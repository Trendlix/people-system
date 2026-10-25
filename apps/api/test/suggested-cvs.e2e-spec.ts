import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import {
  careersIpToken,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  cvFacts,
  HIDDEN,
  type RecruitmentSettingsView,
  type Role,
  type SuggestionAdded,
  type VacancyListItem,
  type VacancySuggestions,
  type VacancySuggestionView,
  type VacancyView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CvReadingsService } from '../src/recruitment/cv-readings.service.js';
import { RecruitmentSchedulerService } from '../src/recruitment/recruitment-scheduler.service.js';
import { VacancySuggestionsService } from '../src/recruitment/vacancy-suggestions.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Suggested From Earlier CVs (owner, 24 October 2026: "does the system automatically add recomended general cv's to the
// opened posts?" and "is there a run to fetch previously updated CV's?"; asked, "Suggest; HR adds", "General CVs + past
// applicants", "Yes, HR presses 'Invite to apply'"). A Video Editor vacancy in the Video team, published by the CEO: its
// earlier CVs worked out (general CVs of the team, a rejected applicant for a Motion Designer job in the same
// department), each with its reasons; never someone hired, a current employee, one found "Not a fit", one who applied
// already, an archived general CV, one older than 12 months, a C-level vacancy's applicant, one filtered out or in the
// running elsewhere; nothing for a C-level vacancy. HR adds a general CV and a past applicant (their applications and
// sources), invites one (the email through the memory outbox, MAIL_TRANSPORT=memory, then their application through
// ?src=invite closes it), dismisses one (it never comes back); HR told once a batch, again only for a new CV; a hiring
// manager refused; a developer's answer masked; each step in the audit log. Every name is invented; the test deletes
// what it made. Since 25 October 2026 ("Full CV fit score"; cv-fit.ts) a read CV is ranked by its CV fit for the vacancy
// (the area, 65 × the fit ÷ 100, recency) in place of the key skills, title and years.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `sg${Date.now().toString(36)}`;
const TODAY = todayInCairo();

const nameOf = (who: string) => `${who[0].toUpperCase()}${who.slice(1)} Person ${RUN}`;
const email = (who: string) => `${who}.${RUN}@mail.test`;
/** Each person's own mobile (the same mobile is one person's): +2010 and 8 digits. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 11;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2010${String(h % 100_000_000).padStart(8, '0')}`;
};

/** A PDF with these lines of text: each person's CV its own file. */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

/** A made-up CV's text: the person, their latest job (its dates), their skills. */
const cvTextOf = (who: string, title: string, from: string, skills: string) => [nameOf(who), 'Experience', `${title}, Studio Example, ${from} - Present`, 'Skills', skills].join('\n');

