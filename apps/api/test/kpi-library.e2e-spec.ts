import type { INestApplication } from '@nestjs/common';
import type { KpiDraftAllResult, KpiLibraryRole, KpiPublishDraftsResult, KpiTemplateView } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The KPI role library (owner, 21 October 2026: "can you add templetes for all departments and job roles"; packages/shared
// kpi-library.ts): HR and a Super Admin list its roles; "Draft templates for every job title" makes a draft from the
// matched role for each job title with no draft and no published version (its title, then its department; the leadership
// metric for a head; its metrics linked to the JD's duty rows), skipping the rest and never touching a published version,
// audited once and for each draft; a draft from a role HR picks; "Publish selected drafts" publishing the drafts that pass
// and saying what stops the others. Every name is invented; the test deletes what it made, the drafts it made for job
// titles of other tests too.

const RUN = Date.now().toString(36).toLowerCase();
const NEXT = monthsLater(todayInCairo().slice(0, 7), 1);

/** A publishable template: one metric in each of the first three pillars. */
const CONTENT = {
  attendancePoints: 20,
  metrics: ['delivery', 'quality', 'clients'].map((pillar, i) => ({
    pillar,
    name: `Metric ${i + 1}`,
    definition: null,
    howMeasured: null,
    jdDuty: null,
    targetPoints: 10,
    criteria: [
      { label: 'Good', points: 10 },
      { label: 'Poor', points: 0 },
    ],
  })),
};

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);

