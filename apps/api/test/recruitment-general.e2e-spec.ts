import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import { CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, GENERAL_CV_IP_TOKEN } from '@trendlix/shared';
import type { ApplicantsSummary, ApplicationListItem, ApplicationView, CvSaveResult, CvUploadView, GeneralCvListItem, GeneralCvView, PublicGeneralForm, Role, VacancyView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// General CVs, the applicants by posted job and the bulk upload (owner, 22 October 2026: "i want a proper viweing, what
// came out of the posted jobs and what cam on randomly", "Both"; "is there a way to easy apply from linkedin?" … "why
// not"). Someone sends their CV on the careers page without a job (the area, the consent, the field robots fill, the
// signed address's hourly limit, one CV an email every 30 days); HR adds one that came by email (their agreement
// ticked), marks it reviewed, archives and restores it, and moves it to an open vacancy (an application keeping its
// reference, its source "General CV (Email)"); the Applicants page's summary counts each vacancy's applicants by stage
// and source. HR drops CVs on the vacancy (read for the name, email and mobile; a scanned one by its file's name; one
// already there flagged and skipped) and on the general CVs (one sent in the last 30 days skipped unless kept). The CEO
// reads, nobody else. Every name is invented; the test deletes what it made.

const RUN = `gc${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const YEAR = TODAY.slice(0, 4);
/** Each person's own mobile (candidate profiles, 22 October 2026: the same mobile is one person's, joined as one): +2010 and 8 digits. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2010${String(h % 100_000_000).padStart(8, '0')}`;
};

/** A PDF with these lines of text (none: a scanned one, no text). */
async function pdfOf(lines: string[] = []): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 20, size: 12, font }));
  return Buffer.from(await doc.save());
}

