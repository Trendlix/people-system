import type { INestApplication } from '@nestjs/common';
import type { KpiFrameworkView, KpiTemplateRow, KpiTemplateView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A job title's own KPI pillars (owner, 3 November 2026: "Yes Please", to a job title having its own pillar names, not
// only weights): a draft saves its own pillars (checked as KPI Pillars checks them, audited), keeps them when saved
// without them, publishes with them from next month, is never "Uses the old pillars" when the company's change, is
// copied with them, and goes back to the pillars it takes. Every name is invented; the test deletes what it made.

const RUN = Date.now().toString(36).toLowerCase();
const NEXT = monthsLater(todayInCairo().slice(0, 7), 1);

const criteria = [
  { label: 'Good', points: 10 },
  { label: 'Half', points: 5 },
  { label: 'Poor', points: 0 },
];
const metric = (pillar: string | null, name: string) => ({ pillar, name, definition: null, howMeasured: null, jdDuties: [], targetPoints: 10, criteria });

/** The videographer's own pillars: three, one of them renamed from the company's, one new. */
const OWN = {
  attendancePillar: 'growth',
  pillars: [
    { key: 'craft', name: 'Craft', weight: 50 },
    { key: 'delivery', name: 'Delivery on Shoot Days', weight: 30 },
    { key: 'growth', name: 'Growth', weight: 20 },
  ],
};
const OWN_CONTENT = { attendancePoints: 20, metrics: [metric('craft', 'Shots approved'), metric('delivery', 'Footage handed over on time')] };
/** The company's next pillars: the plan's four, reweighted. */
const COMPANY_NEXT = [
  { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 40 },
  { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 20 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 20 },
  { key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 20 },
];

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('A job title’s own KPI pillars (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);
  const put = (path: string, session: string, body: object) => api().put(`/api${path}`).set('Cookie', session).send(body);
  const rowOf = async (jobTitleId: string) => ((await get('/kpis/templates', hr).expect(200)).body as KpiTemplateRow[]).find((r) => r.jobTitle.id === jobTitleId)!;
  const lastAudit = (entityId: string, action: string) =>
    prisma.auditLog.findFirst({ where: { entityType: 'kpi_template', entityId, action }, orderBy: { id: 'desc' } }) as Promise<{ diff: Record<string, unknown> } | null>;

  let hr: string;
  let deptId: string;
  let titleId: string;
  let draftId: string;
  let v1: KpiTemplateView;
  let emailDomainBefore: string | null;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    emailDomainBefore = (await get('/company', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await post('/departments', hr, { nameEn: `Own Pillars Media ${RUN}` }).expect(201)).body.id;
    titleId = (await post('/job-titles', hr, { departmentId: deptId, titleEn: `Videographer ${RUN}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.kpiTemplate.deleteMany({ where: { jobTitleId: titleId } });
    // the company's pillars back to the first version, as the other tests expect
    await prisma.kpiFramework.deleteMany({ where: { departmentId: null, version: { gt: 1 } } });
    await prisma.jobTitle.deleteMany({ where: { id: titleId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  it('a draft takes the company’s pillars, and says so: those it goes back to', async () => {
    const draft = (await post(`/kpis/templates/job-titles/${titleId}/draft`, hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
    draftId = draft.id;
    expect(draft).toMatchObject({ ownPillars: false, pillarsFrom: null });
    expect(draft.basePillars!.pillars.map((p) => p.key)).toEqual(['delivery', 'quality', 'clients', 'discipline']);
  });

  it('its own pillars are checked as KPI Pillars checks them, saved, audited, and kept when saved without them', async () => {
    expect(
      said(await put(`/kpis/templates/${draftId}`, hr, { ...OWN_CONTENT, ownPillars: { ...OWN, pillars: [{ ...OWN.pillars[0], weight: 60 }, OWN.pillars[1], { key: 'growth', name: '', weight: 20 }] } }).expect(400)),
    ).toEqual(expect.arrayContaining(['Pillar 3: give it a name.', 'The weights add up to 110%: make them add up to 100%.']));
    const saved = (await put(`/kpis/templates/${draftId}`, hr, { ...OWN_CONTENT, ownPillars: OWN }).expect(200)).body as KpiTemplateView;
    expect(saved).toMatchObject({ ownPillars: true, ownWeights: false, pillarsChanged: false, attendancePillar: 'growth', problems: [] });
    expect(saved.pillars).toEqual([
      { key: 'craft', name: 'Craft', short: 'Craft', weight: 50 },
      { key: 'delivery', name: 'Delivery on Shoot Days', short: 'Delivery', weight: 30 },
      { key: 'growth', name: 'Growth', short: 'Growth', weight: 20 },
    ]);
    expect(saved.metrics.map((m) => m.pillar)).toEqual(['craft', 'delivery']);
    expect(await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: draftId }, select: { ownPillars: true, ownWeights: true } })).toEqual({ ownPillars: true, ownWeights: null });
    expect(await lastAudit(draftId, 'update')).toMatchObject({ diff: { ownPillars: { from: null, to: 'Craft 50% · Delivery on Shoot Days 30% · Growth 20%' } } });
    const again = (await put(`/kpis/templates/${draftId}`, hr, OWN_CONTENT).expect(200)).body as KpiTemplateView;
    expect(again).toMatchObject({ ownPillars: true, attendancePillar: 'growth' });
  });

  it('is published with them, from next month, audited', async () => {
    v1 = (await post(`/kpis/templates/${draftId}/publish`, hr).expect(200)).body as KpiTemplateView;
    expect(v1).toMatchObject({ status: 'published', ownPillars: true, oldPillars: false, opensFrom: `${NEXT}-01` });
    expect(v1.pillars.map((p) => [p.name, p.weight])).toEqual([
      ['Craft', 50],
      ['Delivery on Shoot Days', 30],
      ['Growth', 20],
    ]);
    expect(await lastAudit(draftId, 'publish')).toMatchObject({ diff: { ownPillars: 'Craft 50% · Delivery on Shoot Days 30% · Growth 20%' } });
  });

  it('is never “Uses the old pillars” when the company’s change', async () => {
    const saved = (await put('/kpis/framework', hr, { appliesFrom: NEXT, attendancePillar: 'discipline', pillars: COMPANY_NEXT, nextId: null }).expect(200)).body as KpiFrameworkView;
    expect(saved.departments.find((d) => d.department.id === deptId)).toMatchObject({ oldTemplates: 0 });
    expect(await rowOf(titleId)).toMatchObject({ oldPillars: false });
  });

  it('a draft copied from it keeps them; back to the pillars it takes, its metrics in those', async () => {
    const copy = (await post(`/kpis/templates/job-titles/${titleId}/draft`, hr, { from: 'published' }).expect(201)).body as KpiTemplateView;
    expect(copy).toMatchObject({ ownPillars: true, attendancePillar: 'growth' });
    expect(copy.pillars.map((p) => p.name)).toEqual(['Craft', 'Delivery on Shoot Days', 'Growth']);
    // the company's newest, which it takes: the metrics sent placed in them
    expect(copy.basePillars!.pillars.map((p) => p.weight)).toEqual([40, 20, 20, 20]);
    const back = (
      await put(`/kpis/templates/${copy.id}`, hr, { attendancePoints: 20, metrics: [metric('quality', 'Shots approved'), metric('delivery', 'Footage handed over on time')], ownPillars: null }).expect(200)
    ).body as KpiTemplateView;
    expect(back).toMatchObject({ ownPillars: false, attendancePillar: 'discipline', pillarsFrom: null });
    expect(back.pillars).toEqual(COMPANY_NEXT);
    expect(await lastAudit(copy.id, 'update')).toMatchObject({ diff: { ownPillars: { from: 'Craft 50% · Delivery on Shoot Days 30% · Growth 20%', to: null } } });
  });
});
