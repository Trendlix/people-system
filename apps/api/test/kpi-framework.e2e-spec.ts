import type { INestApplication } from '@nestjs/common';
import type { KpiFrameworkView, KpiJobTitleTemplates, KpiOverview, KpiScorecardView, KpiTemplateRow, KpiTemplateView } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { KpiSchedulerService } from '../src/kpis/kpi-scheduler.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"; packages/
// shared kpi-framework.ts): everyone reads the pillars, HR and a Super Admin change the next ones, audited, from next
// month unless chosen and never from a month whose scorecards are open; a scorecard open already keeps its pillars; a
// template on the old pillars is marked, keeps opening on its old version even once the new pillars apply, then is
// updated (its metrics placed by name, the one whose pillar is gone in Unplaced, which stops publishing) and published
// on the new pillars, applying from their first month; a template made on the new pillars is held back until they
// apply, and moves when their month does; a 3-pillar scorecard's final %, the Attendance metric in the chosen pillar;
// a month mixing old and new pillars averaged by name, in the overview and the Excel. The clock (runOnce) is run with
// moments of the test's own. Every name is invented; the test deletes what it made, and the frameworks after the first.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const LAST = monthsLater(CURRENT, -1);
const NEXT = monthsLater(CURRENT, 1);
const AFTER = monthsLater(CURRENT, 2);
const LATER = monthsLater(CURRENT, 3);
/** A moment on a day, at noon in Cairo whatever the season. */
const at = (day: string) => new Date(`${day}T10:00:00Z`);

const criteria = [
  { label: 'Good', points: 10 },
  { label: 'Half', points: 5 },
  { label: 'Poor', points: 0 },
];
const metric = (pillar: string | null, name: string) => ({ pillar, name, definition: null, howMeasured: null, jdDuty: null, targetPoints: 10, criteria });

/** The analyst's template on the plan's four pillars: one metric in each of the first three. */
const ANALYST = { attendancePoints: 20, metrics: [metric('delivery', 'Reports on time'), metric('quality', 'Data accuracy'), metric('clients', 'Stakeholder feedback')] };

