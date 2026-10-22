import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import {
  ALREADY_APPLIED,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  candidateEmployeeText,
  careersIpToken,
  DEVELOPER_READ_ONLY,
  GENERAL_CV_IP_TOKEN,
  type ApplicationListItem,
  type ApplicationView,
  type CandidateListItem,
  type CandidateView,
  type CvSaveResult,
  type CvUploadView,
  type GeneralCvView,
  type PossibleMatches,
  type PossibleMatchView,
  type Role,
  type VacancyBoard,
  type VacancyView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CandidatesService } from '../src/recruitment/candidates.service.js';
import { CvReadingsService } from '../src/recruitment/cv-readings.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Candidate profiles (owner, 22 October 2026: "how to make like a profile for each candidate to store history and prevent
// duplication? even if the same candidate applied for 2 jobs"; asked, "Email or mobile" and "Link and show rehire"; then
// "and their is a possible match from other fields, HR decides from suggested match"). The same email, or the same
// mobile, joins one candidate across jobs, general CVs and bulk uploads; an email of one and a mobile of another join
// the email's, with a possible duplicate for HR; the same job twice is refused; a former employee is linked with their
// rehire eligibility (a C-level one only as a record to HR); an accepted offer links the profile made; the rows from
// before are backfilled (twice, the same); the suggestions (LinkedIn, name, a CV's contacts) are merged, undone by a
// Super Admin, dismissed for good, and a wrong match split; a hiring manager sees none of it; a developer only
// "Candidate CAN-…". Every person is invented, each with their own email and mobile; the test deletes what it made.

