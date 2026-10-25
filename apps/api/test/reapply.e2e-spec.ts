import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import {
  APPLICATION_CLOSED,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  careersIpToken,
  DEVELOPER_NO_FILES,
  HIDDEN,
  RECRUITMENT_LIMITS,
  type ApplicationListItem,
  type ApplicationView,
  type Role,
  type ScreeningComments,
  type VacancyBoard,
  type VacancyQuestion,
  type VacancyView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CvReadingsService } from '../src/recruitment/cv-readings.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Applying again for the same job (owner, 25 October 2026: "if an employee updated the cv and reapplied, how will he be
// treated in the system?"; asked, "Update their application"; packages/shared reapply.ts). The same person (by email, or
// by their mobile with another email) applying again while their application is open updates it: one application, the
// new CV current and the earlier kept (its file HR's, never a developer's), what they sent and the answers scored
// again (filtered out by a must-have at Applied, HR's decision kept once they were shortlisted), the CV read again, a
// step, HR told "CV updated", the answer { reference, updated: true }; the same file again is no new CV. Rejected:
// refused with the closed message. Another job: a new application. The audit log, the board's and the list's mark, and
// the hourly limit counting the CVs replaced. Every person is invented; the file deletes what it made.

const RUN = `ru${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const email = (who: string) => `${who}.${RUN}@mail.test`;
const nameOf = (who: string) => `${who[0].toUpperCase()}${who.slice(1).replace(/\..*$/, '')} Again ${RUN}`;

/** Each person's own mobile, +2012 and 8 digits, unique for the run. */
const BASE = (Date.now() % 90_000_000) + 10_000_000;
const MOBILES = new Map<string, string>();
const mobile = (who: string): string => {
  if (!MOBILES.has(who)) MOBILES.set(who, `+2012${String((BASE + (MOBILES.size + 1) * 7919) % 100_000_000).padStart(8, '0')}`);
  return MOBILES.get(who)!;
};

const QUESTIONS: VacancyQuestion[] = [
  { key: 'q1', kind: 'yes_no', text: 'Do you live in Cairo?', required: true, knockout: true, wanted: 'yes', points: 5 },
  { key: 'q2', kind: 'number', text: 'Years of video editing', required: true, knockout: false, atLeast: 3, points: 10 },
];
const answers = (q1: 'yes' | 'no', q2: number) => JSON.stringify({ q1, q2: String(q2) });

/** A file's bytes as sent. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** A PDF with these lines and a CV's usual words (enough text to be read without OCR): each CV its own file. */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const all = [...lines, 'Experience: video editing for brands and agencies.', 'Skills: storytelling, colour grading, motion graphics.'];
  all.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

describe('Applying again for the same job (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let A: VacancyView;
  let B: VacancyView;
  const vacancyIds: string[] = [];
  const STARTED = new Date();

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const status = (res: request.Response, expected: number): request.Response => {
    if (res.status !== expected) throw new Error(`Expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e }, select: { id: true } })).id;
    sessions[key] = await signIn(app, e);
  }

  let ipN = 0;
  const nextIp = () => `10.81.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
  /** An application on the careers page, its address signed by the website (each its own address unless one is given). */
  async function apply(v: VacancyView, who: string, extra: Record<string, string> = {}, cv?: { data: Buffer; name: string }, ip = nextIp()): Promise<request.Response> {
    const at = String(Date.now());
    let req = api()
      .post(`/api/public/careers/${v.slug}/apply`)
      .set('x-careers-key', process.env.CAREERS_KEY!)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(v.slug)));
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobile(who), consent: 'true', yearsExperience: '4', answers: answers('yes', 5), ip, ...extra };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    const file = cv ?? { data: await pdfOf([`${who} ${RUN} curriculum vitae`]), name: `${who}.pdf` };
    return await req.attach('cv', file.data, file.name);
  }

  /** The application of `who` on a vacancy, with its CV, earlier CVs and steps. */
  const appOf = (v: VacancyView, who: string) =>
    prisma.jobApplication.findFirstOrThrow({
      where: { vacancyId: v.id, email: email(who) },
      include: { cv: { select: { fileName: true, sha256: true, createdAt: true } }, earlierCvs: { orderBy: { sentAt: 'asc' } }, steps: { orderBy: { at: 'asc' } }, cvReading: true },
    });
  const readAll = async () => {
    const readings = app.get(CvReadingsService);
    for (let i = 0; i < 40; i++) if ((await readings.runOnce()) === 0) return;
  };

  async function openVacancy(extra: object = {}): Promise<VacancyView> {
    const v = (await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 2, closingDate: addDays(TODAY, 30), questions: QUESTIONS, ...extra }).expect(201)).body as VacancyView;
    vacancyIds.push(v.id);
    await post('hr', `/recruitment/vacancies/${v.id}/submit`).expect(200);
    return (await post('ceo', `/recruitment/vacancies/${v.id}/approve`).expect(200)).body as VacancyView;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('developer', ['developer']);
    departmentId = (await prisma.department.create({ data: { nameEn: `Studio Again ${RUN}` }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Editor Again ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    A = await openVacancy({ keySkills: ['Premiere Pro'] });
    B = await openVacancy();
  });

  afterAll(async () => {
    const apps = await prisma.jobApplication.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true, candidateId: true } });
    const contacts = await prisma.candidateContact.findMany({ where: { OR: [{ value: { endsWith: `.${RUN}@mail.test` } }, { value: { in: [...MOBILES.values()] } }] }, select: { candidateId: true } });
    const candidateIds = new Set([...apps.map((a) => a.candidateId), ...contacts.map((c) => c.candidateId)].filter((x): x is string => !!x));
    await prisma.whatsAppMessage.deleteMany({ where: { applicationId: { in: apps.map((a) => a.id) } } });
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.candidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    // "New applications" and "CV updated", told to every HR account there was: taken back so the next file's are sent
    await prisma.notification.deleteMany({
      where: { kind: 'applications_new', createdAt: { gte: STARTED }, link: { in: [...vacancyIds.map((id) => `/recruitment/vacancies/${id}`), ...apps.map((a) => `/recruitment/applicants/${a.id}`)] } },
    });
    await app.close();
  });

  it('the same email with a new CV and other answers: one application, the new CV current, the earlier kept, scored again, read again, a step, HR told, updated: true', async () => {
    const cv1 = await pdfOf([`Mona ${RUN} first CV`, 'Video editor']);
    const first = status(await apply(A, 'mona', { answers: answers('yes', 5) }, { data: cv1, name: 'Mona CV.pdf' }), 201).body as { reference: string; updated?: boolean };
    expect(first.updated).toBeUndefined();
    await readAll();
    const before = await appOf(A, 'mona');
    expect(before).toMatchObject({ matchPercent: 100, filteredOut: false, cvUpdatedAt: null });
    expect(before.cvReading?.status).toBe('read');
    await prisma.notification.deleteMany({ where: { userId: users.hr } });

    // two years more, an answer changed, a new CV that names Premiere Pro (a key skill of the job)
    const cv2 = await pdfOf([`Mona ${RUN} new CV`, 'Senior video editor, Premiere Pro']);
    const again = status(await apply(A, 'mona', { answers: answers('yes', 1), yearsExperience: '6' }, { data: cv2, name: 'Mona CV 2026.pdf' }), 201);
    expect(again.body).toEqual({ reference: first.reference, updated: true });

    expect(await prisma.jobApplication.count({ where: { vacancyId: A.id, email: email('mona') } })).toBe(1);
    const a = await appOf(A, 'mona');
    expect(a.number).toBe(first.reference);
    expect(a.cv!.fileName).toBe('Mona CV 2026.pdf');
    expect(a.cv!.sha256).not.toBe(before.cv!.sha256);
    expect(a.earlierCvs).toEqual([expect.objectContaining({ fileName: 'Mona CV.pdf', mimeType: 'application/pdf', sizeBytes: cv1.length, sentAt: before.cv!.createdAt, ip: expect.any(String) })]);
    expect(Buffer.from(a.earlierCvs[0].data).equals(cv1)).toBe(true);
    // the answers scored again: 5 of 15 points
    expect(a).toMatchObject({ points: 5, maxPoints: 15, matchPercent: 33, filteredOut: false, knockedOut: [], yearsExperience: expect.anything() });
    expect(Number(a.yearsExperience)).toBe(6);
    expect(a.cvUpdatedAt).not.toBeNull();
    expect(a.steps.map((s) => s.event)).toEqual(['applied', 'updated']);
    expect(a.steps[1]).toMatchObject({ stage: 'applied', byId: null, note: 'New CV. Changed: years of experience, answers (match 100% → 33%).' });
    // read again: the reading reset (and the fit with it), then the round reads the new CV
    expect(a.cvReading).toMatchObject({ status: 'pending', text: null });
    expect(a.cvMatchPercent).toBeNull();
    await readAll();
    const read = await appOf(A, 'mona');
    expect(read.cvReading?.status).toBe('read');
    expect(read.cvReading?.text).toContain('new CV');
    expect(read.cvMatchPercent).not.toBeNull();

    // HR told "CV updated", with the applicant's page
    const told = await prisma.notification.findMany({ where: { userId: users.hr, kind: 'applications_new' }, select: { title: true, body: true, link: true } });
    expect(told).toEqual([{ title: 'CV updated', body: `${nameOf('mona')} applied again for ${A.title} (${A.number}) with a new CV: open the applicant to see what changed.`, link: `/recruitment/applicants/${a.id}` }]);

    // the applicant's page: the current CV, Earlier CVs, the mark and the step
    const view = (await get('hr', `/recruitment/applications/${a.id}`).expect(200)).body as ApplicationView;
    expect(view.cv).toMatchObject({ fileName: 'Mona CV 2026.pdf' });
    expect(view.earlierCvs).toEqual([expect.objectContaining({ id: a.earlierCvs[0].id, cvFileName: 'Mona CV.pdf', sizeBytes: cv1.length, sentAt: before.cv!.createdAt.toISOString() })]);
    expect(view.cvUpdated).toBe(true);
    expect(view.cvUpdatedAt).toBe(a.cvUpdatedAt!.toISOString());
    expect(view.history.at(-1)).toMatchObject({ event: 'updated', by: null });
    // its file, as sent (a PDF shown); the current CV is the new one
    const file = await get('hr', `/recruitment/applications/${a.id}/earlier-cvs/${a.earlierCvs[0].id}`).buffer(true).parse(bytes).expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(file.body as Buffer).equals(cv1)).toBe(true);
    const current = await get('hr', `/recruitment/applications/${a.id}/cv`).buffer(true).parse(bytes).expect(200);
    expect(Buffer.from(current.body as Buffer).equals(cv2)).toBe(true);
    await get('hr', `/recruitment/applications/${a.id}/earlier-cvs/${B.id}`).expect(404);
    // the CV window: the current CV sent when it came, with the earlier one
    const window = (await get('hr', `/recruitment/applications/${a.id}/comments`).expect(200)).body as ScreeningComments;
    const shown = window.cvs.find((c) => c.id === a.id)!;
    expect(shown).toMatchObject({ cvFileName: 'Mona CV 2026.pdf', sentAt: a.cvUpdatedAt!.toISOString() });
    expect(shown.earlierCvs?.map((c) => c.cvFileName)).toEqual(['Mona CV.pdf']);
    // the board's and the list's "CV updated"
    const list = (await get('hr', `/recruitment/applications?vacancyId=${A.id}`).expect(200)).body as ApplicationListItem[];
    expect(list.find((r) => r.id === a.id)).toMatchObject({ cvUpdated: true });
    const board = (await get('hr', `/recruitment/vacancies/${A.id}/board`).expect(200)).body as VacancyBoard;
    expect(board.columns.flatMap((c) => c.cards).find((c) => c.id === a.id)).toMatchObject({ cvUpdated: true });
    // deleting it would take the earlier CV too
    expect((await get('superAdmin', `/recruitment/applications/${a.id}/deletion`).expect(200)).body).toMatchObject({ files: 2 });
  });

  it('by the mobile with another email: the same application updated, the new email joining their candidate', async () => {
    const first = status(await apply(A, 'karim'), 201).body as { reference: string };
    const res = status(await apply(A, 'karim.new', { mobile: mobile('karim'), answers: answers('yes', 2) }), 201);
    expect(res.body).toEqual({ reference: first.reference, updated: true });
    expect(await prisma.jobApplication.count({ where: { vacancyId: A.id, OR: [{ email: email('karim') }, { email: email('karim.new') }] } })).toBe(1);
    const a = await appOf(A, 'karim');
    // the email they applied with stays the application's
    expect(a.email).toBe(email('karim'));
    expect(a.cv!.fileName).toBe('karim.new.pdf');
    expect(a.earlierCvs.map((c) => c.fileName)).toEqual(['karim.pdf']);
    expect(a).toMatchObject({ matchPercent: 33 });
    expect(a.steps.map((s) => s.event)).toEqual(['applied', 'updated']);
    expect(a.steps[1].note).toBe('New CV. Changed: answers (match 100% → 33%).');
    const contacts = await prisma.candidateContact.findMany({ where: { candidateId: a.candidateId!, kind: 'email' }, select: { value: true } });
    expect(contacts.map((c) => c.value).sort()).toEqual([email('karim'), email('karim.new')].sort());
    expect(await prisma.notification.count({ where: { userId: users.hr, title: 'CV updated', link: `/recruitment/applicants/${a.id}` } })).toBe(1);
  });

  it('the same CV again: no new CV, nothing read again; a must-have filters out at Applied and no longer, and HR’s shortlist stands', async () => {
    const cv = { data: await pdfOf([`Lina ${RUN} the one CV`]), name: 'Lina.pdf' };
    status(await apply(A, 'lina', {}, cv), 201);
    await readAll();
    const start = await appOf(A, 'lina');
    // the same file, a must-have now failed: filtered out (at Applied), the CV left as it was
    expect(status(await apply(A, 'lina', { answers: answers('no', 5) }, cv), 201).body).toMatchObject({ updated: true });
    let a = await appOf(A, 'lina');
    expect(a).toMatchObject({ filteredOut: true, knockedOut: ['q1'], matchPercent: 67, cvUpdatedAt: null });
    expect(a.earlierCvs).toEqual([]);
    expect(a.cvReading?.status).toBe('read');
    expect(a.cvReading?.id).toBe(start.cvReading?.id);
    expect(a.steps.map((s) => [s.event, s.note])).toEqual([
      ['applied', null],
      ['updated', 'Same CV. Changed: answers (match 100% → 67%). Now filtered out: 1 must-have question not met.'],
      ['filtered_out', '1 must-have question not met'],
    ]);
    // HR told the application changed, not of a CV
    expect(await prisma.notification.count({ where: { userId: users.hr, title: 'Application updated', link: `/recruitment/applicants/${a.id}` } })).toBe(1);
    // met again: no longer filtered out
    status(await apply(A, 'lina', { answers: answers('yes', 5) }, cv), 201);
    a = await appOf(A, 'lina');
    expect(a).toMatchObject({ filteredOut: false, knockedOut: [], matchPercent: 100 });
    expect(a.steps.at(-1)?.note).toBe('Same CV. Changed: answers (match 67% → 100%). No longer filtered out: every must-have question met.');
    // HR shortlists her; failing the must-have now keeps her there, for HR to decide
    await post('hr', `/recruitment/applications/${a.id}/stage`, { to: 'shortlisted' }).expect(200);
    status(await apply(A, 'lina', { answers: answers('no', 5) }, cv), 201);
    a = await appOf(A, 'lina');
    expect(a).toMatchObject({ stage: 'shortlisted', filteredOut: false, knockedOut: ['q1'], matchPercent: 67 });
    expect(a.steps.at(-1)).toMatchObject({ event: 'updated', stage: 'shortlisted', note: 'Same CV. Changed: answers (match 100% → 67%). 1 must-have question not met; kept at Shortlisted (HR decides).' });
    // exactly the same again: nothing changes, nothing is kept
    const steps = a.steps.length;
    expect(status(await apply(A, 'lina', { answers: answers('no', 5) }, cv), 201).body).toMatchObject({ updated: true });
    expect((await appOf(A, 'lina')).steps).toHaveLength(steps);
  });

  it('closed once rejected: refused with the closed message, by email or mobile, nothing changed', async () => {
    status(await apply(A, 'omar'), 201);
    const a = await appOf(A, 'omar');
    await post('hr', `/recruitment/applications/${a.id}/stage`, { to: 'rejected', reason: 'Not this time' }).expect(200);
    expect(said(status(await apply(A, 'omar'), 409))).toEqual([APPLICATION_CLOSED]);
    expect(said(status(await apply(A, 'omar.two', { mobile: mobile('omar') }), 409))).toEqual([APPLICATION_CLOSED]);
    const after = await appOf(A, 'omar');
    expect(after.cv!.sha256).toBe(a.cv!.sha256);
    expect(after.earlierCvs).toEqual([]);
    expect(after.steps.map((s) => s.event)).toEqual(['applied', 'rejected']);
    expect(await prisma.jobApplication.count({ where: { vacancyId: A.id, email: email('omar.two') } })).toBe(0);
  });

  it('another job: a new application under the same candidate', async () => {
    const onA = await appOf(A, 'mona');
    const res = status(await apply(B, 'mona'), 201);
    expect(res.body.updated).toBeUndefined();
    const onB = await appOf(B, 'mona');
    expect(res.body.reference).toBe(onB.number);
    expect(onB.number).not.toBe(onA.number);
    expect(onB.candidateId).toBe(onA.candidateId);
    expect(onB.steps.map((s) => s.event)).toEqual(['applied']);
  });

  it('the hourly limit of an address counts the CVs an update replaced', async () => {
    const ip = nextIp();
    status(await apply(B, 'sami', {}, undefined, ip), 201);
    for (let i = 1; i < RECRUITMENT_LIMITS.applyPerHour; i++) {
      expect(status(await apply(B, 'sami', {}, { data: await pdfOf([`Sami ${RUN} CV ${i}`]), name: `sami-${i}.pdf` }, ip), 201).body).toMatchObject({ updated: true });
    }
    status(await apply(B, 'sami', {}, { data: await pdfOf([`Sami ${RUN} one too many`]), name: 'sami-x.pdf' }, ip), 429);
    expect((await appOf(B, 'sami')).earlierCvs).toHaveLength(RECRUITMENT_LIMITS.applyPerHour - 1);
  });

  it('the audit log keeps each update; a developer sees the earlier CVs’ names hidden and never their files', async () => {
    const a = await appOf(A, 'mona');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'job_application', entityId: a.id, action: 'reapply' }, select: { userId: true, diff: true } });
    expect(entry.userId).toBeNull();
    expect(entry.diff).toMatchObject({ number: a.number, vacancy: A.number, newCv: true, changed: ['yearsExperience', 'answers'], matchPercent: { from: 100, to: 33 }, candidate: expect.stringMatching(/^CAN-/) });
    const log = (await get('superAdmin', `/audit?entityType=job_application&entityId=${a.id}`).expect(200)).body as { entries: { action: string; actionLabel: string; who: { text: string } }[] };
    expect(log.entries.find((e) => e.action === 'reapply')).toMatchObject({ actionLabel: 'Updated their application', who: { text: 'The applicant, on the careers page' } });
    const lina = await appOf(A, 'lina');
    // each time she applied again, the last one changing nothing among them
    expect(await prisma.auditLog.count({ where: { entityType: 'job_application', entityId: lina.id, action: 'reapply' } })).toBe(4);

    // a developer: the earlier CV's name hidden, its file refused, the application's number nowhere
    const seen = (await get('developer', `/recruitment/applications/${a.id}`).expect(200)).body as ApplicationView;
    expect(seen.earlierCvs).toEqual([expect.objectContaining({ id: a.earlierCvs[0].id, cvFileName: HIDDEN })]);
    expect(JSON.stringify(seen)).not.toContain('Mona CV.pdf');
    const refused = await get('developer', `/recruitment/applications/${a.id}/earlier-cvs/${a.earlierCvs[0].id}`).expect(403);
    expect(said(refused)).toEqual([DEVELOPER_NO_FILES]);
    const window = (await get('developer', `/recruitment/applications/${a.id}/comments`).expect(200)).body as ScreeningComments;
    expect(window.cvs.find((c) => c.id === a.id)?.earlierCvs?.map((c) => c.cvFileName)).toEqual([HIDDEN]);
    const theirs = JSON.stringify((await get('developer', `/audit?entityType=job_application&entityId=${a.id}`).expect(200)).body);
    expect(theirs).toContain('reapply');
    expect(theirs).not.toContain(a.number);
  });
});