/** The new pillars: Delivery & Timeliness kept (50%), Quality of Work kept (30%), Clients & Teamwork and Discipline & Growth gone, Growth new (20%) with Attendance. */
const NEW_PILLARS = [
  { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 50 },
  { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 30 },
  { key: 'growth', name: 'Growth', short: 'Growth', weight: 20 },
];

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('KPI framework (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: KpiSchedulerService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const put = (path: string, session: string, body: object) => api().put(`/api${path}`).set('Cookie', session).send(body);
  const card = async (id: string, session: string) => (await get(`/kpis/scorecards/${id}`, session).expect(200)).body as KpiScorecardView;
  const cardOf = async (key: string, month: string) =>
    (await prisma.kpiScorecard.findFirst({ where: { employeeId: ids[key], month: toDateOnly(firstDay(month)) }, select: { id: true, templateId: true } }))!;
  const picks = (view: Pick<KpiScorecardView, 'pillars'>, choices: number[]) => view.pillars.flatMap((p) => p.metrics).map((m, i) => ({ metricId: m.id, choice: choices[i] }));
  /** HR scores someone with nobody in charge: straight to the sign-off. */
  const score = async (id: string, choices: number[]) => {
    const view = await card(id, sessions.hr);
    return (await post(`/kpis/scorecards/${id}/score`, sessions.hr, { picks: picks(view, choices), comment: 'Scored', submit: true }).expect(200)).body as KpiScorecardView;
  };

  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  let deptId: string;
  let analystId: string;
  let designerId: string;
  let analystV1: KpiTemplateView;
  let designerV1: KpiTemplateView;
  let framework: KpiFrameworkView;
  let annLast: KpiScorecardView;
  /** Other job titles with a published template (other tests'), on the first framework's pillars. */
  let othersPublished: number;
  let emailDomainBefore: string | null;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    return email;
  }

  /** Someone with a sign-in under a job title, with nobody in charge (HR scores them), employed from before last month. */
  async function person(key: string, name: string, jobTitleId: string) {
    const email = await account(key, ['employee']);
    const res = await post('/employees', sessions.hr, { fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    await prisma.employment.create({
      data: { employeeId: res.body.id, employmentType: 'full_time', status: 'active', joinDate: toDateOnly(firstDay(monthsLater(LAST, -1))), departmentId: deptId, jobTitleId },
    });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    clock = app.get(KpiSchedulerService);
    await account('hr', ['hr']);
    await account('superAdmin', ['super_admin']);
    await account('ceo', ['ceo']);
    await account('admin', ['admin']);
    // the test's work emails aren't the company's domain
    emailDomainBefore = (await get('/company', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    deptId = (await post('/departments', sessions.hr, { nameEn: `Framework Dept ${RUN}` }).expect(201)).body.id;
    analystId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `Framework Analyst ${RUN}` }).expect(201)).body.id;
    designerId = (await post('/job-titles', sessions.hr, { departmentId: deptId, titleEn: `Framework Designer ${RUN}` }).expect(201)).body.id;
    await person('ann', 'Ann Analyst', analystId);
    await person('bo', 'Bo Designer', designerId);

    // the analyst's version 1 on the plan's four pillars, in force since last month's scorecards opened
    const draft = (await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
    await put(`/kpis/templates/${draft.id}`, sessions.hr, ANALYST).expect(200);
    analystV1 = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body;
    await prisma.kpiTemplate.update({ where: { id: analystV1.id }, data: { opensFrom: toDateOnly(firstDay(CURRENT)) } });
  });

  afterAll(async () => {
    await app.get(NotificationsService).flush();
    await prisma.kpiScorecard.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.kpiTemplate.deleteMany({ where: { jobTitleId: { in: [analystId, designerId].filter(Boolean) } } });
    // back to the first framework, as the other tests expect
    await prisma.kpiFramework.deleteMany({ where: { departmentId: null, version: { gt: 1 } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: [analystId, designerId].filter(Boolean) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('a scorecard opens on the plan’s four pillars, as before', async () => {
    await clock.runOnce(at(`${CURRENT}-01`));
    // its self-rating day gone by: HR scores it
    await clock.runOnce(at(`${CURRENT}-04`));
    annLast = await score((await cardOf('ann', LAST)).id, [0, 0, 0]);
    expect(annLast).toMatchObject({ status: 'sign_off', finalPercent: 100, attendancePillar: 'discipline' });
    expect(annLast.pillars.map((p) => [p.key, p.name, p.weight])).toEqual([
      ['delivery', 'Delivery & Timeliness', 30],
      ['quality', 'Quality of Work', 25],
      ['clients', 'Clients & Teamwork', 25],
      ['discipline', 'Discipline & Growth', 20],
    ]);
  });

  describe('the pillars', () => {
    it('everyone reads the ones in force; only HR and a Super Admin change them', async () => {
      const read = (await get('/kpis/framework', sessions.ann).expect(200)).body as KpiFrameworkView;
      expect(read).toMatchObject({ next: null, canEdit: false, defaultMonth: NEXT, earliestMonth: CURRENT, inForce: { version: 1, attendancePillar: 'discipline' } });
      expect(read.inForce.pillars.map((p) => [p.key, p.weight])).toEqual([
        ['delivery', 30],
        ['quality', 25],
        ['clients', 25],
        ['discipline', 20],
      ]);
      expect(read.usedKeys).toEqual(['delivery', 'quality', 'clients', 'discipline']);
      expect((await get('/kpis/framework', sessions.hr).expect(200)).body).toMatchObject({ canEdit: true });
      const body = { appliesFrom: NEXT, attendancePillar: 'growth', pillars: NEW_PILLARS };
      for (const key of ['ann', 'ceo', 'admin']) await put('/kpis/framework', sessions[key], body).expect(403);
    });

    it('refuses pillars that break the rules, a month already open, and the pillars in force unchanged', async () => {
      expect(said(await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'growth', pillars: NEW_PILLARS.map((p) => ({ ...p, weight: p.key === 'growth' ? 10 : p.weight })) }).expect(400))).toEqual([
        'The weights add up to 90%: make them add up to 100%.',
      ]);
      const nine = Array.from({ length: 9 }, (_, i) => ({ key: `p${i + 1}`, name: `Pillar ${i + 1}`, short: `P${i + 1}`, weight: i === 0 ? 20 : 10 }));
      expect(said(await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'p1', pillars: nine }).expect(400))).toEqual(['A framework takes at most 8 pillars.']);
      expect(
        said(await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'growth', pillars: [...NEW_PILLARS.slice(0, 2), { ...NEW_PILLARS[2], name: 'quality of  work' }] }).expect(400)),
      ).toEqual(['Pillar 3 (quality of work): pillar 2 has the same name.']);
      expect(said(await put('/kpis/framework', sessions.hr, { appliesFrom: LAST, attendancePillar: 'growth', pillars: NEW_PILLARS }).expect(400))).toEqual([
        `The scorecards of ${monthName(LAST)} are open already: choose ${monthName(CURRENT)} or a later month.`,
      ]);
      const inForce = ((await get('/kpis/framework', sessions.hr).expect(200)).body as KpiFrameworkView).inForce;
      expect(said(await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: inForce.attendancePillar, pillars: inForce.pillars }).expect(400))).toEqual([
        'These are the pillars in force: change a pillar, a weight or the Attendance metric’s pillar first.',
      ]);
      expect(await prisma.kpiFramework.count({ where: { departmentId: null } })).toBe(1);
    });

    it('HR saves new pillars: they apply from next month, audited; the scorecard open already keeps its own', async () => {
      const rows = (await get('/kpis/templates', sessions.hr).expect(200)).body as KpiTemplateRow[];
      othersPublished = rows.filter((r) => r.versions > 0 && r.jobTitle.id !== analystId).length;
      framework = (await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'growth', pillars: NEW_PILLARS, nextId: null }).expect(200)).body;
      expect(framework).toMatchObject({ inForce: { version: 1 }, next: { version: 2, appliesFrom: NEXT, opensFrom: `${AFTER}-01`, attendancePillar: 'growth' }, oldTemplates: othersPublished + 1 });
      expect(framework.next!.pillars).toEqual(NEW_PILLARS);
      expect(framework.usedKeys).toEqual(['delivery', 'quality', 'clients', 'discipline', 'growth']);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_framework', entityId: framework.next!.id }, orderBy: { id: 'desc' } });
      expect(audit).toMatchObject({
        action: 'create',
        userId: users.hr,
        diff: {
          version: 2,
          appliesFrom: NEXT,
          pillars: ['Delivery & Timeliness 50%', 'Quality of Work 30%', 'Growth 20%'],
          attendancePillar: 'Growth',
          opensFrom: `${AFTER}-01`,
          replaces: { version: 1, pillars: ['Delivery & Timeliness 30%', 'Quality of Work 25%', 'Clients & Teamwork 25%', 'Discipline & Growth 20%'] },
        },
      });
      // the scorecard open already: its pillars and score as they were
      const after = await card(annLast.id, sessions.hr);
      expect(after.pillars).toEqual(annLast.pillars);
      expect(after).toMatchObject({ finalPercent: 100, attendancePillar: 'discipline', status: 'sign_off' });
      // a page loaded before, expecting no next ones, is told
      expect(said(await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'growth', pillars: NEW_PILLARS, nextId: null }).expect(409))[0]).toBe(
        'Someone saved other pillars meanwhile. Reload the page to see them.',
      );
    });

    it('marks the template on the old pillars, on the list and on its page', async () => {
      const rows = (await get('/kpis/templates', sessions.hr).expect(200)).body as KpiTemplateRow[];
      expect(rows.find((r) => r.jobTitle.id === analystId)).toMatchObject({ oldPillars: true, inForce: { id: analystV1.id } });
      expect(rows.find((r) => r.jobTitle.id === designerId)).toMatchObject({ oldPillars: false, versions: 0 });
      const page = (await get(`/kpis/templates/job-titles/${analystId}`, sessions.hr).expect(200)).body as KpiJobTitleTemplates;
      expect(page.versions[0]).toMatchObject({ id: analystV1.id, oldPillars: true, attendancePillar: 'discipline' });
      expect(page.versions[0].pillars.map((p) => p.name)).toEqual(['Delivery & Timeliness', 'Quality of Work', 'Clients & Teamwork', 'Discipline & Growth']);
    });
  });

  describe('a template on the new pillars', () => {
    it('is drafted in them, Attendance in the chosen pillar, and held back until they apply', async () => {
      const draft = (await post(`/kpis/templates/job-titles/${designerId}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
      expect(draft).toMatchObject({ pillars: NEW_PILLARS, attendancePillar: 'growth', pillarsChanged: false });
      expect(draft.problems).toEqual(['Add a metric to Delivery & Timeliness: every pillar is scored.', 'Add a metric to Quality of Work: every pillar is scored.']);
      // a pillar the framework hasn't is refused
      expect(said(await put(`/kpis/templates/${draft.id}`, sessions.hr, { attendancePoints: 20, metrics: [metric('clients', 'Output')] }).expect(400))).toEqual([
        'Metric 1 (Output): choose one of the framework’s pillars.',
      ]);
      await put(`/kpis/templates/${draft.id}`, sessions.hr, { attendancePoints: 20, metrics: [metric('delivery', 'Output'), metric('quality', 'Accuracy')] }).expect(200);
      designerV1 = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body;
      // published this month on pillars that apply from next month: from their first opening, not next month
      expect(designerV1).toMatchObject({ status: 'published', opensFrom: `${AFTER}-01`, firstMonth: NEXT, oldPillars: false, attendancePillar: 'growth' });
      const stored = await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: designerV1.id }, select: { frameworkId: true } });
      expect(stored.frameworkId).toBe(framework.next!.id);
      expect(await prisma.auditLog.findFirst({ where: { entityType: 'kpi_template', entityId: designerV1.id, action: 'publish' } })).toMatchObject({ diff: { framework: 2, opensFrom: `${AFTER}-01` } });
    });

    it('a Super Admin changes the next pillars’ month; the versions on them move with it, audited', async () => {
      const moved = (await put('/kpis/framework', sessions.superAdmin, { appliesFrom: AFTER, attendancePillar: 'growth', pillars: NEW_PILLARS, nextId: framework.next!.id }).expect(200))
        .body as KpiFrameworkView;
      expect(moved.next).toMatchObject({ id: framework.next!.id, version: 2, appliesFrom: AFTER, opensFrom: `${LATER}-01` });
      expect(fromDb(await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: designerV1.id } }))).toBe(`${LATER}-01`);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'kpi_framework', action: 'update' }, orderBy: { id: 'desc' } });
      expect(audit).toMatchObject({ userId: users.superAdmin, diff: { version: 2, appliesFrom: { from: NEXT, to: AFTER }, templatesMoved: 1 } });
      await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'growth', pillars: NEW_PILLARS }).expect(200);
      expect(fromDb(await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: designerV1.id } }))).toBe(`${AFTER}-01`);
    });
  });

  describe('when the new pillars apply', () => {
    it('this month’s scorecards still open on the old ones; the designer’s new version waits', async () => {
      await clock.runOnce(at(`${NEXT}-01`));
      expect((await cardOf('ann', CURRENT)).templateId).toBe(analystV1.id);
      expect(await cardOf('bo', CURRENT)).toBeNull();
    });

    it('the analyst’s keep opening on its old version and old pillars until it is updated; the designer’s on the new ones', async () => {
      await clock.runOnce(at(`${AFTER}-01`));
      const ann = await cardOf('ann', NEXT);
      expect(ann.templateId).toBe(analystV1.id);
      expect((await card(ann.id, sessions.ann)).pillars.map((p) => p.key)).toEqual(['delivery', 'quality', 'clients', 'discipline']);
      const bo = await card((await cardOf('bo', NEXT)).id, sessions.bo);
      expect(bo).toMatchObject({ template: { id: designerV1.id }, attendancePillar: 'growth' });
      // the Attendance metric in Growth, the chosen pillar: its points its only ones there
      expect(bo.pillars.map((p) => [p.key, p.weight, p.max, p.metrics.length])).toEqual([
        ['delivery', 50, 10, 1],
        ['quality', 30, 10, 1],
        ['growth', 20, 20, 0],
      ]);
      // their month's scorecards are open: the pillars can't apply from it any more
      expect(said(await put('/kpis/framework', sessions.hr, { appliesFrom: NEXT, attendancePillar: 'growth', pillars: NEW_PILLARS }).expect(400))).toEqual([
        `The scorecards of ${monthName(NEXT)} are open already: choose a later month.`,
      ]);
    });

    it('a month mixing old and new pillars is averaged by name, in the overview and the Excel', async () => {
      await clock.runOnce(at(`${AFTER}-04`));
      expect((await score((await cardOf('ann', NEXT)).id, [0, 0, 0])).finalPercent).toBe(100);
      // Bo: Output 10/10 × 50 + Accuracy 5/10 × 30 + Growth (Attendance 20/20) × 20 = 50 + 15 + 20
      expect((await score((await cardOf('bo', NEXT)).id, [0, 1])).finalPercent).toBe(85);
      const o = (await get(`/kpis/overview?month=${NEXT}`, sessions.hr).expect(200)).body as KpiOverview;
      expect(o.pillarsChanged).toBe(true);
      // as many scorecards with each: the newest version's pillars first, then the others'
      expect(o.pillars.map((c) => [c.name, c.weight])).toEqual([
        ['Delivery & Timeliness', null],
        ['Quality of Work', null],
        ['Growth', 20],
        ['Clients & Teamwork', 25],
        ['Discipline & Growth', 20],
      ]);
      const dept = o.departments.find((d) => d.id === deptId)!;
      expect(dept).toMatchObject({ scored: 2, average: 92.5 });
      expect(dept.pillars).toEqual({ 'delivery and timeliness': 100, 'quality of work': 75, 'clients and teamwork': 100, 'discipline and growth': 100, growth: 100 });

      const file = await get(`/kpis/export?month=${NEXT}`, sessions.hr).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.body as unknown as ArrayBuffer);
      const header = (wb.worksheets[0].getRow(1).values as unknown[]).filter(Boolean);
      expect(header).toEqual(expect.arrayContaining(['Delivery & Timeliness', 'Quality of Work', 'Clients & Teamwork (25%)', 'Discipline & Growth (20%)', 'Growth (20%)']));
    });
  });

  describe('updating the old template', () => {
    let draft: KpiTemplateView;

    it('places its metrics in the new pillars by name; the one whose pillar is gone in Unplaced stops publishing', async () => {
      draft = (await post(`/kpis/templates/job-titles/${analystId}/draft`, sessions.hr, { from: 'published' }).expect(201)).body;
      expect(draft).toMatchObject({ version: 2, pillars: NEW_PILLARS, attendancePillar: 'growth', pillarsChanged: true });
      expect(draft.metrics.map((m) => [m.name, m.pillar, m.wasIn ?? null])).toEqual([
        ['Reports on time', 'delivery', null],
        ['Data accuracy', 'quality', null],
        ['Stakeholder feedback', null, 'Clients & Teamwork'],
      ]);
      const refusal = 'Metric 3 (Stakeholder feedback) is in Unplaced: its pillar, Clients & Teamwork, is no longer in the KPI framework. Move it into a pillar, or remove it, before publishing.';
      expect(draft.problems).toEqual([refusal]);
      expect(said(await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(400))).toEqual([refusal]);
      // saved as it is: the one in Unplaced stays there, with where it was
      const saved = (await put(`/kpis/templates/${draft.id}`, sessions.hr, { attendancePoints: 20, metrics: draft.metrics }).expect(200)).body as KpiTemplateView;
      expect(saved).toMatchObject({ pillarsChanged: false, problems: [refusal] });
      // "Publish selected drafts" says the same
      const bulk = (await post('/kpis/templates/publish-drafts', sessions.hr, { templateIds: [draft.id] }).expect(200)).body;
      expect(bulk).toMatchObject({ published: [], problems: [{ templateId: draft.id, problems: [refusal] }] });
    });

    it('moved into a pillar, it publishes on the new pillars, from their first month; the mark goes', async () => {
      await put(`/kpis/templates/${draft.id}`, sessions.hr, { attendancePoints: 20, metrics: [metric('delivery', 'Reports on time'), metric('quality', 'Data accuracy'), metric('growth', 'Stakeholder feedback')] }).expect(200);
      const v2 = (await post(`/kpis/templates/${draft.id}/publish`, sessions.hr).expect(200)).body as KpiTemplateView;
      expect(v2).toMatchObject({ version: 2, status: 'published', opensFrom: `${AFTER}-01`, pillars: NEW_PILLARS, attendancePillar: 'growth', oldPillars: false });
      const rows = (await get('/kpis/templates', sessions.hr).expect(200)).body as KpiTemplateRow[];
      expect(rows.find((r) => r.jobTitle.id === analystId)).toMatchObject({ oldPillars: false });
      expect(((await get('/kpis/framework', sessions.hr).expect(200)).body as KpiFrameworkView).oldTemplates).toBe(othersPublished);
      // version 1 keeps its own, the old ones
      const v1 = (await get(`/kpis/templates/${analystV1.id}`, sessions.hr).expect(200)).body as KpiTemplateView;
      expect(v1).toMatchObject({ oldPillars: true, attendancePillar: 'discipline' });
    });

    it('a 3-pillar scorecard’s final % is Σ pillar % × its weight', async () => {
      await clock.runOnce(at(`${LATER}-01`));
      await clock.runOnce(at(`${LATER}-04`));
      const ann = await cardOf('ann', AFTER);
      const view = await card(ann.id, sessions.hr);
      expect(view.pillars.map((p) => [p.key, p.metrics.map((m) => m.name)])).toEqual([
        ['delivery', ['Reports on time']],
        ['quality', ['Data accuracy']],
        ['growth', ['Stakeholder feedback']],
      ]);
      // Reports on time 5/10 × 50 + Data accuracy 10/10 × 30 + Growth (10 + Attendance 20)/(10 + 20) × 20 = 25 + 30 + 20
      const scored = await score(ann.id, [1, 0, 0]);
      expect(scored).toMatchObject({ finalPercent: 75, level: 'needs_improvement' });
      expect(scored.score!.pillars.map((p) => [p.key, p.percent])).toEqual([
        ['delivery', 50],
        ['quality', 100],
        ['growth', 100],
      ]);
      const kept = await prisma.kpiScorecard.findUniqueOrThrow({ where: { id: ann.id }, select: { pillars: true } });
      expect(kept.pillars).toEqual({ delivery: 50, quality: 100, growth: 100 });
      // the month before, on the old pillars, as it was
      expect((await card((await cardOf('ann', NEXT)).id, sessions.hr)).pillars.map((p) => p.key)).toEqual(['delivery', 'quality', 'clients', 'discipline']);
    });
  });
});

/** A template version's opens-from day, YYYY-MM-DD. */
function fromDb(row: { opensFrom: Date | null }): string | null {
  return row.opensFrom ? row.opensFrom.toISOString().slice(0, 10) : null;
}