const RUN = `cn${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const email = (who: string) => `${who}.${RUN}@mail.test`;
const nameOf = (who: string) => `${who[0].toUpperCase()}${who.slice(1)} Cand ${RUN}`;

/** Each person's own mobile, +2011 and 8 digits, unique for the run. */
const BASE = (Date.now() % 90_000_000) + 10_000_000;
const MOBILES = new Map<string, string>();
const mobile = (who: string): string => {
  if (!MOBILES.has(who)) MOBILES.set(who, `+2011${String((BASE + (MOBILES.size + 1) * 7919) % 100_000_000).padStart(8, '0')}`);
  return MOBILES.get(who)!;
};
/** The same mobile as an Egyptian dials it: 011…. */
const local = (m: string) => `0${m.slice(3)}`;

/** A PDF with these lines: each person's CV its own file (an identical file would suggest a match). */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

describe('Candidate profiles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let gradeId: string;
  let shiftId: string;
  let A: VacancyView;
  let B: VacancyView;
  let C: VacancyView;
  const employeeIds: string[] = [];
  const vacancyIds: string[] = [];
  let hmId: string;
  /** When the test began: the notices it caused are taken back (HR is told of the careers page's CVs once a day, whoever HR is). */
  const STARTED = new Date();

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  /** The answer, when it has the status expected (else the test fails with what the API said). */
  const status = (res: request.Response, expected: number): request.Response => {
    if (res.status !== expected) throw new Error(`Expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };

  async function account(key: string, roles: Role[], employeeId?: string) {
    const e = await createUser(prisma, roles);
    const u = await prisma.user.update({ where: { email: e }, data: { ...(employeeId && { employeeId }) }, select: { id: true } });
    users[key] = u.id;
    sessions[key] = await signIn(app, e);
  }

  let ipN = 0;
  /** An application on the careers page, its address signed by the website (each its own address: 5 an hour each). */
  async function apply(v: VacancyView, who: string, extra: Record<string, string> = {}, cv?: Buffer): Promise<request.Response> {
    const ip = `10.77.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
    const at = String(Date.now());
    let req = api()
      .post(`/api/public/careers/${v.slug}/apply`)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(v.slug)));
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobile(who), consent: 'true', ip, ...extra };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    return await req.attach('cv', cv ?? (await pdfOf([`${who} ${RUN} curriculum vitae`])), `${who}.pdf`);
  }

  /** "Send us your CV" on the careers page. */
  async function sendCv(who: string, extra: Record<string, string> = {}): Promise<request.Response> {
    const ip = `10.78.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
    const at = String(Date.now());
    let req = api().post('/api/public/general-cvs').set(CLIENT_IP_HEADER, ip).set(CLIENT_IP_AT_HEADER, at).set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, GENERAL_CV_IP_TOKEN));
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobile(who), areaOther: 'Video', consent: 'true', ip, ...extra };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    return await req.attach('cv', await pdfOf([`${who} ${RUN} general cv`]), `${who}.pdf`);
  }

  /** HR's Add a CV. */
  async function addCv(who: string, extra: Record<string, string> = {}): Promise<request.Response> {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions.hr);
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobile(who), areaOther: 'Video', source: 'email', consent: 'true', ...extra };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    return await req.attach('cv', await pdfOf([`${who} ${RUN} added cv`]), `${who}.pdf`);
  }

  const appOf = (v: VacancyView, who: string) => prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: v.id, email: email(who) }, select: { id: true, number: true, candidateId: true } });
  const candidateOf = async (v: VacancyView, who: string) => (await appOf(v, who)).candidateId!;
  const profile = async (as: string, id: string) => (await get(as, `/recruitment/candidates/${id}`).expect(200)).body as CandidateView;
  const matches = async (as = 'hr') => (await get(as, '/recruitment/candidates/matches').expect(200)).body as PossibleMatches;
  const pairIn = (list: PossibleMatchView[], x: string, y: string) => list.find((m) => m.candidates.some((c) => c.id === x) && m.candidates.some((c) => c.id === y));

  async function openVacancy(extra: object = {}): Promise<VacancyView> {
    const v = (await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 3, closingDate: addDays(TODAY, 30), ...extra }).expect(201)).body as VacancyView;
    vacancyIds.push(v.id);
    await post('hr', `/recruitment/vacancies/${v.id}/submit`).expect(200);
    return (await post('ceo', `/recruitment/vacancies/${v.id}/approve`).expect(200)).body as VacancyView;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('outsider', ['employee']);
    // a developer: the Developer role alone, always the developer view
    await account('developer', ['developer']);
    departmentId = (await prisma.department.create({ data: { nameEn: `Studio ${RUN}` }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Editor ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    // a hiring manager: an employee whose account is theirs
    hmId = (
      await prisma.employee.create({
        data: { employeeCode: `HM-${RUN}`, fullNameEn: `Hiring Manager ${RUN}`, fullNameAr: 'مدير', employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01') } } },
        select: { id: true },
      })
    ).id;
    employeeIds.push(hmId);
    await account('hm', ['employee'], hmId);
    A = await openVacancy({ hiringManagerId: hmId });
    B = await openVacancy();
    C = await openVacancy({ headcount: 1, gradeId, shiftId });
  });

  afterAll(async () => {
    const apps = await prisma.jobApplication.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true, employeeId: true, candidateId: true } });
    const cvs = await prisma.generalCv.findMany({ where: { email: { endsWith: `.${RUN}@mail.test` } }, select: { id: true, candidateId: true } });
    const offers = await prisma.jobOffer.findMany({ where: { applicationId: { in: apps.map((a) => a.id) } }, select: { id: true, employeeId: true } });
    const hired = [...apps.map((a) => a.employeeId), ...offers.map((o) => o.employeeId)].filter((id): id is string => !!id);
    const contacts = await prisma.candidateContact.findMany({ where: { OR: [{ value: { endsWith: `.${RUN}@mail.test` } }, { value: { in: [...MOBILES.values()] } }] }, select: { candidateId: true } });
    const candidateIds = new Set([...apps.map((a) => a.candidateId), ...cvs.map((g) => g.candidateId), ...contacts.map((x) => x.candidateId)].filter((x): x is string => !!x));
    await prisma.jobOffer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
    await prisma.onboardingChecklist.deleteMany({ where: { applicationId: { in: apps.map((a) => a.id) } } });
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.generalCv.deleteMany({ where: { id: { in: cvs.map((g) => g.id) } } });
    await prisma.cvUpload.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    // the candidates split off or merged with them too
    const more = await prisma.candidate.findMany({ where: { OR: [{ mergedIntoId: { in: [...candidateIds] } }, { mergesMerged: { some: { keptId: { in: [...candidateIds] } } } }] }, select: { id: true } });
    for (const m of more) candidateIds.add(m.id);
    await prisma.candidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    for (const id of new Set([...hired, ...employeeIds])) {
      await prisma.user.updateMany({ where: { employeeId: id }, data: { employeeId: null } });
      await prisma.generatedDocument.deleteMany({ where: { employeeId: id } });
      const employments = await prisma.employment.findMany({ where: { employeeId: id }, select: { id: true } });
      await prisma.contract.deleteMany({ where: { employmentId: { in: employments.map((e) => e.id) } } });
      await prisma.employment.deleteMany({ where: { employeeId: id } });
      await prisma.employee.deleteMany({ where: { id } });
    }
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    // "New CVs" and "New applications" told to every HR account there was, once a day: taken back so the next file's are sent
    await prisma.notification.deleteMany({
      where: { kind: 'applications_new', createdAt: { gte: STARTED }, link: { in: ['/recruitment/applicants?tab=general', ...vacancyIds.map((id) => `/recruitment/vacancies/${id}`)] } },
    });
    await app.close();
  });

  describe('joining one candidate (the owner’s "Email or mobile")', () => {
    it('two jobs, the same email: one candidate holding both, with the lists’ badge and the applicant’s page', async () => {
      status(await apply(A, 'mona'), 201);
      status(await apply(B, 'mona'), 201);
      const [a1, a2] = [await appOf(A, 'mona'), await appOf(B, 'mona')];
      expect(a1.candidateId).toBeTruthy();
      expect(a2.candidateId).toBe(a1.candidateId);
      const c = await profile('hr', a1.candidateId!);
      expect(c.code).toMatch(/^CAN-\d{4,}$/);
      expect(c.fullName).toBe(nameOf('mona'));
      expect(c.applications.map((a) => a.vacancy.id).sort()).toEqual([A.id, B.id].sort());
      expect(c.emailContacts.map((e) => e.email)).toEqual([email('mona')]);
      expect(c.mobileContacts.map((m) => m.mobile)).toEqual([mobile('mona')]);
      expect(c.cvs).toHaveLength(2);
      expect(c.timeline.some((t) => t.text.startsWith('Applied: ') && t.text.includes(a1.number))).toBe(true);
      const list = (await get('hr', `/recruitment/applications?vacancyId=${A.id}`).expect(200)).body as ApplicationListItem[];
      expect(list.find((r) => r.email === email('mona'))!.candidate).toMatchObject({ code: c.code, applications: 2, generalCvs: 0, employee: null });
      const board = (await get('hr', `/recruitment/vacancies/${A.id}/board`).expect(200)).body as VacancyBoard;
      expect(board.columns.flatMap((x) => x.cards).find((x) => x.id === a1.id)!.candidate).toMatchObject({ code: c.code, applications: 2 });
      const view = (await get('hr', `/recruitment/applications/${a1.id}`).expect(200)).body as ApplicationView;
      expect(view.candidateProfile).toMatchObject({ id: c.id, code: c.code, otherApplications: [{ id: a2.id, vacancy: { id: B.id } }], canSplit: true });
      const all = (await get('hr', `/recruitment/candidates?q=${encodeURIComponent(c.code)}`).expect(200)).body as CandidateListItem[];
      expect(all).toEqual([expect.objectContaining({ id: c.id, code: c.code, applications: 2, latest: expect.objectContaining({ kind: 'application' }) })]);
      // found by an email, a mobile typed as dialled, a name
      for (const q of [email('mona'), local(mobile('mona')), nameOf('mona')]) {
        expect(((await get('hr', `/recruitment/candidates?q=${encodeURIComponent(q)}`).expect(200)).body as CandidateListItem[]).map((x) => x.id), q).toEqual([c.id]);
      }
    });

    it('the same mobile with another email (typed as dialled): one candidate, both emails kept', async () => {
      status(await apply(A, 'karim'), 201);
      status(await apply(B, 'karim.work', { mobile: local(mobile('karim')) }), 201);
      const id = await candidateOf(A, 'karim');
      expect(await candidateOf(B, 'karim.work')).toBe(id);
      const c = await profile('hr', id);
      expect(c.emailContacts.map((e) => e.email).sort()).toEqual([email('karim'), email('karim.work')].sort());
      expect(c.mobileContacts.map((m) => m.mobile)).toEqual([mobile('karim')]);
    });

    it('the email of one and the mobile of another: the email’s candidate, and a possible duplicate on both', async () => {
      status(await apply(A, 'lina'), 201);
      status(await apply(A, 'omar'), 201);
      status(await apply(B, 'lina', { mobile: mobile('omar') }), 201);
      const lina = await candidateOf(A, 'lina');
      const omar = await candidateOf(A, 'omar');
      expect(lina).not.toBe(omar);
      expect(await candidateOf(B, 'lina')).toBe(lina);
      const pair = pairIn((await matches()).duplicates, lina, omar)!;
      expect(pair).toMatchObject({ kind: 'duplicate', signals: expect.arrayContaining(['same_mobile']) });
      expect((await profile('hr', lina)).matches.map((m) => m.id)).toContain(pair.id);
      expect((await profile('hr', omar)).matches.map((m) => m.id)).toContain(pair.id);
      // never merged by itself: Omar's mobile stays his
      expect((await profile('hr', omar)).mobileContacts.map((m) => m.mobile)).toEqual([mobile('omar')]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'job_application', entityId: (await appOf(B, 'lina')).id, action: 'apply' }, select: { diff: true } });
      expect(audit.diff).toMatchObject({ candidate: expect.stringMatching(/^CAN-/), possibleDuplicateOf: expect.stringMatching(/^CAN-/) });
    });

    it('the same job twice, by email or by mobile: refused on the careers page; another job joins; HR is told which', async () => {
      status(await apply(A, 'sara'), 201);
      expect(said(status(await apply(A, 'sara'), 409))).toEqual([ALREADY_APPLIED]);
      expect(said(status(await apply(A, 'sara.other', { mobile: mobile('sara') }), 409))).toEqual([ALREADY_APPLIED]);
      status(await apply(B, 'sara.other', { mobile: mobile('sara') }), 201);
      const id = await candidateOf(A, 'sara');
      expect(await candidateOf(B, 'sara.other')).toBe(id);
      // HR's general CV of hers (a third email, her mobile) joins her too; moved to the job she applied for: refused, naming it
      const added = (status(await addCv('sara.third', { mobile: mobile('sara') }), 201)).body as GeneralCvView;
      const gcv = await prisma.generalCv.findUniqueOrThrow({ where: { id: added.id }, select: { candidateId: true } });
      expect(gcv.candidateId).toBe(id);
      const there = await appOf(A, 'sara');
      expect(said(await post('hr', `/recruitment/general-cvs/${added.id}/move`, { vacancyId: A.id }).expect(409))[0]).toMatch(new RegExp(`^The same person applied for this job already \\(${there.number}, CAN-\\d+\\)\\.$`));
    });

    it('a general CV, then an application: one candidate; the 30 days count by the candidate; moving it keeps its candidate', async () => {
      status(await sendCv('hana'), 201);
      const g = await prisma.generalCv.findFirstOrThrow({ where: { email: email('hana') }, select: { id: true, candidateId: true } });
      expect(g.candidateId).toBeTruthy();
      // the same person by her mobile, with another email: refused on the careers page and on Add a CV
      expect(said(status(await sendCv('hana.two', { mobile: mobile('hana') }), 409))[0]).toMatch(/^You sent us your CV on .+ already\. HR will be in touch\.$/);
      expect(said(status(await addCv('hana.three', { mobile: mobile('hana') }), 409))[0]).toMatch(/^The same person \(by their mobile\) sent a CV on .+ already \(APP-\d{4}-\d+\): open it instead\.$/);
      status(await apply(A, 'hana'), 201);
      expect(await candidateOf(A, 'hana')).toBe(g.candidateId);
      await post('hr', `/recruitment/general-cvs/${g.id}/move`, { vacancyId: B.id }).expect(200);
      expect(await candidateOf(B, 'hana')).toBe(g.candidateId);
      const c = await profile('hr', g.candidateId!);
      expect(c.applications).toHaveLength(2);
      expect(c.generalCvs).toEqual([expect.objectContaining({ id: g.id, status: 'moved', movedTo: expect.objectContaining({ applicationId: (await appOf(B, 'hana')).id }) })]);
      // the moved application holds the general CV's copy: listed once
      expect(c.cvs.map((x) => x.kind).sort()).toEqual(['application', 'general_cv']);
      // the lists' badge: a general CV and one application on A
      const row = ((await get('hr', `/recruitment/applications?vacancyId=${A.id}`).expect(200)).body as ApplicationListItem[]).find((r) => r.email === email('hana'))!;
      expect(row.candidate).toMatchObject({ applications: 2 });
    });

    it('a bulk upload: the saved row joined to the candidate who applied before', async () => {
      status(await apply(A, 'nader'), 201);
      const up = (
        await api()
          .post(`/api/recruitment/cv-uploads?vacancyId=${B.id}`)
          .set('Cookie', sessions.hr)
          .attach('cv', await pdfOf([nameOf('nader'), email('nader')]), 'nader.pdf')
          .expect(201)
      ).body as CvUploadView;
      const result = (
        await post('hr', '/recruitment/cv-uploads/save', { vacancyId: B.id, rows: [{ id: up.id, fullName: nameOf('nader'), email: email('nader'), mobile: mobile('nader'), source: 'linkedin' }] }).expect(200)
      ).body as CvSaveResult;
      expect(result.saved).toHaveLength(1);
      expect(await candidateOf(B, 'nader')).toBe(await candidateOf(A, 'nader'));
      // and the same person on the same job again, by the mobile alone, skipped with the application named
      const again = (
        await api()
          .post(`/api/recruitment/cv-uploads?vacancyId=${B.id}`)
          .set('Cookie', sessions.hr)
          .attach('cv', await pdfOf(['Someone', 'cv again']), 'again.pdf')
          .expect(201)
      ).body as CvUploadView;
      const second = (
        await post('hr', '/recruitment/cv-uploads/save', { vacancyId: B.id, rows: [{ id: again.id, fullName: nameOf('nader'), email: email('nader.new'), mobile: mobile('nader'), source: 'linkedin' }] }).expect(200)
      ).body as CvSaveResult;
      expect(second.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/^The same person applied for this job already \(APP-\d{4}-\d+, CAN-\d+\)\.$/)]);
    });
  });

  describe('former and current employees (the owner’s "Link and show rehire")', () => {
    it('a former employee: linked, when and why they left and the rehire eligibility shown', async () => {
      const fady = await prisma.employee.create({
        data: {
          employeeCode: `FMR-${RUN}`,
          fullNameEn: `Fady Former ${RUN}`,
          fullNameAr: 'فادي',
          personalEmail: email('fady'),
          employments: { create: { employmentType: 'full_time', status: 'resigned', joinDate: new Date('2023-01-01'), endDate: new Date('2025-03-31'), endReason: 'resigned' } },
        },
        select: { id: true, employeeCode: true, employments: { select: { id: true } } },
      });
      employeeIds.push(fady.id);
      await prisma.offboardingCase.create({ data: { employmentId: fady.employments[0].id, status: 'completed', completedAt: new Date(), rehire: 'eligible' } });
      status(await apply(A, 'fady'), 201);
      const id = await candidateOf(A, 'fady');
      const c = await profile('hr', id);
      expect(c.employee).toMatchObject({ restricted: false, state: 'former', leftOn: '2025-03-31', endReason: 'resigned', rehire: 'eligible', employee: { id: fady.id, employeeCode: fady.employeeCode } });
      expect(candidateEmployeeText(c.employee!)).toBe(`Former employee ${fady.employeeCode}: left 2025-03 (Resigned) · Rehire: Yes`);
      const view = (await get('hr', `/recruitment/applications/${(await appOf(A, 'fady')).id}`).expect(200)).body as ApplicationView;
      expect(view.candidateProfile?.employee).toMatchObject({ state: 'former', rehire: 'eligible' });
      const row = ((await get('hr', `/recruitment/applications?vacancyId=${A.id}`).expect(200)).body as ApplicationListItem[]).find((r) => r.email === email('fady'))!;
      expect(row.candidate?.employee).toBe('former');
    });

    it('a current employee, by their work email: "Current employee"', async () => {
      const ziad = await prisma.employee.create({
        data: { employeeCode: `CUR-${RUN}`, fullNameEn: `Ziad Current ${RUN}`, fullNameAr: 'زياد', workEmail: email('ziad'), employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-05-01') } } },
        select: { id: true, employeeCode: true },
      });
      employeeIds.push(ziad.id);
      status(await apply(B, 'ziad'), 201);
      const c = await profile('hr', await candidateOf(B, 'ziad'));
      expect(c.employee).toMatchObject({ state: 'current', employee: { employeeCode: ziad.employeeCode } });
      expect(candidateEmployeeText(c.employee!)).toBe(`Current employee ${ziad.employeeCode}`);
    });

    it('a C-level former employee, by their mobile: HR sees only "Linked to an employee record"; the CEO the details', async () => {
      const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
      const ghada = await prisma.employee.create({
        data: {
          employeeCode: `CLV-${RUN}`,
          fullNameEn: `Ghada Chief ${RUN}`,
          fullNameAr: 'غادة',
          mobile: local(mobile('ghada')),
          employments: { create: { employmentType: 'full_time', status: 'terminated', gradeId: g9, joinDate: new Date('2022-01-01'), endDate: new Date('2025-06-30'), endReason: 'terminated' } },
        },
        select: { id: true, employeeCode: true, employments: { select: { id: true } } },
      });
      employeeIds.push(ghada.id);
      await prisma.offboardingCase.create({ data: { employmentId: ghada.employments[0].id, status: 'completed', completedAt: new Date(), rehire: 'not_eligible' } });
      status(await apply(A, 'ghada'), 201);
      const id = await candidateOf(A, 'ghada');
      const hr = await profile('hr', id);
      expect(hr.employee).toMatchObject({ restricted: true, employee: null, state: null, rehire: null, leftOn: null });
      expect(candidateEmployeeText(hr.employee!)).toBe('Linked to an employee record');
      expect(JSON.stringify(hr)).not.toContain(ghada.employeeCode);
      expect(JSON.stringify(hr)).not.toContain('Ghada Chief');
      const row = ((await get('hr', `/recruitment/applications?vacancyId=${A.id}`).expect(200)).body as ApplicationListItem[]).find((r) => r.email === email('ghada'))!;
      expect(row.candidate?.employee).toBe('restricted');
      const ceo = await profile('ceo', id);
      expect(ceo.employee).toMatchObject({ restricted: false, state: 'former', rehire: 'not_eligible', endReason: 'terminated', employee: { employeeCode: ghada.employeeCode } });
    });

    it('an accepted offer: the profile made from it linked', async () => {
      status(await apply(C, 'yara'), 201);
      const a = await appOf(C, 'yara');
      await post('hr', `/recruitment/applications/${a.id}/stage`, { to: 'shortlisted' }).expect(200);
      const offer = (
        await post('hr', '/offers', {
          fullNameEn: nameOf('yara'),
          fullNameAr: 'يارا',
          email: email('yara'),
          employmentType: 'full_time',
          joinDate: addDays(TODAY, 14),
          jobTitleId,
          gradeId,
          shiftId,
          grossSalary: 20000,
          applicationId: a.id,
        }).expect(201)
      ).body as { id: string };
      await post('hr', `/offers/${offer.id}/answer`, { answer: 'accepted' }).expect(200);
      const hired = await prisma.jobApplication.findUniqueOrThrow({ where: { id: a.id }, select: { employeeId: true, stage: true } });
      expect(hired.stage).toBe('hired');
      expect(hired.employeeId).toBeTruthy();
      const c = await profile('hr', a.candidateId!);
      expect(c.employee).toMatchObject({ restricted: false, state: 'current', employee: { id: hired.employeeId } });
      expect(c.offers).toEqual([expect.objectContaining({ id: offer.id, status: 'accepted' })]);
    });
  });

  describe('the backfill of the rows from before', () => {
    it('joins them by email, then by the mobile normalized (an unparseable one alone); run twice, the same', async () => {
      const n = (k: number) => `APP-1990-${BASE + k}`;
      const at = (d: string) => new Date(`2026-0${d}T09:00:00Z`);
      const o1 = await prisma.jobApplication.create({ data: { number: n(1), vacancyId: B.id, fullName: nameOf('old.one'), email: email('old.one'), mobile: local(mobile('old')), consentAt: at('1-05'), createdAt: at('1-05') }, select: { id: true } });
      const o2 = await prisma.jobApplication.create({
        data: { number: n(2), vacancyId: A.id, fullName: nameOf('old.two'), email: email('old.two'), mobile: `+20 ${mobile('old').slice(3, 5)} ${mobile('old').slice(5)}`, consentAt: at('2-05'), createdAt: at('2-05') },
        select: { id: true },
      });
      const o3 = await prisma.generalCv.create({ data: { number: n(3), fullName: nameOf('old.one'), email: email('old.one'), mobile: 'call me', areaOther: 'Video', source: 'email', consentAt: at('3-05'), createdAt: at('3-05') }, select: { id: true } });
      const o4 = await prisma.generalCv.create({ data: { number: n(4), fullName: nameOf('old.four'), email: email('old.four'), mobile: 'n/a', areaOther: 'Video', source: 'email', consentAt: at('4-05'), createdAt: at('4-05') }, select: { id: true } });
      const backfill = app.get(CandidatesService);
      const first = await backfill.backfill();
      expect(first).not.toBeNull();
      expect(first!.applications).toBeGreaterThanOrEqual(2);
      expect(first!.generalCvs).toBeGreaterThanOrEqual(2);
      const of = async () => ({
        o1: (await prisma.jobApplication.findUniqueOrThrow({ where: { id: o1.id } })).candidateId,
        o2: (await prisma.jobApplication.findUniqueOrThrow({ where: { id: o2.id } })).candidateId,
        o3: (await prisma.generalCv.findUniqueOrThrow({ where: { id: o3.id } })).candidateId,
        o4: (await prisma.generalCv.findUniqueOrThrow({ where: { id: o4.id } })).candidateId,
      });
      const ids = await of();
      expect(ids.o1).toBeTruthy();
      expect(ids.o2).toBe(ids.o1); // the mobile, normalized
      expect(ids.o3).toBe(ids.o1); // the email
      expect(ids.o4).toBeTruthy();
      expect(ids.o4).not.toBe(ids.o1);
      const c = await profile('ceo', ids.o1!);
      expect(c.emailContacts.map((e) => e.email).sort()).toEqual([email('old.one'), email('old.two')].sort());
      expect(c.mobileContacts.map((m) => m.mobile)).toEqual([mobile('old')]);
      // the latest name: the newest row's (the general CV of March)
      expect(c.fullName).toBe(nameOf('old.one'));
      expect(c.lastAppliedAt).toBe(at('3-05').toISOString());
      expect((await profile('ceo', ids.o4!)).mobileContacts).toEqual([]);
      const count = await prisma.candidate.count();
      const second = await backfill.backfill();
      expect(second).toEqual({ applications: 0, generalCvs: 0, created: 0, joined: 0, employeesLinked: 0 });
      expect(await prisma.candidate.count()).toBe(count);
      expect(await of()).toEqual(ids);
      expect(await prisma.auditLog.count({ where: { entityType: 'candidate', action: 'backfill' } })).toBeGreaterThan(0);
    });
  });

  describe('HR’s decisions', () => {
    it('suggested by LinkedIn and by name: "Same LinkedIn · Same name"; a name alone shown, ranked last', async () => {
      status(await apply(A, 'nour', { linkedin: `https://www.linkedin.com/in/nour-${RUN}/?trk=x` }), 201);
      status(await apply(B, 'nour.two', { fullName: `nour   CAND ${RUN}`, linkedin: `eg.linkedin.com/in/NOUR-${RUN}` }), 201);
      status(await apply(A, 'hala', { fullName: `Hala Named ${RUN}` }), 201);
      status(await apply(B, 'hala.two', { fullName: `HALA named ${RUN}` }), 201);
      const [n1, n2, h1, h2] = [await candidateOf(A, 'nour'), await candidateOf(B, 'nour.two'), await candidateOf(A, 'hala'), await candidateOf(B, 'hala.two')];
      expect(n1).not.toBe(n2);
      const m = await matches();
      const nour = pairIn(m.suggested, n1, n2)!;
      expect(nour).toMatchObject({ kind: 'suggested', signals: ['same_linkedin', 'same_name'], why: 'Same LinkedIn · Same name', score: 95, weak: false });
      const hala = pairIn(m.suggested, h1, h2)!;
      expect(hala).toMatchObject({ signals: ['same_name'], why: 'Same name', weak: true });
      expect(m.suggested.findIndex((x) => x.id === nour.id)).toBeLessThan(m.suggested.findIndex((x) => x.id === hala.id));
      expect((await profile('hr', n2)).matches.map((x) => x.id)).toContain(nour.id);
      const onApplicant = (await get('hr', `/recruitment/applications/${(await appOf(A, 'nour')).id}`).expect(200)).body as ApplicationView;
      expect(onApplicant.candidateProfile?.matches.map((x) => x.id)).toContain(nour.id);
      expect(((await get('hr', `/recruitment/candidates?q=${encodeURIComponent(email('nour'))}`).expect(200)).body as CandidateListItem[])[0].openMatches).toBeGreaterThanOrEqual(1);
    });

    it('confirmed: merged, everything moved to the kept one; undone by a Super Admin only, the pair back', async () => {
      const [n1, n2] = [await candidateOf(A, 'nour'), await candidateOf(B, 'nour.two')];
      await post('outsider', `/recruitment/candidates/${n1}/merge`, { otherId: n2 }).expect(403);
      await post('ceo', `/recruitment/candidates/${n1}/merge`, { otherId: n2 }).expect(403);
      expect(said(await post('hr', `/recruitment/candidates/${n1}/merge`, { otherId: n1 }).expect(400))).toEqual(['Choose another candidate to merge with.']);
      const kept = (await post('hr', `/recruitment/candidates/${n1}/merge`, { otherId: n2 }).expect(200)).body as CandidateView;
      expect(kept.applications.map((a) => a.vacancy.id).sort()).toEqual([A.id, B.id].sort());
      expect(kept.emailContacts.map((e) => e.email).sort()).toEqual([email('nour'), email('nour.two')].sort());
      expect(kept.merges).toEqual([expect.objectContaining({ merged: expect.objectContaining({ id: n2 }), undoneAt: null, canUndo: false, moved: { applications: 1, generalCvs: 0, contacts: 2 } })]);
      expect(await candidateOf(B, 'nour.two')).toBe(n1);
      const gone = await profile('hr', n2);
      expect(gone.mergedInto).toMatchObject({ id: n1 });
      expect(pairIn((await matches()).suggested, n1, n2)).toBeUndefined();
      // merged once: not again
      expect(said(await post('hr', `/recruitment/candidates/${n1}/merge`, { otherId: n2 }).expect(404))).toEqual(['Candidate not found.']);
      // undone: a Super Admin's alone
      const mergeId = kept.merges[0].id;
      await post('hr', `/recruitment/candidates/merges/${mergeId}/undo`).expect(403);
      expect((await profile('superAdmin', n1)).merges[0].canUndo).toBe(true);
      const back = (await post('superAdmin', `/recruitment/candidates/merges/${mergeId}/undo`).expect(200)).body as CandidateView;
      expect(back.applications.map((a) => a.vacancy.id)).toEqual([A.id]);
      expect(back.merges[0].undoneAt).not.toBeNull();
      expect(await candidateOf(B, 'nour.two')).toBe(n2);
      expect((await profile('hr', n2)).emailContacts.map((e) => e.email)).toEqual([email('nour.two')]);
      expect(pairIn((await matches()).suggested, n1, n2)).toMatchObject({ signals: ['same_linkedin', 'same_name'] });
      expect(said(await post('superAdmin', `/recruitment/candidates/merges/${mergeId}/undo`).expect(409))).toEqual(['This merge was undone already.']);
    });

    it('dismissed ("Not the same person"): gone, and never back when they apply again', async () => {
      const [h1, h2] = [await candidateOf(A, 'hala'), await candidateOf(B, 'hala.two')];
      const pair = pairIn((await matches()).suggested, h1, h2)!;
      await post('ceo', `/recruitment/candidates/matches/${pair.id}/dismiss`).expect(403);
      await post('hr', `/recruitment/candidates/matches/${pair.id}/dismiss`).expect(200);
      expect(pairIn((await matches()).suggested, h1, h2)).toBeUndefined();
      expect(said(await post('hr', `/recruitment/candidates/matches/${pair.id}/dismiss`).expect(409))).toEqual(['This pair was dismissed already.']);
      // Hala applies again: worked out again, the pair stays dismissed
      status(await apply(B, 'hala', { fullName: `Hala Named ${RUN}` }), 201);
      expect(pairIn((await matches()).suggested, h1, h2)).toBeUndefined();
      expect((await profile('hr', h1)).matches).toEqual([]);
    });

    it('a wrong match split: "Move to a new candidate" with the contacts used only there; the two never suggested', async () => {
      status(await apply(A, 'tarek'), 201);
      status(await apply(B, 'tarek', { mobile: mobile('tarek.two') }), 201);
      const old = await candidateOf(A, 'tarek');
      expect(await candidateOf(B, 'tarek')).toBe(old);
      const onB = await appOf(B, 'tarek');
      await post('ceo', `/recruitment/candidates/split/${onB.id}`).expect(403);
      const made = (await post('hr', `/recruitment/candidates/split/${onB.id}`).expect(200)).body as { id: string; code: string };
      expect(made.code).toMatch(/^CAN-\d+$/);
      expect(await candidateOf(B, 'tarek')).toBe(made.id);
      const split = await profile('hr', made.id);
      expect(split.mobileContacts.map((m) => m.mobile)).toEqual([mobile('tarek.two')]);
      // the email is the other application's too: it stays
      expect(split.emailContacts).toEqual([]);
      const stays = await profile('hr', old);
      expect(stays.emailContacts.map((e) => e.email)).toEqual([email('tarek')]);
      expect(stays.mobileContacts.map((m) => m.mobile)).toEqual([mobile('tarek')]);
      const all = await matches();
      expect(pairIn([...all.duplicates, ...all.suggested], old, made.id)).toBeUndefined();
      // their only application: nothing to split
      expect(said(await post('hr', `/recruitment/candidates/split/${onB.id}`).expect(409))).toEqual(['This is all their candidate profile holds: there is nothing to split.']);
      const actions = await prisma.auditLog.findMany({ where: { entityType: 'candidate', userId: { in: [users.hr, users.superAdmin] } }, select: { action: true } });
      expect(new Set(actions.map((a) => a.action))).toEqual(new Set(['merge', 'undo_merge', 'dismiss_match', 'split']));
    });

    it('a CV read: the contacts found in it suggest a match with their owner', async () => {
      status(await apply(B, 'zeina'), 201);
      status(await apply(A, 'wael', {}, await pdfOf([nameOf('wael'), 'Video editor with six years in studios and agencies', 'Experience', 'Senior Editor, Bright Studio, 2020 - Present', 'Referee', email('zeina')])), 201);
      const [wael, zeina] = [await candidateOf(A, 'wael'), await candidateOf(B, 'zeina')];
      expect(pairIn((await matches()).suggested, wael, zeina)).toBeUndefined();
      // the round reads 25 CVs at a time: every CV of the run read
      for (let round = 0; round < 10 && (await app.get(CvReadingsService).runOnce()) > 0; round++);
      expect(pairIn((await matches()).suggested, wael, zeina)).toMatchObject({ signals: ['cv_contact'], why: 'Contact found in a CV' });
    });
  });

  describe('who sees it', () => {
    it('HR, the CEO and a Super Admin; a hiring manager is refused the profile and sees no other applications', async () => {
      const mona = await appOf(A, 'mona');
      await post('hr', `/recruitment/applications/${mona.id}/stage`, { to: 'shortlisted' }).expect(200);
      for (const who of ['hm', 'outsider']) {
        await get(who, '/recruitment/candidates').expect(403);
        await get(who, `/recruitment/candidates/${mona.candidateId}`).expect(403);
        await get(who, '/recruitment/candidates/matches').expect(403);
      }
      const seen = (await get('hm', `/recruitment/applications/${mona.id}`).expect(200)).body as ApplicationView;
      expect(seen.viewer).toBe('hiring_manager');
      expect(seen.candidateProfile).toBeNull();
      const board = (await get('hm', `/recruitment/vacancies/${A.id}/board`).expect(200)).body as VacancyBoard;
      expect(board.columns.flatMap((c) => c.cards).find((c) => c.id === mona.id)!.candidate).toBeNull();
      await get('ceo', `/recruitment/candidates/${mona.candidateId}`).expect(200);
      await get('superAdmin', `/recruitment/candidates/${mona.candidateId}`).expect(200);
      await get('hr', '/recruitment/candidates/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('the developer sees "Candidate CAN-…" only: no name, email or mobile; a search by name finds nothing, by the code it does', async () => {
      const id = await candidateOf(A, 'mona');
      const list = (await get('developer', '/recruitment/candidates').expect(200)).body as CandidateListItem[];
      expect(list.length).toBeGreaterThan(0);
      for (const c of list) expect(c.fullName).toMatch(/^Candidate CAN-\d+$/);
      const c = (await get('developer', `/recruitment/candidates/${id}`).expect(200)).body as CandidateView;
      expect(c.fullName).toBe(`Candidate ${c.code}`);
      const text = JSON.stringify([list, c, (await get('developer', '/recruitment/candidates/matches').expect(200)).body]);
      expect(text).not.toContain(`Cand ${RUN}`);
      expect(text).not.toContain(email('mona'));
      expect(text).not.toContain(mobile('mona').slice(3));
      const app1 = (await get('developer', `/recruitment/applications/${(await appOf(A, 'mona')).id}`).expect(200)).body as ApplicationView;
      expect(app1.candidateProfile?.fullName).toBe(`Candidate ${c.code}`);
      expect(JSON.stringify(app1)).not.toContain(`Cand ${RUN}`);
      expect((await get('developer', `/recruitment/candidates?q=${encodeURIComponent(nameOf('mona'))}`).expect(200)).body).toEqual([]);
      expect(((await get('developer', `/recruitment/candidates?q=${encodeURIComponent(c.code)}`).expect(200)).body as CandidateListItem[]).map((x) => x.id)).toEqual([id]);
      const refused = await post('developer', `/recruitment/candidates/${id}/merge`, { otherId: await candidateOf(A, 'karim') });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toBe(DEVELOPER_READ_ONLY);
    });
  });
});