describe('KPI role library (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const get = (path: string, session: string) => api().get(`/api${path}`).set('Cookie', session);
  const post = (path: string, session: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', session).send(body);

  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const titles: Record<string, string> = {};
  const departments: string[] = [];
  /** Every draft made by "Draft templates for every job title", whoever's job title. */
  const madeDrafts = new Set<string>();
  let publishedId: string;
  let draftId: string;
  let result: KpiDraftAllResult;

  async function account(key: string, roles: Parameters<typeof createUser>[1]) {
    const email = await createUser(prisma, roles);
    sessions[key] = await signIn(app, email);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  const jobTitle = async (key: string, body: Record<string, unknown>) => {
    titles[key] = (await post('/job-titles', sessions.hr, body).expect(201)).body.id;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    for (const [key, roles] of [
      ['hr', ['hr']],
      ['superAdmin', ['super_admin']],
      ['ceo', ['ceo']],
      ['admin', ['admin']],
      ['manager', ['manager']],
      ['employee', ['employee']],
    ] as const) {
      await account(key, [...roles]);
    }
    const web = (await post('/departments', sessions.hr, { nameEn: `Library Web ${RUN}` }).expect(201)).body.id as string;
    const mobile = (await post('/departments', sessions.hr, { nameEn: `Mobile ${RUN}`, parentId: web }).expect(201)).body.id as string;
    const ops = (await post('/departments', sessions.hr, { nameEn: `Library Ops ${RUN}` }).expect(201)).body.id as string;
    departments.push(mobile, web, ops);

    await jobTitle('frontend', {
      departmentId: web,
      titleEn: `Senior Frontend Developer ${RUN}`,
      jdDuties: '<ul><li>Deliver assigned sprint tasks on time</li><li>Fix bugs reported by QA before release</li><li>Keep the office plants watered</li></ul>',
    });
    await jobTitle('head', { departmentId: ops, titleEn: `Head of HR ${RUN}` });
    await jobTitle('mobileTeam', { departmentId: mobile, titleEn: `Developer ${RUN}` });
    await jobTitle('arabic', { departmentId: ops, titleEn: `Specialist ${RUN}`, titleAr: 'محاسب' });
    await jobTitle('published', { departmentId: web, titleEn: `Graphic Designer ${RUN}` });
    await jobTitle('drafted', { departmentId: web, titleEn: `Copywriter ${RUN}` });

    // a job title with a published version, and one with a draft already
    const toPublish = (await post(`/kpis/templates/job-titles/${titles.published}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView;
    await api().put(`/api/kpis/templates/${toPublish.id}`).set('Cookie', sessions.hr).send(CONTENT).expect(200);
    publishedId = (await post(`/kpis/templates/${toPublish.id}/publish`, sessions.hr).expect(200)).body.id;
    draftId = ((await post(`/kpis/templates/job-titles/${titles.drafted}/draft`, sessions.hr, { from: 'blank' }).expect(201)).body as KpiTemplateView).id;
  });

  afterAll(async () => {
    const ours = Object.values(titles);
    await prisma.kpiTemplate.deleteMany({ where: { OR: [{ id: { in: [...madeDrafts] } }, { jobTitleId: { in: ours } }] } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: ours } } });
    await prisma.department.deleteMany({ where: { id: { in: departments } } });
    await app.close();
  });

  it('lists the library’s roles for HR and a Super Admin', async () => {
    const roles = (await get('/kpis/templates/library', sessions.hr).expect(200)).body as KpiLibraryRole[];
    expect(roles.length).toBeGreaterThanOrEqual(30);
    expect(roles).toContainEqual({ key: 'frontend-developer', name: 'Frontend Developer', kind: 'development' });
    expect(roles).toContainEqual({ key: 'general', name: 'Universal (Any Role)', kind: 'general' });
    await get('/kpis/templates/library', sessions.superAdmin).expect(200);
    for (const key of ['employee', 'manager', 'ceo', 'admin']) await get('/kpis/templates/library', sessions[key]).expect(403);
  });

  it('only HR and a Super Admin draft every job title', async () => {
    for (const key of ['employee', 'manager', 'ceo', 'admin']) await post('/kpis/templates/draft-all', sessions[key]).expect(403);
    expect(await prisma.kpiTemplate.count({ where: { jobTitleId: { in: [titles.frontend, titles.head, titles.mobileTeam, titles.arabic] } } })).toBe(0);
  });

  it('makes a draft from the matched role where there is none, and leaves the rest as they are', async () => {
    const publishedBefore = await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: publishedId }, include: { metrics: true } });
    const draftBefore = await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: draftId }, include: { metrics: true } });

    result = (await post('/kpis/templates/draft-all', sessions.hr).expect(200)).body as KpiDraftAllResult;
    for (const m of result.made) madeDrafts.add(m.templateId);
    const made = (key: string) => result.made.find((m) => m.jobTitleId === titles[key]);
    const skipped = (key: string) => result.skipped.find((s) => s.jobTitleId === titles[key]);

    expect(made('frontend')).toMatchObject({
      title: `Senior Frontend Developer ${RUN}`,
      department: `Library Web ${RUN}`,
      libraryKey: 'frontend-developer',
      libraryName: 'Frontend Developer',
      leadership: false,
      reason: 'The job title says “frontend developer”.',
    });
    expect(made('head')).toMatchObject({ libraryKey: 'general-hr', leadership: true });
    expect(made('mobileTeam')).toMatchObject({ department: `Library Web ${RUN} › Mobile ${RUN}`, libraryKey: 'mobile-developer', reason: `The department says “mobile”.` });
    expect(made('arabic')).toMatchObject({ libraryKey: 'accountant', reason: 'The job title says “محاسب”.' });
    expect(skipped('published')).toEqual({ jobTitleId: titles.published, title: `Graphic Designer ${RUN}`, department: `Library Web ${RUN}`, why: 'It has a published version: start its next draft from that, on its page.' });
    expect(skipped('drafted')).toMatchObject({ why: 'It has a draft already.' });
    expect(made('published')).toBeUndefined();
    expect(made('drafted')).toBeUndefined();

    // drafts only, version 1, the role's metrics linked to the JD's duty rows
    const frontend = (await get(`/kpis/templates/${made('frontend')!.templateId}`, sessions.hr).expect(200)).body as KpiTemplateView;
    expect(frontend).toMatchObject({ jobTitleId: titles.frontend, version: 1, status: 'draft', attendancePoints: 25, opensFrom: null, problems: [] });
    // each a list of the one linked (25 October 2026: "Yes, several duties"), else none
    expect(frontend.metrics.every((m) => m.jdDuties.length <= 1)).toBe(true);
    const duty = Object.fromEntries(frontend.metrics.map((m) => [m.name, m.jdDuties[0] ?? null]));
    expect(duty['Sprint tasks delivered on time']).toBe('Deliver assigned sprint tasks on time');
    expect(duty['Reopened bugs after QA']).toBe('Fix bugs reported by QA before release');
    expect(duty['Development plan']).toBeNull();
    expect(Object.values(duty)).not.toContain('Keep the office plants watered');
    const head = (await get(`/kpis/templates/${made('head')!.templateId}`, sessions.hr).expect(200)).body as KpiTemplateView;
    expect(head.metrics.filter((m) => m.pillar === 'clients').map((m) => m.name)).toContain('Team delivery and development');
    expect(head.metrics.every((m) => m.jdDuties.length === 0)).toBe(true);
    const page = await get(`/kpis/templates/job-titles/${titles.arabic}`, sessions.hr).expect(200);
    expect(page.body.draft).toMatchObject({ status: 'draft', version: 1 });

    // the published version and the draft there already are untouched; nothing was published
    const publishedAfter = await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: publishedId }, include: { metrics: true } });
    expect(publishedAfter).toEqual(publishedBefore);
    expect(await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: draftId }, include: { metrics: true } })).toEqual(draftBefore);
    expect(await prisma.kpiTemplate.count({ where: { jobTitleId: titles.published } })).toBe(1);
    expect(await prisma.kpiTemplate.count({ where: { id: { in: [...madeDrafts] }, status: { not: 'draft' } } })).toBe(0);

    // the list shows them as drafts
    const rows = (await get('/kpis/templates', sessions.hr).expect(200)).body as { jobTitle: { id: string }; draft: { id: string } | null; inForce: unknown }[];
    expect(rows.find((r) => r.jobTitle.id === titles.frontend)!.draft!.id).toBe(made('frontend')!.templateId);

    // audited: once for the run, and each draft as a draft is
    const run = await prisma.auditLog.findFirst({ where: { action: 'draft_all', userId: users.hr }, orderBy: { id: 'desc' } });
    expect(run).toMatchObject({ entityType: 'kpi_template', diff: { made: result.made.length, skipped: result.skipped.length } });
    expect((run!.diff as { drafts: { templateId: string }[] }).drafts.map((d) => d.templateId).sort()).toEqual([...madeDrafts].sort());
    const created = await prisma.auditLog.findFirst({ where: { action: 'create', entityType: 'kpi_template', entityId: made('frontend')!.templateId } });
    expect(created).toMatchObject({ userId: users.hr, diff: { jobTitleId: titles.frontend, version: 1, status: 'draft', from: 'library', libraryKey: 'frontend-developer', metrics: frontend.metrics.length } });
  });

  it('run again (a Super Admin too), it makes nothing for a job title that has a draft now', async () => {
    const again = (await post('/kpis/templates/draft-all', sessions.superAdmin).expect(200)).body as KpiDraftAllResult;
    for (const m of again.made) madeDrafts.add(m.templateId);
    const ours = Object.values(titles);
    expect(again.made.filter((m) => ours.includes(m.jobTitleId))).toEqual([]);
    expect(again.skipped.filter((s) => ours.includes(s.jobTitleId)).map((s) => s.why)).toEqual(expect.arrayContaining(['It has a draft already.']));
    expect(await prisma.kpiTemplate.count({ where: { jobTitleId: titles.frontend } })).toBe(1);
  });

  it('starts one job title’s draft from a library role HR picks', async () => {
    await jobTitle('picked', { departmentId: departments[2], titleEn: `Coordinator Lead ${RUN}`, jdDuties: '<p>Run technical SEO audits and fixes on client sites</p>' });
    const path = `/kpis/templates/job-titles/${titles.picked}/draft`;
    await post(path, sessions.employee, { from: 'library', libraryKey: 'seo-specialist' }).expect(403);
    expect(said(await post(path, sessions.hr, { from: 'library', libraryKey: 'no-such-role' }).expect(400))).toEqual(['Choose a role from the library.']);
    expect(said(await post(path, sessions.hr, { from: 'library' }).expect(400))).toEqual(['Choose a role from the library.']);
    const draft = (await post(path, sessions.hr, { from: 'library', libraryKey: 'seo-specialist' }).expect(201)).body as KpiTemplateView;
    expect(draft).toMatchObject({ status: 'draft', version: 1, attendancePoints: 20, problems: [] });
    expect(draft.metrics.find((m) => m.name === 'Technical SEO health')!.jdDuties).toEqual(['Run technical SEO audits and fixes on client sites']);
    // "Lead": the leadership metric too
    expect(draft.metrics.map((m) => m.name)).toContain('Team delivery and development');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'create', entityType: 'kpi_template', entityId: draft.id } });
    expect(audit!.diff).toMatchObject({ from: 'library', libraryKey: 'seo-specialist', library: 'SEO Specialist', leadership: true });
    expect(said(await post(path, sessions.hr, { from: 'library', libraryKey: 'seo-specialist' }).expect(409))[0]).toContain('has a draft already');
  });

  it('publishes the drafts chosen that pass, and says what stops the others', async () => {
    const frontendDraft = result.made.find((m) => m.jobTitleId === titles.frontend)!.templateId;
    const missing = '00000000-0000-4000-8000-000000000000';
    const body = { templateIds: [frontendDraft, draftId, publishedId, missing, frontendDraft] };
    for (const key of ['employee', 'manager', 'ceo', 'admin']) await post('/kpis/templates/publish-drafts', sessions[key], body).expect(403);
    expect(said(await post('/kpis/templates/publish-drafts', sessions.hr, { templateIds: [] }).expect(400))).toEqual(['Choose the drafts to publish.']);
    expect(said(await post('/kpis/templates/publish-drafts', sessions.hr, { templateIds: ['nope'] }).expect(400))).toEqual(['Choose the drafts to publish.']);

    const done = (await post('/kpis/templates/publish-drafts', sessions.hr, body).expect(200)).body as KpiPublishDraftsResult;
    expect(done.published).toEqual([{ templateId: frontendDraft, jobTitleId: titles.frontend, title: `Senior Frontend Developer ${RUN}`, version: 1, opensFrom: `${NEXT}-01` }]);
    expect(done.problems.map((p) => [p.templateId, p.title])).toEqual([
      [draftId, `Copywriter ${RUN}`],
      [publishedId, `Graphic Designer ${RUN}`],
      [missing, null],
    ]);
    expect(done.problems[0].problems).toContain('Add a metric to Delivery & Timeliness: every pillar is scored.');
    expect(done.problems[1].problems).toEqual(['Version 1 is published already.']);
    expect(done.problems[2].problems).toEqual(['This KPI template could not be found.']);

    // published from next month; the bad draft is still a draft
    const view = (await get(`/kpis/templates/${frontendDraft}`, sessions.hr).expect(200)).body as KpiTemplateView;
    expect(view).toMatchObject({ status: 'published', opensFrom: `${NEXT}-01`, inForce: false });
    expect((await prisma.kpiTemplate.findUniqueOrThrow({ where: { id: draftId } })).status).toBe('draft');
    madeDrafts.delete(frontendDraft); // deleted with our job titles' templates

    expect(await prisma.auditLog.findFirst({ where: { action: 'publish', entityId: frontendDraft } })).toMatchObject({ userId: users.hr, diff: { status: { from: 'draft', to: 'published' }, opensFrom: `${NEXT}-01` } });
    expect(await prisma.auditLog.findFirst({ where: { action: 'publish_drafts', userId: users.hr }, orderBy: { id: 'desc' } })).toMatchObject({
      diff: { published: [{ templateId: frontendDraft, version: 1 }], refused: 3, opensFrom: `${NEXT}-01` },
    });
  });
});
