import type { INestApplication } from '@nestjs/common';
import type { ApplicationListItem, ApplicationView, HiringStep, InterviewSaved, Role, VacancyBoard, VacancyView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The hiring steps' screening call and the interview's gate (owner, 29 October 2026: "HR Filteration and shortlisting -
// Manager view the shortlisted and accept or reject them - HR Screening and scheduling"; asked, "Screening call +
// result"; packages/shared hiring-steps.ts). A Video Editor vacancy with Hana as its hiring manager, a Colourist one
// without, and a C-level one: HR's screening call (refused before Hana accepts, at Applied, filtered out; passed, failed,
// passed again; only HR or a Super Admin; its comment kept from Hana), the interview scheduled (or moved to by hand) only
// once Hana accepted and the call passed, each refusal in words and nothing saved, a later round asking nothing, Hana's
// acceptance cleared once scheduled; where each shortlisted applicant stands on the list and the board, and ?step=. Email
// is kept in MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `hs${Date.now().toString(36)}`;
const TODAY = todayInCairo();

const WAITING = 'Waiting for the hiring manager to accept them.';
const REJECTED = 'The hiring manager rejected them: reject them, or ask the hiring manager to accept them.';
const NO_CALL = 'Make the screening call first: only those who pass it are interviewed.';
const FAILED = 'They failed the screening call.';

describe('The hiring steps: the screening call and the interview’s gate (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  let departmentId: string;
  const jobTitleIds: string[] = [];
  const vacancyIds: string[] = [];
  const employeeIds: string[] = [];
  /** The vacancies: with Hana as the hiring manager, without one, the list's own (Hana's too), and a C-level one. */
  const vac: Record<'hana' | 'none' | 'list' | 'chief', string> = { hana: '', none: '', list: '', chief: '' };
  const apps: Record<string, string> = {};

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const view = async (as: string, key: string) => (await get(as, `/recruitment/applications/${apps[key]}`).expect(200)).body as ApplicationView;
  const call = (as: string, key: string, body: object) => post(as, `/recruitment/applications/${apps[key]}/screening-call`, body);
  const accept = (key: string) => post('hm', `/recruitment/applications/${apps[key]}/suggest`, { suggestion: 'next' }).expect(200);
  const turnDown = (key: string) => post('hm', `/recruitment/applications/${apps[key]}/suggest`, { suggestion: 'reject', note: 'Not the style we need' }).expect(200);
  const interviewBody = (extra: object = {}) => ({ date: addDays(TODAY, 7), time: '10:30', minutes: 45, kind: 'phone', interviewerIds: [people.iv1], ...extra });
  const schedule = (key: string) => post('hr', `/recruitment/applications/${apps[key]}/interviews`, interviewBody());
  const interviews = (key: string) => prisma.interview.count({ where: { applicationId: apps[key] } });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** A user with an employee profile (their work email their sign-in) and a current employment. */
  async function person(key: string, roles: Role[], name: string) {
    await account(key, roles);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: emails[key],
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId } },
      },
      select: { id: true },
    });
    people[key] = e.id;
    employeeIds.push(e.id);
  }

  /** An applicant as the careers page makes one, at a stage (its history to it), with the steps' fields given. */
  async function applicant(
    key: string,
    vacancyId: string,
    stage: 'applied' | 'shortlisted' | 'interview',
    extra: { filteredOut?: boolean; suggestion?: 'next' | 'reject'; screeningCall?: 'passed' | 'failed' } = {},
  ) {
    const n = Object.keys(apps).length + 1;
    const steps = [{ event: 'applied', stage: 'applied' }];
    if (stage !== 'applied') steps.push({ event: 'shortlisted', stage: 'shortlisted' });
    if (stage === 'interview') steps.push({ event: 'interview', stage: 'interview' });
    const a = await prisma.jobApplication.create({
      data: {
        // a year the careers page never numbers, so the numbering of real applications never meets it
        number: `APP-1997-${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`,
        vacancyId,
        stage,
        filteredOut: extra.filteredOut ?? false,
        fullName: `${key} Applicant ${RUN}`,
        email: `${key.toLowerCase()}.${RUN}@mail.test`,
        mobile: '+20 100 123 4567',
        consentAt: new Date(),
        matchPercent: 90 - n,
        points: 8,
        maxPoints: 10,
        ...(extra.suggestion && { suggestion: extra.suggestion, suggestedById: users.hm, suggestedAt: new Date() }),
        ...(extra.screeningCall && { screeningCall: extra.screeningCall, screeningCallById: users.hr, screeningCallAt: new Date() }),
        steps: { create: steps.map((s, i) => ({ ...s, at: new Date(Date.now() - (steps.length - i) * 86_400_000) })) },
      },
      select: { id: true },
    });
    apps[key] = a.id;
    return a.id;
  }

  /** A vacancy drafted by `as` (HR, or a Super Admin for a C-level one); opened by the CEO unless `draft`. */
  async function vacancy(as: string, jobTitleId: string, extra: object = {}, draft = false): Promise<string> {
    const gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    const made = (await post(as, '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, ...(as === 'hr' && { gradeId, salaryMin: 15000, salaryMax: 25000 }), ...extra }).expect(201))
      .body as VacancyView;
    vacancyIds.push(made.id);
    if (draft) return made.id;
    await post(as, `/recruitment/vacancies/${made.id}/submit`).expect(200);
    await post('ceo', `/recruitment/vacancies/${made.id}/approve`).expect(200);
    return made.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    departmentId = (await prisma.department.create({ data: { nameEn: `Post Production ${RUN}` }, select: { id: true } })).id;
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    const title = async (titleEn: string, minGradeId?: string) => {
      const id = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `${titleEn} ${RUN}`, jdPurpose: '<p>Work on the studio’s films.</p>', ...(minGradeId && { minGradeId }) }, select: { id: true } })).id;
      jobTitleIds.push(id);
      return id;
    };
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await person('hm', ['employee', 'manager'], 'Hana Hiring');
    await person('iv1', ['employee'], 'Ivan Interviewer');
    vac.hana = await vacancy('hr', await title('Video Editor'), { hiringManagerId: people.hm });
    vac.none = await vacancy('hr', await title('Colourist'));
    vac.list = await vacancy('hr', await title('Sound Designer'), { hiringManagerId: people.hm });
    vac.chief = await vacancy('superAdmin', await title('Chief Editor', g9), {}, true);
    await applicant('Sara', vac.hana, 'shortlisted');
    await applicant('Adam', vac.hana, 'applied');
    await applicant('Fady', vac.hana, 'applied', { filteredOut: true });
    await applicant('Omar', vac.hana, 'shortlisted');
    await applicant('Lina', vac.hana, 'shortlisted');
    await applicant('Ivy', vac.hana, 'interview');
    await applicant('Nina', vac.none, 'shortlisted');
    await applicant('Bea', vac.none, 'applied');
    await applicant('Clara', vac.chief, 'shortlisted');
    // the list's: one at each hiring step, and two at other stages
    await applicant('ToReview', vac.list, 'shortlisted');
    await applicant('TurnedDown', vac.list, 'shortlisted', { suggestion: 'reject' });
    await applicant('CallDue', vac.list, 'shortlisted', { suggestion: 'next' });
    await applicant('CallFailed', vac.list, 'shortlisted', { suggestion: 'next', screeningCall: 'failed' });
    await applicant('Ready', vac.list, 'shortlisted', { suggestion: 'next', screeningCall: 'passed' });
    await applicant('JustApplied', vac.list, 'applied');
    await applicant('Interviewing', vac.list, 'interview', { screeningCall: 'passed' });
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: jobTitleIds } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('the screening call', () => {
    it('is refused at Applied, filtered out, and until the hiring manager accepts them; its form checked', async () => {
      expect(said(await call('hr', 'Adam', { result: 'passed' }).expect(409))).toEqual(['Shortlist them first: the screening call comes once the hiring manager accepts them.']);
      expect(said(await call('hr', 'Fady', { result: 'passed' }).expect(409))).toEqual(['They failed a must-have question and were filtered out: restore them first.']);
      expect(said(await call('hr', 'Sara', { result: 'passed' }).expect(409))).toEqual([WAITING]);
      await turnDown('Sara');
      expect(said(await call('hr', 'Sara', { result: 'passed' }).expect(409))).toEqual([REJECTED]);
      expect(said(await call('hr', 'Sara', { result: 'maybe' }).expect(400))).toEqual(['Choose whether they passed or failed the screening call.']);
      expect(said(await call('hr', 'Sara', { result: 'passed', note: 'x'.repeat(1001) }).expect(400))).toEqual(['Keep the comment to 1000 characters or fewer.']);
      // at another stage
      expect(said(await call('hr', 'Ivy', { result: 'passed' }).expect(409))).toEqual(['They are at Interview: the screening call is made at Shortlisted.']);
      // nothing was kept
      expect((await view('hr', 'Sara')).screeningCall).toBeNull();
    });

    it('is HR’s (or a Super Admin’s): never the hiring manager’s nor the CEO’s', async () => {
      await accept('Sara');
      await call('hm', 'Sara', { result: 'passed' }).expect(403);
      await call('ceo', 'Sara', { result: 'passed' }).expect(403);
      await call('iv1', 'Sara', { result: 'passed' }).expect(403);
      expect((await view('hr', 'Sara')).screeningCall).toBeNull();
    });

    it('is recorded passed, then failed, then passed again, with who and when; its comment kept from the hiring manager', async () => {
      let a = (await call('hr', 'Sara', { result: 'passed', note: '  Clear and keen  ' }).expect(200)).body as ApplicationView;
      expect(a.screeningCall).toEqual({ result: 'passed', note: 'Clear and keen', by: { email: emails.hr, name: expect.any(String) }, at: expect.any(String) });
      expect(a).toMatchObject({ stage: 'shortlisted', hasHiringManager: true, interviewBlocked: null, hiringStep: 'ready', can: { interview: true, scheduleInterview: true } });
      // the hiring manager's acceptance stays: the interview needs it
      expect(a.suggestion).toMatchObject({ kind: 'next' });

      a = (await call('hr', 'Sara', { result: 'failed', note: '' }).expect(200)).body as ApplicationView;
      expect(a.screeningCall).toMatchObject({ result: 'failed', note: null, by: { email: emails.hr } });
      expect(a).toMatchObject({ interviewBlocked: FAILED, hiringStep: 'call_failed', can: { interview: false } });

      a = (await call('superAdmin', 'Sara', { result: 'passed', note: 'Called again: expects 30,000' }).expect(200)).body as ApplicationView;
      expect(a.screeningCall).toMatchObject({ result: 'passed', note: 'Called again: expects 30,000', by: { email: emails.superAdmin } });
      expect(a.interviewBlocked).toBeNull();

      // the CEO reads it all, but schedules nothing; the hiring manager sees the result, never HR's comment
      expect(await view('ceo', 'Sara')).toMatchObject({ screeningCall: { result: 'passed', note: 'Called again: expects 30,000' }, interviewBlocked: null });
      const hana = await view('hm', 'Sara');
      expect(hana).toMatchObject({ viewer: 'hiring_manager', screeningCall: { result: 'passed', note: null }, interviewBlocked: null, hasHiringManager: true });
      expect(JSON.stringify(hana)).not.toContain('30,000');

      // the audit log: each call with its result, never the comment's words
      const rows = await prisma.auditLog.findMany({ where: { entityType: 'job_application', entityId: apps.Sara, action: 'screening_call' }, orderBy: { at: 'asc' }, select: { diff: true } });
      expect(rows.map((r) => r.diff)).toEqual([
        { number: expect.any(String), vacancy: expect.any(String), result: 'Passed', note: '(comment)' },
        { number: expect.any(String), vacancy: expect.any(String), result: { from: 'Passed', to: 'Failed' } },
        { number: expect.any(String), vacancy: expect.any(String), result: { from: 'Failed', to: 'Passed' }, note: '(comment)' },
      ]);
      expect(JSON.stringify(rows)).not.toContain('Clear and keen');
    });

    it('of a C-level vacancy’s applicant is the Super Admin’s: HR never finds them', async () => {
      await call('hr', 'Clara', { result: 'passed' }).expect(404);
      const a = (await call('superAdmin', 'Clara', { result: 'passed' }).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ hasHiringManager: false, screeningCall: { result: 'passed' }, interviewBlocked: null, hiringStep: 'ready' });
    });
  });

  describe('the interview’s gate', () => {
    it('refuses scheduling with each reason in turn, saving nothing, and allows it after a passed call', async () => {
      expect(said(await schedule('Adam').expect(409))).toEqual(['Shortlist them first: the hiring manager accepts them, then HR’s screening call.']);
      expect(said(await schedule('Omar').expect(409))).toEqual([WAITING]);
      expect((await view('hr', 'Omar')).interviewBlocked).toBe(WAITING);
      await turnDown('Omar');
      expect(said(await schedule('Omar').expect(409))).toEqual([REJECTED]);
      expect((await view('hr', 'Omar')).interviewBlocked).toBe(REJECTED);
      await accept('Omar');
      expect(said(await schedule('Omar').expect(409))).toEqual([NO_CALL]);
      expect((await view('hr', 'Omar')).interviewBlocked).toBe(NO_CALL);
      await call('hr', 'Omar', { result: 'failed' }).expect(200);
      expect(said(await schedule('Omar').expect(409))).toEqual([FAILED]);
      expect(await interviews('Omar')).toBe(0);
      expect((await view('hr', 'Omar')).stage).toBe('shortlisted');

      await call('hr', 'Omar', { result: 'passed' }).expect(200);
      const saved = (await schedule('Omar').expect(201)).body as InterviewSaved;
      expect(saved.interview.status).toBe('scheduled');
      // HR acted on the hiring manager's acceptance: done with, as any move of HR's
      const a = await view('hr', 'Omar');
      expect(a).toMatchObject({ stage: 'interview', suggestion: null, interviewBlocked: null, hiringStep: null, screeningCall: { result: 'passed' } });
      expect(await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.Omar }, select: { suggestion: true, suggestionNote: true, suggestedById: true, suggestedAt: true } })).toEqual({
        suggestion: null,
        suggestionNote: null,
        suggestedById: null,
        suggestedAt: null,
      });
      expect(a.history.at(-1)).toMatchObject({ event: 'interview', stage: 'interview' });
    });

    it('refuses moving to Interview by hand likewise', async () => {
      const move = () => post('hr', `/recruitment/applications/${apps.Lina}/stage`, { to: 'interview' });
      expect((await view('hr', 'Lina')).can.interview).toBe(false);
      expect(said(await move().expect(409))).toEqual([WAITING]);
      await turnDown('Lina');
      expect(said(await move().expect(409))).toEqual([REJECTED]);
      await accept('Lina');
      expect(said(await move().expect(409))).toEqual([NO_CALL]);
      await call('hr', 'Lina', { result: 'failed' }).expect(200);
      expect(said(await move().expect(409))).toEqual([FAILED]);
      expect((await view('hr', 'Lina')).stage).toBe('shortlisted');
      await call('hr', 'Lina', { result: 'passed' }).expect(200);
      expect((await view('hr', 'Lina')).can.interview).toBe(true);
      const a = (await move().expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ stage: 'interview', suggestion: null });
    });

    it('asks only the passed call on a vacancy without a hiring manager', async () => {
      expect(said(await schedule('Bea').expect(409))).toEqual(['Shortlist them first, then make the screening call.']);
      let a = await view('hr', 'Nina');
      expect(a).toMatchObject({ hasHiringManager: false, interviewBlocked: NO_CALL, hiringStep: 'call_due' });
      expect(said(await schedule('Nina').expect(409))).toEqual([NO_CALL]);
      a = (await call('hr', 'Nina', { result: 'passed' }).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ interviewBlocked: null, hiringStep: 'ready' });
      await schedule('Nina').expect(201);
      expect((await view('hr', 'Nina')).stage).toBe('interview');
    });

    it('asks nothing of a later round', async () => {
      // Ivy is at Interview without a review or a call (before the hiring steps); Omar had his first interview
      expect((await view('hr', 'Ivy')).interviewBlocked).toBeNull();
      await schedule('Ivy').expect(201);
      await post('hr', `/recruitment/applications/${apps.Omar}/interviews`, interviewBody({ date: addDays(TODAY, 9) })).expect(201);
      expect(await interviews('Omar')).toBe(2);
    });
  });

  describe('where each shortlisted applicant stands', () => {
    const expected: Record<string, HiringStep | null> = {
      ToReview: 'to_review',
      TurnedDown: 'manager_rejected',
      CallDue: 'call_due',
      CallFailed: 'call_failed',
      Ready: 'ready',
      JustApplied: null,
      Interviewing: null,
    };
    const byKey = (rows: { id: string; hiringStep?: HiringStep | null }[]) => Object.fromEntries(Object.keys(expected).map((k) => [k, rows.find((r) => r.id === apps[k])?.hiringStep]));

    it('shows on the list and the board', async () => {
      const list = (await get('hr', `/recruitment/applications?vacancyId=${vac.list}`).expect(200)).body as ApplicationListItem[];
      expect(byKey(list)).toEqual(expected);
      const board = (await get('hr', `/recruitment/vacancies/${vac.list}/board`).expect(200)).body as VacancyBoard;
      expect(byKey(board.columns.flatMap((c) => c.cards))).toEqual(expected);
      // the hiring manager's board, from Shortlisted on
      const hana = (await get('hm', `/recruitment/vacancies/${vac.list}/board`).expect(200)).body as VacancyBoard;
      expect(byKey(hana.columns.flatMap((c) => c.cards))).toEqual({ ...expected, JustApplied: undefined });
      // the applicant's page too, with why they can't be interviewed yet
      expect(await view('hr', 'ToReview')).toMatchObject({ hiringStep: 'to_review', interviewBlocked: WAITING });
      expect(await view('hr', 'CallDue')).toMatchObject({ hiringStep: 'call_due', interviewBlocked: NO_CALL });
    });

    it('filters the list by ?step=, each step exactly', async () => {
      for (const [key, step] of Object.entries(expected)) {
        if (!step) continue;
        const rows = (await get('hr', `/recruitment/applications?vacancyId=${vac.list}&step=${step}`).expect(200)).body as ApplicationListItem[];
        expect(rows.map((r) => r.id), step).toEqual([apps[key]]);
      }
      // across the vacancies: the Colourist's without a hiring manager counts as accepted
      await applicant('Bo', vac.none, 'shortlisted');
      const due = (await get('hr', '/recruitment/applications?step=call_due').expect(200)).body as ApplicationListItem[];
      expect(due.map((r) => r.id).filter((id) => Object.values(apps).includes(id)).sort()).toEqual([apps.CallDue, apps.Bo].sort());
      const ready = (await get('hr', '/recruitment/applications?step=ready').expect(200)).body as ApplicationListItem[];
      // Sara (passed, accepted) and Ready; Clara's C-level vacancy is never HR's
      expect(ready.map((r) => r.id).filter((id) => Object.values(apps).includes(id)).sort()).toEqual([apps.Sara, apps.Ready].sort());
      expect(said(await get('hr', '/recruitment/applications?step=maybe').expect(400))).toEqual(['Choose a hiring step.']);
    });
  });
});