describe('Suggested From Earlier CVs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const departments: Record<string, string> = {};
  const titles: Record<string, string> = {};
  const employeeIds: string[] = [];
  const vacancies: Record<string, VacancyView> = {};
  let V: VacancyView;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object = {}) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const ok = (res: request.Response, expected = 200): request.Response => {
    if (res.status !== expected) throw new Error(`Expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e }, select: { id: true } })).id;
    sessions[key] = await signIn(app, e);
    return e;
  }

  let ipN = 0;
  /** An application on the careers page, its address signed by the website (each its own address). */
  async function apply(v: VacancyView, who: string, extra: Record<string, string> = {}) {
    const ip = `10.91.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
    const at = String(Date.now());
    let req = api()
      .post(`/api/public/careers/${v.slug}/apply`)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(v.slug)));
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobileOf(who), consent: 'true', yearsExperience: '3', ip, ...extra };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    ok(await req.attach('cv', await pdfOf([`${nameOf(who)} curriculum vitae`]), `${who}.pdf`), 201);
    return prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: v.id, email: email(who) }, select: { id: true, number: true, candidateId: true } });
  }

  /** HR's Add a CV, the area the Video team (unless given). */
  async function addCv(who: string, area = departments.video, lines?: string[]) {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions.hr);
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobileOf(who), departmentId: area, source: 'email', consent: 'true' };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    const made = ok(await req.attach('cv', await pdfOf(lines ?? [`${nameOf(who)} general cv`]), `${who}.pdf`), 201).body as { id: string; number: string };
    return made;
  }

  /** A CV's reading as the readings round keeps it: its text and what the rules found in it. */
  async function read(subject: { applicationId: string } | { generalCvId: string }, text: string) {
    const data = { status: 'read', method: 'pdf', text, facts: cvFacts(text) as object, readAt: new Date() };
    const where = 'applicationId' in subject ? { applicationId: subject.applicationId } : { generalCvId: subject.generalCvId };
    await prisma.cvReading.upsert({ where, create: { ...subject, ...data }, update: data });
  }

  const candidateOf = async (who: string) =>
    (await prisma.candidateContact.findUniqueOrThrow({ where: { kind_value: { kind: 'email', value: email(who) } }, select: { candidateId: true } })).candidateId;

  const suggestions = async (as = 'hr', status?: string) => ok(await get(as, `/recruitment/vacancies/${V.id}/suggestions${status ? `?status=${status}` : ''}`)).body as VacancySuggestions;
  const rowOf = async (who: string, status?: string): Promise<VacancySuggestionView | undefined> => {
    const id = await candidateOf(who);
    return (await suggestions('hr', status)).rows.find((r) => r.candidate.id === id);
  };
  const notices = () => prisma.notification.findMany({ where: { userId: users.hr, kind: 'cv_suggestions', link: `/recruitment/vacancies/${V.id}?view=suggested` }, select: { title: true, body: true } });

  async function vacancy(key: string, as: 'hr' | 'superAdmin', body: object) {
    const made = ok(await post(as, '/recruitment/vacancies', { employmentType: 'full_time', headcount: 2, closingDate: addDays(TODAY, 30), about: '<p>Made-up work.</p>', ...body }), 201).body as VacancyView;
    ok(await post(as, `/recruitment/vacancies/${made.id}/submit`));
    vacancies[key] = ok(await post('ceo', `/recruitment/vacancies/${made.id}/approve`)).body as VacancyView;
    return vacancies[key];
  }

  const people = ['mona', 'lina', 'dana', 'sami', 'arch', 'old', 'emp', 'inproc', 'chief', 'already', 'omar', 'hana', 'nadia', 'filt', 'late'];
  const PEOPLE_TEXT = () => people.flatMap((p) => [nameOf(p), email(p), mobileOf(p)]);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('outsider', ['employee']);
    const devEmail = await account('developer', ['employee']);
    ok(await patch('superAdmin', `/users/${users.developer}`, { roles: ['employee', 'developer'] }));
    sessions.developer = await signIn(app, devEmail);

    departments.studio = (await prisma.department.create({ data: { nameEn: `Studio ${RUN}` }, select: { id: true } })).id;
    departments.video = (await prisma.department.create({ data: { nameEn: `Video ${RUN}`, parentId: departments.studio }, select: { id: true } })).id;
    departments.motion = (await prisma.department.create({ data: { nameEn: `Motion ${RUN}`, parentId: departments.studio }, select: { id: true } })).id;
    departments.radio = (await prisma.department.create({ data: { nameEn: `Radio ${RUN}` }, select: { id: true } })).id;
    departments.board = (await prisma.department.create({ data: { nameEn: `Board ${RUN}` }, select: { id: true } })).id;
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    titles.video = (await prisma.jobTitle.create({ data: { departmentId: departments.video, titleEn: `Video Editor ${RUN}` }, select: { id: true } })).id;
    titles.motion = (await prisma.jobTitle.create({ data: { departmentId: departments.motion, titleEn: `Motion Designer ${RUN}` }, select: { id: true } })).id;
    titles.radio = (await prisma.jobTitle.create({ data: { departmentId: departments.radio, titleEn: `Radio Host ${RUN}` }, select: { id: true } })).id;
    titles.chief = (await prisma.jobTitle.create({ data: { departmentId: departments.board, titleEn: `Chief Creative ${RUN}`, minGradeId: g9 }, select: { id: true } })).id;

    // the vacancy's hiring manager: an employee whose sign-in is their work email
    const managerEmail = await account('manager', ['employee']);
    const manager = await prisma.employee.create({
      data: {
        employeeCode: `HM-${RUN}`,
        fullNameEn: `Hala Manager ${RUN}`,
        fullNameAr: 'مديرة',
        workEmail: managerEmail,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId: departments.video } },
      },
      select: { id: true },
    });
    employeeIds.push(manager.id);
    await prisma.user.update({ where: { id: users.manager }, data: { employeeId: manager.id } });
    // a current employee, whose personal email their general CV carries (their candidate linked to them by it)
    const emp = await prisma.employee.create({
      data: {
        employeeCode: `EMP-SG-${RUN}`,
        fullNameEn: nameOf('emp'),
        fullNameAr: 'موظف',
        personalEmail: email('emp'),
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2025-01-01'), departmentId: departments.motion } },
      },
      select: { id: true },
    });
    employeeIds.push(emp.id);

    // the other jobs, published: a Motion Designer one (the same department), a Radio Host one, and a C-level one
    const P = await vacancy('motion', 'hr', { jobTitleId: titles.motion });
    const R = await vacancy('radio', 'hr', { jobTitleId: titles.radio });
    const C = await vacancy('chief', 'superAdmin', { jobTitleId: titles.chief, headcount: 1 });

    // the earlier applicants
    const omar = await apply(P, 'omar');
    ok(await post('hr', `/recruitment/applications/${omar.id}/stage`, { to: 'rejected', reason: 'Not this time' }));
    const hana = await apply(P, 'hana');
    await prisma.jobApplication.update({ where: { id: hana.id }, data: { stage: 'hired' } });
    const nadia = await apply(P, 'nadia');
    ok(await post('hr', '/recruitment/comments', { applicationId: nadia.id, comment: 'Invented screening note', verdict: 'not_a_fit' }), 201);
    const filt = await apply(P, 'filt');
    await prisma.jobApplication.update({ where: { id: filt.id }, data: { filteredOut: true } });
    const inprocApp = await apply(R, 'inproc');
    await prisma.jobApplication.update({ where: { id: inprocApp.id }, data: { stage: 'interview' } });
    const chiefApp = await apply(C, 'chief');
    for (const [a, who, title] of [
      [omar, 'omar', 'Video Editor'],
      [hana, 'hana', 'Video Editor'],
      [nadia, 'nadia', 'Video Editor'],
      [filt, 'filt', 'Video Editor'],
      [inprocApp, 'inproc', 'Radio Host'],
      [chiefApp, 'chief', 'Creative Director'],
    ] as const) {
      await read({ applicationId: a.id }, cvTextOf(who, title, 'Mar 2021', 'Premiere Pro, After Effects, Storyboarding'));
    }

    // the general CVs, of the Video team
    for (const who of ['mona', 'lina', 'dana', 'sami', 'arch', 'old', 'emp', 'inproc', 'chief', 'already']) {
      const g = await addCv(who);
      await read({ generalCvId: g.id }, cvTextOf(who, 'Video Editor', 'Jan 2022', 'Premiere Pro, After Effects, DaVinci Resolve'));
    }
    const archived = await prisma.generalCv.findFirstOrThrow({ where: { email: email('arch') }, select: { id: true } });
    ok(await post('hr', `/recruitment/general-cvs/${archived.id}/archive`));
    // more than 12 months ago
    const thirteenMonths = new Date();
    thirteenMonths.setUTCMonth(thirteenMonths.getUTCMonth() - 13);
    await prisma.generalCv.updateMany({ where: { email: email('old') }, data: { createdAt: thirteenMonths } });

    // the vacancy: Video Editor, its key skills, a years question (2 at least), Hala its hiring manager; published by the
    // CEO, its suggestions worked out and HR told
    V = await vacancy('video', 'hr', {
      jobTitleId: titles.video,
      title: `Video Editor ${RUN}`,
      hiringManagerId: manager.id,
      keySkills: ['Premiere Pro', 'After Effects', 'DaVinci Resolve', 'Storyboarding'],
      questions: [{ key: 'q1', kind: 'number', text: 'Years of experience in video editing', required: true, knockout: false, atLeast: 2, points: 5 }],
    });
  });

  afterAll(async () => {
    const vacancyIds = Object.values(vacancies).map((v) => v.id);
    const candidates = await prisma.candidateContact.findMany({ where: { kind: 'email', value: { endsWith: `.${RUN}@mail.test` } }, select: { candidateId: true } });
    await prisma.vacancySuggestion.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.generalCv.deleteMany({ where: { email: { endsWith: `.${RUN}@mail.test` } } });
    await prisma.candidate.deleteMany({ where: { id: { in: candidates.map((c) => c.candidateId) } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: Object.values(titles) } } });
    await prisma.department.deleteMany({ where: { id: { in: [departments.video, departments.motion] } } });
    await prisma.department.deleteMany({ where: { id: { in: [departments.studio, departments.radio, departments.board] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.recruitmentSettings.updateMany({ where: { id: 1 }, data: { suggestMonths: 12, inviteSubject: null, inviteEn: null, inviteAr: null } });
    await app.close();
  });

  it('a published vacancy lists a matching general CV and a past applicant, each with its reasons, best first', async () => {
    const s = await suggestions();
    expect(s).toMatchObject({ status: 'suggested', paused: null, emailReady: true, recencyMonths: 12, can: { decide: true, invite: true } });
    const mona = await rowOf('mona');
    expect(mona).toMatchObject({ status: 'suggested', email: email('mona'), candidate: { fullName: nameOf('mona') }, source: { kind: 'general_cv', area: `Video ${RUN} · Studio ${RUN}` } });
    expect(mona!.candidate.code).toMatch(/^CAN-\d{4,}$/);
    // the same team (30); her CV fit 79% (3 of the 4 key skills 75, weight 35; "Video Editor" for "Video Editor …" 2 of
    // its 3 words 67, weight 25; about 5 years against the 2 the questions ask 100, weight 20; nothing else asked):
    // 65 × 79 ÷ 100 = 51; recent (5)
    expect(mona!.reasons.map((r) => r.kind)).toEqual(['area', 'fit', 'recency']);
    expect(mona!.reasons[0]).toMatchObject({ kind: 'area', exact: true, ofTeam: true, points: 30 });
    const fit = mona!.reasons[1];
    expect(fit).toMatchObject({ kind: 'fit', percent: 79, points: 51 });
    expect(fit.kind === 'fit' && fit.parts.map((p) => [p.key, p.score])).toEqual([
      ['skills', 75],
      ['title', 67],
      ['experience', 100],
    ]);
    expect(fit.kind === 'fit' && fit.parts.find((p) => p.key === 'title')).toMatchObject({ matchedTitle: 'Video Editor', titleFrom: 'latest' });
    expect(fit.kind === 'fit' && fit.parts.find((p) => p.key === 'experience')).toMatchObject({ fromCv: true, wanted: { min: 2, max: null, from: 'questions' } });
    expect(mona!.score).toBe(30 + 51 + 5);
    expect(mona!.cv).toMatchObject({ kind: 'general_cv', id: mona!.source!.id, key: `general_cv:${mona!.source!.id}` });
    expect(mona!.can).toEqual({ add: true, invite: true, dismiss: true });
    // Omar, rejected for the Motion Designer job (not "Not a fit"): the same department, his years as typed
    const omar = await rowOf('omar');
    expect(omar).toMatchObject({ source: { kind: 'application', vacancy: { id: vacancies.motion.id } } });
    expect(omar!.reasons[0]).toMatchObject({ kind: 'area', exact: false, points: 15 });
    const omarFit = omar!.reasons.find((r) => r.kind === 'fit');
    expect(omarFit?.kind === 'fit' && omarFit.parts.find((p) => p.key === 'experience')).toMatchObject({ fromCv: false, years: 3, score: 100 });
    // best first
    const scores = s.rows.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(s.rows.length).toBeLessThanOrEqual(50);
    // the CEO reads them and decides them as HR does (owner, 25 October 2026: "Yes, the CEO too")
    const ceo = await suggestions('ceo');
    expect(ceo.can).toEqual(s.can);
    expect(ceo.rows.find((r) => r.id === mona!.id)?.can).toEqual(s.rows.find((r) => r.id === mona!.id)?.can);
  });

  it('never someone hired, a current employee, "Not a fit", already applied, archived, older than 12 months, a C-level applicant, filtered out or in the running elsewhere', async () => {
    // one who applied already: suggested at first, closed once they apply
    expect((await rowOf('already'))?.status).toBe('suggested');
    const already = await apply(V, 'already', { answers: JSON.stringify({ q1: 4 }) });
    expect(await rowOf('already')).toBeUndefined();
    expect(await rowOf('already', 'applied')).toMatchObject({ status: 'applied', application: { id: already.id } });
    const shown = new Set((await suggestions()).rows.map((r) => r.candidate.id));
    for (const who of ['hana', 'emp', 'nadia', 'arch', 'old', 'chief', 'filt', 'inproc', 'already']) {
      expect(shown.has(await candidateOf(who)), who).toBe(false);
    }
    for (const who of ['mona', 'lina', 'dana', 'sami', 'omar']) expect(shown.has(await candidateOf(who)), who).toBe(true);
    // the employee is linked to their profile by their email
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: await candidateOf('emp') }, select: { employeeId: true } })).employeeId).toBe(employeeIds[1]);
    // nothing for a C-level vacancy: the CEO sees it paused, HR never sees it
    const c = ok(await get('ceo', `/recruitment/vacancies/${vacancies.chief.id}/suggestions`)).body as VacancySuggestions;
    expect(c).toMatchObject({ paused: 'c_level', rows: [], can: { decide: false } });
    expect(await prisma.vacancySuggestion.count({ where: { vacancyId: vacancies.chief.id } })).toBe(0);
    await get('hr', `/recruitment/vacancies/${vacancies.chief.id}/suggestions`).expect(404);
    // a C-level vacancy's applicant is suggested for no vacancy at all
    expect(await prisma.vacancySuggestion.count({ where: { candidateId: await candidateOf('chief') } })).toBe(0);
  });

  it('refuses a hiring manager and anyone else', async () => {
    // the hiring manager opens the vacancy, never its suggestions
    expect(ok(await get('manager', `/recruitment/vacancies/${V.id}`)).body.viewer).toBe('hiring_manager');
    await get('manager', `/recruitment/vacancies/${V.id}/suggestions`).expect(403);
    await get('outsider', `/recruitment/vacancies/${V.id}/suggestions`).expect(403);
    const lina = (await rowOf('lina'))!;
    await post('manager', `/recruitment/suggestions/${lina.id}/add`).expect(403);
    expect((await rowOf('lina'))?.status).toBe('suggested');
  });

  it('tells HR once a batch when published: worked out again, nobody is told twice', async () => {
    const told = await notices();
    expect(told).toHaveLength(1);
    expect(told[0].title).toMatch(new RegExp(`^\\d+ earlier CVs? match(es)? Video Editor ${RUN}$`));
    expect(told[0].body).toBe(`${V.number}: open Suggested From Earlier CVs on the vacancy to add them, invite them to apply or dismiss them.`);
    // names never in it
    expect(JSON.stringify(told)).not.toContain('Person');
    await app.get(VacancySuggestionsService).refreshAll({ notify: true });
    await app.get(VacancySuggestionsService).refreshVacancy(V.id, { notify: true });
    expect(await notices()).toHaveLength(1);
  });

  it('Recruitment Settings: how far back CVs count, and the invitation’s words', async () => {
    expect(said(await patch('hr', '/recruitment/settings', { suggestMonths: 0 }).expect(400))).toEqual(['Give how many months back CVs count: a whole number from 1 to 36.']);
    await patch('ceo', '/recruitment/settings', { suggestMonths: 6 }).expect(403);
    const s = ok(await patch('hr', '/recruitment/settings', { suggestMonths: 6, inviteSubject: 'An opening for you: {job}' })).body as RecruitmentSettingsView;
    expect(s.suggestions).toEqual({ recencyMonths: 6 });
    expect(s.invite).toEqual({ subject: 'An opening for you: {job}', en: null, ar: null });
    expect(s.inviteStandard.en).toContain('{link}');
    expect((ok(await patch('hr', '/recruitment/settings', { suggestMonths: 12 })).body as RecruitmentSettingsView).suggestions.recencyMonths).toBe(12);
    // the rejection's words untouched
    expect(s.rejection).toEqual({ subject: null, en: null, ar: null });
  });

  it('adds a general CV and a past applicant: their applications made at Applied, their sources set, without answers', async () => {
    const lina = (await rowOf('lina'))!;
    const added = ok(await post('hr', `/recruitment/suggestions/${lina.id}/add`)).body as SuggestionAdded;
    const app1 = await prisma.jobApplication.findUniqueOrThrow({
      where: { id: added.applicationId },
      select: { vacancyId: true, source: true, stage: true, number: true, matchPercent: true, answers: true, generalCv: { select: { id: true, status: true } }, steps: { select: { note: true } } },
    });
    expect(app1).toMatchObject({ vacancyId: V.id, source: 'general_suggested', stage: 'applied', matchPercent: null, answers: {}, generalCv: { id: lina.source!.id, status: 'moved' } });
    // the general CV's reference kept
    expect(app1.number).toBe(lina.source!.number);
    expect(app1.steps[0].note).toContain('Suggested From Earlier CVs');
    expect(await rowOf('lina', 'added')).toMatchObject({ status: 'added', application: { id: added.applicationId } });
    // again: decided already
    expect(said(await post('hr', `/recruitment/suggestions/${lina.id}/add`).expect(409))[0]).toMatch(/^It was added already/);

    const omar = (await rowOf('omar'))!;
    const earlier = await prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: vacancies.motion.id, email: email('omar') }, select: { id: true, number: true, cv: { select: { sha256: true } } } });
    const made = ok(await post('hr', `/recruitment/suggestions/${omar.id}/add`)).body as SuggestionAdded;
    const app2 = await prisma.jobApplication.findUniqueOrThrow({
      where: { id: made.applicationId },
      select: { vacancyId: true, source: true, stage: true, email: true, mobile: true, candidateId: true, consentNote: true, cv: { select: { sha256: true } }, cvReading: { select: { status: true } }, steps: { select: { note: true } } },
    });
    expect(app2).toMatchObject({ vacancyId: V.id, source: 'earlier_applicant', stage: 'applied', email: email('omar'), mobile: mobileOf('omar'), candidateId: await candidateOf('omar') });
    // the CV copied (no new upload), its reading with it
    expect(app2.cv?.sha256).toBe(earlier.cv?.sha256);
    expect(app2.cvReading?.status).toBe('read');
    expect(app2.consentNote).toBe(`From earlier application ${earlier.number}`);
    expect(app2.steps[0].note).toContain(earlier.number);
    // the applicants' list shows the new sources
    const listed = ok(await get('hr', `/recruitment/applications?vacancyId=${V.id}&filtered=all`)).body as { id: string; source: string }[];
    expect(listed.find((a) => a.id === made.applicationId)?.source).toBe('earlier_applicant');
    expect(listed.find((a) => a.id === added.applicationId)?.source).toBe('general_suggested');
  });

  it('invites one only when HR presses it (the vacancy taking applications), then their application through the link closes it', async () => {
    const sami = (await rowOf('sami'))!;
    // on hold: its link wouldn't open
    ok(await post('hr', `/recruitment/vacancies/${V.id}/hold`));
    expect(said(await post('hr', `/recruitment/suggestions/${sami.id}/invite`).expect(409))[0]).toContain('isn’t taking applications');
    ok(await post('hr', `/recruitment/vacancies/${V.id}/reopen`));
    const before = mail.outbox.length;
    const invited = ok(await post('hr', `/recruitment/suggestions/${sami.id}/invite`)).body as VacancySuggestionView;
    expect(invited).toMatchObject({ status: 'invited', sentTo: email('sami') });
    expect(invited.invitedAt).not.toBeNull();
    const sent = mail.outbox.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: email('sami'), subject: `An opening for you: Video Editor ${RUN}` });
    expect(sent[0].text).toContain(`Dear ${nameOf('sami')},`);
    expect(sent[0].text).toContain(`/careers/${V.slug}?src=invite`);
    expect(sent[0].text).toContain('— — —');
    // not twice
    expect(said(await post('hr', `/recruitment/suggestions/${sami.id}/invite`).expect(409))).toEqual([`They were invited on ${TODAY.split('-').reverse().join('/')} already.`]);
    expect(mail.outbox.length).toBe(before + 1);
    // they apply through the link
    const a = await apply(V, 'sami', { source: 'invite', answers: JSON.stringify({ q1: 3 }) });
    expect((await prisma.jobApplication.findUniqueOrThrow({ where: { id: a.id }, select: { source: true } })).source).toBe('invite');
    expect(await rowOf('sami', 'applied')).toMatchObject({ status: 'applied', sentTo: email('sami'), application: { id: a.id } });
    // put back as it was
    await prisma.recruitmentSettings.updateMany({ where: { id: 1 }, data: { inviteSubject: null } });
  });

  it('dismisses one with a reason (the CEO may too): it never comes back', async () => {
    const dana = (await rowOf('dana'))!;
    const done = ok(await post('ceo', `/recruitment/suggestions/${dana.id}/dismiss`, { reason: 'Saw them last month' })).body as VacancySuggestionView;
    expect(done).toMatchObject({ status: 'dismissed', dismissReason: 'Saw them last month', can: { add: false, invite: false, dismiss: false } });
    await app.get(VacancySuggestionsService).refreshVacancy(V.id, { notify: false });
    expect(await rowOf('dana')).toBeUndefined();
    expect(await rowOf('dana', 'dismissed')).toMatchObject({ id: dana.id, decidedBy: { email: expect.any(String) } });
    expect(await prisma.vacancySuggestion.count({ where: { vacancyId: V.id, candidateId: await candidateOf('dana') } })).toBe(1);
    const counts = (await suggestions()).counts;
    expect(counts).toMatchObject({ dismissed: 1, invited: 0, added: 2 });
    expect(counts.applied).toBe(2);
  });

  it('a new CV read while the vacancy is open: worked out with it, HR told once more, only once', async () => {
    const late = await addCv('late', departments.video, [
      `${nameOf('late')} curriculum vitae`,
      'Experience: Video Editor at a made-up studio for several years',
      'Skills: Premiere Pro, After Effects, colour grading and storyboards',
    ]);
    expect(await notices()).toHaveLength(1);
    await app.get(CvReadingsService).runOnce();
    expect((await prisma.cvReading.findUniqueOrThrow({ where: { generalCvId: late.id }, select: { status: true } })).status).toBe('read');
    expect((await rowOf('late'))?.source).toMatchObject({ kind: 'general_cv', id: late.id });
    expect(await notices()).toHaveLength(2);
    // nothing new: nobody told again, by the readings or by the hourly round
    await app.get(CvReadingsService).runOnce();
    await app.get(RecruitmentSchedulerService).runOnce();
    expect(await notices()).toHaveLength(2);
  });

  it('the vacancies list shows "Suggestions: N"; never a C-level one’s', async () => {
    const list = ok(await get('hr', '/recruitment/vacancies?status=all')).body as VacancyListItem[];
    const open = (await suggestions()).counts.suggested;
    expect(list.find((v) => v.id === V.id)?.suggestions).toBe(open);
    expect(open).toBeGreaterThan(0);
    const ceoList = ok(await get('ceo', '/recruitment/vacancies?status=all')).body as VacancyListItem[];
    expect(ceoList.find((v) => v.id === vacancies.chief.id)?.suggestions).toBe(0);
    expect(ok(await get('hr', `/recruitment/vacancies/${V.id}`)).body.suggestions).toBe(open);
  });

  it('a developer: pseudonyms, codes "••••", the titles and the reason hidden; nothing changed', async () => {
    const all = [] as VacancySuggestionView[];
    for (const status of ['suggested', 'applied', 'dismissed', 'added']) all.push(...(ok(await get('developer', `/recruitment/vacancies/${V.id}/suggestions?status=${status}`)).body as VacancySuggestions).rows);
    expect(all.length).toBeGreaterThan(4);
    const text = JSON.stringify(all);
    for (const value of PEOPLE_TEXT()) expect(text, value).not.toContain(value);
    expect(text).not.toMatch(/(?:APP-\d{4}-\d+|CAN-\d{4,})/);
    expect(text).not.toContain('Saw them last month');
    for (const r of all) {
      expect(r.candidate.fullName).toMatch(/^(Candidate|Applicant|Employee) [2-9A-HJ-NP-Z]{4,6}$/);
      expect(r.candidate.code).toBe(HIDDEN);
      for (const reason of r.reasons) if (reason.kind === 'title') expect(reason.matchedTitle).toBe(HIDDEN);
      // the fit's past titles too (25 October 2026)
      for (const reason of r.reasons) if (reason.kind === 'fit') for (const p of reason.parts) if (p.key === 'title' && p.matchedTitle !== null) expect(p.matchedTitle).toBe(HIDDEN);
      if (r.email) expect(r.email).toMatch(/@hidden\.invalid$/);
      if (r.sentTo) expect(r.sentTo).toMatch(/@hidden\.invalid$/);
      if (r.cv) expect(r.cv.cvFileName).toBe(HIDDEN);
    }
    expect(all.find((r) => r.status === 'dismissed')?.dismissReason).toBe(HIDDEN);
    // a developer changes nothing, nor works anything out
    const mona = (await rowOf('mona'))!;
    await post('developer', `/recruitment/suggestions/${mona.id}/dismiss`, {}).expect(403);
    expect((await rowOf('mona'))?.status).toBe('suggested');
  });

  it('leaves each decision in the audit log: added, invited (to whom, never the words), dismissed, closed', async () => {
    const ids = (await prisma.vacancySuggestion.findMany({ where: { vacancyId: V.id }, select: { id: true } })).map((r) => r.id);
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'vacancy_suggestion', entityId: { in: ids } }, select: { action: true, userId: true, diff: true } });
    const actions = entries.map((e) => e.action);
    expect(actions.filter((a) => a === 'add_suggestion')).toHaveLength(2);
    expect(actions).toEqual(expect.arrayContaining(['invite_to_apply', 'dismiss_suggestion', 'close']));
    const invite = entries.find((e) => e.action === 'invite_to_apply')!;
    expect(invite.userId).toBe(users.hr);
    expect(invite.diff).toMatchObject({ vacancy: V.number, sentTo: email('sami'), status: { from: 'suggested', to: 'invited' } });
    expect(JSON.stringify(invite.diff)).not.toContain('apply here');
    expect(entries.find((e) => e.action === 'dismiss_suggestion')!.diff).toMatchObject({ reason: 'Saw them last month' });
    // the applications made from them, with their sources
    const made = await prisma.auditLog.findMany({ where: { entityType: 'job_application', action: 'create', diff: { path: ['vacancy'], equals: V.number } }, select: { diff: true } });
    expect(made.map((m) => (m.diff as { source: string }).source).sort()).toEqual(['earlier_applicant', 'general_suggested']);
  });
});
