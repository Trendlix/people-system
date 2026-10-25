import type { INestApplication } from '@nestjs/common';
import type { KpiFrameworkView, KpiJobTitleTemplates, KpiScorecardSummary, KpiScorecardView, KpiSettingsView, KpiTemplateView, PayrollRules, PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { KpiSchedulerService } from '../src/kpis/kpi-scheduler.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Attendance leaves the KPI (owner, 25 October 2026, asked whether attendance is cut twice, on the fixed part of the pay
// below the 90% grace and through the KPI's Attendance metric on the variable part: "Fixed cut only"). The company
// switch Attendance in the KPI on KPI Pillars, off from then: HR and a Super Admin switch it, audited. Switched off, the
// scorecards not yet final are worked out again without the Attendance metric (an open one with poor attendance scores
// as one with full attendance; the pillar it was alone in left out, its weight spread over the others), a final one
// keeps its result exactly, the next draft payroll's variable part follows the new final % once refreshed (its rules
// copying the switch, the legacy KPI average of the inputs typed without attendance), and an approved run never
// changes; the templates' Attendance points and the pillars' Attendance pillar aren't asked for. Switched on again, the
// Attendance metric counts again in the scorecards not final. The clock (KpiSchedulerService.runOnce) is run with a
// moment of the test's own. Every name is invented; the test deletes what it made and leaves the switch off.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
const at = (day: string) => new Date(`${day}T10:00:00Z`);

/** Three metrics, each worth 10 (a pick of 0 gives 10, 1 gives 5, 2 gives 0), none in Discipline & Growth: Attendance alone there, worth 20. */
const CONTENT = {
  attendancePoints: 20,
  metrics: (['delivery', 'quality', 'clients'] as const).map((pillar, i) => ({
    pillar,
    name: ['Reports on time', 'Data accuracy', 'Stakeholder feedback'][i],
    definition: null,
    howMeasured: null,
    jdDuty: null,
    targetPoints: 10,
    criteria: [
      { label: 'Best', points: 10 },
      { label: 'Middling', points: 5 },
      { label: 'Poor', points: 0 },
    ],
  })),
};

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('Attendance out of the KPI (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: KpiSchedulerService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const put = (path: string, session: string, body: object) => api().put(`/api${path}`).set('Cookie', session).send(body);
  const patch = (path: string, session: string, body: object) => api().patch(`/api${path}`).set('Cookie', session).send(body);
  const card = async (id: string, session: string) => (await get(`/kpis/scorecards/${id}`, session).expect(200)).body as KpiScorecardView;
  const switchTo = (on: boolean, session: string) => patch('/kpis/settings', session, { attendanceInKpi: on });

  let M: string;
  let P: string;
  const day = (n: number) => `${P}-${String(n).padStart(2, '0')}`;

  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const runIds: string[] = [];
  const cards: Record<string, string> = {};
  let deptId: string;
  let analystId: string;
  let otherTitleId: string;
  let v1: KpiTemplateView;
  let contracts = 0;
  let practiceId: string;
  let runM: string;
  let runP: string;
  let emailDomainBefore: string | null;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    return email;
  }

  async function person(key: string, email: string | null, employment: Record<string, unknown>, signed = true) {
    const name = `${key[0].toUpperCase()}${key.slice(1)} Outside ${RUN}`;
    const res = await post('/employees', sessions.hr, { fullNameEn: name, fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }) }).expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    const e = await prisma.employment.create({
      data: { employeeId: res.body.id, employmentType: 'full_time', status: 'active', joinDate: toDateOnly(firstDay(monthsLater(M, -1))), ...employment },
    });
    employments[key] = e.id;
    if (!signed) return;
    const start = firstDay(monthsLater(M, -1));
    await prisma.contract.create({
      data: {
        number: `KPA-${RUN}-${++contracts}`,
        employmentId: e.id,
        version: 1,
        form: 'fixed',
        startDate: toDateOnly(start),
        endDate: toDateOnly(addDays(addMonths(start, 12), -1)),
        durationMonths: 12,
        probationMonths: 0,
        grossSalary: 12_000,
        insuredSalary: 12_000,
        payBasis: 'monthly',
        status: 'active',
        signedOn: toDateOnly(start),
      },
    });
  }

  const picks = (view: Pick<KpiScorecardView, 'pillars'>, choices: number[]) => view.pillars.flatMap((p) => p.metrics).map((m, i) => ({ metricId: m.id, choice: choices[i] }));

  /** Self-rated by the employee, then scored by Mona: Reports on time middling (5 of 10), the rest the best. */
  async function rateAndScore(key: string) {
    const view = await card(cards[key], sessions[key]);
    await post(`/kpis/scorecards/${cards[key]}/self`, sessions[key], { picks: picks(view, [1, 0, 0]), submit: true }).expect(200);
    return (await post(`/kpis/scorecards/${cards[key]}/score`, sessions.mona, { picks: picks(view, [1, 0, 0]), comment: 'Good month', submit: true }).expect(200)).body as KpiScorecardView;
  }

  /** HR confirms the scoring, and both sign: final. */
  async function calibrateAndSign(key: string) {
    await post(`/kpis/scorecards/${cards[key]}/calibrate`, sessions.hr, { changes: [] }).expect(200);
    await post(`/kpis/scorecards/${cards[key]}/sign`, sessions[key], {}).expect(200);
    return (await post(`/kpis/scorecards/${cards[key]}/sign`, sessions.mona, {}).expect(200)).body as KpiScorecardView;
  }

  /** A scorecard's row as kept: what "never changes" means for a final one. */
  const kept = (id: string) =>
    prisma.kpiScorecard.findUniqueOrThrow({ where: { id }, select: { status: true, finalPercent: true, level: true, pillars: true, attendanceCounted: true, attendanceAchieved: true, updatedAt: true } });

  type Line = { id: string; employeeId: string; terms: PayrollTerms; result: { kpiScore: number; kpiCut: number; attendanceCut: number } };
  const runOf = async (id: string) => (await get(`/payroll/runs/${id}`, sessions.hr).expect(200)).body as { status: string; rules: PayrollRules; lines: Line[] };
  const lineOf = (lines: Line[], key: string) => lines.find((l) => l.employeeId === ids[key])!;
  /** Lou's line as one made before the KPIs module (its terms without a KPI), its performance typed: worked out with the run's rules. */
  async function typedLegacy(runId: string, performance: number) {
    const line = lineOf((await runOf(runId)).lines, 'lou');
    const { kpi: _kpi, ...terms } = line.terms;
    await prisma.payrollLine.update({ where: { id: line.id }, data: { terms: terms as object } });
    await patch(`/payroll/runs/${runId}/lines`, sessions.hr, { lines: [{ id: line.id, inputs: { performance } }] }).expect(200);
    return lineOf((await runOf(runId)).lines, 'lou');
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    clock = app.get(KpiSchedulerService);
    for (const offset of [-10, -9, -8, -7, -6, -5, -4, -3]) {
      const m = monthsLater(CURRENT, offset);
      const taken = await prisma.payrollRun.count({ where: { month: { in: [toDateOnly(firstDay(m)), toDateOnly(firstDay(monthsLater(m, 1)))] } } });
      if (!taken) {
        M = m;
        P = monthsLater(m, 1);
        break;
      }
    }
    if (!M) throw new Error('No two months in a row without a payroll run for the tests.');

    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    const monaEmail = await account('mona', ['manager']);
    const emails: Record<string, string> = {};
    for (const key of ['pat', 'ada', 'fin']) emails[key] = await account(key, ['employee']);

    // the sign-in emails are the tests' own: no company email domain while they are given
    emailDomainBefore = (await get('/company', sessions.hr).expect(200)).body.emailDomain;
    await patch('/company', sessions.hr, { emailDomain: '' }).expect(200);
    deptId = (await post('/departments', sessions.hr, { nameEn: `KPI Out ${RUN}` }).expect(201)).body.id;
    analystId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `KPI Out Analyst ${RUN}` }).expect(201)).body.id;
    otherTitleId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `KPI Out Other ${RUN}` }).expect(201)).body.id;
    const shiftA = (await prisma.shift.findUniqueOrThrow({ where: { code: 'A' } })).id;

    await person('mona', monaEmail, { departmentId: deptId }, false);
    // Pat and Fin on a shift, their attendance half of it in M; Ada not tracked (counts in full); Lou without a template
    await person('pat', emails.pat, { departmentId: deptId, jobTitleId: analystId, managerId: ids.mona, shiftId: shiftA });
    await person('fin', emails.fin, { departmentId: deptId, jobTitleId: analystId, managerId: ids.mona, shiftId: shiftA });
    await person('ada', emails.ada, { departmentId: deptId, jobTitleId: analystId, managerId: ids.mona }, false);
    await person('lou', null, { departmentId: deptId, jobTitleId: otherTitleId });
  });

  afterAll(async () => {
    await app.get(NotificationsService).flush();
    await prisma.kpiSettings.upsert({ where: { id: 1 }, update: { attendanceInKpi: false }, create: { id: 1, attendanceInKpi: false } });
    await prisma.kpiScorecard.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.kpiTemplate.deleteMany({ where: { jobTitleId: { in: [analystId, otherTitleId].filter(Boolean) } } });
    await prisma.kpiFramework.deleteMany({ where: { departmentId: deptId } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: [analystId, otherTitleId].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await patch('/company', sessions.hr, { emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('is off from 25 October 2026; HR switches it on (audited), nobody else', async () => {
    expect((await get('/kpis/settings', sessions.pat).expect(200)).body).toMatchObject({ attendanceInKpi: false });
    for (const who of ['pat', 'mona', 'ceo']) await switchTo(true, sessions[who]).expect(403);
    expect(said(await patch('/kpis/settings', sessions.hr, { attendanceInKpi: 'yes' }).expect(400))).toEqual(['Say whether attendance counts in the KPI: on or off.']);
    const on = (await switchTo(true, sessions.hr).expect(200)).body as KpiSettingsView;
    expect(on).toMatchObject({ attendanceInKpi: true, selfRatingDay: 3, updatedBy: { email: expect.any(String) } });
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_settings' }, orderBy: { id: 'desc' } });
    expect(audit).toMatchObject({ action: 'update', userId: users.hr, diff: { attendanceInKpi: { from: false, to: true }, rescored: expect.any(Number) } });
    // the same again changes nothing, and logs nothing
    await switchTo(true, sessions.hr).expect(200);
    expect((await prisma.auditLog.findFirst({ where: { entityType: 'kpi_settings' }, orderBy: { id: 'desc' } }))!.id).toBe(audit!.id);
  });

  it('while on: the template, M’s payroll for the attendance (approved), the scorecards opened with Attendance counting', async () => {
    const draft = (await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
    await put(`/kpis/templates/${draft.id}`, sessions.hr, CONTENT).expect(200);
    v1 = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body;
    await prisma.kpiTemplate.update({ where: { id: v1.id }, data: { opensFrom: toDateOnly(firstDay(P)) } });

    // M's run: Pat and Fin worked half their shift's hours; the CEO approves it
    const run = (await post('/payroll/runs', sessions.hr, { month: M }).expect(201)).body as { id: string; rules: PayrollRules; lines: { id: string; employeeId: string; result: { expectedHours: number } }[] };
    runM = run.id;
    runIds.push(run.id);
    expect(run.rules.kpiIncludesAttendance).toBe(true);
    const half = (key: string) => {
      const line = run.lines.find((l) => l.employeeId === ids[key])!;
      return { id: line.id, inputs: { workedHours: line.result.expectedHours / 2 } };
    };
    await patch(`/payroll/runs/${runM}/lines`, sessions.hr, { lines: [half('pat'), half('fin')] }).expect(200);
    await post(`/payroll/runs/${runM}/submit`, sessions.hr).expect(200);
    await post(`/payroll/runs/${runM}/approve`, sessions.ceo).expect(200);

    expect(await clock.runOnce(at(day(1)))).toMatchObject({ month: M });
    const opened = await prisma.kpiScorecard.findMany({ where: { employeeId: { in: people }, month: toDateOnly(firstDay(M)), practice: false }, select: { id: true, employeeId: true, attendanceCounted: true } });
    for (const key of ['pat', 'ada', 'fin']) {
      const c = opened.find((o) => o.employeeId === ids[key])!;
      cards[key] = c.id;
      expect(c.attendanceCounted).toBe(true);
    }
    expect((await card(cards.pat, sessions.pat)).attendance).toEqual({ points: 20, achieved: 10, ratio: 0.5, score: 0.5, source: 'payroll', counted: true });
    expect((await card(cards.ada, sessions.ada)).attendance).toMatchObject({ achieved: 20, source: 'none', counted: true });

    // a practice scorecard follows the switch too
    practiceId = ((await post('/kpis/practice', sessions.hr, { employeeId: ids.ada, month: M }).expect(201)).body as KpiScorecardView).id;
    expect((await card(practiceId, sessions.hr)).attendance.counted).toBe(true);
  });

  it('while on, poor attendance lowers the KPI: Pat 75%, Ada (full) 85%; Fin’s is final at 75%', async () => {
    // Reports on time 5/10 × 30 + 25 + 25 + Discipline & Growth (Attendance alone) 10/20 × 20 = 15 + 50 + 10
    expect(await rateAndScore('pat')).toMatchObject({ status: 'hr', finalPercent: 75 });
    expect(await rateAndScore('ada')).toMatchObject({ status: 'hr', finalPercent: 85 });
    expect(await rateAndScore('fin')).toMatchObject({ status: 'hr', finalPercent: 75 });
    expect(await calibrateAndSign('fin')).toMatchObject({ status: 'final', finalPercent: 75 });
  });

  it('while on, a draft payroll for P takes Fin’s final 75% (25% of the variable cut) and averages attendance into typed KPI inputs', async () => {
    const run = (await post('/payroll/runs', sessions.hr, { month: P }).expect(201)).body as { id: string };
    runP = run.id;
    runIds.push(run.id);
    const { rules, lines } = await runOf(runP);
    expect(rules.kpiIncludesAttendance).toBe(true);
    expect(lineOf(lines, 'fin').terms.kpi).toEqual({ month: M, scorecardId: cards.fin, finalPercent: 75, level: 'needs_improvement', attendanceCounted: true });
    expect(lineOf(lines, 'fin').result).toMatchObject({ kpiScore: 0.75, kpiCut: 600 });
    expect(lineOf(lines, 'pat').terms.kpi).toBeNull();
    // a line with KPI inputs typed: (attendance not tracked, 100% + 60%) ÷ 2 = 80%, in full
    expect((await typedLegacy(runP, 60)).result).toMatchObject({ kpiScore: 1, kpiCut: 0 });
    // the Attendance pillar can't be left out while it counts
    expect(said(await put('/kpis/framework', sessions.hr, { departmentId: deptId, appliesFrom: NEXT, pillars: twoPillars }).expect(400))).toEqual(['Choose the pillar the Attendance metric counts in.']);
  });

  /** A department's own pillars without the Attendance metric's (Discipline & Growth). */
  const twoPillars = [
    { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 60 },
    { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 40 },
  ];

  describe('switched off', () => {
    let finBefore: Awaited<ReturnType<typeof kept>>;
    let runMBefore: unknown;

    beforeAll(async () => {
      finBefore = await kept(cards.fin);
      runMBefore = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runM }, select: { status: true, rules: true, lines: { orderBy: { id: 'asc' }, select: { terms: true, inputs: true, result: true } } } });
    });

    it('HR switches it off: the scorecards not final are worked out again, each in the audit log', async () => {
      const off = (await switchTo(false, sessions.hr).expect(200)).body as KpiSettingsView;
      expect(off.attendanceInKpi).toBe(false);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_settings' }, orderBy: { id: 'desc' } });
      expect(audit).toMatchObject({ action: 'update', userId: users.hr, diff: { attendanceInKpi: { from: true, to: false } } });
      expect((audit!.diff as { rescored: number }).rescored).toBeGreaterThanOrEqual(2);
      const rescored = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_scorecard', entityId: cards.pat }, orderBy: { id: 'desc' } });
      expect(rescored).toMatchObject({
        action: 'update',
        userId: users.hr,
        diff: { month: M, attendanceCounted: false, finalPercent: { from: 75, to: 81.3 }, reason: 'Attendance in the KPI switched off: the KPI is performance only' },
      });
    });

    it('an open scorecard with poor attendance now scores as one with full attendance: performance only', async () => {
      // (15 + 25 + 25) × 100 ÷ 80: Discipline & Growth (Attendance alone) left out, its 20% spread over the others
      for (const key of ['pat', 'ada']) {
        const view = await card(cards[key], sessions.hr);
        expect(view).toMatchObject({ status: 'hr', finalPercent: 81.3, level: 'needs_improvement', attendance: { counted: false } });
        expect(view.pillars[3]).toMatchObject({ key: 'discipline', max: 0, leftOut: true });
        expect(view.score!.pillars[3]).toMatchObject({ key: 'discipline', leftOut: true });
        expect((await prisma.kpiScorecard.findUniqueOrThrow({ where: { id: cards[key] } })).pillars).toEqual({ delivery: 50, quality: 100, clients: 100, discipline: null });
      }
      const all = (await get(`/kpis/scorecards?scope=all&month=${M}`, sessions.hr).expect(200)).body as KpiScorecardSummary[];
      expect(all.find((s) => s.id === cards.pat)).toMatchObject({ finalPercent: 81.3 });
      expect((await card(practiceId, sessions.hr)).attendance.counted).toBe(false);
    });

    it('a final scorecard keeps its result exactly; an approved run never changes', async () => {
      expect(await kept(cards.fin)).toEqual(finBefore);
      expect(await card(cards.fin, sessions.fin)).toMatchObject({ status: 'final', finalPercent: 75, attendance: { counted: true } });
      expect(await prisma.payrollRun.findUniqueOrThrow({ where: { id: runM }, select: { status: true, rules: true, lines: { orderBy: { id: 'asc' }, select: { terms: true, inputs: true, result: true } } } })).toEqual(
        runMBefore,
      );
      await post(`/payroll/runs/${runM}/refresh`, sessions.hr).expect(409);
    });

    it('the steps after it score without it: Pat calibrated and signed is final at 81.3%', async () => {
      expect(await calibrateAndSign('pat')).toMatchObject({ status: 'final', finalPercent: 81.3, attendance: { counted: false } });
    });

    it('the draft payroll, refreshed, follows the new final %: Pat’s variable part in full; its rules copy the switch', async () => {
      await post(`/payroll/runs/${runP}/refresh`, sessions.hr).expect(200);
      const { rules, lines } = await runOf(runP);
      expect(rules.kpiIncludesAttendance).toBe(false);
      expect(lineOf(lines, 'pat').terms.kpi).toEqual({ month: M, scorecardId: cards.pat, finalPercent: 81.3, level: 'needs_improvement', attendanceCounted: false });
      // 81.3% is at or above 80%: no cut (at 75% it would have been 600)
      expect(lineOf(lines, 'pat').result).toMatchObject({ kpiScore: 1, kpiCut: 0 });
      // Fin's final 75% as it was
      expect(lineOf(lines, 'fin').result).toMatchObject({ kpiScore: 0.75, kpiCut: 600 });
      // the KPI inputs typed alone now: 61%, so 2,400 × 39% = 936
      expect((await typedLegacy(runP, 61)).result).toMatchObject({ kpiScore: 0.61, kpiCut: 936 });
    });

    it('the templates no longer ask for the Attendance points, kept as they are', async () => {
      const page = (await get(`/kpis/templates/job-titles/${analystId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates;
      expect(page.attendanceInKpi).toBe(false);
      const draft = (await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'published' }).expect(201)).body as KpiTemplateView;
      expect(draft.problems).toEqual([]);
      const saved = (await put(`/kpis/templates/${draft.id}`, sessions.hr, { ...CONTENT, attendancePoints: 0 }).expect(200)).body as KpiTemplateView;
      expect(saved).toMatchObject({ attendancePoints: 20, problems: [] });
      await put(`/kpis/templates/${draft.id}`, sessions.hr, { ...CONTENT, attendancePoints: 30 }).expect(200);
      expect((await get(`/kpis/templates/${draft.id}`, sessions.hr).expect(200)).body).toMatchObject({ attendancePoints: 30 });
      await api().delete(`/api/kpis/templates/${draft.id}`).set('Cookie', sessions.superAdmin).expect(204);
    });

    it('nor the pillar the Attendance metric counts in: one is kept for when it comes back', async () => {
      expect(((await get('/kpis/framework', sessions.hr).expect(200)).body as KpiFrameworkView).attendanceInKpi).toBe(false);
      const saved = (await put('/kpis/framework', sessions.hr, { departmentId: deptId, appliesFrom: NEXT, pillars: twoPillars, nextId: null }).expect(200)).body as KpiFrameworkView;
      const own = saved.departments.find((d) => d.department.id === deptId)!;
      // neither Discipline & Growth nor any pillar replaced: the last one
      expect(own.next).toMatchObject({ appliesFrom: NEXT, attendancePillar: 'quality' });
    });
  });

  it('a Super Admin switches it on again: the Attendance metric counts again in the scorecards not final', async () => {
    const patBefore = await kept(cards.pat);
    const finBefore = await kept(cards.fin);
    expect((await switchTo(true, sessions.superAdmin).expect(200)).body).toMatchObject({ attendanceInKpi: true });
    const ada = await card(cards.ada, sessions.hr);
    expect(ada).toMatchObject({ status: 'hr', finalPercent: 85, attendance: { counted: true, achieved: 20 } });
    expect(ada.pillars[3]).toMatchObject({ key: 'discipline', max: 20, achieved: 20 });
    expect(ada.pillars[3]).not.toHaveProperty('leftOut');
    expect((await card(practiceId, sessions.hr)).attendance.counted).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_scorecard', entityId: cards.ada }, orderBy: { id: 'desc' } });
    expect(audit).toMatchObject({ userId: users.superAdmin, diff: { attendanceCounted: true, finalPercent: { from: 81.3, to: 85 } } });
    // the final ones keep theirs: Pat's 81.3% without attendance, Fin's 75% with it
    expect(await kept(cards.pat)).toEqual(patBefore);
    expect(await kept(cards.fin)).toEqual(finBefore);
    await switchTo(false, sessions.hr).expect(200);
  });
});
