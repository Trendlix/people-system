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
// "Yes, at once"; 5 November 2026: Review 1 merged into Applicants, Review 2 the Final Review, a review's Reject with
// "optional Feedback", review rejections apart from the Rejected tab; 9 November 2026: "give the hiring manager access to
// move his batch to HR screening", the Final Review and the Technical Interview the hiring manager's). A Video Editor
// vacancy recruited by Rita (in HR), whose manager Mazen isn't in HR, hired for by Hana; and one recruited by Hadi (in
// HR) without a hiring manager. Rita's Applicants (another HR person refused, no Send to Review 1), Hana's Final Review
// on My Hiring (told once, a batch passed to HR Screening; Mazen has no part any more), HR Screening (Unreachable kept,
// the interview refused until accepted), the Technical Interview (HR's Pending kept, HR refused Accepted, Hana's Accepted
// to the Offer), a decline closing, the Final Review skipped and the interview HR's without a hiring manager, a Super
// Admin taking any step, the Rejected tab without the reviews' rejections ("Rejected at review" apart), the restore and
// the board. Email is kept in MailService's outbox
// (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

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
    it('names the recruiter; only an HR person may be one', async () => {
      expect(v.recruiter).toEqual({ id: people.rita, name: `Rita Recruiter ${RUN}` });
      expect(v.hiringManager).toEqual({ id: people.hana, name: `Hana Hiring ${RUN}` });
      expect(solo.hiringManager).toBeNull();
      expect(said(await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', recruiterId: people.hana }).expect(400))).toEqual([
        'The recruiter must be a current employee who works in HR.',
      ]);
    });
  });

  describe('Applicants: the recruiter’s review', () => {
    it('every CV lands there, Rita’s to pass or reject without reasons; no Send to Review 1 any more', async () => {
      const sara = (await get('rita', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(sara).toMatchObject({ stage: 'applied' });
      expect(sara.can.decide).toEqual({ stage: 'applied', outcomes: ['passed', 'rejected'], reasons: [] });
      expect(sara.nextBy).toBe(`The recruiter: Rita Recruiter ${RUN}`);
      await post('hr', `/recruitment/vacancies/${v.id}/send-to-review`, { applicationIds: [apps.Sara] }).expect(404);
      expect(said(await post('hr', `/recruitment/applications/${apps.Sara}/stage`, { to: 'review_1' }).expect(400))).toEqual(['Choose Rejected.']);
    });

    it('is Rita’s: another HR person is refused, a Super Admin may', async () => {
      expect(said(await post('hadi', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'passed' }).expect(403))).toEqual(['The recruiter takes this step.']);
      expect(((await get('hadi', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView).can.decide).toBeNull();
    });

    it('a rejection takes no reasons, its feedback optional, kept as a decision', async () => {
      expect(said(await post('rita', `/recruitment/applications/${apps.Lina}/decide`, { outcome: 'rejected', reasons: ['culture_fit'] }).expect(400))).toEqual([
        'A review is passed or rejected: no reasons are chosen, write feedback if you like.',
      ]);
      const lina = (await post('rita', `/recruitment/applications/${apps.Lina}/decide`, { outcome: 'rejected', feedback: 'Lives far, wants remote only' }).expect(200)).body as ApplicationView;
      expect(lina.stage).toBe('rejected');
      expect(await stageOf('Lina')).toMatchObject({ rejectedFrom: 'applied', rejectReason: null });
      expect(lina.decisions).toEqual([
        { id: expect.any(String), stage: 'applied', outcome: 'rejected', reasons: [], feedback: 'Lives far, wants remote only', by: expect.objectContaining({ email: emails.rita }), at: expect.any(String) },
      ]);
      expect(lina.history.at(-1)).toMatchObject({ event: 'decided', stage: 'rejected', note: 'Applicants: Rejected' });
      expect(await prisma.auditLog.findFirst({ where: { entityId: apps.Lina, action: 'decide' } })).toMatchObject({ diff: { step: 'applied', outcome: 'rejected' } });
    });

    it('passes several at once to the Final Review (the others skipped with why); Hana told once', async () => {
      const before = mail.outbox.length;
      const stray = randomUUID();
      const r = (
        await post('rita', `/recruitment/vacancies/${v.id}/decide`, {
          applicationIds: [apps.Sara, apps.Adam, apps.Nour, apps.Lina, apps.Fady, apps.Basma, stray],
          stage: 'applied',
          outcome: 'passed',
          feedback: 'Strong reels',
        }).expect(200)
      ).body as HiringBatchResult;
      expect(r.done.map((d) => d.id)).toEqual([apps.Sara, apps.Adam, apps.Nour]);
      expect(r.skipped.map((x) => x.reason)).toEqual([
        'They were rejected already.',
        'They failed a must-have question and were filtered out.',
        'They applied to another vacancy.',
        'Applicant not found.',
      ]);
      expect((await stageOf('Sara')).stage).toBe('review_2');
      expect(await notices('hana')).toEqual([{ title: `3 applicants for ${job} wait for your final review: pass or reject them`, body: [name('Sara'), name('Adam'), name('Nour')].join(', '), link: '/recruitment/my-hiring' }]);
      expect(mail.outbox.slice(before).map((m) => m.to)).toEqual([emails.hana]);
      // the recruiter's manager has no part any more (9 November 2026)
      expect(await notices('mazen')).toEqual([]);
      // Rita works on the HR pages: nothing sent her
      expect(await notices('rita')).toEqual([]);
    });
  });

  describe('the Final Review: the hiring manager’s (9 November 2026)', () => {
    it('Hana sees those at her Final Review on My Hiring and their page, never their expected salary; Mazen nothing', async () => {
      const mine = (await get('hana', '/recruitment/my-hiring').expect(200)).body as MyHiring;
      expect(mine.toReview).toEqual([{ vacancy: { id: v.id, number: v.number, title: v.title }, applicants: expect.any(Array) }]);
      expect(mine.toReview![0].applicants.map((a) => [a.fullName, a.stage])).toEqual([
        [name('Sara'), 'review_2'],
        [name('Adam'), 'review_2'],
        [name('Nour'), 'review_2'],
      ]);
      const sara = (await get('hana', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(sara).toMatchObject({ viewer: 'hiring_manager', expectedSalary: null, nextBy: `The hiring manager: Hana Hiring ${RUN}`, can: { decide: { stage: 'review_2', outcomes: ['passed', 'rejected'], reasons: [] } } });
      // nobody before her review: Lina was rejected at Applicants
      await get('hana', `/recruitment/applications/${apps.Lina}`).expect(404);
      await get('mazen', `/recruitment/applications/${apps.Sara}`).expect(404);
      expect(((await get('mazen', '/recruitment/my-hiring').expect(200)).body as MyHiring).toReview ?? []).toEqual([]);
    });

    it('passes her batch to HR Screening, rejects one; HR may not take her review', async () => {
      expect(said(await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'passed' }).expect(403))).toEqual(['The hiring manager takes this step.']);
      await post('hana', `/recruitment/vacancies/${v.id}/decide`, { applicationIds: [apps.Sara, apps.Adam], stage: 'review_2', outcome: 'passed' }).expect(200);
      await post('hana', `/recruitment/applications/${apps.Nour}/decide`, { outcome: 'rejected' }).expect(200);
      expect((await stageOf('Sara')).stage).toBe('screening');
      expect(await stageOf('Nour')).toMatchObject({ stage: 'rejected', rejectedFrom: 'review_2' });
      // still hers to see, the one she rejected too
      expect(((await get('hana', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView).viewer).toBe('hiring_manager');
      await get('hana', `/recruitment/applications/${apps.Nour}`).expect(200);
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

    it('rejects only with its own reasons', async () => {
      expect(said(await post('hr', `/recruitment/applications/${apps.Adam}/decide`, { outcome: 'rejected' }).expect(400))).toEqual(['Choose why they are rejected: one reason or more.']);
      await post('hr', `/recruitment/applications/${apps.Adam}/decide`, { outcome: 'rejected', reasons: ['overqualified'], feedback: 'Too senior for the role' }).expect(200);
      expect(await stageOf('Adam')).toMatchObject({ stage: 'rejected', rejectedFrom: 'screening', rejectReason: 'Overqualified' });
    });
  });

  describe('the Technical Interview: the hiring manager’s (9 November 2026)', () => {
    it('HR records the candidate’s Pending; Accepted and Rejected are Hana’s, which takes them to the Offer', async () => {
      const pending = (await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'pending' }).expect(200)).body as ApplicationView;
      expect(pending).toMatchObject({ stage: 'interview', hold: 'pending', can: { makeOffer: false, scheduleInterview: true, decide: { stage: 'interview', outcomes: ['pending', 'unreachable', 'declined'], reasons: [] } } });
      expect(said(await post('hr', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'accepted' }).expect(403))).toEqual([
        'The hiring manager accepts or rejects at this step; HR records Pending, Unreachable or Declined.',
      ]);
      const hanas = (await get('hana', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(hanas.can.decide).toEqual({ stage: 'interview', outcomes: ['accepted', 'rejected', 'pending', 'unreachable', 'declined'], reasons: expect.arrayContaining(['skills_mismatch']) });
      expect(said(await post('hana', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'rejected', reasons: ['location'] }).expect(400))[0]).toContain('Choose the reasons from: Culture Fit');
      const offer = (await post('hana', `/recruitment/applications/${apps.Sara}/decide`, { outcome: 'accepted', feedback: 'Great test edit' }).expect(200)).body as ApplicationView;
      expect(offer).toMatchObject({ stage: 'offer', hold: null, nextBy: null, can: { decide: null } });
      expect(((await get('hr', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView).can.makeOffer).toBe(true);
      expect(offer.decisions!.map((d) => [d.stage, d.outcome])).toEqual([
        ['applied', 'passed'],
        ['review_2', 'passed'],
        ['screening', 'unreachable'],
        ['screening', 'accepted'],
        ['interview', 'pending'],
        ['interview', 'accepted'],
      ]);
    });
  });

  describe('without a hiring manager', () => {
    it('the Final Review is skipped; the interview is HR’s; a decline closes them', async () => {
      const basma = (await post('hadi', `/recruitment/applications/${apps.Basma}/decide`, { outcome: 'passed' }).expect(200)).body as ApplicationView;
      expect(basma.stage).toBe('screening');
      expect(await notices('hadi')).toEqual([]);
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

  describe('the Rejected tab and Applicants’ “Rejected at review”', () => {
    it('lists those rejected at HR Screening or the interview on the tab, those rejected at a review apart', async () => {
      const ids = async (query: string) => ((await get('hr', `/recruitment/applications?vacancyId=${v.id}&${query}`).expect(200)).body as ApplicationListItem[]).map((a) => a.id).sort();
      expect(await ids('stage=rejected')).toEqual([apps.Adam].sort());
      expect(await ids('reviewRejected=only')).toEqual([apps.Lina, apps.Nour].sort());
      // the stage asked for doesn't matter with it
      expect(await ids('reviewRejected=only&stage=applied')).toEqual([apps.Lina, apps.Nour].sort());
      expect(((await get('hr', `/recruitment/vacancies/${v.id}`).expect(200)).body as VacancyView)).toMatchObject({ rejectedAtReview: 2, stageCounts: { rejected: 1 } });
      const board = (await get('hr', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(board.rejectedAtReview).toBe(2);
      expect(board.columns.find((c) => c.stage === 'rejected')!.cards.map((c) => c.id)).toEqual([apps.Adam]);
      // the decline closes at the interview: on the tab
      expect(((await get('hr', `/recruitment/applications?vacancyId=${solo.id}&stage=rejected`).expect(200)).body as ApplicationListItem[]).map((a) => a.id)).toEqual([apps.Basma]);
    });
  });

  describe('HR’s hand', () => {
    it('rejects from any step with its reasons (none at a review); restores to the step they were rejected at', async () => {
      expect(said(await post('hr', `/recruitment/applications/${apps.Badr}/stage`, { to: 'rejected' }).expect(400))).toEqual(['Choose why they are rejected: one reason or more.']);
      await post('hr', `/recruitment/applications/${apps.Badr}/stage`, { to: 'rejected', reasons: ['salary_expectations'], feedback: 'Asked for twice the range' }).expect(200);
      expect(await stageOf('Badr')).toMatchObject({ stage: 'rejected', rejectedFrom: 'screening', rejectReason: 'Salary Expectations' });
      await post('hr', `/recruitment/applications/${apps.Lina}/restore`).expect(200);
      expect((await stageOf('Lina')).stage).toBe('applied');
      expect(said(await post('hr', `/recruitment/applications/${apps.Lina}/stage`, { to: 'rejected', reasons: ['culture_fit'] }).expect(400))).toEqual([
        'A review is passed or rejected: no reasons are chosen, write feedback if you like.',
      ]);
      await post('hr', `/recruitment/applications/${apps.Lina}/stage`, { to: 'rejected' }).expect(200);
      expect(await stageOf('Lina')).toMatchObject({ stage: 'rejected', rejectedFrom: 'applied' });
    });

    it('the board has a column a step; the hiring manager’s starts at her Final Review', async () => {
      const board = (await get('hr', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(board.columns.map((c) => c.stage)).toEqual(['applied', 'review_2', 'screening', 'interview', 'offer', 'hired', 'rejected']);
      expect(board.columns.find((c) => c.stage === 'offer')!.cards.map((c) => c.id)).toEqual([apps.Sara]);
      const hanas = (await get('hana', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(hanas.columns.map((c) => c.stage)).toEqual(['review_2', 'screening', 'interview', 'offer', 'hired', 'rejected']);
    });
  });
});
