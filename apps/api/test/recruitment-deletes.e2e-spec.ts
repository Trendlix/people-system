import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import {
  careersIpToken,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  interviewWhen,
  vacancyConfirmText,
  type ApplicationDeletion,
  type ApplicationView,
  type Role,
  type VacancyDeletion,
  type VacancySuggestions,
  type VacancyView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { ONLY_SUPER_ADMIN_DELETES } from '../src/auth/roles.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { VacancySuggestionsService } from '../src/recruitment/vacancy-suggestions.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Deleting an applicant, or a vacancy people applied to (owner, 25 October 2026, on a closed vacancy with one rejected
// applicant: "i want to delete this"; asked, "Vacancy alone - applicant alone - superadmin only"). A Super Admin deletes
// a rejected applicant with their steps, comments, interviews (past and cancelled), draft offer and notifications, the
// vacancy's count dropping; HR, the CEO, an Admin and a developer are refused; a sent offer and an interview still to
// come keep one on record (until it is cancelled through the usual path). The candidate profile goes with its last
// record and stays with another application or a general CV. A vacancy with applicants: refused without its number
// typed, then gone with everything on it; refused as a whole, naming the one, while an offer sent keeps one, nothing
// changed. A general CV added from Suggested From Earlier CVs is Reviewed again once its application goes, and suggested
// again. The audit log keeps numbers and statuses only. Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `rd${Date.now().toString(36)}`;
const TODAY = todayInCairo();

const nameOf = (who: string) => `${who[0].toUpperCase()}${who.slice(1)} Person ${RUN}`;
const email = (who: string) => `${who}.${RUN}@mail.test`;
/** Each person's own mobile (the same mobile is one person's): +2012 and 8 digits. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 17;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2012${String(h % 100_000_000).padStart(8, '0')}`;
};

async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

describe('Deleting applicants and vacancies with applicants (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const vacancyIds: string[] = [];
  let departmentId: string;
  let jobTitleId: string;
  let A: VacancyView;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const del = (as: string, path: string) => api().delete(`/api${path}`).set('Cookie', sessions[as]);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const ok = (res: request.Response, expected = 200): request.Response => {
    if (res.status !== expected) throw new Error(`Expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e }, select: { id: true } })).id;
    sessions[key] = await signIn(app, e);
  }

  let ipN = 0;
  /** An application on the careers page, its address signed by the website (each its own address). */
  async function apply(v: VacancyView, who: string) {
    const ip = `10.93.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
    const at = String(Date.now());
    let req = api()
      .post(`/api/public/careers/${v.slug}/apply`).set('x-careers-key', process.env.CAREERS_KEY!)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(v.slug)));
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobileOf(who), consent: 'true', yearsExperience: '3', ip };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    ok(await req.attach('cv', await pdfOf([`${nameOf(who)} curriculum vitae`]), `${who}.pdf`), 201);
    return prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: v.id, email: email(who) }, select: { id: true, number: true, candidateId: true } });
  }

  /** HR's Add a CV, for the vacancies' team. */
  async function addCv(who: string) {
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions.hr);
    const fields = { fullName: nameOf(who), email: email(who), mobile: mobileOf(who), departmentId, source: 'email', consent: 'true' };
    for (const [k, val] of Object.entries(fields)) req = req.field(k, val);
    return ok(await req.attach('cv', await pdfOf([`${nameOf(who)} general cv`]), `${who}.pdf`), 201).body as { id: string; number: string };
  }

  async function openVacancy(): Promise<VacancyView> {
    const made = ok(await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 3, closingDate: addDays(TODAY, 30), about: '<p>Made-up work.</p>' }), 201).body as VacancyView;
    vacancyIds.push(made.id);
    ok(await post('hr', `/recruitment/vacancies/${made.id}/submit`));
    return ok(await post('ceo', `/recruitment/vacancies/${made.id}/approve`)).body as VacancyView;
  }

  /** A job offer as the offers' pages leave it: a draft, or sent to the candidate. */
  async function offer(applicationId: string, status: 'draft' | 'sent', n: number) {
    return prisma.jobOffer.create({
      data: {
        number: `OFF-1999-${RUN}${n}`,
        status,
        fullNameEn: 'Offer Person',
        fullNameAr: 'شخص',
        email: `offer${n}.${RUN}@mail.test`,
        employmentType: 'full_time',
        joinDate: new Date(`${addDays(TODAY, 30)}T00:00:00Z`),
        grossSalary: 20000,
        expiresOn: new Date(`${addDays(TODAY, 7)}T00:00:00Z`),
        applicationId,
        ...(status === 'sent' && { sentAt: new Date(), sentVia: 'link' }),
      },
      select: { id: true, number: true },
    });
  }

  const interview = (applicationId: string, status: string, startsAt: Date) =>
    prisma.interview.create({ data: { applicationId, status, startsAt, minutes: 45, kind: 'phone', ...(status === 'cancelled' && { cancelledAt: new Date() }) }, select: { id: true, startsAt: true } });

  const vacancyOf = async (v: VacancyView) => ok(await get('hr', `/recruitment/vacancies/${v.id}`)).body as VacancyView;
  const candidateGone = async (id: string) => (await prisma.candidate.count({ where: { id } })) === 0;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    // a developer: the Developer role alone, always the developer view (answered with a Super Admin's sight, read only)
    await account('developer', ['developer']);
    departmentId = (await prisma.department.create({ data: { nameEn: `Accounts ${RUN}` }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Account Manager ${RUN}`, jdPurpose: '<p>Look after the accounts.</p>' }, select: { id: true } })).id;
    A = await openVacancy();
  });

  afterAll(async () => {
    const apps = await prisma.jobApplication.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true, candidateId: true } });
    const cvs = await prisma.generalCv.findMany({ where: { email: { endsWith: `.${RUN}@mail.test` } }, select: { id: true, candidateId: true } });
    const contacts = await prisma.candidateContact.findMany({ where: { value: { endsWith: `.${RUN}@mail.test` } }, select: { candidateId: true } });
    const candidateIds = [...new Set([...apps.map((a) => a.candidateId), ...cvs.map((g) => g.candidateId), ...contacts.map((x) => x.candidateId)].filter((x): x is string => !!x))];
    await prisma.jobOffer.deleteMany({ where: { OR: [{ applicationId: { in: apps.map((a) => a.id) } }, { number: { startsWith: `OFF-1999-${RUN}` } }] } });
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.generalCv.deleteMany({ where: { id: { in: cvs.map((g) => g.id) } } });
    await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: Object.values(users) } }, { link: { in: vacancyIds.map((id) => `/recruitment/vacancies/${id}`) } }] } });
    await app.close();
  });

  describe('an applicant on their own', () => {
    it('is a Super Admin’s alone: HR, the CEO, an Admin and a developer are refused', async () => {
      const a = await apply(A, 'hala');
      for (const who of ['hr', 'ceo', 'admin']) {
        expect(said(await del(who, `/recruitment/applications/${a.id}`).expect(403))).toEqual([ONLY_SUPER_ADMIN_DELETES]);
        await get(who, `/recruitment/applications/${a.id}/deletion`).expect(403);
      }
      await del('developer', `/recruitment/applications/${a.id}`).expect(403);
      await get('developer', `/recruitment/applications/${a.id}/deletion`).expect(403);
      expect(((await get('developer', `/recruitment/applications/${a.id}`).expect(200)).body as ApplicationView).can.delete).toBe(false);
      expect(((await get('hr', `/recruitment/applications/${a.id}`).expect(200)).body as ApplicationView).can.delete).toBe(false);
      expect(((await get('superAdmin', `/recruitment/applications/${a.id}`).expect(200)).body as ApplicationView).can.delete).toBe(true);
      expect(await prisma.jobApplication.count({ where: { id: a.id } })).toBe(1);
    });

    it('goes when rejected, with its steps, comments, interviews past and cancelled, draft offer and notifications; its last record taking the profile', async () => {
      const a = await apply(A, 'rana');
      ok(await post('hr', `/recruitment/applications/${a.id}/stage`, { to: 'rejected', reason: 'Made-up reason' }));
      ok(await post('hr', '/recruitment/comments', { applicationId: a.id, comment: 'Made-up comment', verdict: 'maybe' }), 201);
      await interview(a.id, 'done', new Date(Date.now() - 3 * 86_400_000));
      await interview(a.id, 'cancelled', new Date(Date.now() + 5 * 86_400_000));
      const draft = await offer(a.id, 'draft', 1);
      await prisma.notification.create({ data: { userId: users.hr, kind: 'hiring_suggestion', title: 'Made-up', body: 'Made-up', link: `/recruitment/applicants/${a.id}` } });
      await prisma.notification.create({ data: { userId: users.hr, kind: 'interview_feedback', title: 'Made-up', body: 'Made-up', link: `/recruitment/applicants/${a.id}#screening-comments` } });
      const before = await vacancyOf(A);

      const d = ok(await get('superAdmin', `/recruitment/applications/${a.id}/deletion`)).body as ApplicationDeletion;
      expect(d).toMatchObject({ id: a.id, number: a.number, vacancy: { id: A.id, number: A.number }, refusal: null, interviews: 2, comments: 1, files: 1, draftOffers: 1 });
      expect(d.candidate).toMatchObject({ id: a.candidateId, goes: true });

      await del('superAdmin', `/recruitment/applications/${a.id}`).expect(204);
      expect(await prisma.jobApplication.count({ where: { id: a.id } })).toBe(0);
      expect(await prisma.jobApplicationStep.count({ where: { applicationId: a.id } })).toBe(0);
      expect(await prisma.screeningComment.count({ where: { applicationId: a.id } })).toBe(0);
      expect(await prisma.interview.count({ where: { applicationId: a.id } })).toBe(0);
      expect(await prisma.jobApplicationCv.count({ where: { applicationId: a.id } })).toBe(0);
      expect(await prisma.jobOffer.count({ where: { id: draft.id } })).toBe(0);
      expect(await prisma.notification.count({ where: { link: { startsWith: `/recruitment/applicants/${a.id}` } } })).toBe(0);
      // nothing else was left of them
      expect(await candidateGone(a.candidateId!)).toBe(true);
      expect(await prisma.candidateContact.count({ where: { value: email('rana') } })).toBe(0);
      // the vacancy's count drops; the applicant's page answers 404
      const after = await vacancyOf(A);
      expect(after.applicants).toBe(before.applicants - 1);
      expect(after.sourceCounts.careers ?? 0).toBe((before.sourceCounts.careers ?? 0) - 1);
      await get('superAdmin', `/recruitment/applications/${a.id}`).expect(404);
      await del('superAdmin', `/recruitment/applications/${a.id}`).expect(404);
    });

    it('stays on record once an offer was sent to them', async () => {
      const a = await apply(A, 'omar');
      ok(await post('hr', `/recruitment/applications/${a.id}/stage`, { to: 'shortlisted' }));
      await offer(a.id, 'sent', 2);
      const d = ok(await get('superAdmin', `/recruitment/applications/${a.id}/deletion`)).body as ApplicationDeletion;
      expect(d.refusal).toBe('An offer was sent to them, so the application stays on record.');
      expect(said(await del('superAdmin', `/recruitment/applications/${a.id}`).expect(409))).toEqual(['An offer was sent to them, so the application stays on record.']);
      expect(await prisma.jobApplication.count({ where: { id: a.id } })).toBe(1);
    });

    it('stays while an interview is still to come, until it is cancelled through the usual path', async () => {
      const a = await apply(A, 'ivy');
      const iv = await interview(a.id, 'scheduled', new Date(Date.now() + 7 * 86_400_000));
      const text = `Cancel the interview on ${interviewWhen(iv.startsAt)} first, so the invitations go out as cancelled.`;
      expect((ok(await get('superAdmin', `/recruitment/applications/${a.id}/deletion`)).body as ApplicationDeletion).refusal).toBe(text);
      expect(said(await del('superAdmin', `/recruitment/applications/${a.id}`).expect(409))).toEqual([text]);
      ok(await post('hr', `/recruitment/interviews/${iv.id}/cancel`, { reason: 'Made-up reason' }));
      await del('superAdmin', `/recruitment/applications/${a.id}`).expect(204);
      expect(await prisma.interview.count({ where: { id: iv.id } })).toBe(0);
    });

    it('leaves the candidate profile while they have another application or a general CV', async () => {
      const B = await openVacancy();
      // another application
      const samiA = await apply(A, 'sami');
      const samiB = await apply(B, 'sami');
      expect(samiB.candidateId).toBe(samiA.candidateId);
      expect((ok(await get('superAdmin', `/recruitment/applications/${samiA.id}/deletion`)).body as ApplicationDeletion).candidate).toMatchObject({ goes: false });
      await del('superAdmin', `/recruitment/applications/${samiA.id}`).expect(204);
      expect(await candidateGone(samiA.candidateId!)).toBe(false);
      expect(await prisma.jobApplication.count({ where: { candidateId: samiA.candidateId } })).toBe(1);
      // a general CV
      const cv = await addCv('gina');
      const gina = await apply(A, 'gina');
      const cvCandidate = (await prisma.generalCv.findUniqueOrThrow({ where: { id: cv.id }, select: { candidateId: true } })).candidateId;
      expect(gina.candidateId).toBe(cvCandidate);
      expect((ok(await get('superAdmin', `/recruitment/applications/${gina.id}/deletion`)).body as ApplicationDeletion).candidate).toMatchObject({ goes: false });
      await del('superAdmin', `/recruitment/applications/${gina.id}`).expect(204);
      expect(await candidateGone(gina.candidateId!)).toBe(false);
      expect(await prisma.generalCv.count({ where: { id: cv.id } })).toBe(1);
    });

    it('puts a general CV added from Suggested From Earlier CVs back to Reviewed, to be suggested again', async () => {
      const cv = await addCv('nadia');
      // worked out now (the vacancy's page keeps them 2 minutes)
      await app.get(VacancySuggestionsService).refreshVacancy(A.id, { notify: false });
      const listed = ok(await get('hr', `/recruitment/vacancies/${A.id}/suggestions`)).body as VacancySuggestions;
      const row = listed.rows.find((r) => r.source?.kind === 'general_cv' && r.source.id === cv.id);
      expect(row).toBeDefined();
      ok(await post('hr', `/recruitment/suggestions/${row!.id}/add`));
      const moved = await prisma.generalCv.findUniqueOrThrow({ where: { id: cv.id }, select: { status: true, applicationId: true } });
      expect(moved.status).toBe('moved');
      expect(await prisma.vacancySuggestion.findUniqueOrThrow({ where: { id: row!.id }, select: { status: true } })).toEqual({ status: 'added' });

      await del('superAdmin', `/recruitment/applications/${moved.applicationId}`).expect(204);
      expect(await prisma.vacancySuggestion.count({ where: { id: row!.id } })).toBe(0);
      const back = await prisma.generalCv.findUniqueOrThrow({ where: { id: cv.id }, select: { status: true, applicationId: true, events: { orderBy: { at: 'desc' }, take: 1, select: { event: true, note: true } } } });
      expect(back).toMatchObject({ status: 'reviewed', applicationId: null, events: [{ event: 'restored', note: `Its application on ${A.number} was deleted` }] });
      // worked out again: suggested once more
      const again = ok(await get('hr', `/recruitment/vacancies/${A.id}/suggestions`)).body as VacancySuggestions;
      expect(again.rows.find((r) => r.source?.kind === 'general_cv' && r.source.id === cv.id)).toMatchObject({ status: 'suggested' });
    });
  });

  describe('a vacancy with applicants', () => {
    it('is refused without its number typed, then goes with everything on it', async () => {
      const C = await openVacancy();
      const lone = await apply(C, 'lone');
      const zaid = await apply(C, 'zaid');
      ok(await post('hr', `/recruitment/applications/${zaid.id}/stage`, { to: 'rejected', reason: 'Made-up reason' }));
      await interview(zaid.id, 'done', new Date(Date.now() - 86_400_000));
      // zaid applied to another job too: their profile stays
      const zaidA = await apply(A, 'zaid');
      ok(await post('hr', `/recruitment/vacancies/${C.id}/close`, { reason: 'Made-up reason' }));

      const shown = ok(await get('superAdmin', `/recruitment/vacancies/${C.id}`)).body as VacancyView;
      expect(shown.can.delete).toBe(true);
      expect((ok(await get('hr', `/recruitment/vacancies/${C.id}`)).body as VacancyView).can.delete).toBe(false);
      await get('hr', `/recruitment/vacancies/${C.id}/deletion`).expect(403);
      await del('hr', `/recruitment/vacancies/${C.id}?confirm=${C.number}`).expect(403);
      const d = ok(await get('superAdmin', `/recruitment/vacancies/${C.id}/deletion`)).body as VacancyDeletion;
      expect(d).toEqual({ id: C.id, number: C.number, title: C.title, status: 'closed', applications: 2, refusals: [], candidates: 1, confirm: true });

      expect(said(await del('superAdmin', `/recruitment/vacancies/${C.id}`).expect(400))).toEqual([vacancyConfirmText(C.number, 2)]);
      expect(said(await del('superAdmin', `/recruitment/vacancies/${C.id}?confirm=VAC-1999-0000`).expect(400))).toEqual([vacancyConfirmText(C.number, 2)]);
      expect(await prisma.vacancy.count({ where: { id: C.id } })).toBe(1);

      await del('superAdmin', `/recruitment/vacancies/${C.id}?confirm=${C.number.toLowerCase()}`).expect(204);
      expect(await prisma.vacancy.count({ where: { id: C.id } })).toBe(0);
      expect(await prisma.jobApplication.count({ where: { id: { in: [lone.id, zaid.id] } } })).toBe(0);
      expect(await prisma.interview.count({ where: { applicationId: zaid.id } })).toBe(0);
      expect(await prisma.vacancySuggestion.count({ where: { vacancyId: C.id } })).toBe(0);
      expect(await candidateGone(lone.candidateId!)).toBe(true);
      expect(await candidateGone(zaid.candidateId!)).toBe(false);
      expect(await prisma.jobApplication.count({ where: { id: zaidA.id } })).toBe(1);
      await get('superAdmin', `/recruitment/vacancies/${C.id}`).expect(404);

      // the audit log: the vacancy, each application, the profile deleted; numbers and statuses only
      const vacancyRow = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'vacancy', entityId: C.id, action: 'delete' }, select: { diff: true } });
      expect(vacancyRow.diff).toEqual({ number: C.number, title: C.title, status: 'closed', applicationsDeleted: [lone.number, zaid.number].sort() });
      const appRows = await prisma.auditLog.findMany({ where: { entityType: 'job_application', entityId: { in: [lone.id, zaid.id] }, action: 'delete' }, select: { entityId: true, diff: true } });
      expect(appRows.find((r) => r.entityId === zaid.id)?.diff).toEqual({ number: zaid.number, vacancy: C.number, stage: 'rejected', source: 'careers', interviews: 1, comments: 0, withVacancy: true });
      expect(appRows.find((r) => r.entityId === lone.id)?.diff).toMatchObject({ number: lone.number, vacancy: C.number, stage: 'applied', source: 'careers' });
      const text = JSON.stringify(appRows);
      expect(text).not.toContain(RUN);
      const candidateRows = await prisma.auditLog.findMany({ where: { entityType: 'candidate', entityId: lone.candidateId!, action: 'delete' }, select: { diff: true } });
      expect(candidateRows).toHaveLength(1);
      expect(candidateRows[0].diff).toEqual({ code: expect.stringMatching(/^CAN-/) });
    });

    it('is refused as a whole while one application stays, naming it, nothing changed', async () => {
      const D = await openVacancy();
      const kept = await apply(D, 'kamal');
      const other = await apply(D, 'mai');
      ok(await post('hr', `/recruitment/applications/${kept.id}/stage`, { to: 'shortlisted' }));
      const sent = await offer(kept.id, 'sent', 3);
      const line = `${kept.number}: an offer was sent (${sent.number})`;
      const d = ok(await get('superAdmin', `/recruitment/vacancies/${D.id}/deletion`)).body as VacancyDeletion;
      expect(d.refusals).toEqual([line]);
      const res = await del('superAdmin', `/recruitment/vacancies/${D.id}?confirm=${D.number}`).expect(409);
      expect(said(res)).toEqual([`One application stays on record, so the vacancy stays: ${line}.`]);
      expect(await prisma.vacancy.count({ where: { id: D.id } })).toBe(1);
      expect(await prisma.jobApplication.count({ where: { id: { in: [kept.id, other.id] } } })).toBe(2);
      expect(await candidateGone(other.candidateId!)).toBe(false);
    });

    it('is deleted as before when nobody applied, without a number to type', async () => {
      const E = await openVacancy();
      expect((ok(await get('superAdmin', `/recruitment/vacancies/${E.id}/deletion`)).body as VacancyDeletion).confirm).toBe(false);
      await del('superAdmin', `/recruitment/vacancies/${E.id}`).expect(204);
      expect(await prisma.vacancy.count({ where: { id: E.id } })).toBe(0);
    });
  });
});
