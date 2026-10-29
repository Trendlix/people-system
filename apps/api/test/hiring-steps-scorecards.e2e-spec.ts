import type { INestApplication } from '@nestjs/common';
import type { ApplicationView, FeedbackView, InterviewSaved, InterviewView, MyHiring, Role, VacancyView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { RecruitmentSchedulerService } from '../src/recruitment/recruitment-scheduler.service.js';
import { NO_PROFILE_FOR_SCORECARD, NOT_A_SCORER } from '../src/recruitment/scorecard-givers.js';
import { createApp, createUser, signIn } from './helpers.js';

// The hiring steps' scorecards (owner, 29 October 2026: "then there should be interview comment and status for HR and
// hiring manager"; asked, "Score Card for each of them"; packages/shared hiring-steps.ts, step 5). A Motion Designer
// vacancy with Hana as its hiring manager: after an interview, Hana and HR (Hadi, with his own employee profile) each
// give a scorecard as its interviewers do, even when not among them, each said to be whose it is; HR without an employee
// profile is told why it can't; nobody else gives one, and nobody before it starts. An interviewer still sees the
// others' only once they gave theirs. Hana finds her vacancy's interviews on My Hiring, a scorecard due counted, and is
// reminded the day after (HR is not). A C-level vacancy's stays with the CEO and a Super Admin: the CEO scores it as HR.
// Email is kept in MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `hs${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const CARD = { ratings: { skills: 4, experience: 3, communication: 5, culture: 4 }, recommendation: 'yes', notes: 'Clear storyboards' };

type InterviewAnswer = InterviewView & { myFeedbackGiven?: boolean };

describe('Scorecards from HR and the hiring manager (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const people: Record<string, string> = {};
  const employeeIds: string[] = [];
  const vacancyIds: string[] = [];
  const apps: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let cLevelTitleId: string;
  let v: VacancyView;
  let chief: VacancyView;
  let mona: InterviewView;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object = {}) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: users[key], kind }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });
  const applicant = async (as: string, key: string) => (await get(as, `/recruitment/applications/${apps[key]}`).expect(200)).body as ApplicationView;
  const myHiring = async (as: string) => (await get(as, '/recruitment/my-hiring').expect(200)).body as MyHiring;
  const scorecard = (as: string, interviewId: string, body: object = CARD) => put(as, `/recruitment/interviews/${interviewId}/feedback`, body);
  /** Puts an interview back in time, as if it had taken place. */
  const tookPlace = (id: string, hoursAgo: number) => prisma.interview.update({ where: { id }, data: { startsAt: new Date(Date.now() - hoursAgo * 3_600_000) } });
  const roles = (feedback: FeedbackView[]) => Object.fromEntries(feedback.map((f) => [f.interviewer.employeeId, f.role]));

  /** A user with an employee profile (their work email their sign-in) and a current employment. */
  async function person(key: string, roleKeys: Role[], name: string) {
    const email = await createUser(prisma, roleKeys);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: email,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId } },
      },
      select: { id: true },
    });
    people[key] = e.id;
    employeeIds.push(e.id);
  }

  /** A user without an employee profile. */
  async function account(key: string, roleKeys: Role[]) {
    const email = await createUser(prisma, roleKeys);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  async function vacancy(as: string, body: object): Promise<VacancyView> {
    const made = (await post(as, '/recruitment/vacancies', { employmentType: 'full_time', headcount: 1, ...body }).expect(201)).body as VacancyView;
    vacancyIds.push(made.id);
    await post(as, `/recruitment/vacancies/${made.id}/submit`).expect(200);
    return (await post('ceo', `/recruitment/vacancies/${made.id}/approve`).expect(200)).body as VacancyView;
  }

  /** An applicant at Applied, as the careers page makes one. */
  async function applied(key: string, vacancyId: string) {
    const n = Object.keys(apps).length + 1;
    const a = await prisma.jobApplication.create({
      data: {
        // a year the careers page never numbers, so the numbering of real applications never meets it
        number: `APP-1999-${String(Date.now()).slice(-7)}${n}`,
        vacancyId,
        stage: 'applied',
        fullName: `${key} Applicant ${RUN}`,
        email: `${key.toLowerCase()}.${RUN}@mail.test`,
        mobile: '+20 100 123 4567',
        consentAt: new Date(),
        steps: { create: [{ event: 'applied', stage: 'applied', at: new Date(Date.now() - 86_400_000) }] },
      },
      select: { id: true },
    });
    apps[key] = a.id;
  }

  /**
   * Takes an applicant at Applied to an interview a week from now, the way that works with the hiring steps' gate and
   * without it: HR shortlists them, the hiring manager (if any) accepts them, HR's screening call passes, then HR
   * schedules it.
   */
  async function interviewFor(as: string, key: string, hm: string | null, interviewerIds: string[]): Promise<InterviewView> {
    await post(as, `/recruitment/applications/${apps[key]}/stage`, { to: 'shortlisted' }).expect(200);
    if (hm) await post(hm, `/recruitment/applications/${apps[key]}/suggest`, { suggestion: 'next' }).expect(200);
    // HR's screening call comes with the hiring steps' gate on scheduling (built beside this): where that endpoint isn't
    // there yet, it answers 404 and nothing gates the interview, so either way the interview below is scheduled
    const call = await post(as, `/recruitment/applications/${apps[key]}/screening-call`, { result: 'passed' });
    if (call.status !== 404) expect(call.status).toBeLessThan(300);
    const body = { date: addDays(TODAY, 7), time: '10:30', minutes: 45, kind: 'phone', interviewerIds, note: 'Bring your reel.' };
    return ((await post(as, `/recruitment/applications/${apps[key]}/interviews`, body).expect(201)).body as InterviewSaved).interview;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    departmentId = (await prisma.department.create({ data: { nameEn: `Motion ${RUN}` }, select: { id: true } })).id;
    const g9Id = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Motion Designer ${RUN}`, jdPurpose: '<p>Animate the studio’s work.</p>' }, select: { id: true } })).id;
    cLevelTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Chief Creative ${RUN}`, jdPurpose: '<p>Lead the studio.</p>', minGradeId: g9Id }, select: { id: true } })).id;
    await person('hr', ['hr'], 'Hadi HR');
    await account('hrNoProfile', ['hr']);
    await person('ceo', ['ceo'], 'Celine CEO');
    await account('superAdmin', ['super_admin']);
    await person('hm', ['employee', 'manager'], 'Hana Hiring');
    await person('iv1', ['employee'], 'Ivan Interviewer');
    await person('iv2', ['employee'], 'Iris Interviewer');
    await person('outsider', ['employee'], 'Omar Outsider');
    v = await vacancy('hr', { jobTitleId, hiringManagerId: people.hm });
    // a C-level one (its job title's range starts at G9): the CEO's and a Super Admin's, without a hiring manager
    chief = await vacancy('superAdmin', { jobTitleId: cLevelTitleId });
    await applied('Mona', v.id);
    await applied('Karim', v.id);
    await applied('Leila', chief.id);
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: [jobTitleId, cLevelTitleId] } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  it('are given by nobody before the interview starts; HR without an employee profile is told why it can’t', async () => {
    mona = await interviewFor('hr', 'Mona', 'hm', [people.iv1, people.iv2]);
    expect(mona.can.feedback).toBe(false);
    expect(said(await scorecard('hm', mona.id).expect(409))).toEqual(['Give your scorecard once the interview has started.']);
    expect(said(await scorecard('hr', mona.id).expect(409))).toEqual(['Give your scorecard once the interview has started.']);
    expect(said(await scorecard('hrNoProfile', mona.id).expect(409))).toEqual([NO_PROFILE_FOR_SCORECARD]);
    // it took place yesterday
    await tookPlace(mona.id, 26);
  });

  it('may be given by HR and the hiring manager as by the interviewers, once it took place', async () => {
    const can = async (as: string) => ((await applicant(as, 'Mona')).interviews.find((i) => i.id === mona.id) as InterviewAnswer).can.feedback;
    expect(await can('hr')).toBe(true);
    expect(await can('hm')).toBe(true);
    expect(await can('iv1')).toBe(true);
    // without an employee profile, or the CEO on a vacancy that isn't C-level: no
    expect(await can('hrNoProfile')).toBe(false);
    expect(await can('ceo')).toBe(false);
    const hr = (await applicant('hr', 'Mona')).interviews[0] as InterviewAnswer;
    expect(hr.myFeedbackGiven).toBe(false);
  });

  it('show on the hiring manager’s My Hiring, though she isn’t on the panel, her scorecard due', async () => {
    const hm = await myHiring('hm');
    const listed = hm.interviews.find((i) => i.id === mona.id) as InterviewAnswer | undefined;
    expect(listed).toMatchObject({ can: { feedback: true }, myFeedbackGiven: false });
    expect(listed!.interviewers.map((i) => i.employeeId)).not.toContain(people.hm);
    expect(hm.feedbackDue).toBe(1);
    expect((await myHiring('iv1')).interviews.map((i) => i.id)).toContain(mona.id);
    // HR's own My Hiring lists only theirs, never every interview
    expect((await myHiring('hr')).interviews.map((i) => i.id)).not.toContain(mona.id);
    expect((await myHiring('outsider')).interviews).toEqual([]);
    expect((await get('hm', '/auth/me').expect(200)).body.hiring).toBe(true);
  });

  it('are taken from an interviewer, the hiring manager and HR, each said to be whose it is', async () => {
    await scorecard('iv1', mona.id).expect(200);
    const hmSaved = (await scorecard('hm', mona.id, { ...CARD, recommendation: 'strong_yes', notes: null }).expect(200)).body as InterviewAnswer;
    expect(hmSaved).toMatchObject({ can: { feedback: true }, myFeedbackGiven: true });
    await scorecard('hr', mona.id, { ...CARD, notes: 'Good portfolio call' }).expect(200);
    const a = await applicant('hr', 'Mona');
    expect(a.feedback).toHaveLength(3);
    expect(roles(a.feedback)).toEqual({ [people.iv1]: 'interviewer', [people.hm]: 'hiring_manager', [people.hr]: 'hr' });
    expect(a.feedback.find((f) => f.mine)).toMatchObject({ interviewer: { employeeId: people.hr }, role: 'hr', notes: 'Good portfolio call' });
    // the hiring manager sees them all, hers marked
    const hm = await applicant('hm', 'Mona');
    expect(hm.feedback).toHaveLength(3);
    expect(hm.feedback.find((f) => f.mine)).toMatchObject({ role: 'hiring_manager', recommendation: 'strong_yes' });
    expect((hm.interviews[0] as InterviewAnswer).myFeedbackGiven).toBe(true);
    // her scorecard is no longer due
    expect((await myHiring('hm')).feedbackDue).toBe(0);
  });

  it('are refused to anyone else, in words', async () => {
    expect(said(await scorecard('hrNoProfile', mona.id).expect(409))).toEqual([NO_PROFILE_FOR_SCORECARD]);
    expect(said(await scorecard('ceo', mona.id).expect(403))).toEqual([NOT_A_SCORER]);
    await scorecard('outsider', mona.id).expect(404);
  });

  it('stay hidden from an interviewer until they give theirs, then show with whose each is', async () => {
    let a = await applicant('iv2', 'Mona');
    expect(a.feedback).toEqual([]);
    expect(a.feedbackHidden).toBe(3);
    await scorecard('iv2', mona.id, { ...CARD, recommendation: 'no' }).expect(200);
    a = await applicant('iv2', 'Mona');
    expect(a.feedbackHidden).toBe(0);
    expect(roles(a.feedback)).toEqual({ [people.iv1]: 'interviewer', [people.iv2]: 'interviewer', [people.hm]: 'hiring_manager', [people.hr]: 'hr' });
    expect((await applicant('hr', 'Mona')).feedback).toHaveLength(4);
  });

  it('are changed by their author, one each, the change audited with whose it is', async () => {
    await scorecard('hm', mona.id, { ...CARD, recommendation: 'yes' }).expect(200);
    expect(await prisma.interviewFeedback.count({ where: { interviewId: mona.id, employeeId: people.hm } })).toBe(1);
    expect((await applicant('hr', 'Mona')).feedback.find((f) => f.interviewer.employeeId === people.hm)).toMatchObject({ role: 'hiring_manager', recommendation: 'yes' });
    const audited = await prisma.auditLog.findMany({ where: { entityType: 'interview', entityId: mona.id, action: { in: ['feedback', 'feedback_change'] } }, select: { action: true, diff: true } });
    expect(audited.map((x) => [x.action, (x.diff as { givenAs?: string }).givenAs])).toEqual(
      expect.arrayContaining([
        ['feedback', 'interviewer'],
        ['feedback', 'hiring_manager'],
        ['feedback', 'hr'],
        ['feedback_change', 'hiring_manager'],
      ]),
    );
    // never the notes
    expect(JSON.stringify(audited)).not.toContain('Good portfolio call');
  });

  it('are asked of the hiring manager the day after, once, as of the interviewers; never of HR', async () => {
    const karim = await interviewFor('hr', 'Karim', 'hm', [people.iv1]);
    await tookPlace(karim.id, 30);
    const round = app.get(RecruitmentSchedulerService);
    expect(await round.runOnce()).toBeGreaterThanOrEqual(2);
    await round.runOnce();
    const toKarim = (key: string) => notices(key, 'interview_feedback').then((all) => all.filter((n) => n.link === `/recruitment/applicants/${apps.Karim}`));
    expect(await toKarim('hm')).toEqual([{ title: 'Your interview scorecard', body: expect.stringContaining(`Karim Applicant ${RUN}: interviewed`), link: `/recruitment/applicants/${apps.Karim}` }]);
    expect(await toKarim('iv1')).toHaveLength(1);
    // Mona's: hers was given; HR is never reminded
    expect((await notices('hm', 'interview_feedback')).filter((n) => n.link === `/recruitment/applicants/${apps.Mona}`)).toEqual([]);
    expect(await notices('hr', 'interview_feedback')).toEqual([]);
    // given now: no longer due on her My Hiring
    expect((await myHiring('hm')).feedbackDue).toBe(1);
    await scorecard('hm', karim.id).expect(200);
    expect((await myHiring('hm')).feedbackDue).toBe(0);
  });

  it('on a C-level vacancy are the CEO’s as HR’s, never HR’s', async () => {
    const leila = await interviewFor('superAdmin', 'Leila', null, [people.iv1]);
    await tookPlace(leila.id, 26);
    await get('hr', `/recruitment/applications/${apps.Leila}`).expect(404);
    await scorecard('hr', leila.id).expect(404);
    expect(((await applicant('ceo', 'Leila')).interviews[0] as InterviewAnswer).can.feedback).toBe(true);
    await scorecard('ceo', leila.id).expect(200);
    expect((await applicant('ceo', 'Leila')).feedback.find((f) => f.mine)).toMatchObject({ role: 'hr', interviewer: { employeeId: people.ceo } });
    // a Super Admin without an employee profile is told why not
    expect(said(await scorecard('superAdmin', leila.id).expect(409))).toEqual([NO_PROFILE_FOR_SCORECARD]);
  });

  it('keep My Hiring for the hiring manager once her vacancy closes, its interviews still hers to score', async () => {
    await post('hr', `/recruitment/vacancies/${v.id}/close`, { reason: 'Filled' }).expect(200);
    const hm = await myHiring('hm');
    expect(hm.vacancies).toEqual([]);
    expect(hm.interviews.map((i) => i.id)).toContain(mona.id);
    expect((await get('hm', '/auth/me').expect(200)).body.hiring).toBe(true);
  });
});
