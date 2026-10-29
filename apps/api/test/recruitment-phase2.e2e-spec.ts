import type { INestApplication } from '@nestjs/common';
import type { ApplicationView, InterviewSaved, InterviewView, MyHiring, OnboardingSummary, OnboardingView, RecruitmentAnalytics, Role, VacancyBoard, VacancyView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { RecruitmentSchedulerService } from '../src/recruitment/recruitment-scheduler.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Recruitment, Phase 2 (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by email through
// the owner's SMTP settings"). A Video Editor vacancy with Hana as its hiring manager: the pipeline board (HR's in full,
// Hana's from Shortlisted on); interviews scheduled, moved and cancelled, the candidate emailed each time with the
// calendar invitation (its UID kept, its SEQUENCE raised), the interviewers told; the scorecards (an interviewer sees the
// others' only once they gave theirs) and their reminder the day after; Hana's suggestion for HR; the rejection email
// with the standard words and HR's own; onboarding opened on a hire through an accepted offer, its items, and a C-level
// one hidden from HR; the analytics and their Excel; My Hiring; the audit log. Email is kept in MailService's outbox
// (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `rp${Date.now().toString(36)}`;
const TODAY = todayInCairo();

describe('Recruitment, Phase 2 (e2e)', () => {
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
  let cLevelTitleId: string;
  let gradeId: string;
  let g9Id: string;
  let shiftId: string;
  let v: VacancyView;
  const vacancyIds: string[] = [];
  const employeeIds: string[] = [];
  const apps: Record<string, string> = {};

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object = {}) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object = {}) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: users[key], kind }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });
  /** The calendar invitation of a message in the outbox, its lines unfolded (the JSON transport keeps an attachment as base64). */
  const icsOf = (m: { attachments?: { content: Buffer | string; encoding?: string }[] }) => {
    const a = m.attachments?.[0];
    if (!a) return '';
    const bytes = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, (a.encoding as BufferEncoding) ?? 'base64');
    return bytes.toString('utf8').replace(/\r\n /g, '');
  };

  /** A user with an employee profile (their work email their sign-in) and a current employment. */
  async function person(key: string, roles: Role[], name: string, grade?: string) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: email,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId, ...(grade && { gradeId: grade }) } },
      },
      select: { id: true },
    });
    people[key] = e.id;
    employeeIds.push(e.id);
  }

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** An applicant as the careers page makes one, at a stage (its history to it). */
  async function applicant(key: string, stage: 'applied' | 'shortlisted' | 'interview', extra: { filteredOut?: boolean; expectedSalary?: number } = {}) {
    const n = Object.keys(apps).length + 1;
    const steps = [{ event: 'applied', stage: 'applied' }];
    if (stage !== 'applied') steps.push({ event: 'shortlisted', stage: 'shortlisted' });
    if (stage === 'interview') steps.push({ event: 'interview', stage: 'interview' });
    const a = await prisma.jobApplication.create({
      data: {
        // a year the careers page never numbers, so the numbering of real applications never meets it
        number: `APP-1999-${String(Date.now()).slice(-7)}${n}`,
        vacancyId: v.id,
        stage,
        filteredOut: extra.filteredOut ?? false,
        fullName: `${key} Applicant ${RUN}`,
        email: `${key.toLowerCase()}.${RUN}@mail.test`,
        mobile: '+20 100 123 4567',
        consentAt: new Date(),
        matchPercent: 80 - n,
        points: 8,
        maxPoints: 10,
        expectedSalary: extra.expectedSalary ?? 18000,
        notes: 'HR only',
        cv: { create: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 10, data: Buffer.from('%PDF-1.4\n%%EOF\n') } },
        steps: { create: steps.map((s, i) => ({ ...s, at: new Date(Date.now() - (steps.length - i) * 86_400_000) })) },
      },
      select: { id: true },
    });
    apps[key] = a.id;
    return a.id;
  }

  const interviewBody = (extra: object = {}) => ({ date: addDays(TODAY, 7), time: '10:30', minutes: 45, kind: 'in_person', interviewerIds: [people.iv1, people.iv2], note: 'Bring your reel.', ...extra });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    departmentId = (await prisma.department.create({ data: { nameEn: `Post Production ${RUN}` }, select: { id: true } })).id;
    gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    g9Id = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Video Editor ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    cLevelTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Chief Editor ${RUN}`, minGradeId: g9Id }, select: { id: true } })).id;
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await person('hm', ['employee', 'manager'], 'Hana Hiring');
    await person('iv1', ['employee'], 'Ivan Interviewer');
    await person('iv2', ['employee'], 'Iris Interviewer');
    await person('outsider', ['employee'], 'Omar Outsider');
    const made = await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 2, hiringManagerId: people.hm, gradeId, shiftId, salaryMin: 15000, salaryMax: 25000 }).expect(201);
    vacancyIds.push(made.body.id);
    await post('hr', `/recruitment/vacancies/${made.body.id}/submit`).expect(200);
    v = (await post('ceo', `/recruitment/vacancies/${made.body.id}/approve`).expect(200)).body as VacancyView;
    await applicant('Sara', 'shortlisted');
    await applicant('Adam', 'applied');
    await applicant('Fady', 'applied', { filteredOut: true });
    await applicant('Nour', 'interview');
  });

  afterAll(async () => {
    const all = await prisma.jobApplication.findMany({ where: { vacancyId: { in: vacancyIds } }, select: { id: true, employeeId: true } });
    const offers = await prisma.jobOffer.findMany({ where: { applicationId: { in: all.map((a) => a.id) } }, select: { id: true, employeeId: true } });
    const hired = [...all.map((a) => a.employeeId), ...offers.map((o) => o.employeeId)].filter((id): id is string => !!id);
    await prisma.jobOffer.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
    await prisma.onboardingChecklist.deleteMany({ where: { employment: { employeeId: { in: [...hired, ...employeeIds] } } } });
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
    await prisma.recruitmentSettings.deleteMany({});
    await app.close();
  });

  describe('the pipeline board', () => {
    it('shows HR every applicant by stage, those filtered out counted apart, with the days at their stage', async () => {
      const b = (await get('hr', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(b).toMatchObject({ viewer: 'manages', canMove: true, filteredOut: 1, vacancy: { id: v.id } });
      expect(b.columns.map((c) => c.stage)).toEqual(['applied', 'shortlisted', 'interview', 'offer', 'hired', 'rejected']);
      expect(b.columns.find((c) => c.stage === 'applied')!.cards.map((c) => c.id)).toEqual([apps.Adam]);
      const sara = b.columns.find((c) => c.stage === 'shortlisted')!.cards[0];
      expect(sara).toMatchObject({ id: apps.Sara, fullName: `Sara Applicant ${RUN}`, source: 'careers', daysInStage: 1, openOffer: false, upcomingInterviews: 0, suggestion: null });
      expect((await get('ceo', `/recruitment/vacancies/${v.id}/board`).expect(200)).body).toMatchObject({ viewer: 'reads', canMove: false });
    });

    it('shows the hiring manager their vacancy from Shortlisted on, read only; nobody else', async () => {
      const b = (await get('hm', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(b).toMatchObject({ viewer: 'hiring_manager', canMove: false, filteredOut: 0 });
      expect(b.columns.map((c) => c.stage)).toEqual(['shortlisted', 'interview', 'offer', 'hired', 'rejected']);
      expect(b.columns.flatMap((c) => c.cards.map((x) => x.id)).sort()).toEqual([apps.Nour, apps.Sara].sort());
      await get('outsider', `/recruitment/vacancies/${v.id}/board`).expect(404);
      await get('iv1', `/recruitment/vacancies/${v.id}/board`).expect(404);
    });
  });

  describe('the hiring manager', () => {
    it('opens the vacancy without its salary range, and its applicants from Shortlisted on without the expected salary or HR’s notes', async () => {
      const mine = (await get('hm', `/recruitment/vacancies/${v.id}`).expect(200)).body as VacancyView;
      expect(mine).toMatchObject({ viewer: 'hiring_manager', salaryMin: null, salaryMax: null, can: { edit: false, approve: false, close: false } });
      expect((await get('hr', `/recruitment/vacancies/${v.id}`).expect(200)).body).toMatchObject({ viewer: 'manages', salaryMin: 15000 });
      const a = (await get('hm', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ viewer: 'hiring_manager', expectedSalary: null, notes: null, can: { suggest: true, scheduleInterview: false, reject: false, makeOffer: false } });
      expect(JSON.stringify(a)).not.toContain('18000');
      await get('hm', `/recruitment/applications/${apps.Sara}/cv`).expect(200);
      // not one still at Applied, nor one filtered out
      await get('hm', `/recruitment/applications/${apps.Adam}`).expect(404);
      await get('hm', `/recruitment/applications/${apps.Fady}`).expect(404);
      await get('hm', `/recruitment/applications/${apps.Adam}/cv`).expect(404);
      // HR sees it all
      expect((await get('hr', `/recruitment/applications/${apps.Sara}`).expect(200)).body).toMatchObject({ viewer: 'manages', expectedSalary: 18000, notes: 'HR only' });
      // nobody else
      await get('outsider', `/recruitment/applications/${apps.Sara}`).expect(404);
      await get('outsider', `/recruitment/vacancies/${v.id}`).expect(404);
      await get('outsider', '/recruitment/applications').expect(403);
    });

    it('suggests the next step or a rejection, which HR is told of and which clears once HR acts', async () => {
      await post('iv1', `/recruitment/applications/${apps.Sara}/suggest`, { suggestion: 'next' }).expect(404);
      await post('hr', `/recruitment/applications/${apps.Sara}/suggest`, { suggestion: 'next' }).expect(403);
      const a = (await post('hm', `/recruitment/applications/${apps.Nour}/suggest`, { suggestion: 'reject', note: 'Not the style we need' }).expect(200)).body as ApplicationView;
      expect(a.suggestion).toMatchObject({ kind: 'reject', note: 'Not the style we need', by: { email: emails.hm } });
      expect(await notices('hr', 'hiring_suggestion')).toEqual([{ title: 'Hiring manager suggests: Reject', body: `Nour Applicant ${RUN} · Video Editor ${RUN}`, link: `/recruitment/applicants/${apps.Nour}` }]);
      const b = (await get('hr', `/recruitment/vacancies/${v.id}/board`).expect(200)).body as VacancyBoard;
      expect(b.columns.find((c) => c.stage === 'interview')!.cards[0].suggestion).toBe('reject');
      await post('hr', `/recruitment/applications/${apps.Nour}/stage`, { to: 'shortlisted' }).expect(200);
      expect((await get('hr', `/recruitment/applications/${apps.Nour}`).expect(200)).body.suggestion).toBeNull();
      expect(said(await post('hm', `/recruitment/applications/${apps.Nour}/suggest`, { suggestion: 'maybe' }).expect(400))).toEqual(['Suggest the next step or a rejection.']);
    });
  });

  describe('interviews', () => {
    let interview: InterviewView;

    it('are scheduled by HR, move the applicant to Interview, invite the candidate with the calendar invitation and tell the interviewers', async () => {
      const before = mail.outbox.length;
      const saved = (await post('hr', `/recruitment/applications/${apps.Sara}/interviews`, interviewBody()).expect(201)).body as InterviewSaved;
      interview = saved.interview;
      expect(saved.email).toBe('sent');
      expect(interview).toMatchObject({ status: 'scheduled', minutes: 45, kind: 'in_person', note: 'Bring your reel.', can: { reschedule: true, cancel: true, mark: false, feedback: false } });
      expect(interview.interviewers.map((i) => i.employeeId).sort()).toEqual([people.iv1, people.iv2].sort());
      expect(interview.emailedAt).not.toBeNull();
      const a = (await get('hr', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(a.stage).toBe('interview');
      expect(a.history.at(-1)).toMatchObject({ event: 'interview', note: `Interview on ${addDays(TODAY, 7)}` });
      expect(a.interviews.map((i) => i.id)).toEqual([interview.id]);
      // the candidate's email, English then Arabic, with the invitation
      const sent = mail.outbox.slice(before);
      const toCandidate = sent.find((m) => m.to === `sara.${RUN}@mail.test`)!;
      expect(toCandidate.subject).toContain('Interview invitation: Video Editor');
      expect(toCandidate.replyTo).toBe(emails.hr);
      expect(toCandidate.text).toContain('Bring your reel.');
      expect(toCandidate.text).toContain('عزيزي/عزيزتي');
      const ics = icsOf(toCandidate);
      expect(ics).toContain('METHOD:REQUEST');
      expect(ics).toContain(`UID:interview-${interview.id}@people.trendlix.com`);
      expect(ics).toContain('SEQUENCE:0');
      expect(ics).toContain(`mailto:sara.${RUN}@mail.test`);
      expect(toCandidate.attachments![0].contentType).toBe('text/calendar; charset=UTF-8; method=REQUEST');
      // the interviewers: a notification each, and the invitation to their work email
      expect(await notices('iv1', 'interview_scheduled')).toEqual([{ title: 'Interview scheduled', body: expect.stringContaining(`Sara Applicant ${RUN} on`), link: `/recruitment/applicants/${apps.Sara}` }]);
      expect(sent.some((m) => m.to === emails.iv2 && icsOf(m).includes('METHOD:REQUEST'))).toBe(true);
    });

    it('refuses a time passed, someone who isn’t an employee, anyone but HR, and an applicant filtered out', async () => {
      expect(said(await post('hr', `/recruitment/applications/${apps.Adam}/interviews`, interviewBody({ date: addDays(TODAY, -1) })).expect(400))).toEqual(['That time has passed: choose a later one.']);
      expect(said(await post('hr', `/recruitment/applications/${apps.Adam}/interviews`, interviewBody({ interviewerIds: [users.hr] })).expect(400))).toEqual([
        'Each interviewer must be a current employee: choose them from the list.',
      ]);
      expect(said(await post('hr', `/recruitment/applications/${apps.Adam}/interviews`, interviewBody({ kind: 'online', location: 'zoom' })).expect(400))).toEqual([
        'Give the meeting’s link in full, starting with https://.',
      ]);
      await post('hm', `/recruitment/applications/${apps.Sara}/interviews`, interviewBody()).expect(403);
      expect(said(await post('hr', `/recruitment/applications/${apps.Fady}/interviews`, interviewBody()).expect(409))).toEqual([
        'They failed a must-have question and were filtered out: restore them first.',
      ]);
    });

    it('let the interviewers open the applicants they interview, and no other', async () => {
      const a = (await get('iv1', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(a).toMatchObject({ viewer: 'interviewer', expectedSalary: null, notes: null, can: { suggest: false } });
      await get('iv1', `/recruitment/applications/${apps.Nour}`).expect(404);
      await get('outsider', `/recruitment/applications/${apps.Sara}`).expect(404);
    });

    it('are moved to another time: the same UID, the next SEQUENCE; an interviewer taken off told', async () => {
      const before = mail.outbox.length;
      const saved = (await put('hr', `/recruitment/interviews/${interview.id}`, interviewBody({ time: '13:00', interviewerIds: [people.iv1] })).expect(200)).body as InterviewSaved;
      expect(saved.interview.interviewers.map((i) => i.employeeId)).toEqual([people.iv1]);
      const toCandidate = mail.outbox.slice(before).find((m) => m.to === `sara.${RUN}@mail.test`)!;
      expect(toCandidate.subject).toContain('Interview moved');
      expect(icsOf(toCandidate)).toContain(`UID:interview-${interview.id}@people.trendlix.com`);
      expect(icsOf(toCandidate)).toContain('SEQUENCE:1');
      expect((await notices('iv2', 'interview_scheduled')).at(-1)).toMatchObject({ title: 'Interview cancelled for you' });
      await put('hm', `/recruitment/interviews/${interview.id}`, interviewBody()).expect(403);
    });

    it('are cancelled with a cancellation (METHOD:CANCEL), then can’t change', async () => {
      const other = ((await post('hr', `/recruitment/applications/${apps.Sara}/interviews`, interviewBody({ date: addDays(TODAY, 9) })).expect(201)).body as InterviewSaved).interview;
      const before = mail.outbox.length;
      const cancelled = (await post('hr', `/recruitment/interviews/${other.id}/cancel`, { reason: 'Moved to the first one' }).expect(200)).body as InterviewSaved;
      expect(cancelled.interview).toMatchObject({ status: 'cancelled', cancelReason: 'Moved to the first one', can: { reschedule: false, cancel: false } });
      const toCandidate = mail.outbox.slice(before).find((m) => m.to === `sara.${RUN}@mail.test`)!;
      expect(toCandidate.subject).toContain('Interview cancelled');
      expect(icsOf(toCandidate)).toContain('METHOD:CANCEL');
      expect(icsOf(toCandidate)).toContain('STATUS:CANCELLED');
      expect(icsOf(toCandidate)).toContain('SEQUENCE:1');
      expect(said(await post('hr', `/recruitment/interviews/${other.id}/cancel`).expect(409))).toEqual(['Only a scheduled interview can be cancelled.']);
      expect(said(await post('hr', `/recruitment/interviews/${interview.id}/outcome`, { outcome: 'done' }).expect(409))).toEqual(['The interview hasn’t started yet.']);
    });

    it('take a scorecard from each interviewer once it started; an interviewer sees the others’ once they gave theirs', async () => {
      // Nour's interview took place yesterday: HR scheduled it, it is put back a day as if it had
      await post('hr', `/recruitment/applications/${apps.Nour}/stage`, { to: 'interview' }).expect(200);
      const nour = ((await post('hr', `/recruitment/applications/${apps.Nour}/interviews`, interviewBody()).expect(201)).body as InterviewSaved).interview;
      await prisma.interview.update({ where: { id: nour.id }, data: { startsAt: new Date(Date.now() - 26 * 3_600_000) } });
      const card = { ratings: { skills: 4, experience: 3, communication: 5, culture: 4 }, recommendation: 'yes', notes: 'Good eye' };
      expect(said(await put('iv1', `/recruitment/interviews/${nour.id}/feedback`, { ...card, ratings: { skills: 9 } }).expect(400))).toEqual([
        'Rate skills for the role from 1 to 5.',
        'Rate experience from 1 to 5.',
        'Rate communication from 1 to 5.',
        'Rate culture fit from 1 to 5.',
      ]);
      // the hiring manager and HR give one too since 29 October 2026 (hiring-steps-scorecards.e2e-spec.ts); the CEO
      // reading a vacancy that isn't C-level doesn't, and someone else can't open it
      await put('ceo', `/recruitment/interviews/${nour.id}/feedback`, card).expect(403);
      await put('outsider', `/recruitment/interviews/${nour.id}/feedback`, card).expect(404);
      await put('iv1', `/recruitment/interviews/${nour.id}/feedback`, card).expect(200);
      // Iris hasn't given hers: she sees none of the others'
      let a = (await get('iv2', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView;
      expect(a.feedback).toEqual([]);
      expect(a.feedbackHidden).toBe(1);
      a = (await get('iv1', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView;
      expect(a.feedback).toHaveLength(1);
      expect(a.feedback[0]).toMatchObject({ mine: true, recommendation: 'yes', ratings: card.ratings, notes: 'Good eye' });
      await put('iv2', `/recruitment/interviews/${nour.id}/feedback`, { ...card, recommendation: 'no', notes: null }).expect(200);
      a = (await get('iv2', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView;
      expect(a.feedback.map((f) => f.recommendation).sort()).toEqual(['no', 'yes']);
      expect(a.feedbackHidden).toBe(0);
      // the hiring manager and HR see them all
      expect(((await get('hm', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView).feedback).toHaveLength(2);
      expect(((await get('hr', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView).feedback).toHaveLength(2);
      // changed by its author
      await put('iv2', `/recruitment/interviews/${nour.id}/feedback`, { ...card, recommendation: 'strong_no' }).expect(200);
      // done, then marked
      const done = (await post('hr', `/recruitment/interviews/${nour.id}/outcome`, { outcome: 'done' }).expect(200)).body as InterviewView;
      expect(done.status).toBe('done');
    });

    it('remind each interviewer of a scorecard not given the day after, once', async () => {
      await post('hr', `/recruitment/applications/${apps.Adam}/stage`, { to: 'shortlisted' }).expect(200);
      const adam = ((await post('hr', `/recruitment/applications/${apps.Adam}/interviews`, interviewBody({ interviewerIds: [people.iv2] })).expect(201)).body as InterviewSaved).interview;
      await prisma.interview.update({ where: { id: adam.id }, data: { startsAt: new Date(Date.now() - 30 * 3_600_000) } });
      const round = app.get(RecruitmentSchedulerService);
      expect(await round.runOnce()).toBeGreaterThanOrEqual(1);
      expect((await notices('iv2', 'interview_feedback')).filter((n) => n.link === `/recruitment/applicants/${apps.Adam}`)).toEqual([
        { title: 'Your interview scorecard', body: expect.stringContaining(`Adam Applicant ${RUN}: interviewed`), link: `/recruitment/applicants/${apps.Adam}` },
      ]);
      await round.runOnce();
      expect((await notices('iv2', 'interview_feedback')).filter((n) => n.link === `/recruitment/applicants/${apps.Adam}`)).toHaveLength(1);
      // Nour's interviewers gave theirs: no reminder
      expect((await notices('iv1', 'interview_feedback')).filter((n) => n.link === `/recruitment/applicants/${apps.Nour}`)).toEqual([]);
    });

    it('show on the upcoming list for HR and the CEO, and in My Hiring for the interviewers and the hiring manager', async () => {
      const upcoming = (await get('hr', '/recruitment/interviews').expect(200)).body as InterviewView[];
      expect(upcoming.map((i) => i.id)).toContain(interview.id);
      await get('ceo', '/recruitment/interviews').expect(200);
      await get('iv1', '/recruitment/interviews').expect(403);
      const iv1 = (await get('iv1', '/recruitment/my-hiring').expect(200)).body as MyHiring;
      expect(iv1.interviews.map((i) => i.id)).toContain(interview.id);
      expect(iv1.vacancies).toEqual([]);
      const hm = (await get('hm', '/recruitment/my-hiring').expect(200)).body as MyHiring;
      expect(hm.vacancies).toEqual([expect.objectContaining({ id: v.id, counts: expect.objectContaining({ applied: 0 }) })]);
      // no shortlist to review either (29 October 2026: hiring-steps-review.e2e-spec.ts)
      expect((await get('outsider', '/recruitment/my-hiring').expect(200)).body).toEqual({ vacancies: [], interviews: [], feedbackDue: 0, toReview: [] });
      expect((await get('hm', '/auth/me').expect(200)).body.hiring).toBe(true);
      expect((await get('iv1', '/auth/me').expect(200)).body.hiring).toBe(true);
      expect((await get('outsider', '/auth/me').expect(200)).body.hiring).toBe(false);
    });
  });

  describe('the rejection email', () => {
    it('goes only when ticked, with the standard words, then with HR’s', async () => {
      const before = mail.outbox.length;
      const quiet = (await post('hr', `/recruitment/applications/${apps.Adam}/stage`, { to: 'rejected', reason: 'Too junior' }).expect(200)).body;
      expect(quiet.emailed).toBe('not_sent');
      expect(mail.outbox.length).toBe(before);
      await post('hr', `/recruitment/applications/${apps.Adam}/restore`).expect(200);
      const sent = (await post('hr', `/recruitment/applications/${apps.Adam}/stage`, { to: 'rejected', reason: 'Too junior', email: true }).expect(200)).body;
      expect(sent.emailed).toBe('sent');
      const m = mail.outbox.at(-1)!;
      expect(m).toMatchObject({ to: `adam.${RUN}@mail.test`, subject: `Your application for Video Editor ${RUN} · طلبك لوظيفة Video Editor ${RUN}` });
      expect(m.text).toContain(`Dear Adam Applicant ${RUN},`);
      expect(m.text).not.toContain('Too junior');
      // HR's words
      await patch('ceo', '/recruitment/settings', { rejectionSubject: 'About {job}' }).expect(403);
      const s = (await patch('hr', '/recruitment/settings', { rejectionSubject: 'About {job}', rejectionEn: 'Hello {name}, thank you from {company}.' }).expect(200)).body;
      expect(s.rejection).toEqual({ subject: 'About {job}', en: 'Hello {name}, thank you from {company}.', ar: null });
      expect((await get('ceo', '/recruitment/settings').expect(200)).body.standard.subject).toContain('{job}');
      await post('hr', `/recruitment/applications/${apps.Adam}/restore`).expect(200);
      await post('hr', `/recruitment/applications/${apps.Adam}/stage`, { to: 'rejected', reason: 'Too junior', email: true }).expect(200);
      expect(mail.outbox.at(-1)).toMatchObject({ subject: `About Video Editor ${RUN}` });
      expect(mail.outbox.at(-1)!.text.startsWith(`Hello Adam Applicant ${RUN}, thank you from`)).toBe(true);
      // back to the standard
      expect((await patch('hr', '/recruitment/settings', { rejectionSubject: '', rejectionEn: '' }).expect(200)).body.rejection).toEqual({ subject: null, en: null, ar: null });
    });
  });

  describe('onboarding', () => {
    let checklist: OnboardingView;

    it('opens on a hire through an accepted job offer, with the system’s three items and HR’s defaults', async () => {
      const offer = (await post('hr', '/offers', {
        fullNameEn: `Sara Hired ${RUN}`,
        fullNameAr: 'سارة',
        email: `sara.hired.${RUN}@mail.test`,
        employmentType: 'full_time',
        joinDate: addDays(TODAY, 14),
        jobTitleId,
        gradeId,
        shiftId,
        grossSalary: 20000,
        applicationId: apps.Sara,
      }).expect(201)).body as { id: string };
      await post('hr', `/offers/${offer.id}/answer`, { answer: 'accepted' }).expect(200);
      const a = (await get('hr', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(a.stage).toBe('hired');
      const found = (await get('hr', `/onboarding/employees/${a.employeeId}`).expect(200)).body as { checklist: OnboardingSummary };
      expect(found.checklist).toMatchObject({ status: 'open', application: { id: apps.Sara }, employee: { id: a.employeeId } });
      checklist = (await get('hr', `/onboarding/${found.checklist.id}`).expect(200)).body as OnboardingView;
      expect(checklist.items.map((i) => [i.kind, i.label, i.owner, i.status])).toEqual([
        ['contract', 'Contract signed', 'hr', 'pending'],
        ['kpi_template', 'KPI template in place for the job title', 'hr', 'pending'],
        ['assets', 'Equipment handed over', 'assets', 'pending'],
        ['manual', 'National ID and documents collected', 'hr', 'pending'],
        ['manual', 'JD sign-off', 'manager', 'pending'],
        ['manual', 'Accounts created', 'admin', 'pending'],
        ['manual', 'Social insurance Form 1', 'hr', 'pending'],
      ]);
      expect(checklist.can).toEqual({ manage: true, complete: true, addItem: true });
      expect(((await get('hr', '/onboarding').expect(200)).body as OnboardingSummary[]).map((c) => c.id)).toContain(checklist.id);
      await get('outsider', `/onboarding/${checklist.id}`).expect(404);
      await get('outsider', '/onboarding').expect(403);
    });

    it('has its items cleared by their owners (the system’s ticked by the system), and completes only once all are', async () => {
      const manual = checklist.items.find((i) => i.label === 'National ID and documents collected')!;
      const auto = checklist.items.find((i) => i.kind === 'contract')!;
      expect(said(await patch('hr', `/onboarding/${checklist.id}/items/${auto.id}`, { status: 'done' }).expect(400))).toEqual(['“Contract signed” is ticked by the system once their contract is signed.']);
      await patch('hr', `/onboarding/${checklist.id}/items/${manual.id}`, { status: 'done', note: 'Copies on file' }).expect(200);
      const added = (await post('hr', `/onboarding/${checklist.id}/items`, { label: 'Welcome lunch', owner: 'manager' }).expect(201)).body as OnboardingView;
      expect(added.items.at(-1)).toMatchObject({ label: 'Welcome lunch', owner: 'manager', kind: 'manual' });
      const refused = said(await post('hr', `/onboarding/${checklist.id}/complete`).expect(400));
      expect(refused[0]).toMatch(/^Still pending: Contract signed, KPI template in place for the job title, Equipment handed over/);
      const after = (await get('hr', `/onboarding/${checklist.id}`).expect(200)).body as OnboardingView;
      expect(after.items.find((i) => i.id === manual.id)).toMatchObject({ status: 'done', note: 'Copies on file', doneBy: expect.any(String) });
      expect(after.progress).toEqual({ cleared: 1, total: 8 });
    });

    it('is opened by hand for someone hired without the ATS, once; a C-level person’s is the CEO’s alone', async () => {
      const outsiderEmployment = (await prisma.employment.findFirstOrThrow({ where: { employeeId: people.outsider }, select: { id: true } })).id;
      const opened = (await post('hr', `/onboarding/employments/${outsiderEmployment}`).expect(201)).body as OnboardingView;
      expect(opened).toMatchObject({ status: 'open', application: null });
      expect(said(await post('hr', `/onboarding/employments/${outsiderEmployment}`).expect(409))).toEqual(['This employment has an onboarding checklist already. Open it from Onboarding.']);
      await person('chief', ['employee'], 'Clara Chief', g9Id);
      const chiefEmployment = (await prisma.employment.findFirstOrThrow({ where: { employeeId: people.chief }, select: { id: true } })).id;
      await post('hr', `/onboarding/employments/${chiefEmployment}`).expect(404);
      const chief = (await post('ceo', `/onboarding/employments/${chiefEmployment}`).expect(201)).body as OnboardingView;
      await get('hr', `/onboarding/${chief.id}`).expect(404);
      expect(((await get('hr', '/onboarding').expect(200)).body as OnboardingSummary[]).map((c) => c.id)).not.toContain(chief.id);
      expect(((await get('ceo', '/onboarding').expect(200)).body as OnboardingSummary[]).map((c) => c.id)).toContain(chief.id);
    });

    it('has HR’s default items, which HR changes', async () => {
      const defaults = (await get('hr', '/onboarding/checklist').expect(200)).body as { id: string; label: string; owner: string }[];
      expect(defaults.map((d) => d.label)).toEqual(['National ID and documents collected', 'JD sign-off', 'Accounts created', 'Social insurance Form 1']);
      const saved = (await put('hr', '/onboarding/checklist', { items: [...defaults, { label: 'Laptop set up', owner: 'admin' }] }).expect(200)).body as { label: string }[];
      expect(saved.at(-1)).toMatchObject({ label: 'Laptop set up' });
      await put('outsider', '/onboarding/checklist', { items: defaults }).expect(403);
      await put('hr', '/onboarding/checklist', { items: defaults }).expect(200);
    });
  });

  describe('the analytics', () => {
    it('count the year’s applicants, hires, funnel and sources, for HR and the CEO, with an Excel', async () => {
      const r = (await get('hr', `/recruitment/analytics?year=${TODAY.slice(0, 4)}&departmentId=${departmentId}`).expect(200)).body as RecruitmentAnalytics;
      expect(r).toMatchObject({ year: Number(TODAY.slice(0, 4)), departmentId, applicants: 4, hires: 1, openVacancies: 1, openPositions: 1 });
      expect(r.funnel.map((f) => [f.stage, f.reached])).toEqual([
        ['applied', 4],
        ['shortlisted', 3],
        // Sara (hired), Adam (interviewed, then rejected) and Nour
        ['interview', 3],
        ['offer', 1],
        ['hired', 1],
      ]);
      expect(r.sources).toEqual([{ source: 'careers', applicants: 4, shortlisted: 3, hired: 1 }]);
      expect(r.offers).toMatchObject({ made: 1, accepted: 1, declined: 0, acceptanceRate: 100 });
      expect(r.timeToHireDays).not.toBeNull();
      expect(r.hiresByMonth).toHaveLength(12);
      expect(r.departments).toEqual([expect.objectContaining({ id: departmentId, hires: 1 })]);
      await get('ceo', `/recruitment/analytics?departmentId=${departmentId}`).expect(200);
      await get('outsider', '/recruitment/analytics').expect(403);
      const file = await get('hr', `/recruitment/analytics/export?departmentId=${departmentId}`).expect(200);
      expect(file.headers['content-type']).toContain('spreadsheetml');
      expect(file.headers['content-disposition']).toContain('Recruitment');
    });
  });

  it('leaves its steps in the audit log', async () => {
    const actions = await prisma.auditLog.findMany({
      where: { OR: [{ entityType: 'interview' }, { entityType: 'job_application', entityId: { in: Object.values(apps) } }, { entityType: 'onboarding_checklist' }, { entityType: 'recruitment_settings' }, { entityType: 'recruitment_analytics' }] },
      select: { action: true },
    });
    const seen = new Set(actions.map((a) => a.action));
    for (const a of ['schedule', 'reschedule', 'cancel', 'feedback', 'feedback_change', 'interview_done', 'suggest', 'rejection_email', 'open_onboarding', 'mark_onboarding_item', 'add_onboarding_item', 'update', 'analytics_file']) {
      expect(seen, a).toContain(a);
    }
    // a scorecard's notes are never in the log
    const feedback = await prisma.auditLog.findMany({ where: { entityType: 'interview', action: 'feedback' }, select: { diff: true } });
    expect(JSON.stringify(feedback)).not.toContain('Good eye');
  });
});
