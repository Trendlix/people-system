import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import type { INestApplication } from '@nestjs/common';
import {
  careersIpToken,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  CV_FIT_VERSION,
  HIDDEN,
  type ApplicationListItem,
  type ApplicationView,
  type CandidateView,
  type CvFit,
  type GeneralCvListItem,
  type GeneralCvView,
  type Role,
  type ScreeningComments,
  type SuggestionAdded,
  type VacancyBoard,
  type VacancyView,
  yearsScore,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { CvReadingsService } from '../src/recruitment/cv-readings.service.js';
import { RecruitmentSchedulerService } from '../src/recruitment/recruitment-scheduler.service.js';
import { VacancySuggestionsService } from '../src/recruitment/vacancy-suggestions.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The CV fit (owner, 25 October 2026, on the Marketing Manager vacancy's applicants added from Suggested From Earlier
// CVs, CV match "—" for all: "aren't you supposed to match the candidate to the job based on the CV and ATS?"; asked,
// "Full CV fit score"; packages/shared cv-fit.ts) and the other open positions a CV fits ("and if it recomended to
// another position based on the CV"). A Marketing Manager vacancy with no key skills, its requirements asking 5+ years,
// a bachelor's in marketing or business and the job's terms; a Media Buyer one with its key skills; a C-level one and a
// closed Media Planner one, never recommended. Their CVs read by the reading round (PDFs with their own text): the fit
// from the title, years, requirements and education, then the key skills once added; the sort and the CV match filter
// by it; the key skills suggested from a description; a media buyer applying for the Marketing Manager job gets "Better
// fit: Media Buyer", the Other Open Positions on their page, CV window and profile, and HR adds them there through the
// suggestions; one applied to both is never recommended either; a general CV's best open position; the hiring manager
// never sees them, a developer sees them masked, without Add; the version sweep. Every person and CV is invented; the
// test deletes what it made.

const RUN = `fit${Date.now().toString(36)}`;
const TODAY = todayInCairo();

const nameOf = (who: string) => `${who[0].toUpperCase()}${who.slice(1)} Person ${RUN}`;
const email = (who: string) => `${who}.${RUN}@mail.test`;
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 13;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2010${String(h % 100_000_000).padStart(8, '0')}`;
};

async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 760 - i * 18, size: 11, font }));
  return Buffer.from(await doc.save());
}

/** A media buyer's CV: fits the Media Buyer job far better than the Marketing Manager one. */
const BUYER_CV = (who: string) => [
  nameOf(who),
  'Experience',
  'Media Buyer, Orbit Agency, Feb 2022 - Present',
  'Paid Social Specialist, Nile Studio, Jan 2020 - Jan 2022',
  'Skills',
  // lines short enough for the page: a PDF's text past its edge isn't read
  'Facebook Ads, Google Ads, TikTok Ads, bidding, pixels,',
  'conversion tracking, daily budgets, ROAS reporting',
  'Education',
  'Bachelor of Commerce, Cairo University, 2019',
];

/** A marketing manager's CV: the Marketing Manager job's, nothing like the Media Buyer one. */
const MANAGER_CV = (who: string) => [
  nameOf(who),
  'Experience',
  'Marketing Manager, Bright Group, Jan 2017 - Present',
  'Marketing Specialist, Nile Media Studio, Jan 2014 - Dec 2016',
  'Skills',
  'Brand strategy, market research, campaign planning, budget ownership,',
  'team leadership, reporting to management, SEO, Google Analytics',
  'Education',
  'Bachelor of Business Administration, Faculty of Commerce, Cairo University, 2013',
];

const MANAGER_REQUIREMENTS =
  '<ul><li>5+ years of experience in marketing, 2 of them leading a team</li><li>Bachelor&#39;s degree in Marketing or Business</li><li>Brand strategy, market research and campaign planning</li><li>Budget ownership and reporting to management</li></ul>';
const BUYER_REQUIREMENTS = '<ul><li>3–5 years buying media on paid social and search</li><li>Hands-on with Meta Ads, Google Ads and TikTok Ads</li><li>Daily budgets, bidding, pixels and conversion tracking</li></ul>';
const BUYER_DUTIES = '<p>Plan and buy paid campaigns; optimise bidding and budgets; report on ROAS and conversions.</p>';

describe('CV fit and other open positions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const departments: string[] = [];
  const titles: Record<string, string> = {};
  const employeeIds: string[] = [];
  const v: Record<string, VacancyView> = {};
  const apps: Record<string, string> = {};

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const ok = (res: request.Response, expected = 200): request.Response => {
    if (res.status !== expected) throw new Error(`Expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];

  async function account(key: string, roles: Role[]) {
    const e = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email: e }, select: { id: true } })).id;
    sessions[key] = await signIn(app, e);
    return e;
  }

  // agency background left out unless a test asks for it (27 October 2026): the fits here are about the other parts
  async function vacancy(key: string, as: 'hr' | 'superAdmin', body: object) {
    const made = ok(await post(as, '/recruitment/vacancies', { employmentType: 'full_time', headcount: 2, closingDate: addDays(TODAY, 30), about: '<p>Made-up work.</p>', agencyBackground: 'not_needed', ...body }), 201).body as VacancyView;
    ok(await post(as, `/recruitment/vacancies/${made.id}/submit`));
    v[key] = ok(await post('ceo', `/recruitment/vacancies/${made.id}/approve`)).body as VacancyView;
    return v[key];
  }

  let ipN = 0;
  async function apply(to: VacancyView, who: string, cv: string[]) {
    const ip = `10.93.${Math.floor(++ipN / 200)}.${(ipN % 200) + 1}`;
    const at = String(Date.now());
    let req = api()
      .post(`/api/public/careers/${to.slug}/apply`).set('x-careers-key', process.env.CAREERS_KEY!)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(to.slug)));
    for (const [k, val] of Object.entries({ fullName: nameOf(who), email: email(who), mobile: mobileOf(who), consent: 'true', answers: '{}', ip })) req = req.field(k, val);
    ok(await req.attach('cv', await pdfOf(cv), `${who}.pdf`), 201);
    return (await prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: to.id, email: email(who) }, select: { id: true } })).id;
  }

  /** The reading round until nothing is left (each round that reads CVs works the open vacancies' suggestions out). */
  async function drain() {
    const readings = app.get(CvReadingsService);
    for (let i = 0; i < 40; i++) if ((await readings.runOnce()) === 0) return;
  }

  const appOf = async (as: string, id: string) => ok(await get(as, `/recruitment/applications/${id}`)).body as ApplicationView;
  const listOf = async (as: string, q: string) => ok(await get(as, `/recruitment/applications?vacancyId=${v.manager.id}&filtered=all${q}`)).body as ApplicationListItem[];
  const keys = (fit: CvFit | null | undefined) => fit?.parts.map((p) => p.key);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('superAdmin', ['super_admin']);
    await account('developer', ['developer', 'employee']);
    const managerEmail = await account('manager', ['employee']);

    const dept = (await prisma.department.create({ data: { nameEn: `Growth ${RUN}` }, select: { id: true } })).id;
    const board = (await prisma.department.create({ data: { nameEn: `Board ${RUN}` }, select: { id: true } })).id;
    departments.push(dept, board);
    const g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;
    for (const [key, title, departmentId, minGradeId] of [
      ['manager', 'Marketing Manager', dept, null],
      ['buyer', 'Media Buyer', dept, null],
      ['planner', 'Media Planner', dept, null],
      ['chief', 'Chief Marketing Officer', board, g9],
    ] as const) {
      titles[key] = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `${title} ${RUN}`, minGradeId }, select: { id: true } })).id;
    }
    const hm = await prisma.employee.create({
      data: {
        employeeCode: `HM-FIT-${RUN}`,
        fullNameEn: `Hana Manager ${RUN}`,
        fullNameAr: 'مديرة',
        workEmail: managerEmail,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId: dept } },
      },
      select: { id: true },
    });
    employeeIds.push(hm.id);
    await prisma.user.update({ where: { id: users.manager }, data: { employeeId: hm.id } });

    // the Marketing Manager job: no key skills; its requirements ask 5+ years, a bachelor's in marketing or business
    await vacancy('manager', 'hr', { jobTitleId: titles.manager, hiringManagerId: hm.id, requirements: MANAGER_REQUIREMENTS, responsibilities: '<p>Own the brand strategy; lead the marketing team; plan campaigns; report results to management.</p>' });
    await vacancy('buyer', 'hr', { jobTitleId: titles.buyer, keySkills: ['Meta Ads', 'Google Ads', 'TikTok Ads'], requirements: BUYER_REQUIREMENTS, responsibilities: BUYER_DUTIES });
    // the same job under another name, closed: never recommended
    await vacancy('planner', 'hr', { jobTitleId: titles.planner, keySkills: ['Meta Ads', 'Google Ads', 'TikTok Ads'], requirements: BUYER_REQUIREMENTS, responsibilities: BUYER_DUTIES });
    ok(await post('hr', `/recruitment/vacancies/${v.planner.id}/close`, { reason: 'Filled elsewhere' }));
    // C-level: never recommended, nor its applicants
    await vacancy('chief', 'superAdmin', { jobTitleId: titles.chief, headcount: 1, requirements: '<p>10+ years leading marketing; brand strategy; media buying budgets</p>' });

    apps.layla = await apply(v.manager, 'layla', BUYER_CV('layla'));
    apps.karim = await apply(v.manager, 'karim', MANAGER_CV('karim'));
    // Nour applied for both jobs already
    apps.nour = await apply(v.manager, 'nour', BUYER_CV('nour'));
    apps.nourBuyer = await apply(v.buyer, 'nour', BUYER_CV('nour'));
    // a general CV of a media buyer's
    let req = api().post('/api/recruitment/general-cvs').set('Cookie', sessions.hr);
    for (const [k, val] of Object.entries({ fullName: nameOf('sami'), email: email('sami'), mobile: mobileOf('sami'), departmentId: dept, source: 'email', consent: 'true' })) req = req.field(k, val);
    apps.sami = (ok(await req.attach('cv', await pdfOf(BUYER_CV('sami')), 'sami.pdf'), 201).body as GeneralCvView).id;
    await drain();
  });

  afterAll(async () => {
    const ids = Object.values(v).map((x) => x.id);
    const candidates = await prisma.candidateContact.findMany({ where: { kind: 'email', value: { endsWith: `.${RUN}@mail.test` } }, select: { candidateId: true } });
    await prisma.vacancySuggestion.deleteMany({ where: { vacancyId: { in: ids } } });
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: ids } } });
    await prisma.generalCv.deleteMany({ where: { email: { endsWith: `.${RUN}@mail.test` } } });
    await prisma.candidate.deleteMany({ where: { id: { in: candidates.map((c) => c.candidateId) } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: ids } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: Object.values(titles) } } });
    await prisma.department.deleteMany({ where: { id: { in: departments } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
  });

  it('a read CV for a vacancy with no key skills: its fit from the title, years, requirements and education', async () => {
    const karim = await appOf('hr', apps.karim);
    const fit = karim.cvReading!.fit!;
    expect(fit.version).toBe(CV_FIT_VERSION);
    expect(keys(fit)).toEqual(['title', 'experience', 'requirements', 'education']);
    // the four left after the key skills, re-weighted to 100: 25, 20, 15, 5 of 65
    expect(fit.parts.map((p) => p.weight)).toEqual([38.5, 30.8, 23.1, 7.7]);
    expect(fit.parts.find((p) => p.key === 'title')).toMatchObject({ matchedTitle: 'Marketing Manager', titleFrom: 'latest' });
    // since Jan 2014 (about 12 years and more): past twice the 5 asked, 4 less a year past 10, never below 70
    const experience = fit.parts.find((p) => p.key === 'experience')!;
    expect(experience).toMatchObject({ fromCv: true, wanted: { min: 5, max: null, from: 'requirements' } });
    expect(experience.years).toBeGreaterThan(12);
    expect(Math.abs(experience.score - yearsScore(experience.years!, { min: 5, max: null }))).toBeLessThanOrEqual(1);
    expect(experience.score).toBeLessThan(100);
    expect(fit.parts.find((p) => p.key === 'education')).toMatchObject({ score: 100, level: 'bachelor', wantedLevel: 'bachelor', fieldMet: true });
    expect(karim.cvMatchPercent).toBe(fit.percent);
    expect(karim.cvReading!.cvMatchPercent).toBe(fit.percent);
    expect(karim.cvMatchPercent).toBeGreaterThanOrEqual(75);
    // the media buyer fits it far less; nobody answered screening questions (the job asks none)
    const layla = await appOf('hr', apps.layla);
    expect(layla.matchPercent).toBeNull();
    expect(layla.cvMatchPercent).toBeLessThan(50);
    expect(keys(layla.cvFit)).toEqual(['title', 'experience', 'requirements', 'education']);
  });

  it('sorts by it ("match": the screening’s, else the fit; "cv") and filters by it (?minCvMatch=)', async () => {
    const byFit = (rows: ApplicationListItem[]) => [...rows].sort((a, b) => (b.cvMatchPercent ?? -1) - (a.cvMatchPercent ?? -1));
    const plain = await listOf('hr', '');
    expect(plain.map((a) => a.id)).toEqual(byFit(plain).map((a) => a.id));
    expect(plain[0].id).toBe(apps.karim);
    expect((await listOf('hr', '&sort=cv')).map((a) => a.id)[0]).toBe(apps.karim);
    const karim = plain.find((a) => a.id === apps.karim)!;
    expect((await listOf('hr', `&minCvMatch=${karim.cvMatchPercent}`)).map((a) => a.id)).toEqual([apps.karim]);
    // the list carries the breakdown
    expect(keys(karim.cvFit)).toEqual(['title', 'experience', 'requirements', 'education']);
  });

  it('suggests key skills from a vacancy’s title and description; adding them scores its applications again', async () => {
    const s = ok(
      await post('hr', '/recruitment/key-skills/suggest', {
        title: 'Media Buyer',
        requirements: '<ul><li>Meta Ads, Google Ads and TikTok Ads</li><li>Excel reports every week</li></ul>',
        responsibilities: '<p>Run Meta Ads and Google Ads campaigns.</p>',
      }),
    ).body as { skills: string[] };
    expect(s.skills).toEqual(['Media buying', 'Meta Ads', 'Google Ads', 'TikTok Ads', 'Excel']);
    expect(ok(await post('hr', '/recruitment/key-skills/suggest', { title: 'Marketing Manager', jobTitleId: titles.manager, requirements: MANAGER_REQUIREMENTS })).body).toEqual({ skills: ['Marketing'] });
    // HR and a Super Admin (who edit vacancies) only
    await post('ceo', '/recruitment/key-skills/suggest', { title: 'Media Buyer' }).expect(403);
    expect(said(await post('hr', '/recruitment/key-skills/suggest', { title: 'x'.repeat(200) }).expect(400))[0]).toMatch(/^Keep the title to/);
    // nothing is saved by suggesting
    expect((ok(await get('hr', `/recruitment/vacancies/${v.manager.id}`)).body as VacancyView).keySkills).toEqual([]);

    const before = await appOf('hr', apps.karim);
    ok(await patch('hr', `/recruitment/vacancies/${v.manager.id}`, { keySkills: ['SEO', 'Google Analytics', 'Brand strategy'] }));
    const after = await appOf('hr', apps.karim);
    expect(keys(after.cvFit)).toEqual(['skills', 'title', 'experience', 'requirements', 'education']);
    expect(after.cvFit!.parts[0]).toMatchObject({ score: 100, found: ['SEO', 'Google Analytics', 'Brand strategy'], missing: [], weight: 35 });
    expect(after.cvMatchPercent).not.toBe(before.cvMatchPercent);
    expect(after.cvReading!.skills).toEqual({ found: ['SEO', 'Google Analytics', 'Brand strategy'], missing: [] });
    // its requirements' text changed: scored again too (the text is saved, though "(text)" before and after)
    ok(await patch('hr', `/recruitment/vacancies/${v.manager.id}`, { requirements: `${MANAGER_REQUIREMENTS}<p>A master's degree in Marketing</p>` }));
    const again = await appOf('hr', apps.karim);
    expect(again.cvFit!.parts.find((p) => p.key === 'education')).toMatchObject({ wantedLevel: 'bachelor' });
    expect((ok(await get('hr', `/recruitment/vacancies/${v.manager.id}`)).body as VacancyView).requirements).toContain('master');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'vacancy', entityId: v.manager.id, action: 'update' }, orderBy: { at: 'desc' } });
    expect(entry.diff).toMatchObject({ requirements: { from: '(text)', to: '(text changed)' } });
  });

  it('an applicant whose CV fits another open vacancy better: "Better fit" on the list and the board, Other Open Positions on their page, CV window and profile', async () => {
    const rows = await listOf('hr', '');
    const layla = rows.find((a) => a.id === apps.layla)!;
    expect(layla.betterFit).toMatchObject({ vacancy: { id: v.buyer.id, number: v.buyer.number, title: v.buyer.title } });
    expect(layla.betterFit!.percent).toBeGreaterThanOrEqual(60);
    expect(layla.betterFit!.percent).toBeGreaterThanOrEqual(layla.cvMatchPercent! + 10);
    expect(layla.betterFit!.others.map((o) => o.vacancy.id)).toEqual([v.buyer.id]);
    // the marketing manager fits his own best: none; Nour applied for the Media Buyer job already: none
    expect(rows.find((a) => a.id === apps.karim)!.betterFit).toBeNull();
    expect(rows.find((a) => a.id === apps.nour)!.betterFit).toBeNull();
    const board = ok(await get('hr', `/recruitment/vacancies/${v.manager.id}/board`)).body as VacancyBoard;
    const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === apps.layla)!;
    expect(card.betterFit).toMatchObject({ vacancy: { id: v.buyer.id }, percent: layla.betterFit!.percent });
    expect(keys(card.cvFit)).toEqual(keys(layla.cvFit));

    const page = await appOf('hr', apps.layla);
    expect(page.openPositions).toHaveLength(1);
    expect(page.openPositions![0]).toMatchObject({ vacancy: { id: v.buyer.id }, percent: layla.betterFit!.percent, can: { add: true } });
    expect(keys(page.openPositions![0].fit)).toEqual(['skills', 'title', 'experience', 'requirements']);
    // the same fit Suggested From Earlier CVs ranks her by on the Media Buyer job
    const suggested = ok(await get('hr', `/recruitment/vacancies/${v.buyer.id}/suggestions`)).body as { rows: { candidate: { id: string }; reasons: { kind: string; percent?: number }[] }[] };
    const laylaCandidate = (await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.layla }, select: { candidateId: true } })).candidateId!;
    expect(suggested.rows.find((r) => r.candidate.id === laylaCandidate)?.reasons.find((r) => r.kind === 'fit')?.percent).toBe(page.openPositions![0].percent);
    // the CV window's
    const window = ok(await get('hr', `/recruitment/applications/${apps.layla}/comments`)).body as ScreeningComments;
    const cv = window.cvs.find((c) => c.id === apps.layla)!;
    expect(cv.fit?.percent).toBe(page.cvMatchPercent);
    expect(cv.openPositions?.map((p) => p.vacancy.id)).toEqual([v.buyer.id]);
    // the profile's
    const profile = ok(await get('hr', `/recruitment/candidates/${laylaCandidate}`)).body as CandidateView;
    expect(profile.openPositions?.map((p) => [p.vacancy.id, p.percent])).toEqual([[v.buyer.id, layla.betterFit!.percent]]);
    expect(profile.applications.find((a) => a.id === apps.layla)?.cvFit?.percent).toBe(page.cvMatchPercent);
  });

  it('never a closed or C-level vacancy, nor one they applied to', async () => {
    for (const id of [apps.layla, apps.karim, apps.nour]) {
      const page = await appOf('hr', id);
      const shown = (page.openPositions ?? []).map((p) => p.vacancy.id);
      expect(shown).not.toContain(v.planner.id);
      expect(shown).not.toContain(v.chief.id);
      expect(shown).not.toContain(v.manager.id);
    }
    // the closed one and the C-level one keep no fits at all
    expect(await prisma.cvOpenFit.count({ where: { vacancyId: { in: [v.planner.id, v.chief.id] } } })).toBe(0);
    // Nour, on both jobs: neither recommended to her
    expect((await appOf('hr', apps.nour)).openPositions).toEqual([]);
    expect((await appOf('hr', apps.nourBuyer)).openPositions).toEqual([]);
  });

  it('a general CV: its best open position on the list (sortable) and its page', async () => {
    const list = ok(await get('hr', '/recruitment/general-cvs?sort=fit')).body as GeneralCvListItem[];
    const sami = list.find((g) => g.id === apps.sami)!;
    expect(sami.bestPosition).toMatchObject({ vacancy: { id: v.buyer.id, title: v.buyer.title } });
    expect(sami.bestPosition!.percent).toBeGreaterThanOrEqual(50);
    const percents = list.map((g) => g.bestPosition?.percent ?? -1);
    expect([...percents].sort((a, b) => b - a)).toEqual(percents);
    const page = ok(await get('hr', `/recruitment/general-cvs/${apps.sami}`)).body as GeneralCvView;
    expect(page.openPositions?.map((p) => p.vacancy.id)).toEqual([v.buyer.id]);
  });

  it('the hiring manager never sees them; a developer sees them masked, without Add, and adds nothing', async () => {
    ok(await post('hr', `/recruitment/applications/${apps.layla}/stage`, { to: 'shortlisted' }));
    const hm = await appOf('manager', apps.layla);
    expect(hm.openPositions).toBeNull();
    const card = (ok(await get('manager', `/recruitment/vacancies/${v.manager.id}/board`)).body as VacancyBoard).columns.flatMap((c) => c.cards).find((c) => c.id === apps.layla)!;
    expect(card.betterFit).toBeUndefined();
    // a developer: the percent and the vacancies, the past titles hidden
    const dev = await appOf('developer', apps.layla);
    expect(dev.openPositions?.map((p) => [p.vacancy.id, p.can.add])).toEqual([[v.buyer.id, false]]);
    const titlesSeen = [...(dev.cvFit?.parts ?? []), ...(dev.openPositions?.[0].fit?.parts ?? [])].filter((p) => p.key === 'title' && p.matchedTitle !== null);
    expect(titlesSeen.length).toBeGreaterThan(0);
    for (const p of titlesSeen) expect(p.matchedTitle).toBe(HIDDEN);
    const devRows = (ok(await get('developer', `/recruitment/applications?vacancyId=${v.manager.id}&filtered=all`)).body as ApplicationListItem[]);
    const devLayla = devRows.find((a) => a.id === apps.layla)!;
    expect(devLayla.cvMatchPercent).toBe(dev.cvMatchPercent);
    expect(devLayla.betterFit).toMatchObject({ vacancy: { id: v.buyer.id } });
    expect(JSON.stringify([devRows, dev])).not.toContain('Paid Social Specialist');
    for (const p of devLayla.cvFit?.parts ?? []) if (p.key === 'title' && p.matchedTitle !== null) expect(p.matchedTitle).toBe(HIDDEN);
    await post('developer', `/recruitment/vacancies/${v.buyer.id}/recommended/add`, { applicationId: apps.layla }).expect(403);
    expect(await prisma.jobApplication.count({ where: { vacancyId: v.buyer.id, email: email('layla') } })).toBe(0);
    // the hiring manager adds nothing either
    await post('manager', `/recruitment/vacancies/${v.buyer.id}/recommended/add`, { applicationId: apps.layla }).expect(403);
  });

  it('Add to this vacancy: their application on the other vacancy through Suggested From Earlier CVs, with its fit; recommended there no more', async () => {
    // not one of the recommended ones: refused, nothing made
    expect(said(await post('hr', `/recruitment/vacancies/${v.buyer.id}/recommended/add`, { applicationId: apps.karim }).expect(409))[0]).toMatch(/^They aren’t recommended for this vacancy now/);
    await post('hr', `/recruitment/vacancies/${v.planner.id}/recommended/add`, { applicationId: apps.layla }).expect(409);
    await post('hr', `/recruitment/vacancies/${v.chief.id}/recommended/add`, { applicationId: apps.layla }).expect(404);
    await post('hr', `/recruitment/vacancies/${v.buyer.id}/recommended/add`, {}).expect(400);

    const shown = (await appOf('hr', apps.layla)).openPositions![0];
    const added = ok(await post('hr', `/recruitment/vacancies/${v.buyer.id}/recommended/add`, { applicationId: apps.layla })).body as SuggestionAdded;
    const made = await prisma.jobApplication.findUniqueOrThrow({
      where: { id: added.applicationId },
      select: { vacancyId: true, source: true, stage: true, matchPercent: true, cvMatchPercent: true, cvFit: true, cvReading: { select: { status: true } }, steps: { select: { note: true } } },
    });
    expect(made).toMatchObject({ vacancyId: v.buyer.id, source: 'earlier_applicant', stage: 'applied', matchPercent: null, cvReading: { status: 'read' } });
    expect(made.steps[0].note).toContain('Suggested From Earlier CVs');
    // a suggested applicant gets the fit: the same as recommended
    expect(made.cvMatchPercent).toBe(shown.percent);
    expect((made.cvFit as unknown as CvFit).parts.map((p) => [p.key, p.score])).toEqual(shown.fit!.parts.map((p) => [p.key, p.score]));
    expect((made.cvFit as unknown as CvFit).version).toBe(CV_FIT_VERSION);
    // its suggestion added, in the audit log
    const laylaCandidate = (await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.layla }, select: { candidateId: true } })).candidateId!;
    const s = await prisma.vacancySuggestion.findUniqueOrThrow({ where: { vacancyId_candidateId: { vacancyId: v.buyer.id, candidateId: laylaCandidate } }, select: { id: true, status: true, applicationId: true } });
    expect(s).toMatchObject({ status: 'added', applicationId: added.applicationId });
    expect(await prisma.auditLog.count({ where: { entityType: 'vacancy_suggestion', entityId: s.id, action: 'add_suggestion', userId: users.hr } })).toBe(1);
    // on the Media Buyer job's list, without screening answers: its match the fit's
    const buyerRows = ok(await get('hr', `/recruitment/applications?vacancyId=${v.buyer.id}&filtered=all`)).body as ApplicationListItem[];
    expect(buyerRows.find((a) => a.id === added.applicationId)).toMatchObject({ matchPercent: null, cvMatchPercent: made.cvMatchPercent, source: 'earlier_applicant' });
    // now on it: recommended there no more, not again
    expect((await appOf('hr', apps.layla)).openPositions).toEqual([]);
    expect((await listOf('hr', '')).find((a) => a.id === apps.layla)!.betterFit).toBeNull();
    await post('hr', `/recruitment/vacancies/${v.buyer.id}/recommended/add`, { applicationId: apps.layla }).expect(409);
  });

  it('a general CV moved to a vacancy is scored for it', async () => {
    ok(await post('hr', `/recruitment/general-cvs/${apps.sami}/move`, { vacancyId: v.manager.id }));
    const moved = await prisma.jobApplication.findFirstOrThrow({ where: { vacancyId: v.manager.id, email: email('sami') }, select: { cvMatchPercent: true, cvFit: true } });
    expect(moved.cvMatchPercent).not.toBeNull();
    expect((moved.cvFit as unknown as CvFit).parts.map((p) => p.key)).toEqual(['skills', 'title', 'experience', 'requirements', 'education']);
  });

  it('the version sweep: fits of an older version, or none (the key skills’ match of before), worked out again; once', async () => {
    const karim = await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.karim }, select: { cvMatchPercent: true, cvFit: true } });
    const nour = await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.nourBuyer }, select: { cvMatchPercent: true, cvFit: true } });
    await prisma.jobApplication.update({ where: { id: apps.karim }, data: { cvMatchPercent: 1, cvFit: { percent: 1, version: CV_FIT_VERSION - 1, parts: [] } } });
    await prisma.$executeRaw`UPDATE job_applications SET cv_fit = NULL, cv_match_percent = 67 WHERE id = ${apps.nourBuyer}::uuid`;
    const readings = app.get(CvReadingsService);
    await app.get(RecruitmentSchedulerService).runOnce();
    const after = await prisma.jobApplication.findMany({ where: { id: { in: [apps.karim, apps.nourBuyer] } }, select: { id: true, cvMatchPercent: true, cvFit: true } });
    expect(after.find((a) => a.id === apps.karim)).toMatchObject({ cvMatchPercent: karim.cvMatchPercent, cvFit: karim.cvFit });
    expect(after.find((a) => a.id === apps.nourBuyer)).toMatchObject({ cvMatchPercent: nour.cvMatchPercent, cvFit: nour.cvFit });
    // nothing left of an older version
    expect(await readings.refreshFits()).toBe(0);
    // and the suggestions' fits worked out by the same round
    await app.get(VacancySuggestionsService).refreshAll({ notify: false });
    expect(await prisma.cvOpenFit.count({ where: { vacancyId: v.buyer.id } })).toBeGreaterThan(0);
  });

  // Marketing agency background (owner, 27 October 2026: "i need a flag if the candidate is ex marketing agencies or not
  // AND reflectin the scoring"; "Name words + your list", "Show agency years", "Set per job", "Yes or no")
  it('agency background: the flag on the page and the list, its part when the job asks it, and HR’s marks scoring again at once', async () => {
    const put = (as: string, body: object) => api().put('/api/recruitment/agency-marks').set('Cookie', sessions[as]).send(body);
    ok(await patch('hr', `/recruitment/vacancies/${v.buyer.id}`, { agencyBackground: 'required' }));
    expect((ok(await get('hr', `/recruitment/vacancies/${v.buyer.id}`)).body as VacancyView).agencyBackground).toBe('required');
    // Nour: Media Buyer at Orbit Agency, Paid Social Specialist at Nile Studio: ex-agency by the names
    const nour = await appOf('hr', apps.nourBuyer);
    const agency = nour.cvReading!.agency!;
    expect(agency.exAgency).toBe(true);
    expect(agency.months).toBeGreaterThanOrEqual(6);
    expect(agency.jobs.map((j) => [j.pastCompany, j.agency, j.by])).toEqual([
      ['Orbit Agency', true, 'name'],
      ['Nile Studio', true, 'name'],
    ]);
    // required: 20 on top of the other parts scored (here 95: no education asked), which shrink to fit
    const parts = nour.cvReading!.fit!.parts;
    const others = parts.filter((p) => p.key !== 'agency').length;
    expect(others).toBeGreaterThan(0);
    expect(parts.find((p) => p.key === 'agency')).toMatchObject({ score: 100, exAgency: true, agencyWanted: 'required', weight: Math.round((1000 * 20) / 115) / 10 });
    const row = (ok(await get('hr', `/recruitment/applications?vacancyId=${v.buyer.id}&filtered=all`)).body as ApplicationListItem[]).find((a) => a.id === apps.nourBuyer)!;
    expect(row.fromCv).toMatchObject({ exAgency: true, agencyMonths: agency.months });
    const before = nour.cvReading!.cvMatchPercent!;
    // HR marks both not agencies, whatever their names say: not ex-agency, the part 0, the match lower at once
    await put('manager', { company: 'Orbit Agency', agency: false }).expect(403);
    expect(said(await put('hr', { company: ' ', agency: false }).expect(400))).toEqual(['Write the company’s name, e.g. Publicis Egypt.']);
    ok(await put('hr', { company: 'Orbit Agency', agency: false }));
    ok(await put('hr', { company: 'nile  STUDIO', agency: false }));
    const after = await appOf('hr', apps.nourBuyer);
    expect(after.cvReading!.agency).toMatchObject({ exAgency: false, months: 0 });
    expect(after.cvReading!.agency!.jobs.map((j) => j.by)).toEqual(['mark', 'mark']);
    expect(after.cvReading!.fit!.parts.find((p) => p.key === 'agency')).toMatchObject({ score: 0 });
    expect(after.cvReading!.cvMatchPercent!).toBeLessThan(before);
    const marks = ok(await get('hr', '/recruitment/agency-marks')).body as { id: string; name: string; agency: boolean; byName: boolean }[];
    const mine = marks.filter((m) => ['Orbit Agency', 'nile  STUDIO'].includes(m.name));
    expect(mine.map((m) => [m.agency, m.byName])).toEqual([
      [false, true],
      [false, true],
    ]);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'agency_mark', entityId: mine[0].id } })).action).toBe('create');
    // the marks removed: told by the names again, scored again
    for (const m of mine) await api().delete(`/api/recruitment/agency-marks/${m.id}`).set('Cookie', sessions.hr).expect(204);
    expect((await appOf('hr', apps.nourBuyer)).cvReading!.cvMatchPercent).toBe(before);
    // not needed: left out of the fit, the flag still shown
    ok(await patch('hr', `/recruitment/vacancies/${v.buyer.id}`, { agencyBackground: 'not_needed' }));
    const plain = await appOf('hr', apps.nourBuyer);
    expect(keys(plain.cvReading!.fit)).not.toContain('agency');
    expect(plain.cvReading!.agency!.exAgency).toBe(true);
  });

  // Experience career or company based, and the skipper (owner, 29 October 2026: "when calculating expirence in the
  // scoring, make it career based or company based. and if the candidate is a skipper or no"; "Span vs time employed",
  // "Set per job", "Short average stay", "Flag + lower the score")
  it('experience company or career based as the job says; a skipper flagged on the page and the list, 10 points off', async () => {
    // Hana: three short jobs, a year off between the first two: under 2 years worked over a 3-year career
    const hana = await apply(v.buyer, 'hana', [
      nameOf('hana'),
      'Experience',
      'Media Buyer, Alpha Foods, Jan 2021 - Aug 2021',
      'Media Buyer, Beta Retail, Sep 2022 - Apr 2023',
      'Paid Social Specialist, Gamma Telecom, May 2023 - Jan 2024',
      'Skills',
      'Facebook Ads, Google Ads, TikTok Ads, bidding, pixels',
    ]);
    await drain();
    expect((ok(await get('hr', `/recruitment/vacancies/${v.buyer.id}`)).body as VacancyView).experienceBasis).toBe('company');
    const company = await appOf('hr', hana);
    expect(company.cvReading!.career).toEqual({ spanMonths: 36, companies: 3, averageStayMonths: 8, skipper: true });
    // company based (the default): the 22 months worked (7, 7 and 8), under the 3–5 asked
    expect(company.cvReading!.fit!.parts.find((p) => p.key === 'experience')).toMatchObject({ basis: 'company', years: 1.8, fromCv: true });
    expect(company.cvReading!.fit!.skipper).toEqual({ penalty: 10, averageStayMonths: 8 });
    const row = (ok(await get('hr', `/recruitment/applications?vacancyId=${v.buyer.id}&filtered=all`)).body as ApplicationListItem[]).find((a) => a.id === hana)!;
    expect(row.fromCv).toMatchObject({ skipper: true, averageStayMonths: 8 });
    // Nour (2 companies): not told, never "not a skipper"
    const nourRow = (ok(await get('hr', `/recruitment/applications?vacancyId=${v.buyer.id}&filtered=all`)).body as ApplicationListItem[]).find((a) => a.id === apps.nourBuyer)!;
    expect(nourRow.fromCv).toMatchObject({ skipper: null, averageStayMonths: null });

    // career based: the 3 years of the career, in the range asked; scored again at once, higher
    expect(said(await patch('hr', `/recruitment/vacancies/${v.buyer.id}`, { experienceBasis: 'tenure' }).expect(400))).toEqual(['Choose how experience is counted: company or career.']);
    ok(await patch('hr', `/recruitment/vacancies/${v.buyer.id}`, { experienceBasis: 'career' }));
    expect((ok(await get('hr', `/recruitment/vacancies/${v.buyer.id}`)).body as VacancyView).experienceBasis).toBe('career');
    const career = await appOf('hr', hana);
    expect(career.cvReading!.fit!.parts.find((p) => p.key === 'experience')).toMatchObject({ basis: 'career', years: 3, score: 100 });
    expect(career.cvReading!.cvMatchPercent!).toBeGreaterThan(company.cvReading!.cvMatchPercent!);
    ok(await patch('hr', `/recruitment/vacancies/${v.buyer.id}`, { experienceBasis: 'company' }));
    expect((await appOf('hr', hana)).cvReading!.cvMatchPercent).toBe(company.cvReading!.cvMatchPercent);
  });
});
