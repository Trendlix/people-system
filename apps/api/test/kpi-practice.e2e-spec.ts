import type { INestApplication } from '@nestjs/common';
import type { KpiCounts, KpiHeatmap, KpiOverview, KpiPracticeChoices, KpiPracticeRow, KpiScorecardSummary, KpiScorecardView, KpiTemplateView } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { KpiSchedulerService } from '../src/kpis/kpi-scheduler.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { finalKpis } from '../src/payroll/kpi-terms.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Practice KPI scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and Admin..
// how?", choosing "Practice scorecards"; packages/shared kpi-practice.ts): HR and a Super Admin start one for anyone (HR
// never a C-level person), any month from the join date to this one, on a draft or a published version; its starter
// takes every step standing in, with no dates, to final; the employee and the manager never see it, a Super Admin
// viewing as them does and, acting as them, takes their step; the real opening still opens the month's real scorecard;
// payroll's KPI, the overview, the heatmap, the Excel and the counts leave it out; nobody is told; a draft saved changed
// starts its practice scorecards again, unchanged keeps them, published carries them on, discarded deletes them; only a
// Super Admin deletes them, never a real one; and the audit log has each, marked practice. Every name is invented; the
// test deletes what it made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const PREV = monthsLater(CURRENT, -1);
const NEXT = monthsLater(CURRENT, 1);
/** A moment on a day, at noon in Cairo whatever the season. */
const at = (day: string) => new Date(`${day}T10:00:00Z`);

