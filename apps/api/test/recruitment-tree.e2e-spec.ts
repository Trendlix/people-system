import type { INestApplication } from '@nestjs/common';
import type { ApplicationListItem, ApplicationView, HiringBatchResult, MyHiring, Role, VacancyBoard, VacancyView } from '@trendlix/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The recruitment tree (owner, 3 November 2026: "Recrutment tree"; asked, "HR1 (Recruter) - HR2 (Her MAnager if there is)
// - then Manager", "Declined closes, rest stay", "Reason list + feedback", "Wait in Applicants", "A Recruiter field",
// "Yes, at once"). A Video Editor vacancy recruited by Rita (in HR), whose manager Mazen isn't in HR, hired for by Hana;
// and one recruited by Hadi (in HR, nobody manages him) without a hiring manager. HR sends applicants to Review 1 (Rita
// told), Rita's Review 1 (another HR person refused), Mazen's Review 2 on My Hiring (Hana told), Hana's Final Review (her
// rejection final, HR told), HR Screening (Unreachable kept, the interview refused until accepted), the Technical
// Interview (Pending kept, Accepted to the Offer), a decline closing, the reviews skipped without their people, a Super
// Admin taking any step, the restore and the board. Email is kept in MailService's outbox (MAIL_TRANSPORT=memory). Every
// name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `tr${Date.now().toString(36)}`;

