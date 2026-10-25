import type { INestApplication } from '@nestjs/common';
import type { KpiFrameworkView, KpiJobTitleTemplates, KpiScorecardView, KpiTemplateRow, KpiTemplateView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { KpiSchedulerService } from '../src/kpis/kpi-scheduler.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// KPI pillars by department, weights by job title (owner, 22 October 2026: "but i need pillars to each department /
// wights can be changed for each department and Job title"; packages/shared kpi-framework.ts): every department is
// listed with its teams, on the company's pillars until it has its own; HR and a Super Admin set a department's own
// pillars, from next month, audited, or take it back to the company's; a job title in the department, or in one of its
// teams, is drafted and published in its pillars, from their first month; a job title's template gives them its own
// weights (checked, kept when the draft is saved without them, published with it, its scorecard scored with them), reset
// once its department's pillars gain a pillar; the company's change marks only the job titles on its pillars. A team's
// own pillars (owner, 22 October 2026: "where is the pillars for team?", then "Yes, add team pillars"): its job titles
// take them, or its department's when it goes back to them, from the later month; its department's change leaves it be.
// Every name is invented; the test deletes what it made.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const LAST = monthsLater(CURRENT, -1);
const NEXT = monthsLater(CURRENT, 1);
const AFTER = monthsLater(CURRENT, 2);
/** A moment on a day, at noon in Cairo whatever the season. */
const at = (day: string) => new Date(`${day}T10:00:00Z`);

const criteria = [
  { label: 'Good', points: 10 },
  { label: 'Half', points: 5 },
  { label: 'Poor', points: 0 },
];
const metric = (pillar: string | null, name: string) => ({ pillar, name, definition: null, howMeasured: null, jdDuty: null, targetPoints: 10, criteria });

/** Sales's own pillars: two, the Attendance metric in Clients & Teamwork. */
const SALES_PILLARS = [
  { key: 'revenue', name: 'Revenue', short: 'Revenue', weight: 60 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 40 },
];
/** Sales's next pillars changed: Growth added. */
const SALES_THREE = [
  { key: 'revenue', name: 'Revenue', short: 'Revenue', weight: 50 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 30 },
  { key: 'growth', name: 'Growth', short: 'Growth', weight: 20 },
];
/** The Field team's own pillars. */
const FIELD_PILLARS = [
  { key: 'visits', name: 'Visits', short: 'Visits', weight: 70 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 30 },
];
/** The Inside team's own pillars. */
const INSIDE_PILLARS = [
  { key: 'calls', name: 'Calls', short: 'Calls', weight: 50 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 50 },
];
/** The company's next pillars: the plan's four, reweighted. */
const COMPANY_NEXT = [
  { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 40 },
  { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 20 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 20 },
  { key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 20 },
];
const PLAN = ['Delivery & Timeliness', 'Quality of Work', 'Clients & Teamwork', 'Discipline & Growth'];
const SALES_CONTENT = { attendancePoints: 20, metrics: [metric('revenue', 'Deals closed'), metric('clients', 'Client feedback')] };

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('KPI pillars by department, weights by job title (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: KpiSchedulerService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const put = (path: string, session: string, body: object) => api().put(`/api${path}`).set('Cookie', session).send(body);
  const view = async (session = sessions.hr) => (await get('/kpis/framework', session).expect(200)).body as KpiFrameworkView;
  const rowOf = async (jobTitleId: string) => ((await get('/kpis/templates', sessions.hr).expect(200)).body as KpiTemplateRow[]).find((r) => r.jobTitle.id === jobTitleId)!;
  const lastAudit = (entityType: string, entityId: string, action: string) =>
    prisma.auditLog.findFirst({ where: { entityType, entityId, action }, orderBy: { id: 'desc' } }) as Promise<{ userId: string; diff: Record<string, unknown> } | null>;

  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const people: string[] = [];
  let annId: string;
  let salesId: string;
  let fieldId: string;
  let webId: string;
  let salesRepId: string;
  let fieldRepId: string;
  let webDevId: string;
  let insideId: string;
  let insideRepId: string;
  let salesNextId: string;
  let salesRepV1: KpiTemplateView;
  let emailDomainBefore: string | null;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    return email;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    // the Attendance metric counting in the KPI, as it did until 25 October 2026 ("Fixed cut only": off since, tested in
    // kpi-without-attendance.e2e-spec.ts): switched on for these tests, off again after them
    await prisma.kpiSettings.upsert({ where: { id: 1 }, update: { attendanceInKpi: true }, create: { id: 1, attendanceInKpi: true } });
    clock = app.get(KpiSchedulerService);
    await account('hr', ['hr']);
    await account('superAdmin', ['super_admin']);
    await account('ceo', ['ceo']);
    await account('admin', ['admin']);
    // the test's work emails aren't the company's domain
    emailDomainBefore = (await get('/company', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    salesId = (await post('/departments', sessions.hr, { nameEn: `Pillars Sales ${RUN}` }).expect(201)).body.id;
    fieldId = (await post('/departments', sessions.hr, { nameEn: `Field ${RUN}`, parentId: salesId }).expect(201)).body.id;
    webId = (await post('/departments', sessions.hr, { nameEn: `Pillars Web ${RUN}` }).expect(201)).body.id;
    salesRepId = (await post('/job-titles', sessions.hr, { departmentId: salesId, titleEn: `Sales Rep ${RUN}` }).expect(201)).body.id;
    fieldRepId = (await post('/job-titles', sessions.hr, { departmentId: fieldId, titleEn: `Field Rep ${RUN}` }).expect(201)).body.id;
    webDevId = (await post('/job-titles', sessions.hr, { departmentId: webId, titleEn: `Web Developer ${RUN}` }).expect(201)).body.id;
    // Ann, a sales rep with nobody in charge (HR scores her), employed from before last month
    const email = await account('ann', ['employee']);
    annId = (await post('/employees', sessions.hr, { fullNameEn: `Ann Seller ${RUN}`, fullNameAr: 'موظفة تجريبية', workEmail: email }).expect(201)).body.id;
    people.push(annId);
    await prisma.employment.create({
      data: { employeeId: annId, employmentType: 'full_time', status: 'active', joinDate: toDateOnly(firstDay(monthsLater(LAST, -1))), departmentId: salesId, jobTitleId: salesRepId },
    });
  });

  afterAll(async () => {
    await prisma.kpiSettings.update({ where: { id: 1 }, data: { attendanceInKpi: false } });
    await app.get(NotificationsService).flush();
    await prisma.kpiScorecard.deleteMany({ where: { employeeId: { in: people } } });
    const titles = [salesRepId, fieldRepId, webDevId, insideRepId].filter(Boolean);
    await prisma.kpiTemplate.deleteMany({ where: { jobTitleId: { in: titles } } });
    // the company's pillars back to the first version, as the other tests expect; the departments' go with them
    await prisma.kpiFramework.deleteMany({ where: { departmentId: null, version: { gt: 1 } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titles } } });
    await prisma.department.deleteMany({ where: { id: { in: [fieldId, insideId].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: { in: [salesId, webId].filter(Boolean) } } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('lists every department with its teams, on the company’s pillars until they have their own', async () => {
    const read = await view(sessions.ann);
    expect(read.canEdit).toBe(false);
    expect(read.departments.find((d) => d.department.id === salesId)).toEqual({
      department: { id: salesId, nameEn: `Pillars Sales ${RUN}` },
      parent: null,
      inForce: null,
      next: null,
      // its own and its team's, the team having none of its own
      jobTitles: 2,
      oldTemplates: 0,
      teams: [{ department: { id: fieldId, nameEn: `Field ${RUN}` }, parent: { id: salesId, nameEn: `Pillars Sales ${RUN}` }, inForce: null, next: null, jobTitles: 1, oldTemplates: 0, teams: [] }],
    });
    expect(read.departments.find((d) => d.department.id === webId)).toMatchObject({ inForce: null, next: null, jobTitles: 1 });
    expect(read.departments.some((d) => d.department.id === fieldId)).toBe(false);
  });

  describe('a department’s own pillars', () => {
    const body = (extra: object = {}) => ({ departmentId: salesId, appliesFrom: NEXT, attendancePillar: 'clients', pillars: SALES_PILLARS, ...extra });

    it('only HR and a Super Admin set them; an unknown department and the same pillars as the company’s are refused', async () => {
      for (const key of ['ann', 'ceo', 'admin']) await put('/kpis/framework', sessions[key], body()).expect(403);
      await put('/kpis/framework', sessions.hr, body({ departmentId: '00000000-0000-4000-8000-000000000000' })).expect(404);
      expect(said(await put('/kpis/framework', sessions.hr, { departmentId: webId, followsCompany: true, appliesFrom: NEXT }).expect(400))).toEqual([
        `Pillars Web ${RUN} takes the company’s pillars already.`,
      ]);
      expect(said(await put('/kpis/framework', sessions.hr, { followsCompany: true, appliesFrom: NEXT }).expect(400))).toEqual([
        'Only a department or a team goes back to the pillars above it: choose one.',
      ]);
      const company = (await view()).inForce;
      expect(said(await put('/kpis/framework', sessions.hr, body({ attendancePillar: company.attendancePillar, pillars: company.pillars })).expect(400))).toEqual([
        'These are the company’s pillars: change a pillar, a weight or the Attendance metric’s pillar first, or keep the company’s.',
      ]);
      expect(await prisma.kpiFramework.count({ where: { departmentId: salesId } })).toBe(0);
    });

    it('HR sets Sales’s own pillars from next month, audited; the company’s are left as they are', async () => {
      const saved = (await put('/kpis/framework', sessions.hr, body({ nextId: null })).expect(200)).body as KpiFrameworkView;
      expect(saved).toMatchObject({ inForce: { version: 1, departmentId: null }, next: null });
      const sales = saved.departments.find((d) => d.department.id === salesId)!;
      expect(sales).toMatchObject({ inForce: null, next: { version: 1, departmentId: salesId, followsCompany: false, appliesFrom: NEXT, opensFrom: `${AFTER}-01`, attendancePillar: 'clients' } });
      expect(sales.next!.pillars).toEqual(SALES_PILLARS);
      expect(saved.usedKeys).toEqual(expect.arrayContaining(['revenue', 'clients', 'delivery']));
      salesNextId = sales.next!.id;
      expect(await lastAudit('kpi_framework', salesNextId, 'create')).toMatchObject({
        userId: users.hr,
        diff: {
          department: `Pillars Sales ${RUN}`,
          departmentId: salesId,
          version: 1,
          appliesFrom: NEXT,
          pillars: ['Revenue 60%', 'Clients & Teamwork 40%'],
          attendancePillar: 'Clients & Teamwork',
          opensFrom: `${AFTER}-01`,
          replaces: { followsCompany: true },
        },
      });
      // a page loaded before, expecting no next ones, is told
      expect(said(await put('/kpis/framework', sessions.hr, body({ nextId: null })).expect(409))[0]).toBe('Someone saved other pillars meanwhile. Reload the page to see them.');
    });
  });

  describe('job titles in the department', () => {
    it('a job title in Sales, and in its team, is drafted in Sales’s pillars; the web job title in the company’s', async () => {
      const sales = (await post(`/kpis/templates/job-titles/${salesRepId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(sales).toMatchObject({
        pillars: SALES_PILLARS,
        attendancePillar: 'clients',
        pillarsFrom: { departmentId: salesId, nameEn: `Pillars Sales ${RUN}` },
        baseWeights: { revenue: 60, clients: 40 },
        ownWeights: false,
        weightsReset: false,
        pillarsChanged: false,
      });
      const field = (await post(`/kpis/templates/job-titles/${fieldRepId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(field).toMatchObject({ pillars: SALES_PILLARS, pillarsFrom: { departmentId: salesId } });
      const web = (await post(`/kpis/templates/job-titles/${webDevId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(web).toMatchObject({ pillarsFrom: null, attendancePillar: 'discipline', baseWeights: { delivery: 30, quality: 25, clients: 25, discipline: 20 } });
      expect(web.pillars.map((p) => p.name)).toEqual(PLAN);
    });

    it('the job title’s own weights are checked, saved and kept; equal to the department’s, they are none', async () => {
      const draftId = (await rowOf(salesRepId)).draft!.id;
      expect(said(await put(`/kpis/templates/${draftId}`, sessions.hr, { ...SALES_CONTENT, weights: { revenue: 80, clients: 30 } }).expect(400))).toEqual([
        'The pillars’ weights add up to 110%: make them add up to 100%.',
      ]);
      expect(said(await put(`/kpis/templates/${draftId}`, sessions.hr, { ...SALES_CONTENT, weights: { revenue: 100 } }).expect(400))).toEqual([
        'The pillars have changed since the page was opened. Reload the page and set the weights again.',
      ]);
      expect(said(await put(`/kpis/templates/${draftId}`, sessions.hr, { ...SALES_CONTENT, weights: { revenue: 100, clients: 0 } }).expect(400))).toEqual([
        'Clients & Teamwork: give its weight as a whole percent from 1 to 100.',
      ]);
      const saved = (await put(`/kpis/templates/${draftId}`, sessions.hr, { ...SALES_CONTENT, weights: { revenue: 70, clients: 30 } }).expect(200)).body as KpiTemplateView;
      expect(saved).toMatchObject({ ownWeights: true, baseWeights: { revenue: 60, clients: 40 }, problems: [] });
      expect(saved.pillars.map((p) => [p.key, p.weight])).toEqual([
        ['revenue', 70],
        ['clients', 30],
      ]);
      expect(await lastAudit('kpi_template', draftId, 'update')).toMatchObject({ diff: { ownWeights: { from: null, to: 'Revenue 70% · Clients & Teamwork 30%' } } });
      // saved without them: kept
      const again = (await put(`/kpis/templates/${draftId}`, sessions.hr, SALES_CONTENT).expect(200)).body as KpiTemplateView;
      expect(again.ownWeights).toBe(true);
      // the team's job title: the department's weights sent are none of its own
      const fieldDraft = (await rowOf(fieldRepId)).draft!.id;
      const field = (await put(`/kpis/templates/${fieldDraft}`, sessions.hr, { ...SALES_CONTENT, weights: { revenue: 60, clients: 40 } }).expect(200)).body as KpiTemplateView;
      expect(field.ownWeights).toBe(false);
      expect((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: fieldDraft } })).ownWeights).toBeNull();
    });

    it('publishing gives the version Sales’s pillars with the job title’s weights, from their first month, audited', async () => {
      const draftId = (await rowOf(salesRepId)).draft!.id;
      salesRepV1 = (await post(`/kpis/templates/${draftId}/publish`, sessions.hr).expect(200)).body;
      expect(salesRepV1).toMatchObject({ status: 'published', opensFrom: `${AFTER}-01`, ownWeights: true, oldPillars: false, pillarsFrom: { departmentId: salesId } });
      expect(salesRepV1.pillars.map((p) => [p.key, p.weight])).toEqual([
        ['revenue', 70],
        ['clients', 30],
      ]);
      const stored = await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: draftId }, select: { frameworkId: true, ownWeights: true } });
      expect(stored).toEqual({ frameworkId: salesNextId, ownWeights: { revenue: 70, clients: 30 } });
      expect(await lastAudit('kpi_template', draftId, 'publish')).toMatchObject({
        diff: { framework: 1, pillarsOf: `Pillars Sales ${RUN}`, ownWeights: 'Revenue 70% · Clients & Teamwork 30%', opensFrom: `${AFTER}-01` },
      });
      // the team's job title: Sales's pillars, its weights
      const fieldDraft = (await rowOf(fieldRepId)).draft!.id;
      const field = (await post(`/kpis/templates/${fieldDraft}/publish`, sessions.hr).expect(200)).body as KpiTemplateView;
      expect(field).toMatchObject({ ownWeights: false, pillarsFrom: { departmentId: salesId } });
      expect(field.pillars).toEqual(SALES_PILLARS);
      expect((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: fieldDraft } })).frameworkId).toBe(salesNextId);
      expect(await rowOf(salesRepId)).toMatchObject({ oldPillars: false, upcoming: { id: salesRepV1.id } });
    });

    it('its scorecard is scored with the job title’s weights', async () => {
      // in force since this month's opening, as if published last month
      await prisma.kpiTemplate.update({ where: { id: salesRepV1.id }, data: { opensFrom: toDateOnly(firstDay(CURRENT)) } });
      await clock.runOnce(at(`${CURRENT}-01`));
      // her self-rating day gone by: HR scores it
      await clock.runOnce(at(`${CURRENT}-04`));
      const id = (await prisma.kpiScorecard.findFirstOrThrow({ where: { employeeId: annId, month: toDateOnly(firstDay(LAST)) }, select: { id: true } })).id;
      const card = (await get(`/kpis/scorecards/${id}`, sessions.hr).expect(200)).body as KpiScorecardView;
      expect(card.pillars.map((p) => [p.key, p.weight])).toEqual([
        ['revenue', 70],
        ['clients', 30],
      ]);
      const picks = card.pillars.flatMap((p) => p.metrics).map((m, i) => ({ metricId: m.id, choice: [0, 1][i] }));
      const scored = (await post(`/kpis/scorecards/${id}/score`, sessions.hr, { picks, comment: 'Scored', submit: true }).expect(200)).body as KpiScorecardView;
      // Deals closed 10/10 × 70 + (Client feedback 5/10 + Attendance 20/20) / 30 × 30 = 70 + 25
      expect(scored.finalPercent).toBe(95);
    });
  });

  describe('when the pillars change', () => {
    it('the company’s new pillars mark only the job titles on them', async () => {
      const webDraft = (await rowOf(webDevId)).draft!.id;
      await put(`/kpis/templates/${webDraft}`, sessions.hr, {
        attendancePoints: 20,
        metrics: [metric('delivery', 'Releases on time'), metric('quality', 'Bugs'), metric('clients', 'Team feedback')],
      }).expect(200);
      await post(`/kpis/templates/${webDraft}/publish`, sessions.hr).expect(200);
      const saved = (await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'discipline', pillars: COMPANY_NEXT, nextId: null }).expect(200)).body as KpiFrameworkView;
      expect(saved.next).toMatchObject({ version: 2, departmentId: null });
      expect(saved.departments.find((d) => d.department.id === webId)).toMatchObject({ oldTemplates: 1 });
      expect(saved.departments.find((d) => d.department.id === salesId)).toMatchObject({ oldTemplates: 0 });
      expect(await rowOf(webDevId)).toMatchObject({ oldPillars: true });
      expect(await rowOf(salesRepId)).toMatchObject({ oldPillars: false });
      expect(await rowOf(fieldRepId)).toMatchObject({ oldPillars: false });
    });

    it('a draft copied from the published version keeps its weights; once Sales’s pillars gain one, they are reset', async () => {
      const copy = (await post(`/kpis/templates/job-titles/${salesRepId}/draft`, sessions.hr, { from: 'published' }).expect(201)).body as KpiTemplateView;
      expect(copy).toMatchObject({ ownWeights: true, pillarsChanged: false, weightsReset: false });
      expect(copy.pillars.map((p) => p.weight)).toEqual([70, 30]);
      // Super Admin adds Growth to Sales's next pillars
      const saved = (await put('/kpis/framework', sessions.superAdmin, {
        departmentId: salesId,
        appliesFrom: NEXT,
        attendancePillar: 'clients',
        pillars: SALES_THREE,
        nextId: salesNextId,
      }).expect(200)).body as KpiFrameworkView;
      expect(saved.departments.find((d) => d.department.id === salesId)).toMatchObject({ next: { id: salesNextId, version: 1 }, oldTemplates: 2 });
      expect(await lastAudit('kpi_framework', salesNextId, 'update')).toMatchObject({
        userId: users.superAdmin,
        diff: { department: `Pillars Sales ${RUN}`, version: 1, pillars: { from: ['Revenue 60%', 'Clients & Teamwork 40%'], to: ['Revenue 50%', 'Clients & Teamwork 30%', 'Growth 20%'] } },
      });
      const page = (await get(`/kpis/templates/job-titles/${salesRepId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates;
      expect(page.draft).toMatchObject({ ownWeights: false, weightsReset: true, pillarsChanged: true, baseWeights: { revenue: 50, clients: 30, growth: 20 } });
      expect(page.draft!.pillars).toEqual(SALES_THREE);
      expect(page.draft!.problems).toEqual(['Add a metric to Growth: every pillar is scored.']);
      expect(page.versions[0]).toMatchObject({ id: salesRepV1.id, oldPillars: true, ownWeights: true });
      // saved without weights: the ones that no longer fit are dropped
      await put(`/kpis/templates/${copy.id}`, sessions.hr, { attendancePoints: 20, metrics: [...SALES_CONTENT.metrics, metric('growth', 'Courses')] }).expect(200);
      expect((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: copy.id } })).ownWeights).toBeNull();
    });

    it('Sales goes back to the company’s pillars from a month: its job titles take them, from then', async () => {
      // Sales's own pillars in force since last month's
      await prisma.kpiFramework.update({ where: { id: salesNextId }, data: { appliesFrom: toDateOnly(firstDay(LAST)) } });
      const before = await view();
      expect(before.departments.find((d) => d.department.id === salesId)).toMatchObject({ inForce: { id: salesNextId }, next: null });
      const saved = (await put('/kpis/framework', sessions.hr, { departmentId: salesId, followsCompany: true, appliesFrom: AFTER, nextId: null }).expect(200)).body as KpiFrameworkView;
      const sales = saved.departments.find((d) => d.department.id === salesId)!;
      expect(sales).toMatchObject({ inForce: { id: salesNextId }, next: { version: 2, followsCompany: true, appliesFrom: AFTER, pillars: [], attendancePillar: '' } });
      expect(await lastAudit('kpi_framework', sales.next!.id, 'create')).toMatchObject({
        diff: { department: `Pillars Sales ${RUN}`, version: 2, appliesFrom: AFTER, followsCompany: true, replaces: { version: 1, pillars: ['Revenue 50%', 'Clients & Teamwork 30%', 'Growth 20%'] } },
      });
      // the sales rep's draft now in the company's newest pillars, from Sales's month
      const page = (await get(`/kpis/templates/job-titles/${salesRepId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates;
      expect(page.draft).toMatchObject({ pillarsFrom: null, attendancePillar: 'discipline', baseWeights: { delivery: 40, quality: 20, clients: 20, discipline: 20 } });
      // a team's job title too
      const field = (await post(`/kpis/templates/job-titles/${fieldRepId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(field).toMatchObject({ pillarsFrom: null, pillars: COMPANY_NEXT });
      await put(`/kpis/templates/${field.id}`, sessions.hr, {
        attendancePoints: 20,
        metrics: [metric('delivery', 'Visits'), metric('quality', 'Reports'), metric('clients', 'Client feedback')],
      }).expect(200);
      const published = (await post(`/kpis/templates/${field.id}/publish`, sessions.hr).expect(200)).body as KpiTemplateView;
      // the company's next pillars apply from next month, Sales takes them from the month after: from then
      expect(published).toMatchObject({ opensFrom: `${monthsLater(AFTER, 1)}-01`, pillarsFrom: null, oldPillars: false });
      // Sales back on them from next month instead: the version moves with it
      await put('/kpis/framework', sessions.hr, { departmentId: salesId, followsCompany: true, appliesFrom: NEXT, nextId: sales.next!.id }).expect(200);
      expect(fromDateOnly((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: field.id } })).opensFrom!)).toBe(`${AFTER}-01`);
    });
  });
  // owner, 22 October 2026: "where is the pillars for team?", then "Yes, add team pillars"
  describe('a team’s own pillars', () => {
    const team = (extra: object = {}) => ({ departmentId: fieldId, appliesFrom: NEXT, attendancePillar: 'clients', pillars: FIELD_PILLARS, ...extra });
    let fieldNextId: string;

    it('only HR and a Super Admin set them; a team already on its department’s, or the same pillars as its department gives, is refused', async () => {
      for (const key of ['ann', 'ceo', 'admin']) await put('/kpis/framework', sessions[key], team()).expect(403);
      expect(said(await put('/kpis/framework', sessions.hr, { departmentId: fieldId, followsCompany: true, appliesFrom: NEXT }).expect(400))).toEqual([
        `Field ${RUN} takes Pillars Sales ${RUN}’s pillars already.`,
      ]);
      // Sales goes back to the company's next ones: those are what it gives its teams
      expect(said(await put('/kpis/framework', sessions.hr, team({ attendancePillar: 'discipline', pillars: COMPANY_NEXT })).expect(400))).toEqual([
        `These are the pillars Pillars Sales ${RUN} gives its teams: change a pillar, a weight or the Attendance metric’s pillar first, or keep Pillars Sales ${RUN}’s.`,
      ]);
      expect(await prisma.kpiFramework.count({ where: { departmentId: fieldId } })).toBe(0);
    });

    it('HR sets Field’s own pillars, audited; its row under Sales has them, and its job titles count for it alone', async () => {
      const saved = (await put('/kpis/framework', sessions.hr, team({ nextId: null })).expect(200)).body as KpiFrameworkView;
      const sales = saved.departments.find((d) => d.department.id === salesId)!;
      const field = sales.teams.find((t) => t.department.id === fieldId)!;
      expect(field).toMatchObject({ parent: { id: salesId }, inForce: null, next: { version: 1, departmentId: fieldId, followsCompany: false, appliesFrom: NEXT }, jobTitles: 1, oldTemplates: 1 });
      expect(field.next!.pillars).toEqual(FIELD_PILLARS);
      // Sales's own job title alone now
      expect(sales.jobTitles).toBe(1);
      fieldNextId = field.next!.id;
      expect(await lastAudit('kpi_framework', fieldNextId, 'create')).toMatchObject({
        userId: users.hr,
        diff: { team: `Field ${RUN}`, department: `Pillars Sales ${RUN}`, departmentId: fieldId, version: 1, pillars: ['Visits 70%', 'Clients & Teamwork 30%'], replaces: { followsCompany: true } },
      });
      // a field rep's draft is in Field's pillars
      const draft = (await post(`/kpis/templates/job-titles/${fieldRepId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(draft).toMatchObject({ pillars: FIELD_PILLARS, pillarsFrom: { departmentId: fieldId, nameEn: `Field ${RUN}` }, baseWeights: { visits: 70, clients: 30 } });
      // the sales rep's still Sales's (the company's, Sales going back to them)
      expect(((await get(`/kpis/templates/job-titles/${salesRepId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates).draft).toMatchObject({ pillarsFrom: null });
    });

    it('Field goes back to Sales’s pillars from a month: its job titles take them, from the later month, and move with it', async () => {
      const saved = (await put('/kpis/framework', sessions.hr, { departmentId: fieldId, followsCompany: true, appliesFrom: AFTER, nextId: fieldNextId }).expect(200)).body as KpiFrameworkView;
      const field = saved.departments.find((d) => d.department.id === salesId)!.teams.find((t) => t.department.id === fieldId)!;
      expect(field).toMatchObject({ inForce: null, next: { id: fieldNextId, followsCompany: true, appliesFrom: AFTER } });
      const draftId = (await rowOf(fieldRepId)).draft!.id;
      const draft = (await get(`/kpis/templates/job-titles/${fieldRepId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates;
      expect(draft.draft).toMatchObject({ id: draftId, pillarsFrom: null, attendancePillar: 'discipline' });
      await put(`/kpis/templates/${draftId}`, sessions.hr, {
        attendancePoints: 20,
        metrics: [metric('delivery', 'Visits'), metric('quality', 'Reports'), metric('clients', 'Client feedback')],
      }).expect(200);
      const published = (await post(`/kpis/templates/${draftId}/publish`, sessions.hr).expect(200)).body as KpiTemplateView;
      // the company's apply from next month, Sales takes them from next month, Field from the month after: from then
      expect(published).toMatchObject({ opensFrom: `${monthsLater(AFTER, 1)}-01`, pillarsFrom: null, oldPillars: false });
      // Field back on them from next month instead: the version moves with it
      await put('/kpis/framework', sessions.hr, { departmentId: fieldId, followsCompany: true, appliesFrom: NEXT, nextId: fieldNextId }).expect(200);
      expect(fromDateOnly((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: draftId } })).opensFrom!)).toBe(`${AFTER}-01`);
    });

    it('a team with its own pillars in force isn’t marked when its department’s pillars change', async () => {
      insideId = (await post('/departments', sessions.hr, { nameEn: `Inside ${RUN}`, parentId: salesId }).expect(201)).body.id;
      insideRepId = (await post('/job-titles', sessions.hr, { departmentId: insideId, titleEn: `Inside Rep ${RUN}` }).expect(201)).body.id;
      const saved = (await put('/kpis/framework', sessions.superAdmin, { departmentId: insideId, appliesFrom: NEXT, attendancePillar: 'clients', pillars: INSIDE_PILLARS, nextId: null }).expect(200))
        .body as KpiFrameworkView;
      const insideNext = saved.departments.find((d) => d.department.id === salesId)!.teams.find((t) => t.department.id === insideId)!.next!;
      const draft = (await post(`/kpis/templates/job-titles/${insideRepId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      await put(`/kpis/templates/${draft.id}`, sessions.hr, { attendancePoints: 20, metrics: [metric('calls', 'Calls made'), metric('clients', 'Client feedback')] }).expect(200);
      const published = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body as KpiTemplateView;
      expect(published).toMatchObject({ pillarsFrom: { departmentId: insideId, nameEn: `Inside ${RUN}` }, oldPillars: false });
      expect(published.pillars).toEqual(INSIDE_PILLARS);
      // Inside's own in force since last month's
      await prisma.kpiFramework.update({ where: { id: insideNext.id }, data: { appliesFrom: toDateOnly(firstDay(LAST)) } });
      // Sales's next change becomes its own pillars again
      const sales = (await view()).departments.find((d) => d.department.id === salesId)!;
      await put('/kpis/framework', sessions.hr, { departmentId: salesId, appliesFrom: NEXT, attendancePillar: 'clients', pillars: SALES_PILLARS, nextId: sales.next!.id }).expect(200);
      expect(await rowOf(insideRepId)).toMatchObject({ oldPillars: false });
      const after = (await view()).departments.find((d) => d.department.id === salesId)!;
      expect(after.teams.find((t) => t.department.id === insideId)).toMatchObject({ inForce: { id: insideNext.id }, next: null, jobTitles: 1, oldTemplates: 0 });
      // Sales's own job title and Field's (on Sales's pillars again) count for Sales; Inside's for Inside alone
      expect(after.jobTitles).toBe(2);
    });
  });
});