/** Three metrics, each worth 10: a pick of 0 gives 10, 1 gives 5, 2 gives 0; Attendance worth 20. */
const metric = (pillar: string, name: string) => ({
  pillar,
  name,
  definition: null,
  howMeasured: null,
  jdDuty: null,
  targetPoints: 10,
  criteria: [
    { label: 'Great', points: 10 },
    { label: 'Fine', points: 5 },
    { label: 'Poor', points: 0 },
  ],
});
const CONTENT = { attendancePoints: 20, metrics: [metric('delivery', 'Reports on time'), metric('quality', 'Data accuracy'), metric('clients', 'Stakeholder feedback')] };

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Practice KPI scorecards (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: KpiSchedulerService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const put = (path: string, session: string, body: object) => api().put(`/api${path}`).set('Cookie', session).send(body);
  const del = (path: string, session: string) => api().delete(`/api${path}`).set('Cookie', session);
  const card = async (id: string, session: string) => (await get(`/kpis/scorecards/${id}`, session).expect(200)).body as KpiScorecardView;
  const start = async (session: string, body: object) => (await post('/kpis/practice', session, body).expect(201)).body as KpiScorecardView;

  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  let deptId: string;
  let titleId: string;
  let v1: KpiTemplateView;
  let draft: KpiTemplateView;
  let g9Before: boolean;
  let emailDomainBefore: string | null;
  /** The practice scorecards made, by name. */
  const practice: Record<string, string> = {};
  /** When the tests began, after the setup: no notification may be made from then until the real opening. */
  let startedAt: Date;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    return email;
  }

  /** A person with a sign-in (or none), employed from the month before this one. */
  async function person(key: string, name: string, email: string | null, employment: Record<string, unknown>) {
    const res = await post('/employees', sessions.hr, { fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }) }).expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    await prisma.employment.create({ data: { employeeId: res.body.id, employmentType: 'full_time', status: 'active', joinDate: toDateOnly(firstDay(PREV)), ...employment } });
  }

  /** A session of a Super Admin's switched to the user (view only until Act as them). */
  async function viewAs(userKey: string, act = false): Promise<string> {
    const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    let session = cookieOf(await post('/auth/view-as', sessions.viewer, { userId: users[userKey] }).expect(200));
    if (act) session = cookieOf(await post('/auth/view-as/act', session, { act: true }).expect(200));
    return session;
  }

  /** Every metric of a scorecard picked: `choices` in order (one for all when a number). */
  const picks = (view: Pick<KpiScorecardView, 'pillars'>, choices: number | number[]) =>
    view.pillars.flatMap((p) => p.metrics).map((m, i) => ({ metricId: m.id, choice: typeof choices === 'number' ? choices : choices[i] }));

  const notesFor = (keys: string[]) => prisma.notification.count({ where: { userId: { in: keys.map((k) => users[k]) }, createdAt: { gte: startedAt } } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    clock = app.get(KpiSchedulerService);
    await account('hr', ['hr']);
    await account('hr2', ['hr']);
    await account('superAdmin', ['super_admin']);
    // a Super Admin of its own for the switcher, so switching doesn't touch the session the other tests use
    await account('viewer', ['super_admin']);
    const monaEmail = await account('mona', ['manager']);
    const benEmail = await account('ben', ['employee']);
    const omarEmail = await account('omar', ['employee']);
    const claraEmail = await account('clara', ['employee']);

    emailDomainBefore = (await get('/company', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    const g9 = await prisma.grade.findUniqueOrThrow({ where: { code: 'G9' } });
    g9Before = g9.confidential;
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: true } });

    deptId = (await post('/departments', sessions.hr, { nameEn: `Practice Dept ${RUN}` }).expect(201)).body.id;
    titleId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `Practice Analyst ${RUN}` }).expect(201)).body.id;
    await person('mona', 'Mona Manager', monaEmail, { departmentId: deptId });
    await person('ben', 'Ben Rated', benEmail, { departmentId: deptId, jobTitleId: titleId, managerId: ids.mona });
    await person('omar', 'Omar Alone', omarEmail, { departmentId: deptId, jobTitleId: titleId });
    await person('clara', 'Clara Chief', claraEmail, { departmentId: deptId, jobTitleId: titleId, gradeId: g9.id });

    // version 1 published (it opens from next month), and version 2 a draft
    const first = (await post(`/kpis/templates/job-titles/${titleId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
    await put(`/kpis/templates/${first.id}`, sessions.hr, CONTENT).expect(200);
    v1 = (await post(`/kpis/templates/${first.id}/publish`, sessions.hr).expect(200)).body as KpiTemplateView;
    draft = (await post(`/kpis/templates/job-titles/${titleId}/draft`, sessions.hr, { from: 'published' }).expect(201)).body as KpiTemplateView;
    await app.get(NotificationsService).flush();
    startedAt = new Date();
  });

  afterAll(async () => {
    await app.get(NotificationsService).flush();
    await prisma.kpiScorecard.deleteMany({ where: { OR: [{ employeeId: { in: people } }, { template: { jobTitleId: titleId } }] } });
    if (titleId) await prisma.kpiTemplate.deleteMany({ where: { jobTitleId: titleId } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    if (titleId) await prisma.jobTitle.deleteMany({ where: { id: titleId } });
    if (deptId) await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.grade.update({ where: { code: 'G9' }, data: { confidential: g9Before } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('starting one', () => {
    it('HR and a Super Admin start one; a manager or an employee is refused, and HR for a C-level person', async () => {
      const hrCountsBefore = (await get('/kpis/counts', sessions.hr).expect(200)).body as KpiCounts;
      await post('/kpis/practice', sessions.mona, { employeeId: ids.ben }).expect(403);
      await post('/kpis/practice', sessions.ben, { employeeId: ids.ben }).expect(403);
      await get('/kpis/practice', sessions.ben).expect(403);
      await get('/kpis/practice/choices', sessions.mona).expect(403);

      // whom HR may start one for: not the C-level person; the months from the join month, the versions newest first
      const choices = (await get('/kpis/practice/choices', sessions.hr).expect(200)).body as KpiPracticeChoices;
      expect(choices.month).toBe(CURRENT);
      const ben = choices.people.find((p) => p.employee.id === ids.ben)!;
      expect(ben).toMatchObject({ months: [CURRENT, PREV], jobTitle: { id: titleId } });
      expect(ben.templates.map((t) => [t.version, t.draft])).toEqual([
        [2, true],
        [1, false],
      ]);
      expect(choices.people.some((p) => p.employee.id === ids.clara)).toBe(false);
      expect(choices.people.some((p) => p.employee.id === ids.mona)).toBe(false);
      expect(((await get('/kpis/practice/choices', sessions.superAdmin).expect(200)).body as KpiPracticeChoices).people.some((p) => p.employee.id === ids.clara)).toBe(true);

      // HR, on the published version, this month by default
      const fromPublished = await start(sessions.hr, { employeeId: ids.ben, templateId: v1.id });
      practice.benV1 = fromPublished.id;
      expect(fromPublished).toMatchObject({
        month: CURRENT,
        status: 'self_rating',
        templateVersion: 1,
        scorer: { kind: 'manager', name: `Mona Manager ${RUN}` },
        practice: { draft: false, startedBy: { email: expect.any(String) } },
        action: null,
        can: { selfRate: false, score: false, calibrate: false, signAsEmployee: false, signAsManager: false },
        standIn: { self_rate: true, score: true, calibrate: false, sign_employee: false, sign_manager: false },
        unplaced: 0,
      });
      expect(fromPublished.deadlines.selfRating).toBe(`${NEXT}-03`);
      expect(fromPublished.steps).toEqual([expect.objectContaining({ kind: 'opened', comment: 'Practice, on version 1' })]);

      // a Super Admin, on the job title's newest: the draft
      const fromDraft = await start(sessions.superAdmin, { employeeId: ids.ben });
      practice.benDraft = fromDraft.id;
      expect(fromDraft).toMatchObject({ templateVersion: 2, practice: { draft: true }, template: { id: draft.id } });

      // several a person and month; any month from the join month to this one
      practice.benPrev = (await start(sessions.hr, { employeeId: ids.ben, month: PREV, templateId: v1.id })).id;
      expect(said(await post('/kpis/practice', sessions.hr, { employeeId: ids.ben, month: NEXT }).expect(400))[0]).toContain('a practice scorecard is for a month that has begun');
      expect(said(await post('/kpis/practice', sessions.hr, { employeeId: ids.ben, month: monthsLater(PREV, -1) }).expect(400))[0]).toContain('joined in');
      expect(said(await post('/kpis/practice', sessions.hr, { employeeId: ids.mona }).expect(400))[0]).toContain('has no job title');

      // a C-level person: hidden from HR, started by a Super Admin, scored by the CEO
      await post('/kpis/practice', sessions.hr, { employeeId: ids.clara }).expect(404);
      const clara = await start(sessions.superAdmin, { employeeId: ids.clara, templateId: v1.id });
      practice.clara = clara.id;
      expect(clara).toMatchObject({ scorer: { kind: 'ceo' }, confidential: true });
      await get(`/kpis/scorecards/${clara.id}`, sessions.hr).expect(404);

      // nobody in charge of Omar: HR scores
      practice.omar = (await start(sessions.hr, { employeeId: ids.omar, templateId: v1.id })).id;
      expect((await card(practice.omar, sessions.hr)).scorer.kind).toBe('hr');

      // the Practice list: HR without the C-level person's, the Super Admin with it
      const list = (await get('/kpis/practice', sessions.hr).expect(200)).body as KpiPracticeRow[];
      const mine = list.filter((r) => people.includes(r.employee.id));
      expect(mine.map((r) => r.id).sort()).toEqual([practice.benV1, practice.benDraft, practice.benPrev, practice.omar].sort());
      expect(mine.find((r) => r.id === practice.benDraft)).toMatchObject({ template: { version: 2, draft: true }, mine: false, status: 'self_rating' });
      expect(mine.find((r) => r.id === practice.benV1)).toMatchObject({ month: CURRENT, mine: true, startedBy: { email: expect.any(String) } });
      expect(((await get('/kpis/practice', sessions.superAdmin).expect(200)).body as KpiPracticeRow[]).some((r) => r.id === practice.clara)).toBe(true);

      // HR's own counts didn't move
      expect((await get('/kpis/counts', sessions.hr).expect(200)).body).toEqual(hrCountsBefore);

      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_scorecard', entityId: practice.benV1, action: 'practice_start' } });
      expect(audit).toMatchObject({ userId: users.hr, diff: { practice: true, month: CURRENT, version: 1, draft: false, scorer: 'manager', status: 'self_rating' } });
    });
  });

  describe('the steps, without dates', () => {
    it('its starter takes every step standing in, to final; each is kept as theirs for whom they stood in', async () => {
      const id = practice.benV1;
      // in one's own session the real routes refuse it; another HR person sees it but doesn't stand in
      expect(said(await post(`/kpis/scorecards/${id}/self`, sessions.hr, { picks: [], submit: false }).expect(403))[0]).toContain('practice scorecard');
      expect((await card(id, sessions.hr2)).standIn).toBeNull();
      await post(`/kpis/practice/${id}/self`, sessions.hr2, { picks: [], submit: false }).expect(403);
      let view = await card(id, sessions.hr);

      view = (await post(`/kpis/practice/${id}/self`, sessions.hr, { picks: picks(view, [1, 0, 0]), comment: 'A good month', submit: true }).expect(200)).body;
      expect(view).toMatchObject({ status: 'manager', standIn: { score: true, self_rate: false } });
      view = (await post(`/kpis/practice/${id}/score`, sessions.hr, { picks: picks(view, [1, 1, 0]), comment: 'Keep the dates', submit: true }).expect(200)).body;
      // Delivery 50% × 30 + Quality 50% × 25 + Clients 100% × 25 + Discipline (Attendance, full) 100% × 20
      expect(view).toMatchObject({ status: 'hr', finalPercent: 72.5, standIn: { calibrate: true } });
      const second = view.pillars[1].metrics[0];
      view = (await post(`/kpis/practice/${id}/calibrate`, sessions.hr, { changes: [{ metricId: second.id, choice: 0, reason: 'Checked the audit' }] }).expect(200)).body;
      expect(view).toMatchObject({ status: 'sign_off', finalPercent: 85, standIn: { sign_employee: true, sign_manager: true } });
      view = (await post(`/kpis/practice/${id}/sign`, sessions.hr, { as: 'employee', comment: 'Read' }).expect(200)).body;
      await post(`/kpis/practice/${id}/sign`, sessions.hr, { as: 'employee' }).expect(409);
      view = (await post(`/kpis/practice/${id}/sign`, sessions.hr, { as: 'manager' }).expect(200)).body;
      expect(view).toMatchObject({ status: 'final', finalPercent: 85, level: 'needs_improvement', unsigned: false });

      const ben = `Ben Rated ${RUN}`;
      const by = view.steps.map((s) => [s.kind, s.by]);
      expect(by.slice(1)).toEqual([
        ['self_rated', expect.stringMatching(new RegExp(` for ${ben}$`))],
        ['scored', expect.stringMatching(/ for the manager$/)],
        ['calibrated', expect.stringMatching(/ for HR$/)],
        ['signed_employee', expect.stringMatching(new RegExp(` for ${ben}$`))],
        ['signed_manager', expect.stringMatching(/ for the manager$/)],
        ['final', null],
      ]);
      const row = await prisma.kpiScorecard.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ scoredById: users.hr, calibratedById: users.hr, managerSignedById: users.hr, practice: true });

      const steps = await prisma.auditLog.findMany({ where: { entityType: 'kpi_scorecard', entityId: id }, orderBy: { id: 'asc' } });
      expect(steps.map((a) => a.action)).toEqual(['practice_start', 'self_rate', 'score', 'calibrate', 'sign', 'sign']);
      expect(steps[2]).toMatchObject({ userId: users.hr, diff: { practice: true, stoodInFor: 'the manager' } });
      expect(steps[3]).toMatchObject({ diff: { practice: true, stoodInFor: 'HR' } });
      expect(steps[1]).toMatchObject({ diff: { practice: true, stoodInFor: ben } });
    });

    it('no day holds a step back: the scoring goes with the self-rating still open, and the clock never moves one on', async () => {
      // Omar's, this month: the self-rating's day is next month, and HR scores it (nobody in charge)
      let view = await card(practice.omar, sessions.superAdmin);
      expect(view.standIn).toMatchObject({ self_rate: true, score: true });
      view = (await post(`/kpis/practice/${practice.omar}/score`, sessions.superAdmin, { picks: picks(view, 0), comment: 'Fine', submit: true }).expect(200)).body;
      expect(view).toMatchObject({ status: 'sign_off', selfMissed: true, finalPercent: 100 });
      expect(view.steps.find((s) => s.kind === 'self_missed')?.comment).toBe('Not sent: the scoring was sent without it (practice)');
      expect(view.steps.find((s) => s.kind === 'scored')?.by).toMatch(/ for HR$/);

      // last month's: on the 27th its self-rating day (the 3rd) and its sign-off day (the 10th) have gone by, but the
      // clock leaves them be: never self-missed, never final unsigned, no reminder
      const omarPrev = await start(sessions.hr, { employeeId: ids.omar, month: PREV, templateId: v1.id });
      practice.omarPrev = omarPrev.id;
      await post(`/kpis/practice/${omarPrev.id}/score`, sessions.hr, { picks: picks(omarPrev, 0), comment: 'Fine', submit: true }).expect(200);
      const round = await clock.runOnce(at(`${CURRENT}-27`));
      expect(round).not.toBeNull();
      expect(await prisma.kpiScorecard.findUniqueOrThrow({ where: { id: practice.benPrev } })).toMatchObject({ status: 'self_rating', selfMissed: false, remindersSent: [] });
      expect(await prisma.kpiScorecard.findUniqueOrThrow({ where: { id: omarPrev.id } })).toMatchObject({ status: 'sign_off', finalAt: null, remindersSent: [] });
    });
  });

  describe('who sees it', () => {
    it('the employee and the manager, signed in themselves, never do; a Super Admin viewing as them does, marked practice', async () => {
      // the self-rating sent, so it waits for the manager
      const view = await card(practice.benDraft, sessions.superAdmin);
      await post(`/kpis/practice/${practice.benDraft}/self`, sessions.superAdmin, { picks: picks(view, 0), submit: true }).expect(200);

      for (const key of ['ben', 'mona']) {
        for (const id of Object.values(practice)) await get(`/kpis/scorecards/${id}`, sessions[key]).expect(404);
        expect((await get('/kpis/scorecards/mine', sessions[key]).expect(200)).body).toEqual([]);
        expect((await get('/kpis/scorecards/waiting', sessions[key]).expect(200)).body).toEqual([]);
        expect((await get('/kpis/counts', sessions[key]).expect(200)).body).toEqual({ self: 0, team: 0, hr: 0 });
      }
      expect((await get('/kpis/scorecards?scope=team', sessions.mona).expect(200)).body).toEqual([]);
      expect(((await get('/kpis/heatmap?scope=team', sessions.mona).expect(200)).body as KpiHeatmap).rows).toEqual([]);

      // viewing as Ben: his own, marked practice, his step the self-rating
      const asBen = await viewAs('ben');
      const mine = (await get('/kpis/scorecards/mine', asBen).expect(200)).body as KpiScorecardSummary[];
      expect(mine.map((s) => s.id).sort()).toEqual([practice.benV1, practice.benDraft, practice.benPrev].sort());
      expect(mine.every((s) => s.practice)).toBe(true);
      expect(mine.find((s) => s.id === practice.benPrev)).toMatchObject({ action: 'self_rate' });
      const seen = await card(practice.benPrev, asBen);
      expect(seen).toMatchObject({ practice: { draft: false }, can: { selfRate: true }, standIn: null });
      expect(((await get('/kpis/counts', asBen).expect(200)).body as KpiCounts).self).toBe(1);
      // view only: the step is refused until Act as them
      await post(`/kpis/scorecards/${practice.benPrev}/self`, asBen, { picks: picks(seen, 0), submit: true }).expect(403);

      // viewing as Mona: the draft's waits for her scoring
      const asMona = await viewAs('mona');
      // (last month's too, once its self-rating day has gone by: as the real one would)
      const waiting = (await get('/kpis/scorecards/waiting', asMona).expect(200)).body as KpiScorecardSummary[];
      expect(waiting.map((s) => [s.id, s.action, !!s.practice])).toContainEqual([practice.benDraft, 'score', true]);
      expect(waiting.every((s) => s.practice && s.employee.id === ids.ben)).toBe(true);
      expect(((await get('/kpis/counts', asMona).expect(200)).body as KpiCounts).team).toBe(waiting.length);
      // the C-level person's isn't Mona's to see
      await get(`/kpis/scorecards/${practice.clara}`, asMona).expect(404);
    });

    it('acting as them, the Super Admin takes their step as them, in the audit log as both', async () => {
      const asBen = await viewAs('ben', true);
      const view = await card(practice.benPrev, asBen);
      const sent = (await post(`/kpis/scorecards/${practice.benPrev}/self`, asBen, { picks: picks(view, 1), submit: true }).expect(200)).body as KpiScorecardView;
      expect(sent).toMatchObject({ status: 'manager', practice: { draft: false } });
      // the practice routes are for one's own session
      await post(`/kpis/practice/${practice.benPrev}/score`, asBen, { picks: picks(view, 1), submit: false }).expect(403);

      const asMona = await viewAs('mona', true);
      const scored = (await post(`/kpis/scorecards/${practice.benPrev}/score`, asMona, { picks: picks(view, 1), comment: 'As Mona', submit: true }).expect(200)).body as KpiScorecardView;
      expect(scored).toMatchObject({ status: 'hr', finalPercent: 60 });

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'kpi_scorecard', entityId: practice.benPrev, action: { in: ['self_rate', 'score'] } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => [a.action, a.userId, a.onBehalfById])).toEqual([
        ['self_rate', users.ben, users.viewer],
        ['score', users.mona, users.viewer],
      ]);
      expect(audit[0]).toMatchObject({ diff: { practice: true } });
      expect((audit[0].diff as Record<string, unknown>).stoodInFor).toBeUndefined();
      const steps = (await card(practice.benPrev, sessions.hr)).steps;
      expect(steps.find((s) => s.kind === 'self_rated')?.by).toBe(`Ben Rated ${RUN}`);
    });
  });

  describe('nothing leaks out', () => {
    it('payroll’s KPI, the overview, the heatmap, the Excel and All KPIs leave it out', async () => {
      // Ben's practice one of this month is final at 85%: next month's payroll doesn't see it
      expect((await finalKpis(prisma, NEXT, [ids.ben, ids.omar])).size).toBe(0);
      const month = toDateOnly(firstDay(CURRENT));
      const overview = (await get(`/kpis/overview?month=${CURRENT}`, sessions.hr).expect(200)).body as KpiOverview;
      expect(overview.total + overview.hidden).toBe(await prisma.kpiScorecard.count({ where: { month, practice: false } }));
      const all = (await get(`/kpis/scorecards?scope=all&month=${CURRENT}`, sessions.superAdmin).expect(200)).body as KpiScorecardSummary[];
      expect(all.some((s) => people.includes(s.employee.id))).toBe(false);
      const map = (await get(`/kpis/heatmap?scope=all&to=${CURRENT}&months=2`, sessions.superAdmin).expect(200)).body as KpiHeatmap;
      expect(map.rows.some((r) => people.includes(r.employee.id))).toBe(false);

      const file = await get(`/kpis/export?month=${CURRENT}`, sessions.superAdmin)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.body as unknown as ArrayBuffer);
      const names: string[] = [];
      wb.worksheets[0].eachRow((r) => names.push(r.getCell(2).text));
      expect(names.some((n) => n.endsWith(RUN))).toBe(false);
    });

    it('nobody is told: not the employee, the manager, HR or the Super Admins', async () => {
      await app.get(NotificationsService).flush();
      expect(await notesFor(['ben', 'mona', 'omar', 'clara', 'hr', 'hr2', 'superAdmin', 'viewer'])).toBe(0);
      expect(await prisma.notification.count({ where: { link: { in: Object.values(practice).map((id) => `/kpis/scorecards/${id}`) } } })).toBe(0);
    });
  });

  describe('a draft changing under them', () => {
    it('saved unchanged keeps them; saved changed starts them again on its new metrics; published carries them on', async () => {
      // the draft's (Ben's) is with the manager
      expect((await card(practice.benDraft, sessions.superAdmin)).status).toBe('manager');
      const page = (await get(`/kpis/templates/${draft.id}`, sessions.hr).expect(200)).body as KpiTemplateView;
      expect(page).toMatchObject({ practiceScorecards: 1, scorecards: 0 });

      await put(`/kpis/templates/${draft.id}`, sessions.hr, CONTENT).expect(200);
      expect((await card(practice.benDraft, sessions.superAdmin)).status).toBe('manager');

      const changed = { ...CONTENT, attendancePoints: 30, metrics: [...CONTENT.metrics, metric('clients', 'Client calls')] };
      await put(`/kpis/templates/${draft.id}`, sessions.hr, changed).expect(200);
      const reset = await card(practice.benDraft, sessions.superAdmin);
      expect(reset).toMatchObject({ status: 'self_rating', finalPercent: null, selfMissed: false, attendance: { points: 30, achieved: 30 } });
      expect(reset.pillars.flatMap((p) => p.metrics).map((m) => [m.name, m.self])).toEqual([
        ['Reports on time', null],
        ['Data accuracy', null],
        ['Stakeholder feedback', null],
        ['Client calls', null],
      ]);
      expect(reset.steps).toEqual([expect.objectContaining({ kind: 'opened', comment: 'Practice, started again: the draft of version 2 was changed' })]);
      expect(await prisma.auditLog.findFirst({ where: { entityId: practice.benDraft, action: 'practice_reset' } })).toMatchObject({
        userId: users.hr,
        diff: { practice: true, version: 2, status: { from: 'manager', to: 'self_rating' } },
      });

      // published: it carries on, on the published version
      await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200);
      const carried = await card(practice.benDraft, sessions.superAdmin);
      expect(carried).toMatchObject({ templateVersion: 2, practice: { draft: false }, status: 'self_rating' });
      await post(`/kpis/practice/${practice.benDraft}/self`, sessions.superAdmin, { picks: picks(carried, 0), submit: true }).expect(200);
    });

    it('discarded, its practice scorecards are deleted with it (a Super Admin only)', async () => {
      const v3 = (await post(`/kpis/templates/job-titles/${titleId}/draft`, sessions.hr, { from: 'published' }).expect(201)).body as KpiTemplateView;
      const on = await start(sessions.hr, { employeeId: ids.omar });
      expect(on).toMatchObject({ templateVersion: 3, practice: { draft: true } });
      await del(`/kpis/templates/${v3.id}`, sessions.hr).expect(403);
      await del(`/kpis/templates/${v3.id}`, sessions.superAdmin).expect(204);
      expect(await prisma.kpiScorecard.findUnique({ where: { id: on.id } })).toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { entityId: on.id, action: 'delete' } })).toMatchObject({ userId: users.superAdmin, diff: { practice: true, reason: 'Its draft was discarded' } });
    });
  });

  describe('the real opening', () => {
    it('opens this month’s real scorecard on the 1st of next month though a practice one of the month exists', async () => {
      expect(await prisma.kpiScorecard.count({ where: { employeeId: ids.ben, month: toDateOnly(firstDay(CURRENT)), practice: true } })).toBe(2);
      await clock.runOnce(at(`${NEXT}-01`));
      const real = await prisma.kpiScorecard.findMany({ where: { employeeId: ids.ben, month: toDateOnly(firstDay(CURRENT)), practice: false } });
      expect(real).toHaveLength(1);
      expect(real[0]).toMatchObject({ status: 'self_rating', practiceById: null, practiceAt: null });
      // the real one is Ben's to see, told to him; the practice ones still aren't
      const mine = (await get('/kpis/scorecards/mine', sessions.ben).expect(200)).body as KpiScorecardSummary[];
      expect(mine.map((s) => s.id)).toEqual([real[0].id]);
      expect(mine[0].practice).toBeUndefined();
      await app.get(NotificationsService).flush();
      expect(await prisma.notification.count({ where: { userId: users.ben, kind: 'kpi_self_rating', link: `/kpis/scorecards/${real[0].id}` } })).toBe(1);
      // and the practice ones of the month are as they were
      expect((await prisma.kpiScorecard.findUniqueOrThrow({ where: { id: practice.benV1 } })).status).toBe('final');
      // a second real one for the month is refused by the database (the partial unique index)
      await expect(
        prisma.$executeRaw`
          INSERT INTO kpi_scorecards (id, employee_id, employment_id, month, template_id, status, scorer, manager_id, approver_role, attendance_achieved, attendance_source, updated_at)
          SELECT gen_random_uuid(), employee_id, employment_id, month, template_id, status, scorer, manager_id, approver_role, attendance_achieved, attendance_source, now()
          FROM kpi_scorecards WHERE id = ${real[0].id}::uuid`,
      ).rejects.toThrow(/kpi_scorecards_one_real_a_month|23505/);
    });
  });

  describe('deleting', () => {
    it('only a Super Admin deletes a practice scorecard, one or all (only theirs if they say), never a real one', async () => {
      await del(`/kpis/practice/${practice.benV1}`, sessions.hr).expect(403);
      await del('/kpis/practice', sessions.hr).expect(403);
      const real = await prisma.kpiScorecard.findFirstOrThrow({ where: { employeeId: ids.ben, practice: false } });
      expect(said(await del(`/kpis/practice/${real.id}`, sessions.superAdmin).expect(409))[0]).toBe('This is a real KPI scorecard: only a practice one can be deleted.');
      // nor are a real one's steps taken standing in
      await post(`/kpis/practice/${real.id}/self`, sessions.superAdmin, { picks: [], submit: false }).expect(404);

      await del(`/kpis/practice/${practice.benV1}`, sessions.superAdmin).expect(204);
      expect(await prisma.kpiScorecard.findUnique({ where: { id: practice.benV1 } })).toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { entityId: practice.benV1, action: 'delete' } })).toMatchObject({ userId: users.superAdmin, diff: { practice: true, status: 'final', month: CURRENT } });

      // only the Super Admin's own: Ben's on the draft (now version 2) and Clara's
      const own = (await del('/kpis/practice?mine=true', sessions.superAdmin).expect(200)).body as { deleted: number };
      expect(own.deleted).toBe(2);
      expect(await prisma.kpiScorecard.count({ where: { id: { in: [practice.benDraft, practice.clara] } } })).toBe(0);
      expect(await prisma.kpiScorecard.count({ where: { id: { in: [practice.benPrev, practice.omar, practice.omarPrev] } } })).toBe(3);
      // then every one left; the real one stays
      const rest = (await del('/kpis/practice', sessions.superAdmin).expect(200)).body as { deleted: number };
      expect(rest.deleted).toBeGreaterThanOrEqual(3);
      expect(await prisma.kpiScorecard.count({ where: { practice: true, employeeId: { in: people } } })).toBe(0);
      expect(await prisma.kpiScorecard.findUnique({ where: { id: real.id } })).not.toBeNull();
      expect(await prisma.auditLog.findFirst({ where: { entityId: practice.omar, action: 'delete' } })).toMatchObject({ diff: { practice: true, all: true } });
    });
  });
});