describe('The recruitment tree (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let gradeId: string;
  let shiftId: string;
  let v: VacancyView;
  let solo: VacancyView;
  const vacancyIds: string[] = [];
  const employeeIds: string[] = [];
  const apps: Record<string, string> = {};
  let n = 0;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const notices = (key: string) => prisma.notification.findMany({ where: { userId: users[key], kind: 'shortlist_review' }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });
  const name = (key: string) => `${key} Applicant ${RUN}`;
  const job = `Video Editor ${RUN}`;
  const stageOf = async (key: string) => prisma.jobApplication.findUniqueOrThrow({ where: { id: apps[key] }, select: { stage: true, hold: true, rejectedFrom: true, rejectReason: true } });

  /** A user with an employee profile (their work email their sign-in) and a current employment under `managerId`. */
  async function person(key: string, roles: Role[], fullName: string, managerId: string | null = null) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${fullName} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: email,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId, managerId } },
      },
      select: { id: true },
    });
    people[key] = e.id;
    employeeIds.push(e.id);
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: e.id } });
  }

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** A vacancy drafted by HR and approved by the CEO. */
  async function vacancy(body: object): Promise<VacancyView> {
    const made = await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 3, gradeId, shiftId, ...body }).expect(201);
    vacancyIds.push(made.body.id);
    await post('hr', `/recruitment/vacancies/${made.body.id}/submit`).expect(200);
    return (await post('ceo', `/recruitment/vacancies/${made.body.id}/approve`).expect(200)).body as VacancyView;
  }

  /** An applicant as the careers page makes one, at Applicants; the earlier made, the better their match. */
  async function applicant(key: string, vacancyId: string, extra: { filteredOut?: boolean } = {}) {
    n++;
    const a = await prisma.jobApplication.create({
      data: {
        // a year the careers page never numbers, so the numbering of real applications never meets it
        number: `APP-1997-${String(Date.now()).slice(-7)}${n}`,
        vacancyId,
        stage: 'applied',
        filteredOut: extra.filteredOut ?? false,
        fullName: name(key),
        email: `${key.toLowerCase()}.${RUN}@mail.test`,
        mobile: '+20 100 123 4567',
        expectedSalary: 20000,
        consentAt: new Date(),
        matchPercent: 80 - n,
        points: 8,
        maxPoints: 10,
        cv: { create: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 10, data: Buffer.from('%PDF-1.4\n%%EOF\n') } },
        steps: { create: [{ event: 'applied', stage: 'applied', at: new Date(Date.now() - 86_400_000) }] },
      },
      select: { id: true },
    });
    apps[key] = a.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    departmentId = (await prisma.department.create({ data: { nameEn: `Post Production ${RUN}` }, select: { id: true } })).id;
    gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: job, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await person('mazen', ['employee', 'manager'], 'Mazen Manager');
    await person('rita', ['hr'], 'Rita Recruiter', people.mazen);
    await person('hadi', ['hr'], 'Hadi HR');
    await person('hana', ['employee', 'manager'], 'Hana Hiring');
    v = await vacancy({ recruiterId: people.rita, hiringManagerId: people.hana });
    solo = await vacancy({ recruiterId: people.hadi });
    for (const key of ['Sara', 'Adam', 'Nour', 'Lina']) await applicant(key, v.id);
    await applicant('Fady', v.id, { filteredOut: true });
    await applicant('Basma', solo.id);
    await applicant('Badr', solo.id);
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.user.updateMany({ where: { employeeId: { in: employeeIds } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('the vacancy’s recruiter', () => {
    it('names the recruiter and their manager; only an HR person may be one', async () => {
      expect(v.recruiter).toEqual({ id: people.rita, name: `Rita Recruiter ${RUN}` });
      expect(v.recruiterManager).toEqual({ id: people.mazen, name: `Mazen Manager ${RUN}` });
      expect(solo.recruiterManager).toBeNull();
      expect(said(await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', recruiterId: people.hana }).expect(400))).toEqual([
        'The recruiter must be a current employee who works in HR.',
      ]);
    });
  });

  describe('Applicants to Review 1', () => {
    it('HR sends several at once (the others skipped with why); the recruiter told once', async () => {
      const before = mail.outbox.length;
      const stray = randomUUID();
      const r = (await post('hr', `/recruitment/vacancies/${v.id}/send-to-review`, { applicationIds: [apps.Sara, apps.Adam, apps.Nour, apps.Lina, apps.Fady, apps.Basma, stray] }).expect(200))
        .body as HiringBatchResult;
      expect(r.done.map((d) => d.id)).toEqual([apps.Sara, apps.Adam, apps.Nour, apps.Lina]);
      expect(r.skipped.map((s) => s.reason)).toEqual(['They failed a must-have question and were filtered out: restore them first.', 'They applied to another vacancy.', 'Applicant not found.']);
      expect((await stageOf('Sara')).stage).toBe('review_1');
      expect(await notices('rita')).toEqual([
        { title: `4 applicants for ${job} wait for your Review 1: pass or reject them`, body: [name('Sara'), name('Adam'), name('Nour'), name('Lina')].join(', '), link: '/recruitment/applicants?stage=review_1' },
      ]);
      expect(mail.outbox.slice(before).map((m) => m.to)).toEqual([emails.rita]);
      // their page: Rita decides it, as "The recruiter"
      const sara = (await get('rita', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(sara.can.decide).toEqual({ stage: 'review_1', outcomes: ['passed', 'rejected'], reasons: expect.arrayContaining(['culture_fit', 'objectives_mismatch']) });
      expect(sara.nextBy).toBe(`The recruiter: Rita Recruiter ${RUN}`);
      expect(sara.history.at(-1)).toMatchObject({ event: 'to_review', stage: 'review_1' });
    });
  });

  describe('Review 1: the recruiter', () => {
    it('is Rita’s: another HR person is refused, a Super Admin may', async () => {
      expect(said(await post('hadi', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'passed' }).expect(403))).toEqual(['The recruiter takes this step.']);
      expect(((await get('hadi', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView).can.decide).toBeNull();
    });

    it('a rejection takes its reasons and feedback, kept as a decision', async () => {
      expect(said(await post('rita', `/recruitment/applications/${apps.Lina}/decide`, { outcome: 'rejected' }).expect(400))).toEqual(['Choose why they are rejected: one reason or more.']);
      const lina = (await post('rita', `/recruitment/applications/${apps.Lina}/decide`, { outcome: 'rejected', reasons: ['culture_fit', 'location'], feedback: 'Lives far, wants remote only' }).expect(200)).body as ApplicationView;
      expect(lina.stage).toBe('rejected');
      expect(await stageOf('Lina')).toMatchObject({ rejectedFrom: 'review_1', rejectReason: 'Culture Fit, Location' });
      expect(lina.decisions).toEqual([
        { id: expect.any(String), stage: 'review_1', outcome: 'rejected', reasons: ['culture_fit', 'location'], feedback: 'Lives far, wants remote only', by: expect.objectContaining({ email: emails.rita }), at: expect.any(String) },
      ]);
      expect(lina.history.at(-1)).toMatchObject({ event: 'decided', stage: 'rejected', note: 'Review 1: Rejected (Culture Fit, Location)' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: apps.Lina, action: 'decide' } })).toMatchObject({ diff: { step: 'review_1', outcome: 'rejected', reasons: 'Culture Fit, Location' } });
    });

    it('passes several at once to Review 2; Mazen told once', async () => {
      const r = (await post('rita', `/recruitment/vacancies/${v.id}/decide`, { applicationIds: [apps.Sara, apps.Adam, apps.Nour, apps.Lina], stage: 'review_1', outcome: 'passed', feedback: 'Strong reels' }).expect(200))
        .body as HiringBatchResult;
      expect(r.done.map((d) => d.id)).toEqual([apps.Sara, apps.Adam, apps.Nour]);
      expect(r.skipped).toEqual([{ id: apps.Lina, number: expect.any(String), fullName: name('Lina'), reason: 'They were rejected already.' }]);
      expect((await stageOf('Sara')).stage).toBe('review_2');
      expect(await notices('mazen')).toEqual([{ title: `3 applicants for ${job} wait for your Review 2: pass or reject them`, body: [name('Sara'), name('Adam'), name('Nour')].join(', '), link: '/recruitment/my-hiring' }]);
    });
  });

  describe('Review 2: the recruiter’s manager', () => {
    it('Mazen, outside HR, sees those at his Review 2 on My Hiring and their page, never their expected salary', async () => {
      const mine = (await get('mazen', '/recruitment/my-hiring').expect(200)).body as MyHiring;
      expect(mine.toReview).toEqual([{ vacancy: { id: v.id, number: v.number, title: v.title }, applicants: expect.any(Array) }]);
      expect(mine.toReview![0].applicants.map((a) => [a.fullName, a.stage])).toEqual([
        [name('Sara'), 'review_2'],
        [name('Adam'), 'review_2'],
        [name('Nour'), 'review_2'],
      ]);
      const sara = (await get('mazen', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(sara).toMatchObject({ viewer: 'reviewer', expectedSalary: null, can: { decide: { stage: 'review_2' } } });
      await get('mazen', `/recruitment/applications/${apps.Lina}`).expect(404);
    });

    it('passes two to the Final Review (Hana told once), rejects one', async () => {
      await post('mazen', `/recruitment/vacancies/${v.id}/decide`, { applicationIds: [apps.Sara, apps.Adam], stage: 'review_2', outcome: 'passed' }).expect(200);
      await post('mazen', `/recruitment/applications/${apps.Nour}/decide`, { outcome: 'rejected', reasons: ['underqualified'] }).expect(200);
      expect((await stageOf('Sara')).stage).toBe('final_review');
      expect(await stageOf('Nour')).toMatchObject({ stage: 'rejected', rejectedFrom: 'review_2' });
      expect(await notices('hana')).toEqual([{ title: `2 applicants for ${job} wait for your final review: pass or reject them`, body: [name('Sara'), name('Adam')].join(', '), link: '/recruitment/my-hiring' }]);
      // past his review, no longer his to see
      await get('mazen', `/recruitment/applications/${apps.Sara}`).expect(404);
    });
  });

  describe('the Final Review: the hiring manager', () => {
    it('Hana’s rejection is final; her pass goes to HR Screening; HR told', async () => {
      await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'passed' }).expect(403);
      const adam = (await post('hana', `/recruitment/applications/${apps.Adam}/decide`, { outcome: 'rejected', reasons: ['overqualified'], feedback: 'Too senior for the role' }).expect(200))
        .body as ApplicationView;
      expect(adam.stage).toBe('rejected');
      await post('hana', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'passed' }).expect(200);
      expect((await stageOf('Sara')).stage).toBe('screening');
      const hrNotices = await prisma.notification.findMany({ where: { userId: users.hr, kind: 'hiring_suggestion' }, select: { title: true } });
      expect(hrNotices.map((x) => x.title)).toEqual(expect.arrayContaining([`Final Review of ${job}: 1 rejected`, `Final Review of ${job}: 1 passed`]));
    });
  });

  describe('HR Screening', () => {
    it('is HR’s: Unreachable keeps them there; the interview waits for Accepted', async () => {
      expect(said(await post('hana', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'accepted' }).expect(403))).toEqual(['HR takes this step.']);
      expect(said(await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'pending' }).expect(400))).toEqual(['Choose Accepted, Rejected or Unreachable.']);
      await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'unreachable', feedback: 'No answer twice' }).expect(200);
      expect(await stageOf('Sara')).toMatchObject({ stage: 'screening', hold: 'unreachable' });
      const held = (await get('hr', `/recruitment/applications?vacancyId=${v.id}&hold=unreachable`).expect(200)).body as ApplicationListItem[];
      expect(held.map((a) => a.id)).toEqual([apps.Sara]);
      expect(held[0].hold).toBe('unreachable');
      const refused = await post('hr', `/recruitment/applications/${apps.Sara}/interviews`, {}).expect((r) => expect([400, 409]).toContain(r.status));
      if (refused.status === 409) expect(said(refused)[0]).toBe('They are at HR Screening: the interview comes once HR Screening accepts them.');
      await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'accepted' }).expect(200);
      expect(await stageOf('Sara')).toMatchObject({ stage: 'interview', hold: null });
    });
  });

  describe('the Technical Interview', () => {
    it('Pending keeps them; Accepted takes them to the Offer, where an offer can be made', async () => {
      const pending = (await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'pending' }).expect(200)).body as ApplicationView;
      expect(pending).toMatchObject({ stage: 'interview', hold: 'pending', can: { makeOffer: false, scheduleInterview: true } });
      expect(said(await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'rejected', reasons: ['location'] }).expect(400))[0]).toContain('Choose the reasons from: Culture Fit');
      const offer = (await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'accepted', feedback: 'Great test edit' }).expect(200)).body as ApplicationView;
      expect(offer).toMatchObject({ stage: 'offer', hold: null, nextBy: null, can: { makeOffer: true, decide: null } });
      expect(offer.decisions!.map((d) => [d.stage, d.outcome])).toEqual([
        ['review_1', 'passed'],
        ['review_2', 'passed'],
        ['final_review', 'passed'],
        ['screening', 'unreachable'],
        ['screening', 'accepted'],
        ['interview', 'pending'],
        ['interview', 'accepted'],
      ]);
    });
  });

  describe('without a recruiter’s manager or a hiring manager', () => {
    it('Review 2 and the Final Review are skipped; a decline closes them', async () => {
      await post('hr', `/recruitment/applications/${apps.Basma}/stage`, { to: 'review_1' }).expect(200);
      // Hadi, the recruiter, told; not of those he sends himself
      expect((await notices('hadi')).map((x) => x.title)).toEqual([`1 applicant for ${job} wait for your Review 1: pass or reject them`]);
      await post('hadi', `/recruitment/applications/${apps.Badr}/stage`, { to: 'review_1' }).expect(200);
      expect(await notices('hadi')).toHaveLength(1);
      const basma = (await post('hadi', `/recruitment/applications/${apps.Basma}/decide`, { outcome: 'passed' }).expect(200)).body as ApplicationView;
      expect(basma.stage).toBe('screening');
      await post('hr', `/recruitment/applications/${apps.Basma}/decide`, { outcome: 'accepted' }).expect(200);
      const declined = (await post('hr', `/recruitment/applications/${apps.Basma}/decide`, { outcome: 'declined', feedback: 'Took another offer' }).expect(200)).body as ApplicationView;
      expect(declined.stage).toBe('rejected');
      expect(await stageOf('Basma')).toMatchObject({ rejectedFrom: 'interview', rejectReason: 'Declined by the candidate' });
    });

    it('a Super Admin takes any step', async () => {
      await post('superAdmin', `/recruitment/applications/${apps.Badr}/decide`, { outcome: 'passed' }).expect(200);
      expect((await stageOf('Badr')).stage).toBe('screening');
    });
  });

  describe('HR’s hand', () => {
    it('rejects from any step with its reasons; restores to the step they were rejected at', async () => {
      expect(said(await post('hr', `/recruitment/applications/${apps.Badr}/stage`, { to: 'rejected' }).expect(400))).toEqual(['Choose why they are rejected: one reason or more.']);
      await post('hr', `/recruitment/applications/${apps.Badr}/stage`, { to: 'rejected', reasons: ['salary_expectations'], feedback: 'Asked for twice the range' }).expect(200);
      expect(await stageOf('Badr')).toMatchObject({ stage: 'rejected', rejectedFrom: 'screening', rejectReason: 'Salary Expectations' });
      await post('hr', `/recruitment/applications/${apps.Lina}/restore`).expect(200);
      expect((await stageOf('Lina')).stage).toBe('review_1');
    });

    it('the board has a column a step; HR moves only Applicants to Review 1 by hand', async () => {
      const board = (await get('hr', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(board.columns.map((c) => c.stage)).toEqual(['applied', 'review_1', 'review_2', 'final_review', 'screening', 'interview', 'offer', 'hired', 'rejected']);
      expect(board.columns.find((c) => c.stage === 'offer')!.cards.map((c) => c.id)).toEqual([apps.Sara]);
      const hanas = (await get('hana', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(hanas.columns.map((c) => c.stage)).toEqual(['final_review', 'screening', 'interview', 'offer', 'hired', 'rejected']);
    });
  });
});
