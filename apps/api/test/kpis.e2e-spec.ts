import type { INestApplication } from '@nestjs/common';
import type { KpiCounts, KpiHeatmap, KpiJobTitleTemplates, KpiOverview, KpiScorecardSummary, KpiScorecardView, KpiTemplateRow, KpiTemplateView, PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, addMonths, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { KpiSchedulerService } from '../src/kpis/kpi-scheduler.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// KPIs (owner, 21 October 2026: "lets start with the KPI's First"; "Full framework per role", "Self, manager, HR,
// sign-off", "Attendance: Yes, as the sheet", "Last month's KPI, this pay", "As the sheet: full at 80%+", "Templates:
// HR"): the KPI settings; HR building a job title's template, a draft and published versions, publishing applying to
// the scorecards opened from next month, samples and copies, managers reading their team's; a month M's scorecards
// opened on the 1st of M + 1 for everyone under a job title with a template in force (not freelancers or unpaid interns,
// part-timers yes), the Attendance metric from the month's payroll line; the steps with their roles: the employee's
// self-rating, the direct manager's scoring, a team lead standing in, HR scoring for someone with nobody in charge, HR's
// calibration with a reason, the sign-off, a missed self-rating noted, final on the 10th unsigned; a C-level person's
// scored by the CEO and hidden from HR; the payroll of M + 1 reading M's final %: 85% no cut, 70% 30% of the variable
// cut, none no cut, a run with the CEO keeping its figures and a draft taking the KPI on refresh; the notifications, the
// reminders, the overview, the heatmap, the Excel and the audit log. The clock (KpiSchedulerService.runOnce) is run with
// moments of the test's own. Every name is invented; the test deletes what it made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
/** A moment on a day, at noon in Cairo whatever the season. */
const at = (day: string) => new Date(`${day}T10:00:00Z`);

/**
 * The template's three metrics, each worth 10: a pick of 0 gives 10, 1 gives 5, 2 gives 0; Attendance worth 20. The
 * first measures several JD duties (owner, 25 October 2026: "Yes, several duties"), two of the JD's rows and one typed;
 * the second its one duty as a client from before sends it (`jdDuty`).
 */
const DUTIES = ['Deliver reports on time', 'Keep data accurate', 'Send each report to its readers'];
const CONTENT = {
  attendancePoints: 20,
  metrics: [
    {
      pillar: 'delivery',
      name: 'Reports on time',
      definition: 'Monthly reports delivered by their date',
      howMeasured: 'Delivered against due dates',
      jdDuties: DUTIES,
      targetPoints: 10,
      criteria: [
        { label: 'All on time', points: 10 },
        { label: '1 late', points: 5 },
        { label: '2+ late', points: 0 },
      ],
    },
    {
      pillar: 'quality',
      name: 'Data accuracy',
      definition: null,
      howMeasured: 'Errors found in review',
      jdDuty: 'Keep data accurate',
      targetPoints: 10,
      criteria: [
        { label: 'No errors', points: 10 },
        { label: 'Some errors', points: 5 },
        { label: 'Many errors', points: 0 },
      ],
    },
    {
      pillar: 'clients',
      name: 'Stakeholder feedback',
      definition: null,
      howMeasured: null,
      jdDuty: null,
      targetPoints: 10,
      criteria: [
        { label: 'Great', points: 10 },
        { label: 'Fine', points: 5 },
        { label: 'Poor', points: 0 },
      ],
    },
  ],
};

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('KPIs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: KpiSchedulerService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const put = (path: string, session: string, body: object) => api().put(`/api${path}`).set('Cookie', session).send(body);
  const card = async (id: string, session: string) => (await get(`/kpis/scorecards/${id}`, session).expect(200)).body as KpiScorecardView;

  // the month scored (M) and the payroll it counts in (P = M + 1): months with no payroll run yet
  let M: string;
  let P: string;
  const day = (n: number) => `${P}-${String(n).padStart(2, '0')}`;

  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const runIds: string[] = [];
  let deptId: string;
  let teamId: string;
  let analystId: string;
  let otherTitleId: string;
  let designerId: string;
  let v1: KpiTemplateView;
  let v2: KpiTemplateView;
  let g9Before: boolean;
  let emailDomainBefore: string | null;
  let contracts = 0;
  /** Each person's scorecard of month M. */
  const cards: Record<string, string> = {};

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    return email;
  }

  /** A person with a sign-in (or none), employed from the month before M (prisma, as the hiring forms would). */
  async function person(key: string, name: string, email: string | null, employment: Record<string, unknown>) {
    const res = await api()
      .post('/api/employees')
      .set('Cookie', sessions.hr)
      .send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...(email && { workEmail: email }) })
      .expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    const e = await prisma.employment.create({
      data: { employeeId: res.body.id, employmentType: 'full_time', status: 'active', joinDate: toDateOnly(firstDay(monthsLater(M, -1))), ...employment },
    });
    employments[key] = e.id;
  }

  /** A signed contract of 12,000 a month (80% fixed) from the month before M, for a year. */
  async function contract(key: string) {
    const start = firstDay(monthsLater(M, -1));
    await prisma.contract.create({
      data: {
        number: `KPI-${RUN}-${++contracts}`,
        employmentId: employments[key],
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

  /** The picks of the template's three metrics, by criterion index. */
  const picks = (view: Pick<KpiScorecardView, 'pillars'>, choices: (number | null)[], comment: string | null = null) =>
    view.pillars.flatMap((p) => p.metrics).map((m, i) => ({ metricId: m.id, choice: choices[i], ...(comment && i === 0 && { comment }) }));

  const notes = (userKey: string, kind: string) => prisma.notification.findMany({ where: { userId: users[userKey], kind }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // the Attendance metric counting in the KPI, as it did until 25 October 2026 ("Fixed cut only": off since, tested in
    // kpi-without-attendance.e2e-spec.ts): switched on for these tests, off again after them
    await prisma.kpiSettings.upsert({ where: { id: 1 }, update: { attendanceInKpi: true }, create: { id: 1, attendanceInKpi: true } });
    clock = app.get(KpiSchedulerService);
    // two months in a row with no payroll run: M, whose run is made here for the attendance, and P = M + 1
    for (const offset of [-10, -9, -8, -7, -6, -5, -4, -3]) {
      const m = monthsLater(CURRENT, offset);
      const taken = await prisma.payrollRun.count({ where: { month: { in: [toDateOnly(firstDay(m)), toDateOnly(firstDay(monthsLater(m, 1)))] } } });
      if (!taken) {
        M = m;
        P = monthsLater(m, 1);
        break;
      }
    }
    if (!M) throw new Error('No two months in a row without a payroll run for the KPI tests.');

    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    const monaEmail = await account('mona', ['manager']);
    const emails: Record<string, string> = {};
    for (const key of ['ben', 'nora', 'leo', 'omar', 'tia', 'tom', 'clara', 'sam']) emails[key] = await account(key, ['employee']);

    emailDomainBefore = (await get('/company', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    const g9 = await prisma.grade.findUniqueOrThrow({ where: { code: 'G9' } });
    g9Before = g9.confidential;
    await prisma.grade.update({ where: { id: g9.id }, data: { confidential: true } });

    deptId = (await post('/departments', sessions.hr, { nameEn: `KPI Dept ${RUN}` }).expect(201)).body.id;
    teamId = (await post('/departments', sessions.hr, { nameEn: `KPI Team ${RUN}`, parentId: deptId }).expect(201)).body.id;
    analystId = (
      await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `KPI Analyst ${RUN}`, jdDuties: '<ul><li>Deliver reports on time</li><li>Keep data accurate</li></ul>' }).expect(201)
    ).body.id;
    otherTitleId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `KPI Other ${RUN}` }).expect(201)).body.id;
    designerId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `KPI Designer ${RUN}` }).expect(201)).body.id;
    const shiftA = (await prisma.shift.findUniqueOrThrow({ where: { code: 'A' } })).id;

    await person('mona', 'Mona Manager', monaEmail, { departmentId: deptId });
    await person('leo', 'Leo Lead', emails.leo, { departmentId: teamId });
    await prisma.department.update({ where: { id: teamId }, data: { headId: ids.leo } });
    await person('ben', 'Ben Rated', emails.ben, { departmentId: deptId, jobTitleId: analystId, managerId: ids.mona });
    await person('nora', 'Nora Teamed', emails.nora, { departmentId: teamId, jobTitleId: analystId });
    await person('omar', 'Omar Alone', emails.omar, { departmentId: deptId, jobTitleId: analystId });
    await person('tia', 'Tia Timed', emails.tia, { departmentId: deptId, jobTitleId: analystId, managerId: ids.mona, shiftId: shiftA });
    await person('tom', 'Tom Parttime', emails.tom, { departmentId: deptId, jobTitleId: analystId, managerId: ids.mona, employmentType: 'part_time' });
    await person('clara', 'Clara Chief', emails.clara, { departmentId: deptId, jobTitleId: analystId, gradeId: g9.id });
    await person('sam', 'Sam Other', emails.sam, { departmentId: deptId, jobTitleId: otherTitleId });
    await person('fay', 'Fay Freelance', null, { departmentId: deptId, jobTitleId: analystId, employmentType: 'freelance' });
    await person('ian', 'Ian Intern', null, { departmentId: deptId, jobTitleId: analystId, employmentType: 'intern' });
    for (const key of ['ben', 'nora', 'sam', 'tia']) await contract(key);
  });

  afterAll(async () => {
    await prisma.kpiSettings.update({ where: { id: 1 }, data: { attendanceInKpi: false } });
    await app.get(NotificationsService).flush();
    await prisma.kpiScorecard.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.kpiTemplate.deleteMany({ where: { jobTitleId: { in: [analystId, otherTitleId, designerId].filter(Boolean) } } });
    await prisma.payrollRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.department.updateMany({ where: { id: { in: [deptId, teamId].filter(Boolean) } }, data: { headId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: [analystId, otherTitleId, designerId].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: teamId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await prisma.grade.update({ where: { code: 'G9' }, data: { confidential: g9Before } });
    await prisma.kpiSettings.update({ where: { id: 1 }, data: { selfRatingDay: 3, managerDay: 6, hrDay: 8, signOffDay: 10 } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the settings', () => {
    it('shows everyone the deadlines; HR changes them, each after the one before; the audit log has it', async () => {
      expect((await get('/kpis/settings', sessions.ben).expect(200)).body).toMatchObject({ selfRatingDay: 3, managerDay: 6, hrDay: 8, signOffDay: 10 });
      await api().patch('/api/kpis/settings').set('Cookie', sessions.ben).send({ signOffDay: 12 }).expect(403);
      expect(said(await api().patch('/api/kpis/settings').set('Cookie', sessions.hr).send({ managerDay: 2 }).expect(400))).toEqual([
        'The manager’s scoring must be due after the self-rating: choose a later day.',
      ]);
      const changed = (await api().patch('/api/kpis/settings').set('Cookie', sessions.hr).send({ signOffDay: 12 }).expect(200)).body;
      expect(changed).toMatchObject({ signOffDay: 12, updatedBy: { email: expect.any(String) } });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_settings' }, orderBy: { id: 'desc' } });
      expect(audit).toMatchObject({ action: 'update', userId: users.hr, diff: { signOffDay: { from: 10, to: 12 } } });
      await api().patch('/api/kpis/settings').set('Cookie', sessions.hr).send({ signOffDay: 10 }).expect(200);
    });
  });

  describe('templates and versions', () => {
    it('HR starts a draft, saves its metrics (every problem said), and publishes it: it applies from next month', async () => {
      const rows = (await get('/kpis/templates', sessions.hr).expect(200)).body as KpiTemplateRow[];
      expect(rows.find((r) => r.jobTitle.id === analystId)).toMatchObject({ inForce: null, upcoming: null, draft: null, versions: 0, people: 6 });
      await get('/kpis/templates', sessions.ben).expect(403);
      await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.ben, { from: 'blank' }).expect(403);

      const draft = (await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(draft).toMatchObject({ version: 1, status: 'draft', attendancePoints: 20, metrics: [], opensFrom: null });
      expect(draft.problems).toContain('Add a metric to Delivery & Timeliness: every pillar is scored.');
      expect(said(await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(400))).toContain('Add a metric to Quality of Work: every pillar is scored.');
      expect(said(await put(`/kpis/templates/${draft.id}`, sessions.hr, { attendancePoints: 20, metrics: [{ ...CONTENT.metrics[0], name: ' ' }] }).expect(400))).toEqual([
        'Metric 1: give it a name.',
      ]);
      // its JD duties: a list of texts, at most 10, each at most 300 characters
      const withDuties = (jdDuties: unknown) => ({ attendancePoints: 20, metrics: [{ ...CONTENT.metrics[0], jdDuties }] });
      expect(said(await put(`/kpis/templates/${draft.id}`, sessions.hr, withDuties(Array.from({ length: 11 }, (_, i) => `Duty ${i + 1}`))).expect(400))).toEqual([
        'Metric 1 (Reports on time): link it to at most 10 JD duties.',
      ]);
      expect(said(await put(`/kpis/templates/${draft.id}`, sessions.hr, withDuties(['Deliver reports on time', 'x'.repeat(301)])).expect(400))).toEqual([
        'Metric 1 (Reports on time): its JD duty 2 can be at most 300 characters.',
      ]);
      expect(said(await put(`/kpis/templates/${draft.id}`, sessions.hr, withDuties([{ duty: 'Deliver reports on time' }])).expect(400))).toEqual([
        'Metric 1 (Reports on time): its JD duties must be a list of texts.',
      ]);
      const saved = (await put(`/kpis/templates/${draft.id}`, sessions.hr, CONTENT).expect(200)).body as KpiTemplateView;
      expect(saved.metrics.map((m) => [m.pillar, m.name, m.targetPoints, m.criteria.length])).toEqual([
        ['delivery', 'Reports on time', 10, 3],
        ['quality', 'Data accuracy', 10, 3],
        ['clients', 'Stakeholder feedback', 10, 3],
      ]);
      expect(saved.problems).toEqual([]);
      // every duty kept, tidied (one sent twice in another case kept once); the old client's one duty as a list of it
      expect(saved.metrics.map((m) => m.jdDuties)).toEqual([DUTIES, ['Keep data accurate'], []]);
      expect(saved.metrics.some((m) => 'jdDuty' in m)).toBe(false);
      const again = (await put(`/kpis/templates/${draft.id}`, sessions.hr, withDuties([...DUTIES, ' send EACH report to its readers '])).expect(200)).body as KpiTemplateView;
      expect(again.metrics[0].jdDuties).toEqual(DUTIES);
      await put(`/kpis/templates/${draft.id}`, sessions.hr, CONTENT).expect(200);
      // the first is kept as its one duty too, for a build from before
      expect(await prisma.kpiMetric.findMany({ where: { templateId: draft.id }, orderBy: { position: 'asc' }, select: { jdDuty: true, jdDuties: true } })).toEqual([
        { jdDuty: 'Deliver reports on time', jdDuties: DUTIES },
        { jdDuty: 'Keep data accurate', jdDuties: ['Keep data accurate'] },
        { jdDuty: null, jdDuties: [] },
      ]);

      v1 = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body;
      expect(v1).toMatchObject({ version: 1, status: 'published', opensFrom: `${NEXT}-01`, firstMonth: CURRENT, inForce: false, problems: [] });
      // a published version is never changed
      expect(said(await put(`/kpis/templates/${v1.id}`, sessions.hr, CONTENT).expect(409))[0]).toBe("Version 1 is published, so it can't be changed: start a draft from it instead.");

      const actions = (await prisma.auditLog.findMany({ where: { entityType: 'kpi_template', entityId: v1.id }, orderBy: { id: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['create', 'update', 'update', 'update', 'publish']);
      expect(v1.metrics[0].jdDuties).toEqual(DUTIES);

      // a metric kept before several duties (25 October 2026), its one duty in jd_duty alone, reads as a list of it
      await prisma.kpiMetric.update({ where: { id: v1.metrics[2].id }, data: { jdDuty: 'Keep stakeholders informed', jdDuties: [] } });
      const kept = (await get(`/kpis/templates/${v1.id}`, sessions.hr).expect(200)).body as KpiTemplateView;
      expect(kept.metrics.map((m) => m.jdDuties)).toEqual([DUTIES, ['Keep data accurate'], ['Keep stakeholders informed']]);
    });

    it('a second version starts from a copy of the published one, one draft at a time, and keeps the history', async () => {
      const draft = (await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'published' }).expect(201)).body as KpiTemplateView;
      expect(draft).toMatchObject({ version: 2, status: 'draft', attendancePoints: 20 });
      expect(draft.metrics.map((m) => m.name)).toEqual(v1.metrics.map((m) => m.name));
      expect(draft.metrics.map((m) => m.id)).not.toEqual(v1.metrics.map((m) => m.id));
      expect(said(await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'blank' }).expect(409))[0]).toContain('has a draft already');
      await put(`/kpis/templates/${draft.id}`, sessions.hr, { ...CONTENT, attendancePoints: 25 }).expect(200);
      // a change of its JD duties alone is audited as any edit of a draft is
      const fewer = { ...CONTENT, attendancePoints: 25, metrics: [{ ...CONTENT.metrics[0], jdDuties: DUTIES.slice(0, 2) }, ...CONTENT.metrics.slice(1)] };
      expect(((await put(`/kpis/templates/${draft.id}`, sessions.hr, fewer).expect(200)).body as KpiTemplateView).metrics[0].jdDuties).toEqual(DUTIES.slice(0, 2));
      const edit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_template', entityId: draft.id, action: 'update' }, orderBy: { id: 'desc' } });
      expect(edit).toMatchObject({ userId: users.hr, diff: { jobTitleId: analystId, version: 2 } });
      v2 = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body;
      expect(v2).toMatchObject({ version: 2, attendancePoints: 25, opensFrom: `${NEXT}-01` });

      // as if v1 had been published in the month M was scored in: the scorecards opened on the 1st of P use it
      await prisma.kpiTemplate.update({ where: { id: v1.id }, data: { opensFrom: toDateOnly(firstDay(P)) } });
      const row = ((await get('/kpis/templates', sessions.hr).expect(200)).body as KpiTemplateRow[]).find((r) => r.jobTitle.id === analystId)!;
      expect(row).toMatchObject({ inForce: { id: v1.id, version: 1, metrics: 3 }, upcoming: { id: v2.id, version: 2, opensFrom: `${NEXT}-01` }, draft: null, versions: 2 });

      const page = (await get(`/kpis/templates/job-titles/${analystId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates;
      expect(page.jobTitle.duties).toEqual(['Deliver reports on time', 'Keep data accurate']);
      expect(page.jobTitle.jdDuties).toContain('<li>Deliver reports on time</li>');
      expect(page.versions.map((v) => [v.version, v.inForce])).toEqual([
        [2, false],
        [1, true],
      ]);
      expect(page.canEdit).toBe(true);
    });

    it('offers the samples and copies from another job title; only a Super Admin discards a draft', async () => {
      const samples = (await get('/kpis/templates/samples', sessions.hr).expect(200)).body as { code: string; role: string }[];
      expect(samples.map((s) => s.role)).toEqual(['Senior Frontend Developer', 'Video Producer', 'HR Specialist']);
      const fromSample = (await post(`/kpis/templates/job-titles/${designerId}/draft`, sessions.hr, { from: 'sample', sampleCode: 'HR-SP v3' }).expect(201)).body as KpiTemplateView;
      expect(fromSample).toMatchObject({ version: 1, attendancePoints: 20, problems: [] });
      expect(fromSample.metrics).toHaveLength(8);
      await api().delete(`/api/kpis/templates/${fromSample.id}`).set('Cookie', sessions.hr).expect(403);
      await api().delete(`/api/kpis/templates/${fromSample.id}`).set('Cookie', sessions.superAdmin).expect(204);
      await api().delete(`/api/kpis/templates/${v1.id}`).set('Cookie', sessions.superAdmin).expect(409);
      const copied = (await post(`/kpis/templates/job-titles/${designerId}/draft`, sessions.hr, { from: 'template', templateId: v1.id }).expect(201)).body as KpiTemplateView;
      expect(copied.metrics.map((m) => m.name)).toEqual(['Reports on time', 'Data accuracy', 'Stakeholder feedback']);
      expect(copied.version).toBe(1);
    });

    it('a manager and the people under a job title read its published versions; anyone else is told it is not there', async () => {
      const managers = (await get(`/kpis/templates/job-titles/${analystId}`, sessions.mona).expect(200)).body as KpiJobTitleTemplates;
      expect(managers).toMatchObject({ draft: null, canEdit: false });
      expect(managers.versions.map((v) => v.version)).toEqual([2, 1]);
      await get(`/kpis/templates/job-titles/${analystId}`, sessions.ben).expect(200);
      await get(`/kpis/templates/job-titles/${analystId}`, sessions.sam).expect(404);
      await get(`/kpis/templates/job-titles/${designerId}`, sessions.mona).expect(404);
      await get(`/kpis/templates/${v1.id}`, sessions.sam).expect(404);
    });
  });

  describe('opening a month', () => {
    it('the month’s payroll line gives the Attendance metric its score', async () => {
      const run = (await post('/payroll/runs', sessions.hr, { month: M }).expect(201)).body as { id: string; lines: { id: string; employeeId: string; result: { expectedHours: number | null } }[] };
      runIds.push(run.id);
      const tia = run.lines.find((l) => l.employeeId === ids.tia)!;
      expect(tia.result.expectedHours).toBeGreaterThan(0);
      await api()
        .patch(`/api/payroll/runs/${run.id}/lines`)
        .set('Cookie', sessions.hr)
        .send({ lines: [{ id: tia.id, inputs: { workedHours: tia.result.expectedHours! / 2 } }] })
        .expect(200);
    });

    it('opens on the 1st of the next month for everyone under a template in force: not freelancers or unpaid interns, part-timers yes', async () => {
      const round = await clock.runOnce(at(day(1)));
      expect(round).toMatchObject({ month: M, opened: 6, selfMissed: 0, finalized: 0 });
      // once
      expect(await clock.runOnce(at(day(1)))).toMatchObject({ opened: 0 });
      const opened = await prisma.kpiScorecard.findMany({ where: { employeeId: { in: people }, month: toDateOnly(firstDay(M)) }, select: { id: true, employeeId: true, scorer: true, approverRole: true, templateId: true, managerId: true } });
      const of = (key: string) => opened.find((c) => c.employeeId === ids[key]);
      for (const key of ['ben', 'nora', 'omar', 'tia', 'tom', 'clara']) cards[key] = of(key)!.id;
      expect(of('fay')).toBeUndefined();
      expect(of('ian')).toBeUndefined();
      expect(of('sam')).toBeUndefined();
      expect(opened.every((c) => c.templateId === v1.id)).toBe(true);
      expect(of('ben')).toMatchObject({ scorer: 'manager', managerId: ids.mona, approverRole: 'direct_manager' });
      expect(of('nora')).toMatchObject({ scorer: 'manager', managerId: ids.leo, approverRole: 'team_lead' });
      expect(of('omar')).toMatchObject({ scorer: 'hr', managerId: null });
      expect(of('tom')).toMatchObject({ scorer: 'manager', managerId: ids.mona });
      expect(of('clara')).toMatchObject({ scorer: 'ceo', managerId: null });

      const tia = await card(cards.tia, sessions.tia);
      expect(tia.attendance).toEqual({ points: 20, achieved: 10, ratio: 0.5, score: 0.5, source: 'payroll', counted: true });
      expect(tia.pillars[3]).toMatchObject({ name: 'Discipline & Growth', achieved: 10, max: 20 });
      // every duty a metric measures (25 October 2026: "Yes, several duties"), one kept before as a list of it
      expect(tia.pillars.map((p) => p.metrics.map((m) => m.jdDuties))).toEqual([[DUTIES], [['Keep data accurate']], [['Keep stakeholders informed']], []]);
      expect((await card(cards.ben, sessions.ben)).attendance).toMatchObject({ achieved: 20, ratio: null, source: 'none' });

      // the employee is told theirs is open
      const told = await notes('ben', 'kpi_self_rating');
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ title: `Your ${monthName(M).split(' ')[0]} KPI is open`, link: `/kpis/scorecards/${cards.ben}` });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_scorecard', entityId: cards.ben } });
      expect(audit).toMatchObject({ action: 'create', userId: null, diff: { month: M, status: 'self_rating', scorer: 'manager' } });
    });
  });

  describe('the steps', () => {
    it('the employee rates themself (saved, then sent), the manager sees it and is told', async () => {
      let ben = await card(cards.ben, sessions.ben);
      expect(ben).toMatchObject({ status: 'self_rating', action: 'self_rate', can: { selfRate: true, score: false }, score: null, finalPercent: null, payrollMonth: P });
      expect(ben.deadlines).toEqual({ selfRating: day(3), manager: day(6), hr: day(8), signOff: day(10) });
      // the manager doesn't see a self-rating not sent yet
      expect((await card(cards.ben, sessions.mona)).pillars[0].metrics[0].self).toBeNull();

      await post(`/kpis/scorecards/${cards.ben}/self`, sessions.ben, { picks: picks(ben, [1, null, null], 'One report was a day late'), submit: false }).expect(200);
      expect(said(await post(`/kpis/scorecards/${cards.ben}/self`, sessions.ben, { picks: [], submit: true }).expect(400))).toEqual([
        'Rate yourself on every metric before you send it, or save it for later.',
        'Data accuracy: choose one of its criteria.',
        'Stakeholder feedback: choose one of its criteria.',
      ]);
      expect(said(await post(`/kpis/scorecards/${cards.ben}/self`, sessions.ben, { picks: [{ metricId: ben.pillars[0].metrics[0].id, choice: 7 }], submit: false }).expect(400))).toEqual([
        'Reports on time: choose one of its criteria.',
      ]);
      await post(`/kpis/scorecards/${cards.ben}/self`, sessions.mona, { picks: [], submit: false }).expect(403);
      ben = (await post(`/kpis/scorecards/${cards.ben}/self`, sessions.ben, { picks: picks(ben, [1, 0, 0], 'One report was a day late'), comment: 'A good month', submit: true }).expect(200)).body;
      expect(ben).toMatchObject({ status: 'manager', can: { selfRate: false } });
      expect(ben.selfScore).toMatchObject({ finalPercent: 85, level: 'needs_improvement' });

      const mona = await card(cards.ben, sessions.mona);
      expect(mona.pillars[0].metrics[0].self).toEqual({ choice: 1, comment: 'One report was a day late' });
      expect(mona.comments.self).toBe('A good month');
      expect(mona).toMatchObject({ action: 'score', can: { score: true, selfRate: false } });
      const told = await notes('mona', 'kpi_waiting');
      expect(told.map((n) => [n.title, n.link])).toContainEqual(['A KPI scorecard is waiting for you', `/kpis/scorecards/${cards.ben}`]);
    });

    it('the manager scores with a comment; HR is told; the employee sees it only at the sign-off', async () => {
      const view = await card(cards.ben, sessions.mona);
      await post(`/kpis/scorecards/${cards.ben}/score`, sessions.ben, { picks: picks(view, [0, 0, 0]), submit: true }).expect(403);
      await post(`/kpis/scorecards/${cards.ben}/score`, sessions.sam, { picks: [], submit: false }).expect(404);
      expect(said(await post(`/kpis/scorecards/${cards.ben}/score`, sessions.mona, { picks: picks(view, [1, 0, 0]), submit: true }).expect(400))).toEqual([
        'Write your comments: how the month went and the areas of focus.',
      ]);
      const scored = (await post(`/kpis/scorecards/${cards.ben}/score`, sessions.mona, { picks: picks(view, [1, 0, 0]), comment: 'Keep the dates', submit: true }).expect(200)).body as KpiScorecardView;
      expect(scored).toMatchObject({ status: 'hr', finalPercent: 85, level: 'needs_improvement', score: { finalPercent: 85 } });
      expect(scored.score!.pillars.map((p) => p.percent)).toEqual([50, 100, 100, 100]);

      const ben = await card(cards.ben, sessions.ben);
      expect(ben).toMatchObject({ status: 'hr', finalPercent: null, level: null, score: null });
      expect(ben.pillars[0].metrics[0].manager).toBeNull();
      expect(ben.comments.manager).toBeNull();
      const hr = await card(cards.ben, sessions.hr);
      expect(hr).toMatchObject({ action: 'calibrate', can: { calibrate: true }, finalPercent: 85 });
      expect((await notes('hr', 'kpi_waiting')).map((n) => n.link)).toContain(`/kpis/scorecards/${cards.ben}`);
    });

    it('HR confirms it; both are told it is ready to sign; both sign and it is final', async () => {
      await post(`/kpis/scorecards/${cards.ben}/calibrate`, sessions.mona, { changes: [] }).expect(403);
      let view = (await post(`/kpis/scorecards/${cards.ben}/calibrate`, sessions.hr, { changes: [] }).expect(200)).body as KpiScorecardView;
      expect(view).toMatchObject({ status: 'sign_off', finalPercent: 85, calibrated: 0 });
      expect(await notes('ben', 'kpi_ready_to_sign')).toEqual([expect.objectContaining({ title: `Your ${monthName(M).split(' ')[0]} KPI is ready to sign`, body: `Sign by ${day(10).split('-').reverse().join('/')}` })]);
      expect((await notes('mona', 'kpi_waiting')).map((n) => n.title)).toContain('A KPI scorecard is ready for you to sign');

      const ben = await card(cards.ben, sessions.ben);
      expect(ben).toMatchObject({ finalPercent: 85, level: 'needs_improvement', action: 'sign', can: { signAsEmployee: true, signAsManager: false } });
      expect(ben.pillars[0].metrics[0].manager).toEqual({ choice: 1, comment: null });
      expect(ben.comments.manager).toBe('Keep the dates');
      await post(`/kpis/scorecards/${cards.ben}/sign`, sessions.hr, {}).expect(403);
      view = (await post(`/kpis/scorecards/${cards.ben}/sign`, sessions.ben, { comment: 'Read and agreed' }).expect(200)).body;
      expect(view).toMatchObject({ status: 'sign_off', signed: { employee: true, manager: false } });
      expect(said(await post(`/kpis/scorecards/${cards.ben}/sign`, sessions.ben, {}).expect(409))[0]).toBe('You have signed this scorecard already.');
      view = (await post(`/kpis/scorecards/${cards.ben}/sign`, sessions.mona, {}).expect(200)).body;
      expect(view).toMatchObject({ status: 'final', signed: { employee: true, manager: true }, unsigned: false, deadline: null, comments: { employeeSign: 'Read and agreed' } });
      expect(view.steps.map((s) => s.kind)).toEqual(['opened', 'self_rated', 'scored', 'calibrated', 'signed_employee', 'signed_manager', 'final']);
      // final and locked
      await post(`/kpis/scorecards/${cards.ben}/self`, sessions.ben, { picks: [], submit: false }).expect(409);
      await post(`/kpis/scorecards/${cards.ben}/score`, sessions.mona, { picks: [], submit: false }).expect(409);

      const actions = (await prisma.auditLog.findMany({ where: { entityType: 'kpi_scorecard', entityId: cards.ben }, orderBy: { id: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(['create', 'update', 'self_rate', 'score', 'calibrate', 'sign', 'sign']);
    });

    it('reminds the day before the self-rating’s deadline, once', async () => {
      const round = await clock.runOnce(at(day(2)));
      expect(round!.reminders).toBeGreaterThanOrEqual(4);
      const reminded = await notes('nora', 'kpi_self_rating');
      expect(reminded.map((n) => n.title)).toEqual([`Your ${monthName(M).split(' ')[0]} KPI is open`, `Your ${monthName(M).split(' ')[0]} KPI: rate yourself by tomorrow`]);
      expect((await clock.runOnce(at(day(2))))!.reminders).toBe(0);
      expect(await notes('ben', 'kpi_self_rating')).toHaveLength(1);
    });

    it('someone with nobody in charge is scored by HR, straight to the sign-off', async () => {
      const omar = await card(cards.omar, sessions.omar);
      await post(`/kpis/scorecards/${cards.omar}/self`, sessions.omar, { picks: picks(omar, [0, 0, 0]), submit: true }).expect(200);
      expect((await notes('hr', 'kpi_waiting')).map((n) => n.link)).toContain(`/kpis/scorecards/${cards.omar}`);
      const view = (await post(`/kpis/scorecards/${cards.omar}/score`, sessions.hr, { picks: picks(omar, [0, 0, 0]), comment: 'Steady', submit: true }).expect(200)).body as KpiScorecardView;
      expect(view).toMatchObject({ status: 'sign_off', finalPercent: 100, level: 'meets', scorer: { kind: 'hr', name: null } });
      await post(`/kpis/scorecards/${cards.omar}/sign`, sessions.omar, {}).expect(200);
    });

    it('a C-level person’s is scored by the CEO and hidden from HR', async () => {
      await get(`/kpis/scorecards/${cards.clara}`, sessions.hr).expect(404);
      const all = (await get(`/kpis/scorecards?scope=all&month=${M}`, sessions.hr).expect(200)).body as KpiScorecardSummary[];
      expect(all.map((s) => s.employee.id)).not.toContain(ids.clara);
      expect(all.filter((s) => people.includes(s.employee.id))).toHaveLength(5);
      const clara = await card(cards.clara, sessions.clara);
      await post(`/kpis/scorecards/${cards.clara}/self`, sessions.clara, { picks: picks(clara, [0, 0, 0]), submit: true }).expect(200);
      expect((await notes('ceo', 'kpi_waiting')).map((n) => n.link)).toContain(`/kpis/scorecards/${cards.clara}`);
      expect((await notes('hr', 'kpi_waiting')).map((n) => n.link)).not.toContain(`/kpis/scorecards/${cards.clara}`);
      await post(`/kpis/scorecards/${cards.clara}/score`, sessions.hr, { picks: [], submit: false }).expect(404);
      const view = (await post(`/kpis/scorecards/${cards.clara}/score`, sessions.ceo, { picks: picks(clara, [0, 0, 0]), comment: 'Strong', submit: true }).expect(200)).body as KpiScorecardView;
      expect(view).toMatchObject({ status: 'sign_off', confidential: true, scorer: { kind: 'ceo' } });
      await post(`/kpis/scorecards/${cards.clara}/calibrate`, sessions.hr, { changes: [] }).expect(404);
      expect(((await get(`/kpis/scorecards?scope=team&month=${M}`, sessions.ceo).expect(200)).body as KpiScorecardSummary[]).map((s) => s.id)).toEqual([cards.clara]);
    });

    it('a self-rating missed by its day is noted, and the scorer goes on', async () => {
      const round = await clock.runOnce(at(day(4)));
      expect(round).toMatchObject({ selfMissed: 3 }); // Nora, Tia and Tom
      const nora = await card(cards.nora, sessions.leo);
      expect(nora).toMatchObject({ status: 'manager', selfMissed: true, action: 'score' });
      expect(nora.steps.map((s) => [s.kind, s.comment])).toEqual([
        ['opened', null],
        ['self_missed', `Not sent by ${day(3).split('-').reverse().join('/')}`],
      ]);
      expect((await notes('leo', 'kpi_waiting')).map((n) => n.link)).toContain(`/kpis/scorecards/${cards.nora}`);
      await post(`/kpis/scorecards/${cards.nora}/self`, sessions.nora, { picks: [], submit: false }).expect(409);
    });

    it('reminds the scorers the day before theirs, one reminder a person', async () => {
      await clock.runOnce(at(day(5)));
      const mona = (await notes('mona', 'kpi_waiting')).map((n) => [n.title, n.link]);
      // Tia's and Tom's, together
      expect(mona).toContainEqual(['2 KPI scorecards to score by tomorrow', '/kpis/team']);
      expect((await notes('leo', 'kpi_waiting')).map((n) => n.title)).toContain('A KPI scorecard to score by tomorrow');
    });

    it('a team lead scores for someone without a manager; HR calibrates with a required reason, audited', async () => {
      const nora = await card(cards.nora, sessions.leo);
      await post(`/kpis/scorecards/${cards.nora}/score`, sessions.leo, { picks: picks(nora, [1, 0, 0]), comment: 'Close', submit: true }).expect(200);
      const metric = nora.pillars[0].metrics[0].id;
      expect(said(await post(`/kpis/scorecards/${cards.nora}/calibrate`, sessions.hr, { changes: [{ metricId: metric, choice: 2, reason: ' ' }] }).expect(400))).toEqual([
        "Reports on time: write the reason for changing the manager's pick.",
      ]);
      expect(said(await post(`/kpis/scorecards/${cards.nora}/calibrate`, sessions.hr, { changes: [{ metricId: metric, choice: 1, reason: 'Same' }] }).expect(400))).toEqual([
        "Reports on time: that is the manager's pick already; leave it out, or choose another criterion.",
      ]);
      const view = (
        await post(`/kpis/scorecards/${cards.nora}/calibrate`, sessions.hr, { changes: [{ metricId: metric, choice: 2, reason: 'Two reports were late, per the log' }], comment: 'Checked' }).expect(200)
      ).body as KpiScorecardView;
      expect(view).toMatchObject({ status: 'sign_off', finalPercent: 70, level: 'needs_improvement', calibrated: 1 });
      expect(view.pillars[0].metrics[0]).toMatchObject({ manager: { choice: 1 }, hr: { choice: 2, comment: 'Two reports were late, per the log' }, points: 0 });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_scorecard', entityId: cards.nora, action: 'calibrate' } });
      expect(audit!.diff).toMatchObject({ month: M, status: { from: 'hr', to: 'sign_off' }, changes: [{ metric: 'Reports on time', from: '1 late', to: '2+ late', reason: 'Two reports were late, per the log' }], comment: 'Checked' });
      // what waits for HR, for the sidebar and Approvals: Tia's scoring isn't HR's yet; Omar's sign as HR is
      const counts = (await get('/kpis/counts', sessions.hr).expect(200)).body as KpiCounts;
      expect(counts.hr).toBeGreaterThanOrEqual(1);
      expect(((await get('/kpis/counts', sessions.nora).expect(200)).body as KpiCounts).self).toBe(1);
    });
  });

  describe('the payroll', () => {
    let runId: string;
    type Line = { employeeId: string; terms: PayrollTerms; result: { kpiScore: number; kpiCut: number; variable: number } };
    const lines = async () => ((await get(`/payroll/runs/${runId}`, sessions.hr).expect(200)).body as { status: string; lines: Line[] }).lines;
    const lineOf = (all: Line[], key: string) => all.find((l) => l.employeeId === ids[key])!;

    it('reads last month’s final %: 85% no cut; none final yet, no cut', async () => {
      const run = (await post('/payroll/runs', sessions.hr, { month: P }).expect(201)).body as { id: string };
      runId = run.id;
      runIds.push(run.id);
      const all = await lines();
      expect(lineOf(all, 'ben').terms.kpi).toEqual({ month: M, scorecardId: cards.ben, finalPercent: 85, level: 'needs_improvement', attendanceCounted: true });
      expect(lineOf(all, 'ben').result).toMatchObject({ kpiScore: 1, kpiCut: 0 });
      expect(lineOf(all, 'nora').terms.kpi).toBeNull();
      expect(lineOf(all, 'nora').result.kpiCut).toBe(0);
      expect(lineOf(all, 'sam').terms.kpi).toBeNull();
      await post(`/payroll/runs/${runId}/submit`, sessions.hr).expect(200);
    });

    it('a sign-off not done by the 10th is final anyway, noted', async () => {
      await post(`/kpis/scorecards/${cards.nora}/sign`, sessions.nora, {}).expect(200);
      await clock.runOnce(at(day(9)));
      expect((await notes('leo', 'kpi_waiting')).map((n) => n.title)).toContain('A KPI scorecard to sign by tomorrow');
      const clara = await card(cards.clara, sessions.clara);
      await post(`/kpis/scorecards/${clara.id}/sign`, sessions.clara, {}).expect(200);
      expect((await post(`/kpis/scorecards/${clara.id}/sign`, sessions.ceo, {}).expect(200)).body).toMatchObject({ status: 'final' });

      const round = await clock.runOnce(at(day(11)));
      expect(round).toMatchObject({ finalized: 2 }); // Nora (not signed by Leo) and Omar (not signed by HR)
      const nora = await card(cards.nora, sessions.nora);
      expect(nora).toMatchObject({ status: 'final', unsigned: true, finalPercent: 70, signed: { employee: true, manager: false } });
      expect(nora.steps.at(-1)).toMatchObject({ kind: 'final_unsigned', comment: `Not signed by the manager by ${day(10).split('-').reverse().join('/')}` });
      expect((await card(cards.tia, sessions.mona)).status).toBe('manager');
    });

    it('a run with the CEO keeps its figures; back to a draft, it takes the KPI on refresh: 70% cuts 30% of the variable', async () => {
      expect(lineOf(await lines(), 'nora').terms.kpi).toBeNull();
      await post(`/payroll/runs/${runId}/refresh`, sessions.hr).expect(409);
      await post(`/payroll/runs/${runId}/return`, sessions.ceo, { reason: 'Take the KPIs' }).expect(200);
      await post(`/payroll/runs/${runId}/refresh`, sessions.hr).expect(200);
      const all = await lines();
      expect(lineOf(all, 'nora').terms.kpi).toEqual({ month: M, scorecardId: cards.nora, finalPercent: 70, level: 'needs_improvement', attendanceCounted: true });
      expect(lineOf(all, 'nora').result).toMatchObject({ kpiScore: 0.7, variable: 2400, kpiCut: 720 });
      expect(lineOf(all, 'ben').result.kpiCut).toBe(0);
      expect(lineOf(all, 'sam').result).toMatchObject({ kpiScore: 1, kpiCut: 0 });
    });
  });

  describe('the overview', () => {
    it('HR’s month: by step, calibrated, missed, unsigned, the average, levels and pillars by department, C-level left out', async () => {
      const hr = (await get(`/kpis/overview?month=${M}`, sessions.hr).expect(200)).body as KpiOverview;
      expect(hr).toMatchObject({ month: M, total: 5, hidden: 1, calibrated: 1, selfMissed: 3, unsigned: 2 });
      expect(hr.byStatus).toMatchObject({ final: 3, manager: 2 });
      // Ben 85, Nora 70, Omar 100
      expect(hr.average).toBe(85);
      expect(hr.distribution).toMatchObject({ needs_improvement: 2, meets: 1 });
      const dept = hr.departments.find((d) => d.id === deptId)!;
      expect(dept).toMatchObject({ name: `KPI Dept ${RUN}`, scored: 3, average: 85 });
      expect(hr.months).toContain(M);
      const ceo = (await get(`/kpis/overview?month=${M}`, sessions.ceo).expect(200)).body as KpiOverview;
      expect(ceo).toMatchObject({ total: 6, hidden: 0 });
      await get(`/kpis/overview?month=${M}`, sessions.mona).expect(403);
    });

    it('a manager’s heatmap of their people, and the month’s Excel for HR, in the audit log', async () => {
      const map = (await get(`/kpis/heatmap?scope=team&to=${M}&months=3`, sessions.mona).expect(200)).body as KpiHeatmap;
      expect(map.months).toEqual([monthsLater(M, -2), monthsLater(M, -1), M]);
      expect(map.rows.map((r) => r.employee.id).sort()).toEqual([ids.ben, ids.tia, ids.tom].sort());
      const ben = map.rows.find((r) => r.employee.id === ids.ben)!;
      expect(ben.cells).toEqual([null, null, { id: cards.ben, finalPercent: 85, level: 'needs_improvement', status: 'final' }]);
      expect(map.distribution).toMatchObject({ month: M, scored: 1, total: 3, counts: { needs_improvement: 1 } });
      await get(`/kpis/heatmap?scope=all`, sessions.mona).expect(403);

      const file = await get(`/kpis/export?month=${M}`, sessions.hr).expect(200);
      expect(file.headers['content-type']).toContain('spreadsheetml');
      expect(file.headers['content-disposition']).toContain(`KPIs ${monthName(M)}.xlsx`);
      expect(await prisma.auditLog.findFirst({ where: { action: 'kpi_file', userId: users.hr }, orderBy: { id: 'desc' } })).toMatchObject({ entityType: 'kpi_report', diff: { month: M, scorecards: 5, confidentialLeftOut: true } });
    });

    it('the lists: the employee’s own history, a manager’s team, what waits for whom', async () => {
      const mine = (await get('/kpis/scorecards/mine', sessions.ben).expect(200)).body as KpiScorecardSummary[];
      expect(mine).toEqual([expect.objectContaining({ id: cards.ben, month: M, finalPercent: 85, level: 'needs_improvement', status: 'final' })]);
      const team = (await get(`/kpis/scorecards?scope=team&month=${M}`, sessions.mona).expect(200)).body as KpiScorecardSummary[];
      expect(team.map((s) => s.employee.id).sort()).toEqual([ids.ben, ids.tia, ids.tom].sort());
      await get(`/kpis/scorecards?scope=all&month=${M}`, sessions.mona).expect(403);
      const waiting = (await get('/kpis/scorecards/waiting', sessions.mona).expect(200)).body as KpiScorecardSummary[];
      expect(waiting.map((s) => [s.id, s.action])).toEqual(expect.arrayContaining([[cards.tia, 'score'], [cards.tom, 'score']]));
      expect(((await get('/kpis/counts', sessions.mona).expect(200)).body as KpiCounts).team).toBe(2);
    });
  });

  describe('opening with the new version', () => {
    it('HR opens last month’s now; the scorecards opened from next month take version 2, last ones keeping theirs', async () => {
      await post('/kpis/open', sessions.ben).expect(403);
      const opened = (await post('/kpis/open', sessions.hr).expect(200)).body as { month: string; opened: number };
      expect(opened.month).toBe(monthsLater(CURRENT, -1));
      expect(opened.opened).toBe(6);
      expect(await prisma.auditLog.findFirst({ where: { action: 'open', userId: users.hr }, orderBy: { id: 'desc' } })).toMatchObject({ diff: { month: monthsLater(CURRENT, -1), opened: 6 } });

      await clock.runOnce(at(`${NEXT}-01`));
      const current = await prisma.kpiScorecard.findFirstOrThrow({ where: { employeeId: ids.ben, month: toDateOnly(firstDay(CURRENT)) }, select: { templateId: true } });
      expect(current.templateId).toBe(v2.id);
      expect((await prisma.kpiScorecard.findUniqueOrThrow({ where: { id: cards.ben } })).templateId).toBe(v1.id);
      expect((await card(cards.ben, sessions.ben)).templateVersion).toBe(1);
    });
  });
});
