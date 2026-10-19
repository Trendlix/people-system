import type { INestApplication } from '@nestjs/common';
import type { Role } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// GET /org-chart (owner's request, 15 October 2026): the company, its departments in the saved order with their teams in
// theirs, and each job title's headcount; the people's names only for those who see every employee.

// Unique names per run: the test files share one database (emptied at the start of each run).
const RUN = Date.now().toString(36).toUpperCase();
const name = (base: string) => `${base} ${RUN}`;

type Person = { id: string; employeeCode: string; fullNameEn: string; fullNameAr: string };
type Title = { id: string; titleEn: string; titleAr: string | null; headcount: number; people?: Person[] };
type Team = { id: string; nameEn: string; nameAr: string | null; jobTitles: Title[] };
type Chart = {
  company: { nameEn: string; nameAr: string | null; hasLogo: boolean; logoVersion: number | null };
  showsPeople: boolean;
  departments: (Team & { teams: Team[] })[];
};

describe('Org chart (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let admin: string;
  const api = () => request(app.getHttpServer());
  const as = async (roles: Role[]) => signIn(app, await createUser(prisma, roles));
  const chartFor = async (session: string) => (await api().get('/api/org-chart').set('Cookie', session).expect(200)).body as Chart;

  let grades: Map<string, string>;
  const ids: Record<string, string> = {};

  /** POST, as HR, answering the new record's id. */
  const create = async (path: string, body: Record<string, unknown>) => (await api().post(path).set('Cookie', hr).send(body).expect(201)).body.id as string;
  /** A new profile hired with this job title; answers the profile's id and its employment's. */
  const hire = async (fullNameEn: string, jobTitleId: string) => {
    const id = await create('/api/employees', { fullNameEn, fullNameAr: `موظف ${fullNameEn.length}` });
    const res = await api()
      .post(`/api/employees/${id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-02-01', jobTitleId })
      .expect(201);
    return { id, employmentId: res.body.employment.id as string };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await as(['hr']);
    admin = await as(['admin']);
    const list = await api().get('/api/grades').set('Cookie', hr).expect(200);
    grades = new Map((list.body as { id: string; code: string }[]).map((g) => [g.code, g.id]));

    // Marketing (its own job titles, and two teams: one with job titles, one without), then Finance (nothing in it yet)
    ids.marketing = await create('/api/departments', { nameEn: name('Marketing'), nameAr: 'التسويق' });
    ids.finance = await create('/api/departments', { nameEn: name('Finance') });
    ids.content = await create('/api/departments', { nameEn: 'Content Team', nameAr: 'فريق المحتوى', parentId: ids.marketing });
    ids.media = await create('/api/departments', { nameEn: 'Media Team', parentId: ids.marketing });

    ids.coordinator = await create('/api/job-titles', { departmentId: ids.marketing, titleEn: 'Coordinator' }); // any grade
    ids.head = await create('/api/job-titles', {
      departmentId: ids.marketing,
      titleEn: 'Head of Marketing',
      titleAr: 'رئيس التسويق',
      minGradeId: grades.get('G7'),
      maxGradeId: grades.get('G8'),
    });
    ids.writer = await create('/api/job-titles', { departmentId: ids.content, titleEn: 'Writer', maxGradeId: grades.get('G3') });
    ids.senior = await create('/api/job-titles', { departmentId: ids.content, titleEn: 'Senior Writer', minGradeId: grades.get('G5') });

    await hire(name('Zeinab Writer'), ids.writer);
    await hire(name('Adel Writer'), ids.writer);
    await hire(name('Hoda Head'), ids.head);
    // someone who held Senior Writer and left: no longer counted
    const left = await hire(name('Former Senior'), ids.senior);
    await prisma.employment.update({ where: { id: left.employmentId }, data: { endDate: new Date('2026-06-30'), status: 'resigned' } });
  });

  afterAll(async () => {
    await app.close();
  });

  const mine = (chart: Chart) => chart.departments.filter((d) => d.nameEn.endsWith(RUN));

  it('draws the departments in the saved order, with their teams and job titles, the most senior first, and the headcounts', async () => {
    const chart = await chartFor(hr);
    expect(chart.company).toMatchObject({ hasLogo: false, logoVersion: null });
    expect(typeof chart.company.nameEn).toBe('string');
    expect(chart.showsPeople).toBe(true);

    const [marketing, finance] = mine(chart);
    expect(marketing).toMatchObject({ id: ids.marketing, nameEn: name('Marketing'), nameAr: 'التسويق' });
    // a department with nothing in it still shows
    expect(finance).toEqual({ id: ids.finance, nameEn: name('Finance'), nameAr: null, head: null, jobTitles: [], teams: [] });

    // its own job titles: the highest grade first, a title open to any grade last
    expect(marketing.jobTitles.map((t) => [t.titleEn, t.headcount])).toEqual([
      ['Head of Marketing', 1],
      ['Coordinator', 0],
    ]);
    expect(marketing.jobTitles[0].titleAr).toBe('رئيس التسويق');
    expect(marketing.jobTitles[0].people?.map((p) => p.fullNameEn)).toEqual([name('Hoda Head')]);
    expect(marketing.jobTitles[1].people).toEqual([]); // vacant

    expect(marketing.teams.map((t) => [t.nameEn, t.nameAr])).toEqual([
      ['Content Team', 'فريق المحتوى'],
      ['Media Team', null],
    ]);
    const [content, media] = marketing.teams;
    expect(media.jobTitles).toEqual([]);
    // Senior Writer (from G5) before Writer (up to G3); the one who left is not counted
    expect(content.jobTitles.map((t) => [t.titleEn, t.headcount])).toEqual([
      ['Senior Writer', 0],
      ['Writer', 2],
    ]);
    const writers = content.jobTitles[1].people!;
    expect(writers.map((p) => p.fullNameEn)).toEqual([name('Adel Writer'), name('Zeinab Writer')]); // by name
    expect(writers[0]).toEqual({ id: expect.any(String), employeeCode: expect.stringMatching(/^EMP-\d{4}$/), fullNameEn: name('Adel Writer'), fullNameAr: expect.any(String) });
  });

  it('follows the order an Admin sets for the departments and for a department’s teams', async () => {
    const all = (await api().get('/api/departments').set('Cookie', hr).expect(200)).body as { id: string; parentId: string | null }[];
    const top = all.filter((d) => !d.parentId).map((d) => d.id);
    const reordered = [ids.finance, ...top.filter((id) => id !== ids.finance)];
    await api().put('/api/departments/order').set('Cookie', admin).send({ ids: reordered }).expect(204);
    await api().put('/api/departments/order').set('Cookie', admin).send({ parentId: ids.marketing, ids: [ids.media, ids.content] }).expect(204);

    const chart = await chartFor(hr);
    expect(chart.departments.map((d) => d.id)).toEqual(reordered);
    const marketing = chart.departments.find((d) => d.id === ids.marketing)!;
    expect(marketing.teams.map((t) => t.id)).toEqual([ids.media, ids.content]);
  });

  it('gives the names only to those who see every employee: HR, the CEO and Finance', async () => {
    for (const roles of [['ceo'], ['finance']] satisfies Role[][]) {
      const chart = await chartFor(await as(roles));
      expect(chart.showsPeople).toBe(true);
      const content = mine(chart).find((d) => d.id === ids.marketing)!.teams.find((t) => t.id === ids.content)!;
      expect(content.jobTitles.find((t) => t.id === ids.writer)?.people).toHaveLength(2);
    }

    // everyone else gets the structure and the numbers, never who holds a title (an Admin manages the structure, but
    // does not see every employee)
    for (const roles of [['employee'], ['manager'], ['admin'], ['super_admin']] satisfies Role[][]) {
      const chart = await chartFor(await as(roles));
      expect(chart.showsPeople).toBe(false);
      const marketing = mine(chart).find((d) => d.id === ids.marketing)!;
      const titles = [marketing, ...marketing.teams].flatMap((u) => u.jobTitles);
      expect(titles.length).toBe(4);
      for (const t of titles) expect(t).not.toHaveProperty('people');
      expect(titles.find((t) => t.id === ids.writer)?.headcount).toBe(2);
      expect(JSON.stringify(chart)).not.toContain('Writer ' + RUN); // no name anywhere
    }
  });

  it('tells whether the company has a logo, and needs a sign-in', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await api().put('/api/company/logo').set('Cookie', hr).attach('file', png, { filename: 'logo.png', contentType: 'image/png' }).expect(200);
    const chart = await chartFor(await as(['employee']));
    expect(chart.company.hasLogo).toBe(true);
    expect(chart.company.logoVersion).toEqual(expect.any(Number));

    await api().get('/api/org-chart').expect(401);
  });
});
