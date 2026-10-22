import type { INestApplication } from '@nestjs/common';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, careersIpToken } from '@trendlix/shared';
import type { ApplicationListItem, ApplicationView, PublicCareers, PublicVacancyView, Role, VacancyListItem, VacancyQuestion, VacancyView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { createApp, createUser, signIn } from './helpers.js';

// Recruitment, Phase 1 (owner, 22 October 2026: "where will we include the ATS?"; "HR creates a vacancy and the CEO
// approves it"; "the match score uses rules from the screening questions"). HR drafts a Video Producer vacancy from its
// job title (the JD filled in), the CEO sends it back with a reason then approves it, and the careers page shows it
// without its salary range or scoring; applicants apply with their CV (a must-have failed filters one out; duplicates,
// the honeypot, a bad CV, too many from one address are refused); HR shortlists, rejects and restores; Make offer moves
// one to Offer, a withdrawn offer back to Shortlisted, an accepted one to Hired and the vacancy to Filled; a C-level
// vacancy is the CEO's alone; only a Super Admin deletes one nobody applied to; the audit log. Every name is invented;
// the test database is emptied at the start of each run, and this file deletes what it made.

const RUN = `rc${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const YEAR = TODAY.slice(0, 4);

const QUESTIONS: VacancyQuestion[] = [
  { key: 'q1', kind: 'yes_no', text: 'Do you live in Cairo?', required: true, knockout: true, wanted: 'yes', points: 5 },
  { key: 'q2', kind: 'number', text: 'Years of video editing', required: true, knockout: false, atLeast: 3, points: 10 },
  {
    key: 'q3',
    kind: 'choice',
    text: 'Which editor do you use most?',
    required: true,
    knockout: false,
    options: [
      { label: 'Premiere Pro', points: 5, accepted: true },
      { label: 'Other', points: 0, accepted: false },
    ],
  },
];

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe('Recruitment (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let cLevelTitleId: string;
  let gradeId: string;
  let shiftId: string;
  let managerId: string;
  const vacancyIds: string[] = [];
  const employeeIds: string[] = [];

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: users[key], kind }, select: { title: true, body: true, link: true } });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
  }

  /**
   * An application from the careers page, as the website sends it: the applicant's address in the form and signed with
   * WEB_KEY for the job (the tests' key, vitest.config.e2e.ts); `signed` false: named in the form only, as someone
   * posting to the API directly would.
   */
  function apply(slug: string, fields: Record<string, string>, cv: { data: Buffer; name: string } | null = { data: PDF, name: 'My CV.pdf' }, signed = true) {
    let req = api().post(`/api/public/careers/${slug}/apply`);
    if (signed && fields.ip) {
      const at = String(Date.now());
      req = req
        .set(CLIENT_IP_HEADER, fields.ip)
        .set(CLIENT_IP_AT_HEADER, at)
        .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, fields.ip, at, careersIpToken(slug)));
    }
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return cv ? req.attach('cv', cv.data, cv.name) : req;
  }
  const applicant = (name: string, ip: string, answers: object = { q1: 'yes', q2: '5', q3: 'Premiere Pro' }, extra: Record<string, string> = {}) => ({
    fullName: `${name} ${RUN}`,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${RUN}@mail.test`,
    mobile: '+20 100 123 4567',
    yearsExperience: '4',
    answers: JSON.stringify(answers),
    consent: 'true',
    ip,
    ...extra,
  });

  async function vacancy(as: string, body: object = {}): Promise<VacancyView> {
    const res = await post(as, '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, salaryMin: 15000, salaryMax: 25000, questions: QUESTIONS, ...body }).expect(201);
    vacancyIds.push(res.body.id);
    return res.body as VacancyView;
  }

  /** A vacancy open on the careers page: drafted by HR, approved by the CEO. */
  async function openVacancy(body: object = {}): Promise<VacancyView> {
    const v = await vacancy('hr', body);
    await post('hr', `/recruitment/vacancies/${v.id}/submit`).expect(200);
    return (await post('ceo', `/recruitment/vacancies/${v.id}/approve`).expect(200)).body as VacancyView;
  }

  const appByEmail = (email: string) => prisma.jobApplication.findFirstOrThrow({ where: { email }, select: { id: true, number: true, stage: true, filteredOut: true, matchPercent: true } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('admin', ['admin']);
    await account('finance', ['finance']);
    await account('outsider', ['employee']);
    departmentId = (await prisma.department.create({ data: { nameEn: `Production ${RUN}` }, select: { id: true } })).id;
    const g3 = await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } });
    const g9 = await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } });
    gradeId = g3.id;
    jobTitleId = (
      await prisma.jobTitle.create({
        data: {
          departmentId,
          titleEn: `Video Producer ${RUN}`,
          jdPurpose: '<p>Produce the studio’s videos.</p>',
          jdDuties: '<ul><li>Shoot</li><li>Edit</li></ul>',
          jdRequirements: '<p>Three years of editing.</p>',
        },
        select: { id: true },
      })
    ).id;
    cLevelTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Chief Creative Officer ${RUN}`, minGradeId: g9.id }, select: { id: true } })).id;
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    const manager = await prisma.employee.create({
      data: { employeeCode: `MGR-${RUN}`, fullNameEn: `Mona Manager ${RUN}`, fullNameAr: 'مديرة', employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01') } } },
      select: { id: true },
    });
    managerId = manager.id;
    employeeIds.push(manager.id);
  });

  afterAll(async () => {
    const apps = await prisma.jobApplication.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true, employeeId: true } });
    const offers = await prisma.jobOffer.findMany({ where: { applicationId: { in: apps.map((a) => a.id) } }, select: { id: true, employeeId: true } });
    const hired = [...apps.map((a) => a.employeeId), ...offers.map((o) => o.employeeId)].filter((id): id is string => !!id);
    await prisma.jobOffer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    for (const id of new Set(hired)) {
      await prisma.generatedDocument.deleteMany({ where: { employeeId: id } });
      const employments = await prisma.employment.findMany({ where: { employeeId: id }, select: { id: true } });
      await prisma.contract.deleteMany({ where: { employmentId: { in: employments.map((e) => e.id) } } });
      await prisma.employment.deleteMany({ where: { employeeId: id } });
      await prisma.employee.deleteMany({ where: { id } });
    }
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: [jobTitleId, cLevelTitleId] } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('vacancies', () => {
    it('are drafted by HR (and a Super Admin) from a job title, its JD filled in; read by the CEO; nobody else', async () => {
      const v = await vacancy('hr', { hiringManagerId: managerId, shiftId, gradeId, closingDate: addDays(TODAY, 30) });
      expect(v).toMatchObject({ status: 'draft', title: `Video Producer ${RUN}`, headcount: 1, salaryMin: 15000, salaryMax: 25000, hiringManager: { id: managerId } });
      expect(v.number).toMatch(new RegExp(`^VAC-${YEAR}-\\d{4}$`));
      expect(v.slug).toBe(`video-producer-${RUN}-${v.number.toLowerCase()}`);
      expect(v.about).toBe('<p>Produce the studio’s videos.</p>');
      expect(v.responsibilities).toBe('<ul><li>Shoot</li><li>Edit</li></ul>');
      expect(v.questions).toHaveLength(3);
      expect(v.can).toMatchObject({ edit: true, submit: true, approve: false });
      await get('ceo', `/recruitment/vacancies/${v.id}`).expect(200);
      for (const who of ['ceo', 'admin', 'finance', 'outsider']) await post(who, '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time' }).expect(403);
      // Phase 2 (22 October 2026): a vacancy opens to its hiring manager too, so anyone else is told it isn't there
      for (const who of ['admin', 'finance', 'outsider']) await get(who, `/recruitment/vacancies/${v.id}`).expect(404);
      await post('superAdmin', '/recruitment/vacancies', { jobTitleId, employmentType: 'part_time', title: `Editor ${RUN}` })
        .expect(201)
        .then((r) => vacancyIds.push(r.body.id));
    });

    it('refuse bad terms and questions in words', async () => {
      const res = await post('hr', '/recruitment/vacancies', {
        jobTitleId,
        employmentType: 'full_time',
        salaryMin: 30000,
        salaryMax: 20000,
        closingDate: addDays(TODAY, -1),
        questions: [{ key: 'q1', kind: 'yes_no', text: 'Car?', required: true, knockout: true }],
      }).expect(400);
      expect(said(res)).toEqual(['Question 1 (Car?): choose the answer wanted, Yes or No.']);
      const terms = await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', salaryMin: 30000, salaryMax: 20000, closingDate: addDays(TODAY, -1) }).expect(400);
      expect(said(terms)).toEqual(['The least salary is more than the most: swap them.', 'The closing date has passed: choose today or a later day.']);
    });

    it('go to the CEO, who sends one back with a reason, then approves it: on the careers page without its salary or scoring', async () => {
      const v = await vacancy('hr');
      await api().get(`/api/public/careers/${v.slug}`).expect(404);
      await post('hr', `/recruitment/vacancies/${v.id}/approve`).expect(403);
      const pending = (await post('hr', `/recruitment/vacancies/${v.id}/submit`).expect(200)).body as VacancyView;
      expect(pending.status).toBe('pending');
      expect(await notices('ceo', 'vacancy_waiting')).toContainEqual({ title: 'A vacancy waits for your approval', body: `${v.title} (${v.number})`, link: `/recruitment/vacancies/${v.id}` });
      expect(said(await patch('hr', `/recruitment/vacancies/${v.id}`, { headcount: 2 }).expect(409))).toEqual(['The vacancy is waiting for the CEO: ask them to send it back to change it.']);
      expect(said(await post('ceo', `/recruitment/vacancies/${v.id}/send-back`, {}).expect(400))).toEqual(['Say why it goes back, so HR knows what to change.']);
      const back = (await post('ceo', `/recruitment/vacancies/${v.id}/send-back`, { reason: 'Lower the headcount' }).expect(200)).body as VacancyView;
      expect(back).toMatchObject({ status: 'draft', sentBackReason: 'Lower the headcount' });
      expect(await notices('hr', 'vacancy_decided')).toContainEqual({ title: 'Vacancy sent back', body: `${v.title} (${v.number}): see why on the vacancy.`, link: `/recruitment/vacancies/${v.id}` });
      await patch('hr', `/recruitment/vacancies/${v.id}`, { headcount: 1, closingDate: addDays(TODAY, 20) }).expect(200);
      await post('hr', `/recruitment/vacancies/${v.id}/submit`).expect(200);
      const open = (await post('ceo', `/recruitment/vacancies/${v.id}/approve`).expect(200)).body as VacancyView;
      expect(open).toMatchObject({ status: 'open', sentBackReason: null });
      expect(open.publishedAt).not.toBeNull();

      const careers = (await api().get('/api/public/careers').expect(200)).body as PublicCareers;
      expect(careers.vacancies.map((x) => x.slug)).toContain(v.slug);
      const page = await api().get(`/api/public/careers/${v.slug}`).expect(200);
      const job = page.body as PublicVacancyView;
      expect(job.questions[0]).toEqual({ key: 'q1', kind: 'yes_no', text: 'Do you live in Cairo?', required: true, options: null });
      expect(job.questions[2].options).toEqual(['Premiere Pro', 'Other']);
      const raw = JSON.stringify(page.body);
      for (const hidden of ['salary', 'points', 'knockout', 'accepted', 'wanted', 'atLeast']) expect(raw).not.toContain(hidden);

      // published: the job title stays; held and reopened; the questions change until someone applies
      expect(said(await patch('hr', `/recruitment/vacancies/${v.id}`, { employmentType: 'part_time' }).expect(409))).toEqual([
        'The vacancy is published: its employment type stays. Close it and open a new one instead.',
      ]);
      await post('hr', `/recruitment/vacancies/${v.id}/hold`).expect(200);
      await api().get(`/api/public/careers/${v.slug}`).expect(404);
      await post('hr', `/recruitment/vacancies/${v.id}/reopen`).expect(200);
      await api().get(`/api/public/careers/${v.slug}`).expect(200);
    });

    it('for a C-level position are the CEO’s and a Super Admin’s alone', async () => {
      expect(said(await post('hr', '/recruitment/vacancies', { jobTitleId: cLevelTitleId, employmentType: 'full_time' }).expect(403))).toEqual([
        'Only the CEO or a Super Admin sees C-level positions, so only they open a vacancy for one.',
      ]);
      const res = await post('superAdmin', '/recruitment/vacancies', { jobTitleId: cLevelTitleId, employmentType: 'full_time' }).expect(201);
      vacancyIds.push(res.body.id);
      expect(res.body.confidential).toBe(true);
      await get('hr', `/recruitment/vacancies/${res.body.id}`).expect(404);
      expect(((await get('hr', '/recruitment/vacancies?status=all').expect(200)).body as VacancyListItem[]).map((x) => x.id)).not.toContain(res.body.id);
      await get('ceo', `/recruitment/vacancies/${res.body.id}`).expect(200);
    });

    it('are deleted by a Super Admin only, and only while nobody applied', async () => {
      const v = await vacancy('hr');
      await api().delete(`/api/recruitment/vacancies/${v.id}`).set('Cookie', sessions.hr).expect(403);
      await api().delete(`/api/recruitment/vacancies/${v.id}`).set('Cookie', sessions.superAdmin).expect(204);
      expect(await prisma.vacancy.count({ where: { id: v.id } })).toBe(0);
    });
  });

  describe('applying', () => {
    let v: VacancyView;
    beforeAll(async () => {
      v = await openVacancy();
    });

    it('takes an application with its CV, scored by the questions, HR told once a day', async () => {
      const res = await apply(v.slug, { ...applicant('Sara Strong', '10.1.0.1'), linkedin: 'https://linkedin.com/in/sara', source: 'linkedin' }).expect(201);
      expect(res.body.reference).toMatch(new RegExp(`^APP-${YEAR}-\\d{4}$`));
      const a = await prisma.jobApplication.findUniqueOrThrow({ where: { number: res.body.reference }, include: { cv: true, steps: true } });
      expect(a).toMatchObject({ stage: 'applied', filteredOut: false, points: 20, maxPoints: 20, matchPercent: 100, source: 'linkedin', email: `sara.strong.${RUN}@mail.test`, ip: '10.1.0.1' });
      expect(a.cv).toMatchObject({ fileName: 'My CV.pdf', mimeType: 'application/pdf' });
      expect(a.steps.map((s) => s.event)).toEqual(['applied']);
      await apply(v.slug, applicant('Omar Other', '10.1.0.2', { q1: 'yes', q2: '1', q3: 'Other' })).expect(201);
      const omar = await appByEmail(`omar.other.${RUN}@mail.test`);
      expect(omar.matchPercent).toBe(25);
      expect(await notices('hr', 'applications_new')).toEqual([{ title: 'New applications', body: `${v.title} (${v.number}): open the vacancy to review them.`, link: `/recruitment/vacancies/${v.id}` }]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'job_application', entityId: a.id, action: 'apply' } });
      expect(audit.userId).toBeNull();
    });

    it('keeps one failing a must-have, filtered out', async () => {
      await apply(v.slug, applicant('Fady Far', '10.1.0.3', { q1: 'no', q2: '9', q3: 'Premiere Pro' })).expect(201);
      const fady = await appByEmail(`fady.far.${RUN}@mail.test`);
      expect(fady).toMatchObject({ filteredOut: true, matchPercent: 75 });
    });

    it('refuses duplicates, the honeypot, a bad or missing CV, missing answers and a closed job', async () => {
      expect(said(await apply(v.slug, applicant('Sara Strong', '10.1.0.4')).expect(409))[0]).toMatch(/^You applied for this job on .+ already\. HR will be in touch\.$/);
      expect(said(await apply(v.slug, { ...applicant('Robo Bot', '10.1.0.5'), website: 'http://spam.test' }).expect(400))).toEqual(["Your application couldn't be sent. Please try again."]);
      expect(said(await apply(v.slug, applicant('No Cv', '10.1.0.6'), null).expect(400))).toEqual(['Attach your CV, as a PDF or a Word file.']);
      expect(said(await apply(v.slug, applicant('Svg Cv', '10.1.0.7'), { data: Buffer.from('<svg onload="x()"/>'), name: 'cv.pdf' }).expect(400))).toEqual([
        'Your CV must be a PDF or a Word file (.docx).',
      ]);
      expect(said(await apply(v.slug, applicant('Big Cv', '10.1.0.8'), { data: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), name: 'big.pdf' }).expect(413))).toEqual([
        'Your CV must be 5 MB or smaller.',
      ]);
      expect(said(await apply(v.slug, { ...applicant('Half Done', '10.1.0.9', {}), consent: '' }).expect(400))).toEqual([
        'Answer: Do you live in Cairo?',
        'Answer: Years of video editing',
        'Answer: Which editor do you use most?',
        'Tick that we may keep your application and CV to consider you for this job.',
      ]);
      await api().get('/api/public/careers/no-such-job-vac-2026-9999').expect(404);
    });

    // 22 October 2026: an applicant typed "www.linkedin.com/in/…" and the form wanted https://
    it('takes a link typed without https://, keeping it whole', async () => {
      await apply(v.slug, applicant('Link Typer', '10.7.0.1', undefined, { linkedin: 'www.linkedin.com/in/link-typer-1', portfolio: 'behance.net/link-typer' })).expect(201);
      const kept = await prisma.jobApplication.findFirstOrThrow({ where: { email: `link.typer.${RUN}@mail.test` }, select: { linkedin: true, portfolio: true } });
      expect(kept).toEqual({ linkedin: 'https://www.linkedin.com/in/link-typer-1', portfolio: 'https://behance.net/link-typer' });
      expect(said(await apply(v.slug, applicant('Bad Link', '10.7.0.2', undefined, { linkedin: 'not a link' })).expect(400))).toEqual([
        'Write your LinkedIn link, e.g. linkedin.com/in/your-name, or leave it empty.',
      ]);
    });

    // 22 October 2026, the owner trying the form on an iPhone: the mobile "like the one applied in the system, country code
    // and no extra zero"; the notice period "in Days" … "and a selectoor to make it months"; "validate email field"
    it('keeps the mobile as the system keeps phones and the notice period as days or months; refuses a wrong email, mobile or notice period', async () => {
      await apply(v.slug, applicant('Local Mobile', '10.7.1.1', undefined, { mobile: '01012345678', noticePeriod: '2 months', yearsExperience: '2.5' })).expect(201);
      await apply(v.slug, applicant('Spaced Mobile', '10.7.1.2', undefined, { mobile: '+20 101 234 5679', noticePeriod: '1 days' })).expect(201);
      const kept = await prisma.jobApplication.findMany({
        where: { email: { in: [`local.mobile.${RUN}@mail.test`, `spaced.mobile.${RUN}@mail.test`] } },
        orderBy: { createdAt: 'asc' },
        select: { mobile: true, noticePeriod: true, yearsExperience: true },
      });
      expect(kept.map((k) => [k.mobile, k.noticePeriod, Number(k.yearsExperience)])).toEqual([
        ['+201012345678', '2 months', 2.5],
        ['+201012345679', '1 day', 4],
      ]);
      // HR finds them however the mobile is typed
      const found = (q: string) => get('hr', `/recruitment/applications?vacancyId=${v.id}&q=${encodeURIComponent(q)}`).expect(200).then((r) => (r.body as ApplicationListItem[]).map((a) => a.fullName));
      expect(await found('0101 234 5678')).toEqual([`Local Mobile ${RUN}`]);
      expect(await found('234 5679')).toEqual([`Spaced Mobile ${RUN}`]);
      expect(
        said(await apply(v.slug, applicant('Wrong Fields', '10.7.1.3', undefined, { email: 'wrong.fields@mail', mobile: '0101234', yearsExperience: '3.3', noticePeriod: 'one month' })).expect(400)),
      ).toEqual([
        'Write a full email address, e.g. name@example.com.',
        'Write the mobile number without the 0 in front, after choosing the country code.',
        'Write your years of experience as a number from 0 to 60, e.g. 3 or 2.5.',
        'Write the notice period as a number of days or months.',
      ]);
      expect(said(await apply(v.slug, applicant('Long Notice', '10.7.1.4', undefined, { noticePeriod: '13 months' })).expect(400))).toEqual([
        'Keep the notice period to 365 days or 12 months at most.',
      ]);
      expect(said(await apply(v.slug, applicant('Odd Mail', '10.7.1.5', undefined, { email: 'odd mail@mail.test' })).expect(400))).toEqual([
        'Write a full email address, e.g. name@example.com.',
      ]);
    });

    it('refuses more than 5 an hour from one address', async () => {
      for (let i = 1; i <= 5; i++) await apply(v.slug, applicant(`Busy Person${i}`, '10.9.9.9')).expect(201);
      expect(said(await apply(v.slug, applicant('Busy Person6', '10.9.9.9')).expect(429))).toEqual(['You have sent several applications in the last hour. Please try again later.']);
    });

    // 22 October 2026: an address only named in the form, not signed by the website, is ignored: the connection's counts,
    // so posting to the API directly with another address each time doesn't get round the limit
    it('counts an unsigned application against the connection’s address, whatever address it names', async () => {
      const w = await openVacancy({ title: `Runner ${RUN}` });
      for (let i = 1; i <= 5; i++) await apply(w.slug, applicant(`Direct Poster${i}`, `10.8.0.${i}`), undefined, false).expect(201);
      expect(said(await apply(w.slug, applicant('Direct Poster6', '10.8.0.6'), undefined, false).expect(429))).toEqual([
        'You have sent several applications in the last hour. Please try again later.',
      ]);
      // signed by the website, its own address counts
      await apply(w.slug, applicant('Direct Poster7', '10.8.0.7')).expect(201);
    });
  });

  describe('applicants', () => {
    let v: VacancyView;
    let sara: string;
    let fady: string;
    beforeAll(async () => {
      v = await openVacancy({ title: `Editor ${RUN}` });
      await apply(v.slug, applicant('Sara Second', '10.2.0.1')).expect(201);
      await apply(v.slug, applicant('Fady Second', '10.2.0.2', { q1: 'no', q2: '9', q3: 'Other' })).expect(201);
      await apply(v.slug, applicant('Lina Low', '10.2.0.3', { q1: 'yes', q2: '0', q3: 'Other' })).expect(201);
      sara = (await appByEmail(`sara.second.${RUN}@mail.test`)).id;
      fady = (await appByEmail(`fady.second.${RUN}@mail.test`)).id;
    });

    it('are listed by match, those filtered out apart, for HR and the CEO', async () => {
      const list = (await get('hr', `/recruitment/applications?vacancyId=${v.id}`).expect(200)).body as ApplicationListItem[];
      expect(list.map((a) => a.fullName)).toEqual([`Sara Second ${RUN}`, `Lina Low ${RUN}`]);
      const out = (await get('ceo', `/recruitment/applications?vacancyId=${v.id}&filtered=only`).expect(200)).body as ApplicationListItem[];
      expect(out.map((a) => a.id)).toEqual([fady]);
      const good = (await get('hr', `/recruitment/applications?vacancyId=${v.id}&minMatch=70`).expect(200)).body as ApplicationListItem[];
      expect(good.map((a) => a.id)).toEqual([sara]);
      await get('outsider', `/recruitment/applications?vacancyId=${v.id}`).expect(403);
      const counts = (await get('hr', `/recruitment/vacancies/${v.id}`).expect(200)).body as VacancyView;
      expect(counts).toMatchObject({ applicants: 3, toReview: 2, filteredOut: 1 });
    });

    it('show their answers, how each did, and their CV', async () => {
      const a = (await get('hr', `/recruitment/applications/${fady}`).expect(200)).body as ApplicationView;
      expect(a.answers.map((x) => [x.key, x.answer, x.points, x.passed])).toEqual([
        ['q1', 'no', 0, false],
        ['q2', 9, 10, null],
        ['q3', 'Other', 0, null],
      ]);
      expect(a.cv).toMatchObject({ fileName: 'My CV.pdf', mimeType: 'application/pdf' });
      expect(a.can).toMatchObject({ shortlist: false, restore: true, makeOffer: false });
      const cv = await get('hr', `/recruitment/applications/${fady}/cv`).buffer(true).expect(200);
      expect(cv.headers['content-type']).toBe('application/pdf');
      // Phase 2 (22 October 2026): an applicant opens to their hiring manager and interviewers too: 404 for anyone else
      await get('outsider', `/recruitment/applications/${fady}/cv`).expect(404);
    });

    it('are shortlisted, rejected with a reason and restored; one filtered out restored first', async () => {
      expect(said(await post('hr', `/recruitment/applications/${fady}/stage`, { to: 'shortlisted' }).expect(409))).toEqual([
        'They failed a must-have question and were filtered out: restore them first.',
      ]);
      await post('hr', `/recruitment/applications/${fady}/restore`).expect(200);
      await post('hr', `/recruitment/applications/${fady}/stage`, { to: 'shortlisted' }).expect(200);
      await post('ceo', `/recruitment/applications/${sara}/stage`, { to: 'shortlisted' }).expect(403);
      await post('hr', `/recruitment/applications/${sara}/stage`, { to: 'shortlisted' }).expect(200);
      await post('hr', `/recruitment/applications/${sara}/stage`, { to: 'interview' }).expect(200);
      expect(said(await post('hr', `/recruitment/applications/${sara}/stage`, { to: 'rejected' }).expect(400))).toEqual(['Say why they are rejected.']);
      await post('hr', `/recruitment/applications/${sara}/stage`, { to: 'rejected', reason: 'Portfolio too thin' }).expect(200);
      let a = (await get('hr', `/recruitment/applications/${sara}`).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ stage: 'rejected', rejectReason: 'Portfolio too thin' });
      a = (await post('hr', `/recruitment/applications/${sara}/restore`).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ stage: 'interview', rejectReason: null });
      expect(a.history.map((h) => h.event)).toEqual(['applied', 'shortlisted', 'interview', 'rejected', 'restored']);
      await patch('hr', `/recruitment/applications/${sara}/notes`, { notes: 'Strong reel' }).expect(200);
      expect((await get('ceo', `/recruitment/applications/${sara}`).expect(200)).body.notes).toBe('Strong reel');
    });

    it('get a job offer from Make offer; withdrawn, back to shortlisted; accepted, hired and the vacancy filled', async () => {
      const offer = (extra: object = {}) => ({
        fullNameEn: `Sara Second ${RUN}`,
        fullNameAr: 'سارة',
        email: `sara.second.${RUN}@mail.test`,
        employmentType: 'full_time',
        joinDate: addDays(TODAY, 14),
        jobTitleId,
        gradeId,
        shiftId,
        grossSalary: 20000,
        applicationId: sara,
        ...extra,
      });
      // not from one only applied
      const lina = (await appByEmail(`lina.low.${RUN}@mail.test`)).id;
      expect(said(await post('hr', '/offers', offer({ applicationId: lina })).expect(409))).toEqual(['They are at Applied: shortlist them first.']);
      const first = (await post('hr', '/offers', offer()).expect(201)).body as { id: string; number: string; application: { id: string; number: string } };
      expect(first.application.id).toBe(sara);
      expect((await get('hr', `/recruitment/applications/${sara}`).expect(200)).body.stage).toBe('offer');
      expect(said(await post('hr', '/offers', offer()).expect(409))).toEqual([`A job offer to them is open already (${first.number}).`]);
      expect(said(await post('hr', `/recruitment/applications/${sara}/stage`, { to: 'rejected', reason: 'x' }).expect(409))).toEqual(['A job offer to them is open: withdraw it first.']);
      await post('hr', `/offers/${first.id}/withdraw`, { reason: 'Terms changed' }).expect(200);
      let a = (await get('hr', `/recruitment/applications/${sara}`).expect(200)).body as ApplicationView;
      expect(a.stage).toBe('shortlisted');
      expect(a.history.at(-1)).toMatchObject({ event: 'offer_withdrawn', note: first.number });
      const second = (await post('hr', '/offers', offer()).expect(201)).body as { id: string };
      await post('hr', `/offers/${second.id}/answer`, { answer: 'accepted' }).expect(200);
      a = (await get('hr', `/recruitment/applications/${sara}`).expect(200)).body as ApplicationView;
      expect(a.stage).toBe('hired');
      expect(a.employeeId).not.toBeNull();
      expect(a.offers.map((o) => o.status)).toEqual(['withdrawn', 'accepted']);
      const filled = (await get('hr', `/recruitment/vacancies/${v.id}`).expect(200)).body as VacancyView;
      expect(filled).toMatchObject({ status: 'filled', hired: 1 });
      await api().get(`/api/public/careers/${v.slug}`).expect(404);
      // a vacancy someone applied to stays
      expect(said(await api().delete(`/api/recruitment/vacancies/${v.id}`).set('Cookie', sessions.superAdmin).expect(409))).toEqual([
        'People applied to it, so it stays on record. Close it instead.',
      ]);
    });

    it('leave their steps in the audit log', async () => {
      const rows = await prisma.auditLog.findMany({ where: { entityType: 'job_application', entityId: sara }, orderBy: { at: 'asc' }, select: { action: true } });
      expect(rows.map((r) => r.action)).toEqual(['apply', 'stage', 'stage', 'stage', 'restore', 'notes', 'stage', 'stage', 'stage', 'stage']);
      const vacancyRows = await prisma.auditLog.findMany({ where: { entityType: 'vacancy', entityId: v.id }, orderBy: { at: 'asc' }, select: { action: true } });
      expect(vacancyRows.map((r) => r.action)).toEqual(['create', 'submit', 'approve', 'fill']);
    });
  });
});