describe('General CVs and the bulk upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let departmentId: string;
  let boardId: string;
  let boardTitleId: string;
  let teamId: string;
  /** Two teams called the same in two departments, and a department without teams (22 October 2026). */
  let soundStudioId: string;
  let otherDepartmentId: string;
  let soundOtherId: string;
  let loneId: string;
  let jobTitleId: string;
  let vacancy: VacancyView;
  let cv: Buffer;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const email = (who: string) => `${who}.${RUN}@mail.test`;

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e } })).id;
    sessions[key] = await signIn(app, e);
  }

  /** "Send us your CV" as the website sends it: the address signed for the general form (`signed` false: only named). */
  function send(fields: Record<string, string>, file: Buffer | null = cv, signed = true) {
    let req = api().post('/api/public/general-cvs');
    if (signed && fields.ip) {
      const at = String(Date.now());
      req = req.set(CLIENT_IP_HEADER, fields.ip).set(CLIENT_IP_AT_HEADER, at).set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, fields.ip, at, GENERAL_CV_IP_TOKEN));
    }
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return file ? req.attach('cv', file, 'My CV.pdf') : req;
  }
  const person = (who: string, ip: string, extra: Record<string, string> = {}) => ({
    fullName: `${who} Person ${RUN}`,
    email: email(who),
    mobile: mobileOf(who),
    departmentId: teamId,
    consent: 'true',
    ip,
    ...extra,
  });

  /** HR's Add a CV. */
  function add(as: string, fields: Record<string, string>, file: Buffer | null = cv) {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions[as]);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return file ? req.attach('cv', file, 'Their CV.pdf') : req;
  }

  /** A CV dropped in a bulk upload (`vacancyId` none: the general CVs). */
  function upload(as: string, file: Buffer, name: string, vacancyId?: string) {
    return api()
      .post(`/api/recruitment/cv-uploads${vacancyId ? `?vacancyId=${vacancyId}` : ''}`)
      .set('Cookie', sessions[as])
      .attach('cv', file, name);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('hr2', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('outsider', ['employee']);
    departmentId = (await prisma.department.create({ data: { nameEn: `Studio ${RUN}` }, select: { id: true } })).id;
    teamId = (await prisma.department.create({ data: { nameEn: `Video ${RUN}`, parentId: departmentId }, select: { id: true } })).id;
    soundStudioId = (await prisma.department.create({ data: { nameEn: `Sound ${RUN}`, parentId: departmentId }, select: { id: true } })).id;
    otherDepartmentId = (await prisma.department.create({ data: { nameEn: `Radio ${RUN}` }, select: { id: true } })).id;
    soundOtherId = (await prisma.department.create({ data: { nameEn: `Sound ${RUN}`, parentId: otherDepartmentId }, select: { id: true } })).id;
    loneId = (await prisma.department.create({ data: { nameEn: `Finance ${RUN}` }, select: { id: true } })).id;
    // a C-level department: its only job title for G9 · Executive, a confidential grade (22 October 2026)
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    boardId = (await prisma.department.create({ data: { nameEn: `Board ${RUN}` }, select: { id: true } })).id;
    boardTitleId = (await prisma.jobTitle.create({ data: { departmentId: boardId, titleEn: `Chief Officer ${RUN}`, minGradeId: g9 }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Editor ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    const made = (await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 2, closingDate: addDays(TODAY, 30) }).expect(201)).body as VacancyView;
    await post('hr', `/recruitment/vacancies/${made.id}/submit`).expect(200);
    vacancy = (await post('ceo', `/recruitment/vacancies/${made.id}/approve`).expect(200)).body as VacancyView;
    cv = await pdfOf(['A made-up CV']);
  });

  afterAll(async () => {
    await prisma.cvUpload.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.generalCv.deleteMany({ where: { email: { endsWith: `.${RUN}@mail.test` } } });
    await prisma.jobApplication.deleteMany({ where: { vacancy: { jobTitleId } } });
    await prisma.vacancy.deleteMany({ where: { jobTitleId } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.jobTitle.deleteMany({ where: { id: boardTitleId } });
    await prisma.department.deleteMany({ where: { id: { in: [teamId, boardId, soundStudioId, soundOtherId, loneId] } } });
    await prisma.department.deleteMany({ where: { id: { in: [departmentId, otherDepartmentId] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
  });

  describe('“Send us your CV” on the careers page', () => {
    // owner, 22 October 2026: "from my POV, it should be related to teams not departments"; "C Level isn't an option for
    // any user or even HR, how will someone apply for a c-level"; then "remove the department from the dropdown menu,
    // area you would like to work in"
    it('offers each team by its own name, a department only without teams, and never a C-level one', async () => {
      const form = (await api().get('/api/public/general-cvs/form').expect(200)).body as PublicGeneralForm;
      expect(form.areas).toContainEqual({ id: teamId, name: `Video ${RUN}`, hrName: `Video ${RUN} · Studio ${RUN}` });
      expect(form.areas).toContainEqual({ id: loneId, name: `Finance ${RUN}`, hrName: `Finance ${RUN}` });
      // Studio has job titles of its own, but it has teams: never an option
      expect(form.areas.map((a) => a.id)).not.toContain(departmentId);
      expect(form.areas.map((a) => a.id)).not.toContain(otherDepartmentId);
      expect(form.areas.map((a) => a.id)).not.toContain(boardId);
    });

    it('tells apart two teams with the same name by their departments, in the organisation’s order', async () => {
      const form = (await api().get('/api/public/general-cvs/form').expect(200)).body as PublicGeneralForm;
      const sounds = form.areas.filter((a) => a.id === soundStudioId || a.id === soundOtherId);
      expect(sounds.map((a) => a.name).sort()).toEqual([`Sound ${RUN} (Radio ${RUN})`, `Sound ${RUN} (Studio ${RUN})`]);
      expect(form.areas.find((a) => a.id === teamId)?.name).toBe(`Video ${RUN}`);
    });

    it('names every problem, wants a CV, and refuses a robot', async () => {
      expect(said(await send({ fullName: 'M', email: 'x', mobile: '1', ip: '10.6.0.1' }).expect(400))).toEqual([
        'Write your full name.',
        'Write a full email address, e.g. name@example.com.',
        'Write the mobile number without the 0 in front, after choosing the country code.',
        'Choose the position you would like, or Other and write it.',
        'Tick that we may keep your details and CV to consider you for jobs.',
      ]);
      expect(said(await send(person('Nocv', '10.6.0.1'), null).expect(400))).toEqual(['Attach your CV, as a PDF or a Word file.']);
      expect(said(await send({ ...person('Board', '10.6.0.1'), departmentId: boardId }).expect(400))).toEqual(['Choose one of the areas, or Other and write it.']);
      // a department with teams is no longer an area (22 October 2026: "remove the department from the dropdown menu")
      expect(said(await send({ ...person('Dept', '10.6.0.1'), departmentId }).expect(400))).toEqual(['Choose one of the areas, or Other and write it.']);
      expect(said(await send({ ...person('Robot', '10.6.0.1'), website: 'spam' }).expect(400))).toEqual(["Your CV couldn't be sent. Please try again."]);
    });

    it('keeps it new, with its reference in the applications’ series, the person’s consent, and tells HR once a day', async () => {
      const first = (await send({ ...person('Sara', '10.6.0.2'), linkedin: 'linkedin.com/in/sara' }).expect(201)).body as { reference: string };
      expect(first.reference).toMatch(new RegExp(`^APP-${YEAR}-\\d{4}$`));
      const row = await prisma.generalCv.findFirstOrThrow({ where: { email: email('sara') }, include: { events: true } });
      expect(row).toMatchObject({ number: first.reference, status: 'new', source: 'careers', departmentId: teamId, consentById: null, createdById: null, linkedin: 'https://linkedin.com/in/sara' });
      expect(row.events.map((e) => e.event)).toEqual(['received']);
      // the series goes on whichever list it is on
      const second = (await send({ ...person('Area', '10.6.0.3'), departmentId: '', areaOther: 'Photography' }).expect(201)).body as { reference: string };
      expect(Number(second.reference.slice(9))).toBeGreaterThan(Number(first.reference.slice(9)));
      const told = await prisma.notification.findMany({ where: { userId: users.hr, kind: 'applications_new', link: '/recruitment/applicants?tab=general' } });
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ title: 'New CVs' });
      // one CV an email every 30 days
      expect(said(await send(person('Sara', '10.6.0.4')).expect(409))[0]).toMatch(/^You sent us your CV on \d{2}\/\d{2}\/\d{4} already\. HR will be in touch\.$/);
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'general_cv', entityId: row.id } })).action).toBe('apply');
    });

    // 22 October 2026, the owner trying the form on an iPhone: the mobile "like the one applied in the system, country
    // code and no extra zero"; the notice period "in Days" … "and a selectoor to make it months"; "validate email field"
    it('keeps the mobile as the system keeps phones and the notice period as days or months; refuses a wrong email, mobile or notice period', async () => {
      await send(person('Local', '10.6.1.1', { mobile: '01001234567', noticePeriod: '45 days', yearsExperience: '1.5', departmentId: loneId })).expect(201);
      const kept = await prisma.generalCv.findFirstOrThrow({ where: { email: email('local') }, select: { mobile: true, noticePeriod: true, yearsExperience: true, departmentId: true } });
      expect(kept).toMatchObject({ mobile: '+201001234567', noticePeriod: '45 days', departmentId: loneId });
      expect(Number(kept.yearsExperience)).toBe(1.5);
      expect(said(await send(person('Wrong', '10.6.1.2', { email: 'wrong@mail', mobile: '+20 100', noticePeriod: '400 days' })).expect(400))).toEqual([
        'Write a full email address, e.g. name@example.com.',
        'Write the mobile number without the 0 in front, after choosing the country code.',
        'Keep the notice period to 365 days or 12 months at most.',
      ]);
      expect(said(await send(person('Words', '10.6.1.2', { noticePeriod: 'a month' })).expect(400))).toEqual(['Write the notice period as a number of days or months.']);
      // HR finds it however the mobile is typed
      const list = (q: string) => get('hr', `/recruitment/general-cvs?q=${encodeURIComponent(q)}`).expect(200).then((r) => (r.body as GeneralCvListItem[]).map((c) => c.fullName));
      expect(await list('0100 123 4567')).toContain(`Local Person ${RUN}`);
    });

    it('takes 5 an hour from an address it signed; one only named counts against the connection', async () => {
      for (let i = 1; i <= 5; i++) await send(person(`Busy${i}`, '10.6.9.9')).expect(201);
      expect(said(await send(person('Busy6', '10.6.9.9')).expect(429))).toEqual(['You have sent several CVs in the last hour. Please try again later.']);
      for (let i = 1; i <= 5; i++) await send(person(`Direct${i}`, `10.6.8.${i}`), cv, false).expect(201);
      expect(said(await send(person('Direct6', '10.6.8.6'), cv, false).expect(429))).toEqual(['You have sent several CVs in the last hour. Please try again later.']);
    });
  });

  describe('HR’s general CVs', () => {
    let added: GeneralCvView;

    it('HR (and a Super Admin) add one that came by email, the person’s agreement ticked; the CEO reads; nobody else', async () => {
      const fields = { fullName: `Omar Added ${RUN}`, email: email('omar'), mobile: '01001234568', departmentId: teamId, source: 'email', consent: 'true', notes: 'Sent to hr@', noticePeriod: '1 month' };
      expect(said(await add('hr', { ...fields, consent: '' }).expect(400))).toEqual(['Tick that the person agreed to be considered.']);
      expect(said(await add('hr', { ...fields, source: 'referral' }).expect(400))).toEqual(['Write who referred them.']);
      await add('ceo', fields).expect(403);
      await add('outsider', fields).expect(403);
      added = (await add('hr', fields).expect(201)).body as GeneralCvView;
      // HR's notes typed with it: its first screening comment, theirs (24 October 2026), the notes column left alone
      expect(added).toMatchObject({ status: 'new', source: 'email', area: `Video ${RUN} · Studio ${RUN}`, mobile: '+201001234568', noticePeriod: '1 month', notes: null, consentNote: 'Agreed to be considered (recorded by HR)', can: { review: true, archive: true, move: true, editNotes: false } });
      const first = (await get('hr', `/recruitment/general-cvs/${added.id}/comments`).expect(200)).body as { comments: { comment: string; authorRole: string; about: { kind: string } }[] };
      expect(first.comments.map((c) => [c.comment, c.authorRole, c.about.kind])).toEqual([['Sent to hr@', 'hr', 'general_cv']]);
      // HR's too: a department with teams is no longer an area
      expect(said(await add('hr', { ...fields, departmentId }).expect(400))).toEqual(['Choose one of the areas, or Other and write it.']);
      expect(added.consentBy?.email).toBeTruthy();
      expect(added.addedBy?.email).toBe(added.consentBy?.email);
      expect(added.history.map((h) => [h.event, h.note])).toEqual([['received', 'Added by HR (Email)']]);
      expect(said(await add('superAdmin', fields).expect(409))[0]).toMatch(new RegExp(`^${email('omar').replace(/\./g, '\\.')} sent a CV on .* already \\(APP-`));
      const forCeo = (await get('ceo', `/recruitment/general-cvs/${added.id}`).expect(200)).body as GeneralCvView;
      expect(forCeo.can).toEqual({ review: false, archive: false, restore: false, move: false, editNotes: false });
      await get('outsider', `/recruitment/general-cvs/${added.id}`).expect(403);
      const file = await get('hr', `/recruitment/general-cvs/${added.id}/cv`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('application/pdf');
    });

    it('lists them by status, source, area and search; archived apart', async () => {
      const list = (path: string) => get('hr', `/recruitment/general-cvs${path}`).expect(200).then((r) => r.body as GeneralCvListItem[]);
      expect((await list(`?q=${RUN}`)).length).toBeGreaterThanOrEqual(13);
      expect((await list(`?source=email&q=${RUN}`)).map((c) => c.id)).toEqual([added.id]);
      expect((await list(`?q=${encodeURIComponent(`Area Person ${RUN}`)}`))[0]).toMatchObject({ area: 'Photography', departmentId: null, source: 'careers', addedBy: null });
      await get('outsider', '/recruitment/general-cvs').expect(403);
    });

    it('is marked reviewed, archived, restored; each once', async () => {
      expect(((await post('hr', `/recruitment/general-cvs/${added.id}/review`).expect(200)).body as GeneralCvView).status).toBe('reviewed');
      expect(said(await post('hr', `/recruitment/general-cvs/${added.id}/review`).expect(409))).toEqual(['It is reviewed already.']);
      expect(((await post('hr', `/recruitment/general-cvs/${added.id}/archive`).expect(200)).body as GeneralCvView).status).toBe('archived');
      const list = (await get('hr', `/recruitment/general-cvs?q=${email('omar')}`).expect(200)).body as GeneralCvListItem[];
      expect(list).toEqual([]);
      expect(said(await post('hr', `/recruitment/general-cvs/${added.id}/move`, { vacancyId: vacancy.id }).expect(409))).toEqual(['It is archived: restore it first.']);
      expect(((await post('hr', `/recruitment/general-cvs/${added.id}/restore`).expect(200)).body as GeneralCvView).status).toBe('reviewed');
      await post('ceo', `/recruitment/general-cvs/${added.id}/archive`).expect(403);
      const actions = (await prisma.auditLog.findMany({ where: { entityType: 'general_cv', entityId: added.id }, orderBy: { at: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['create', 'review', 'archive', 'restore']);
    });

    it('moves to an open vacancy at Shortlisted, keeping its reference; its source says where it came from', async () => {
      const moved = (await post('hr', `/recruitment/general-cvs/${added.id}/move`, { vacancyId: vacancy.id, stage: 'shortlisted' }).expect(200)).body as GeneralCvView;
      expect(moved).toMatchObject({ status: 'moved', movedTo: { reference: added.number, vacancyId: vacancy.id }, can: { move: false } });
      const a = (await get('hr', `/recruitment/applications/${moved.movedTo!.applicationId}`).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ number: added.number, stage: 'shortlisted', source: 'general', generalSource: 'email', matchPercent: null, filteredOut: false, cv: { mimeType: 'application/pdf' } });
      expect(a.history.map((h) => [h.event, h.note])).toEqual([
        ['applied', 'Moved from a general CV (Email)'],
        ['shortlisted', null],
      ]);
      const row = await prisma.jobApplication.findUniqueOrThrow({ where: { id: a.id }, select: { consentNote: true } });
      expect(row.consentNote).toBe(`From general CV ${added.number}`);
      expect(said(await post('hr', `/recruitment/general-cvs/${added.id}/move`, { vacancyId: vacancy.id }).expect(409))).toEqual(['It was moved to a vacancy already.']);
      // the list shows it with its general source
      const listed = ((await get('hr', `/recruitment/applications?vacancyId=${vacancy.id}`).expect(200)).body as ApplicationListItem[]).find((x) => x.id === a.id);
      expect(listed).toMatchObject({ source: 'general', generalSource: 'email', vacancy: { id: vacancy.id, status: 'open' } });
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'general_cv', entityId: added.id, action: 'move_to_vacancy' } })).diff).toMatchObject({ vacancy: vacancy.number, stage: 'shortlisted' });
    });

    it('can’t move one whose email applied for the vacancy already', async () => {
      const again = (await add('hr', { fullName: `Omar Again ${RUN}`, email: email('sara'), mobile: '01001234567', departmentId: teamId, source: 'whatsapp', consent: 'true' }).expect(409)).body;
      expect(said({ body: again } as request.Response)[0]).toMatch(/sent a CV on/);
      const other = (await add('hr', { fullName: `Lina Twice ${RUN}`, email: email('lina'), mobile: '01001234569', departmentId: teamId, source: 'whatsapp', consent: 'true' }).expect(201)).body as GeneralCvView;
      await post('hr', `/recruitment/general-cvs/${other.id}/move`, { vacancyId: vacancy.id }).expect(200);
      const third = await prisma.generalCv.create({
        data: { number: `APP-${YEAR}-9${String(Date.now()).slice(-4)}`, fullName: 'Lina Again', email: email('lina'), mobile: '01001234567', areaOther: 'Other', source: 'email', consentAt: new Date(), createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) },
        select: { id: true },
      });
      await prisma.generalCvFile.create({ data: { generalCvId: third.id, fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: cv.length, data: new Uint8Array(cv) } });
      expect(said(await post('hr', `/recruitment/general-cvs/${third.id}/move`, { vacancyId: vacancy.id }).expect(409))).toEqual([`${email('lina')} applied for this job already (${other.number}).`]);
    });
  });

  describe('the Applicants page by posted job and source', () => {
    it('counts each vacancy’s applicants by stage and by source, and the general CVs', async () => {
      const s = (await get('ceo', '/recruitment/applicants/summary').expect(200)).body as ApplicantsSummary;
      const g = s.vacancies.find((x) => x.vacancy.id === vacancy.id)!;
      expect(g).toMatchObject({ vacancy: { status: 'open' }, total: 2, bySource: { general: 2 } });
      expect(g.byStage.shortlisted).toBe(1);
      expect(g.byStage.applied).toBe(1);
      expect(s.general).toBeGreaterThanOrEqual(13);
      expect(s.generalNew).toBeGreaterThanOrEqual(12);
      expect(((await get('hr', `/recruitment/vacancies/${vacancy.id}`).expect(200)).body as VacancyView).sourceCounts).toEqual({ general: 2 });
      await get('outsider', '/recruitment/applicants/summary').expect(403);
    });
  });

  describe('bulk upload', () => {
    it('reads each CV dropped on the vacancy; a scanned one by its file’s name; one there already flagged', async () => {
      const read = (await upload('hr', await pdfOf(['Curriculum Vitae', 'Mona Bulk Hassan', `${email('mona')} | 0100 123 4567`]), 'mona.pdf', vacancy.id).expect(201)).body as CvUploadView;
      expect(read).toMatchObject({ fileName: 'mona.pdf', textFound: true, guess: { fullName: 'Mona Bulk Hassan', email: email('mona'), mobile: '+201001234567' }, duplicate: null });
      const scanned = (await upload('hr', await pdfOf(), 'Karim_Scanned_CV.pdf', vacancy.id).expect(201)).body as CvUploadView;
      expect(scanned).toMatchObject({ textFound: false, guess: { fullName: 'Karim Scanned', email: null, mobile: null } });
      const there = (await upload('hr', await pdfOf(['Lina Bulk Again', email('lina')]), 'lina.pdf', vacancy.id).expect(201)).body as CvUploadView;
      expect(there.duplicate).toMatchObject({ inBatch: false, reference: expect.stringMatching(/^APP-/) });
      const twice = (await upload('hr', await pdfOf(['Mona Bulk Twice', email('mona')]), 'mona-again.pdf', vacancy.id).expect(201)).body as CvUploadView;
      expect(twice.duplicate).toEqual({ reference: null, inBatch: true, date: null });
      expect(said(await upload('hr', Buffer.from('not a cv'), 'notes.txt', vacancy.id).expect(400))).toEqual(['notes.txt: A CV must be a PDF or a Word file (.docx).']);
      await upload('ceo', cv, 'cv.pdf', vacancy.id).expect(403);
      await upload('outsider', cv, 'cv.pdf', vacancy.id).expect(403);
      // the batch is its uploader's own
      expect((await get('hr', `/recruitment/cv-uploads?vacancyId=${vacancy.id}`).expect(200)).body).toHaveLength(4);
      expect((await get('hr2', `/recruitment/cv-uploads?vacancyId=${vacancy.id}`).expect(200)).body).toEqual([]);
    });

    it('saves the rows HR checked at Applied, the consent HR’s; skips one there already and one twice', async () => {
      const rows = (await get('hr', `/recruitment/cv-uploads?vacancyId=${vacancy.id}`).expect(200)).body as CvUploadView[];
      const row = (r: CvUploadView, extra: object = {}) => ({ id: r.id, fullName: r.guess.fullName ?? '', email: r.guess.email ?? '', mobile: r.guess.mobile ?? '', source: 'linkedin', ...extra });
      const [mona, karim, lina, twice] = rows;
      const result = (
        await post('hr', '/recruitment/cv-uploads/save', {
          vacancyId: vacancy.id,
          rows: [row(mona), row(karim, { email: email('karim'), mobile: '+20 112 345 6789' }), row(lina), row(twice)],
        }).expect(200)
      ).body as CvSaveResult;
      expect(result.saved.map((s) => s.fullName)).toEqual(['Mona Bulk Hassan', 'Karim Scanned']);
      expect(result.skipped.map((s) => [s.fileName, s.reason])).toEqual([
        ['lina.pdf', expect.stringMatching(new RegExp(`^${email('lina').replace(/\./g, '\\.')} applied for this job already`))],
        ['mona-again.pdf', `${email('mona')} is earlier in this batch.`],
      ]);
      const made = await prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: vacancy.id, email: email('mona') }, include: { steps: true, cv: { select: { fileName: true } } } });
      expect(made).toMatchObject({ stage: 'applied', source: 'linkedin', consentById: users.hr, consentNote: 'By HR (LinkedIn Easy Apply)', matchPercent: null, filteredOut: false, cv: { fileName: 'mona.pdf' } });
      expect(made.steps.map((s) => s.note)).toEqual(['Added by HR from a CV (LinkedIn Easy Apply), in a bulk upload']);
      // the saved rows left the batch; the skipped stay until discarded
      expect(((await get('hr', `/recruitment/cv-uploads?vacancyId=${vacancy.id}`).expect(200)).body as CvUploadView[]).map((r) => r.fileName)).toEqual(['lina.pdf', 'mona-again.pdf']);
      expect((await post('hr', '/recruitment/cv-uploads/discard', { vacancyId: vacancy.id }).expect(200)).body).toEqual({ discarded: 2 });
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'job_application', entityId: made.id } })).diff).toMatchObject({ via: 'bulk upload', source: 'linkedin' });
    });

    it('to the general CVs: the area wanted; one sent in the last 30 days skipped unless kept', async () => {
      const recent = (await upload('hr', await pdfOf(['Sara Repeat Person', email('sara'), '01001234567']), 'sara.pdf').expect(201)).body as CvUploadView;
      expect(recent.duplicate).toMatchObject({ inBatch: false, reference: expect.stringMatching(/^APP-/) });
      const fresh = (await upload('hr', await pdfOf(['Nour Fresh Person', email('nour'), '01001234571']), 'nour.pdf').expect(201)).body as CvUploadView;
      const row = (r: CvUploadView, extra: object = {}) => ({ id: r.id, fullName: r.guess.fullName ?? '', email: r.guess.email ?? '', mobile: r.guess.mobile ?? '', source: 'linkedin', ...extra });
      const first = (await post('hr', '/recruitment/cv-uploads/save', { rows: [row(recent, { departmentId: teamId }), row(fresh)] }).expect(200)).body as CvSaveResult;
      expect(first.saved).toEqual([]);
      expect(first.skipped.map((s) => s.reason)).toEqual([
        expect.stringMatching(/sent a CV on .* \(APP-.*\): tick Keep to save it anyway\.$/),
        'Choose the position they would like, or Other and write it.',
      ]);
      // a team is an area here too (the bulk upload took only departments before, 22 October 2026)
      const second = (await post('hr', '/recruitment/cv-uploads/save', { rows: [row(recent, { departmentId: teamId, keep: true }), row(fresh, { areaOther: 'Sound' })] }).expect(200)).body as CvSaveResult;
      expect(second.saved.map((s) => s.fullName)).toEqual(['Sara Repeat Person', 'Nour Fresh Person']);
      expect(await prisma.generalCv.findFirstOrThrow({ where: { email: email('sara'), source: 'linkedin' }, select: { departmentId: true, mobile: true } })).toEqual({ departmentId: teamId, mobile: '+201001234567' });
      const nour = await prisma.generalCv.findFirstOrThrow({ where: { email: email('nour') }, include: { events: true } });
      expect(nour).toMatchObject({ source: 'linkedin', areaOther: 'Sound', consentById: users.hr, consentNote: 'By HR (LinkedIn Easy Apply)', createdById: users.hr, status: 'new' });
      expect(nour.events.map((e) => e.note)).toEqual(['Added by HR (LinkedIn), in a bulk upload']);
    });

    it('takes at most 50 waiting CVs a person', async () => {
      await prisma.cvUpload.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({ createdById: users.hr2, fileName: `cv${i}.pdf`, mimeType: 'application/pdf', sizeBytes: cv.length, data: new Uint8Array(cv) })),
      });
      expect(said(await upload('hr2', cv, 'one-more.pdf').expect(400))).toEqual(['A batch takes at most 50 CVs: save or discard these first.']);
      expect((await post('hr2', '/recruitment/cv-uploads/discard', {}).expect(200)).body).toEqual({ discarded: 50 });
    });
  });
});
