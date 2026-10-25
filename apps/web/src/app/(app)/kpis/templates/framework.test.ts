import { KPI_PILLARS, type KpiDepartmentPillarsView, type KpiFrameworkVersionView, type KpiFrameworkView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  addPillar,
  appliesFromHint,
  attendanceInKpiOf,
  canFollowCompany,
  companyNewest,
  departmentPillarsText,
  allPillarRows,
  departmentRow,
  effectiveNewest,
  followCompanyConfirmText,
  followCompanySavedText,
  frameworkChangedText,
  frameworkConfirmText,
  frameworkFormOf,
  frameworkInputOf,
  frameworkProblems,
  frameworkSavedText,
  hasOwnPillars,
  inForceText,
  jobTitlesCount,
  latestMonth,
  monthChoices,
  movePillar,
  nextText,
  oldPillarsBanner,
  ownPillarsCountText,
  pillarRowsOf,
  pillarsLabel,
  pillarsMonthOf,
  removePillar,
  shortPlaceholder,
  updatePillar,
  weightTotal,
} from './framework';

// The KPI pillars in KPI Settings (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully
// flexible"): the form HR changes them with, what it sends and checks as the API does, and what the page says.

const version = (over: Partial<KpiFrameworkVersionView> = {}): KpiFrameworkVersionView => ({
  id: 'f1',
  version: 1,
  departmentId: null,
  followsCompany: false,
  pillars: [...KPI_PILLARS],
  attendancePillar: 'discipline',
  appliesFrom: '2000-01',
  opensFrom: '2000-02-01',
  createdAt: '2026-10-21T08:00:00.000Z',
  createdBy: null,
  updatedAt: '2026-10-21T08:00:00.000Z',
  updatedBy: null,
  ...over,
});

const VIEW: KpiFrameworkView = {
  inForce: version(),
  next: null,
  defaultMonth: '2026-11',
  earliestMonth: '2026-10',
  latestMonth: '2027-10',
  oldTemplates: 0,
  canEdit: true,
  usedKeys: ['delivery', 'quality', 'clients', 'discipline'],
  departments: [],
};
const TODAY = '2026-10-21';

describe('the form', () => {
  it('starts from the pillars in force, applying from next month', () => {
    const form = frameworkFormOf(VIEW);
    expect(form.appliesFrom).toBe('2026-11');
    expect(form.pillars.map((p) => [p.rowKey, p.key, p.name, p.short, p.weight])).toEqual([
      ['p0', 'delivery', 'Delivery & Timeliness', 'Delivery', '30'],
      ['p1', 'quality', 'Quality of Work', 'Quality', '25'],
      ['p2', 'clients', 'Clients & Teamwork', 'Clients', '25'],
      ['p3', 'discipline', 'Discipline & Growth', 'Discipline', '20'],
    ]);
    expect(form.attendance).toBe('p3');
  });

  it('starts from the next pillars when there are some, in their month', () => {
    const next = version({ id: 'f2', version: 2, appliesFrom: '2026-12', pillars: [{ key: 'all', name: 'All', short: 'All', weight: 100 }], attendancePillar: 'all' });
    const form = frameworkFormOf({ ...VIEW, next });
    expect(form).toEqual({ pillars: [{ rowKey: 'p0', key: 'all', name: 'All', short: 'All', weight: '100' }], attendance: 'p0', appliesFrom: '2026-12' });
  });

  it('sends each pillar with its key, a new one a key of its own (never one a pillar has had), weights as numbers', () => {
    let form = frameworkFormOf(VIEW);
    form = removePillar(form, 'p2');
    form = removePillar(form, 'p3');
    form = addPillar(form, 'n1');
    form = updatePillar(form, 'n1', { name: 'Clients', weight: '20' });
    form = updatePillar(form, 'p0', { weight: '50' });
    form = updatePillar(form, 'p1', { weight: '30' });
    form = { ...form, attendance: 'n1' };
    expect(frameworkInputOf(form, VIEW.usedKeys)).toEqual({
      appliesFrom: '2026-11',
      attendancePillar: 'clients-2',
      pillars: [
        { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 50 },
        { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 30 },
        // "clients" was a pillar's: this one is another
        { key: 'clients-2', name: 'Clients', short: '', weight: 20 },
      ],
    });
    expect(frameworkProblems(form, VIEW.usedKeys, TODAY)).toEqual([]);
    expect(weightTotal(form)).toBe(100);
  });

  it('says what stops the pillars being saved, as the API does', () => {
    let form = updatePillar(frameworkFormOf(VIEW), 'p0', { weight: '25' });
    expect(weightTotal(form)).toBe(95);
    expect(frameworkProblems(form, VIEW.usedKeys, TODAY)).toEqual(['The weights add up to 95%: make them add up to 100%.']);
    form = updatePillar(form, 'p1', { name: 'delivery and timeliness', weight: 'x' });
    expect(weightTotal(form)).toBe(70);
    expect(frameworkProblems(form, VIEW.usedKeys, TODAY)).toEqual([
      'Pillar 2 (delivery and timeliness): pillar 1 has the same name.',
      'Pillar 2 (delivery and timeliness): give its weight as a whole percent from 1 to 100.',
    ]);
    // the Attendance metric's pillar removed: it has to be chosen again
    const removed = removePillar(frameworkFormOf(VIEW), 'p3');
    expect(removed.attendance).toBe('');
    expect(frameworkProblems({ ...removed, appliesFrom: '2026-09' }, VIEW.usedKeys, TODAY)).toEqual([
      'The weights add up to 80%: make them add up to 100%.',
      'Choose the pillar the Attendance metric counts in.',
      'The scorecards of September 2026 are open already: choose October 2026 or a later month.',
    ]);
  });

  it('asks for no Attendance pillar while attendance is out of the KPI, and sends the one it had (owner, 25 October 2026: "Fixed cut only")', () => {
    const removed = removePillar(frameworkFormOf(VIEW), 'p3');
    expect(frameworkProblems({ ...removed, appliesFrom: '2026-09' }, VIEW.usedKeys, TODAY, false)).toEqual([
      'The weights add up to 80%: make them add up to 100%.',
      'The scorecards of September 2026 are open already: choose October 2026 or a later month.',
    ]);
    // the form keeps the pillar it had, sent as it was for when the setting is back on
    expect(frameworkInputOf(frameworkFormOf(VIEW), VIEW.usedKeys).attendancePillar).toBe('discipline');
    expect(attendanceInKpiOf({ attendanceInKpi: false })).toBe(false);
    // on, and an API from before then (nothing said): it counts
    expect(attendanceInKpiOf({ attendanceInKpi: true })).toBe(true);
    expect(attendanceInKpiOf({})).toBe(true);
    expect(attendanceInKpiOf(null)).toBe(true);
  });

  it('adds pillars up to 8, removes them down to 1, and moves them', () => {
    let form = frameworkFormOf(VIEW);
    for (let i = 0; i < 6; i++) form = addPillar(form, `n${i}`);
    expect(form.pillars).toHaveLength(8);
    let one = frameworkFormOf(VIEW);
    for (const k of ['p0', 'p1', 'p2', 'p3']) one = removePillar(one, k);
    expect(one.pillars.map((p) => p.rowKey)).toEqual(['p3']);
    const moved = movePillar(frameworkFormOf(VIEW), 'p3', -1);
    expect(moved.pillars.map((p) => p.key)).toEqual(['delivery', 'quality', 'discipline', 'clients']);
    expect(movePillar(moved, 'p0', -1)).toBe(moved);
    expect(shortPlaceholder('Client Care')).toBe('Client');
    expect(shortPlaceholder('')).toBe('Short name');
  });

  it('offers the months from this one to a year ahead', () => {
    const months = monthChoices('2026-10', '2027-10');
    expect(months).toHaveLength(13);
    expect(months[0]).toEqual({ value: '2026-10', label: 'October 2026' });
    expect(months.at(-1)).toEqual({ value: '2027-10', label: 'October 2027' });
    expect(appliesFromHint('2026-11')).toBe('November 2026’s scorecards open on 01/12/2026.');
  });
});

describe('in words', () => {
  it('says when the pillars apply, and who saved them', () => {
    expect(inForceText(version())).toBe('In force from the start: the plan’s pillars.');
    expect(inForceText(version({ version: 2, appliesFrom: '2026-11' }))).toBe('In force since November 2026’s scorecards.');
    expect(nextText(version({ appliesFrom: '2026-11', opensFrom: '2026-12-01' }))).toBe(
      'Apply from November 2026’s scorecards, which open on 01/12/2026. They can be changed until then.',
    );
    expect(frameworkChangedText(version())).toBeNull();
    expect(frameworkChangedText(version({ updatedBy: { email: 'mona@trendlix.com', name: 'Mona Adel' } }))).toMatch(/^Saved by Mona Adel on 21\/10\/2026, /);
    expect([pillarsLabel(1), pillarsLabel(5)]).toEqual(['1 pillar', '5 pillars']);
  });

  it('asks before saving, and says every template must then be updated', () => {
    expect(frameworkConfirmText('2026-11', false)).toBe(
      'Save these pillars? They apply from November 2026’s scorecards, which open on 01/12/2026. Every template must then be updated to place its metrics in them; until it is, its scorecards keep opening on its old version and old pillars. The scorecards opened already keep theirs.',
    );
    expect(frameworkConfirmText('2026-11', true)).toMatch(/^Save the changes to the next pillars\? /);
    expect(frameworkSavedText('2026-11')).toBe('Saved. The new pillars apply from November 2026’s scorecards: update each template marked “Uses the old pillars”.');
  });

  it('counts the templates on the old pillars, saying their scorecards keep opening on their old version', () => {
    expect(oldPillarsBanner(0, null)).toBeNull();
    const next = { appliesFrom: '2026-11', opensFrom: '2026-12-01' };
    expect(oldPillarsBanner(3, next)).toEqual({
      head: '3 templates use the old pillars: update them.',
      body: 'Open each one marked, start a draft from its version and place its metrics in the new pillars, then publish it. The new pillars apply from November 2026’s scorecards, which open on 01/12/2026. Until a template is updated, its scorecards keep opening on its old version and old pillars, so nobody is left without a scorecard.',
    });
    expect(oldPillarsBanner(1, null)!.head).toBe('1 template uses the old pillars: update it.');
    expect(oldPillarsBanner(1, null)!.body).not.toContain('apply from');
  });
});

// By department (owner, 22 October 2026: "but i need pillars to each department / wights can be changed for each
// department and Job title").
describe('pillars by department', () => {
  const PRODUCTION = 'd0000000-0000-4000-8000-000000000001';
  const SALES = 'd0000000-0000-4000-8000-000000000002';
  const own = version({
    id: 'p1',
    departmentId: PRODUCTION,
    appliesFrom: '2026-09',
    opensFrom: '2026-10-01',
    pillars: [
      { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 50 },
      { key: 'craft', name: 'Craft', short: 'Craft', weight: 30 },
      { key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 20 },
    ],
  });
  const row = (over: Partial<KpiDepartmentPillarsView> = {}): KpiDepartmentPillarsView => ({
    department: { id: PRODUCTION, nameEn: 'Production' },
    parent: null,
    inForce: null,
    next: null,
    jobTitles: 4,
    oldTemplates: 0,
    teams: [],
    ...over,
  });
  const follows = version({ id: 'p2', departmentId: PRODUCTION, version: 2, followsCompany: true, pillars: [], attendancePillar: '', appliesFrom: '2026-12', opensFrom: '2027-01-01' });

  it('starts a department’s form from its own next pillars, else its own in force, else the company’s newest', () => {
    const next = { ...own, id: 'p3', version: 2, appliesFrom: '2026-12', opensFrom: '2027-01-01', pillars: own.pillars.map((p) => ({ ...p, weight: p.key === 'craft' ? 40 : p.key === 'delivery' ? 40 : 20 })) };
    let form = frameworkFormOf(VIEW, row({ inForce: own, next }));
    expect([form.appliesFrom, form.pillars.map((p) => p.weight)]).toEqual(['2026-12', ['40', '40', '20']]);
    form = frameworkFormOf(VIEW, row({ inForce: own }));
    expect([form.appliesFrom, form.pillars.map((p) => p.key)]).toEqual(['2026-11', ['delivery', 'craft', 'discipline']]);
    // going back to the company's: its own in force to start from, the month of the change
    form = frameworkFormOf(VIEW, row({ inForce: own, next: follows }));
    expect([form.appliesFrom, form.pillars.map((p) => p.key)]).toEqual(['2026-12', ['delivery', 'craft', 'discipline']]);
    // none of its own: a copy of the company's newest, keys and all
    const companyNext = version({ id: 'c2', version: 2, appliesFrom: '2026-11', opensFrom: '2026-12-01', pillars: KPI_PILLARS.slice(0, 3).map((p) => ({ ...p, weight: p.key === 'delivery' ? 40 : 30 })) });
    form = frameworkFormOf({ ...VIEW, next: companyNext }, row());
    expect([form.appliesFrom, form.pillars.map((p) => [p.key, p.weight]), form.attendance]).toEqual([
      '2026-11',
      [
        ['delivery', '40'],
        ['quality', '30'],
        ['clients', '30'],
      ],
      '',
    ]);
    expect(companyNewest({ ...VIEW, next: companyNext })).toBe(companyNext);
    expect(companyNewest(VIEW)).toBe(VIEW.inForce);
  });

  it('finds a department’s row by its id, and a team’s department by its name', () => {
    const view = { departments: [row(), row({ department: { id: SALES, nameEn: 'Sales' } })] };
    expect(departmentRow(view, SALES)?.department.nameEn).toBe('Sales');
    expect(departmentRow(view, 'd0000000-0000-4000-8000-000000000009')).toBeNull();
    expect(departmentRow({ departments: undefined as unknown as KpiDepartmentPillarsView[] }, SALES)).toBeNull();
    expect(pillarRowsOf(view, { id: PRODUCTION, nameEn: 'Production', parentName: null }).map((r) => r.department.id)).toEqual([PRODUCTION]);
    // a team the API sent no row for (from before team pillars): its department's, by name
    expect(pillarRowsOf(view, { id: 'team-1', nameEn: 'Video', parentName: 'Production' }).map((r) => r.department.id)).toEqual([PRODUCTION]);
    expect(pillarRowsOf(view, { id: 'team-2', nameEn: 'Design', parentName: 'Marketing' })).toEqual([]);
  });

  it('says whether a department has its own pillars, and whether it can go back to the company’s', () => {
    expect([hasOwnPillars(row()), canFollowCompany(row())]).toEqual([false, false]);
    expect([hasOwnPillars(row({ inForce: own })), canFollowCompany(row({ inForce: own }))]).toEqual([true, true]);
    expect([hasOwnPillars(row({ next: own })), canFollowCompany(row({ next: own }))]).toEqual([true, true]);
    expect([hasOwnPillars(row({ inForce: own, next: follows })), canFollowCompany(row({ inForce: own, next: follows }))]).toEqual([false, true]);
  });

  it('gives the month a job title’s pillars apply from while they are still to come', () => {
    const companyNext = { next: version({ appliesFrom: '2026-11' }) };
    // the company's: their next month, or none in force
    expect(pillarsMonthOf(companyNext, null)).toBe('2026-11');
    expect(pillarsMonthOf({ next: null }, row())).toBeNull();
    expect(pillarsMonthOf(companyNext, row())).toBe('2026-11');
    // its own in force: none to wait for, whatever the company's do
    expect(pillarsMonthOf(companyNext, row({ inForce: own }))).toBeNull();
    // its own coming
    expect(pillarsMonthOf({ next: null }, row({ next: { ...own, appliesFrom: '2027-01' } }))).toBe('2027-01');
    // back to the company's: the later of the two
    expect(pillarsMonthOf({ next: null }, row({ inForce: own, next: follows }))).toBe('2026-12');
    expect(pillarsMonthOf({ next: version({ appliesFrom: '2027-02' }) }, row({ inForce: own, next: follows }))).toBe('2027-02');
    expect(latestMonth(['2026-11', null, '2027-01', undefined])).toBe('2027-01');
    expect(latestMonth([null])).toBeNull();
  });

  it('says a department’s pillars and its next change in words', () => {
    expect(departmentPillarsText(row())).toEqual({ now: 'The company’s pillars', next: null });
    expect(departmentPillarsText(row({ inForce: own, next: follows }))).toEqual({
      now: 'Delivery & Timeliness 50% · Craft 30% · Discipline & Growth 20%',
      next: 'Back to the company’s pillars from December 2026’s scorecards.',
    });
    expect(departmentPillarsText(row({ next: { ...own, appliesFrom: '2026-11' } })).next).toBe(
      'Its own from November 2026’s scorecards: Delivery & Timeliness 50% · Craft 30% · Discipline & Growth 20%.',
    );
    expect(ownPillarsCountText({ departments: [row(), row()] })).toBe('Every department takes the company’s pillars.');
    expect(ownPillarsCountText({ departments: [row({ inForce: own }), row()] })).toBe('1 department has its own pillars; the others take the company’s.');
    expect(ownPillarsCountText({ departments: [row({ inForce: own }), row({ next: own })] })).toBe('2 departments have their own pillars; the others take the company’s.');
    expect([jobTitlesCount(1), jobTitlesCount(4)]).toEqual(['1 job title', '4 job titles']);
    // a department's first version isn't the plan's
    expect(inForceText(own)).toBe('In force since September 2026’s scorecards.');
  });

  it('asks before saving a department’s pillars, or its going back to the company’s, and says what was done', () => {
    expect(frameworkConfirmText('2026-11', false, 'Production')).toBe(
      'Save these pillars for Production? They apply from November 2026’s scorecards, which open on 01/12/2026. Every template of Production’s job titles must then be updated to place its metrics in them; until it is, its scorecards keep opening on its old version and old pillars. The scorecards opened already keep theirs.',
    );
    expect(frameworkConfirmText('2026-11', true, 'Production')).toMatch(/^Save the changes to Production’s next pillars\? /);
    expect(frameworkSavedText('2026-11', 'Production')).toBe(
      'Saved. Production’s new pillars apply from November 2026’s scorecards: update each template marked “Uses the old pillars”.',
    );
    expect(followCompanyConfirmText('Production', '2026-12')).toBe(
      'Take the company’s pillars again for Production? From December 2026’s scorecards, which open on 01/01/2027, its job titles take the company’s pillars. Every template of its job titles must then be updated to place its metrics in them; until it is, its scorecards keep opening on its old version and old pillars. The scorecards opened already keep theirs.',
    );
    expect(followCompanySavedText('Production', '2026-12')).toBe(
      'Saved. Production takes the company’s pillars from December 2026’s scorecards: update each template marked “Uses the old pillars”.',
    );
  });
});

// Team pillars (owner, 22 October 2026: "where is the pillars for team?", then "Yes, add team pillars").
describe('pillars by team', () => {
  const PRODUCTION = 'd0000000-0000-4000-8000-000000000001';
  const VIDEO = 't0000000-0000-4000-8000-000000000001';
  const DESIGN = 't0000000-0000-4000-8000-000000000002';
  const pillars = (names: string[]) => names.map((name, i) => ({ key: name.toLowerCase(), name, short: name, weight: i === 0 ? 100 - (names.length - 1) * 20 : 20 }));
  const prodOwn = version({ id: 'p1', departmentId: PRODUCTION, appliesFrom: '2026-09', pillars: pillars(['Delivery', 'Craft', 'Discipline']), attendancePillar: 'discipline' });
  const videoOwn = version({ id: 'v1', departmentId: VIDEO, appliesFrom: '2026-12', opensFrom: '2027-01-01', pillars: pillars(['Shoots', 'Discipline']), attendancePillar: 'discipline' });
  const videoBack = version({ id: 'v2', departmentId: VIDEO, version: 2, followsCompany: true, pillars: [], attendancePillar: '', appliesFrom: '2027-01', opensFrom: '2027-02-01' });
  const teamRow = (id: string, nameEn: string, over: Partial<KpiDepartmentPillarsView> = {}): KpiDepartmentPillarsView => ({
    department: { id, nameEn },
    parent: { id: PRODUCTION, nameEn: 'Production' },
    inForce: null,
    next: null,
    jobTitles: 1,
    oldTemplates: 0,
    teams: [],
    ...over,
  });
  const production = (teams: KpiDepartmentPillarsView[], over: Partial<KpiDepartmentPillarsView> = {}): KpiDepartmentPillarsView => ({
    department: { id: PRODUCTION, nameEn: 'Production' },
    parent: null,
    inForce: null,
    next: null,
    jobTitles: 3,
    oldTemplates: 0,
    teams,
    ...over,
  });

  it('lists each department’s teams after it, finds a team’s row and its line up to its department', () => {
    const view = { ...VIEW, departments: [production([teamRow(VIDEO, 'Video'), teamRow(DESIGN, 'Design')])] };
    expect(allPillarRows(view).map((r) => r.department.nameEn)).toEqual(['Production', 'Video', 'Design']);
    expect(departmentRow(view, DESIGN)?.parent?.nameEn).toBe('Production');
    expect(pillarRowsOf(view, { id: VIDEO, nameEn: 'Video', parentName: 'Production' }).map((r) => r.department.nameEn)).toEqual(['Video', 'Production']);
  });

  it('a team’s newest pillars: its own, else its department’s, else the company’s', () => {
    const company = version({ id: 'c2', version: 2, appliesFrom: '2026-11', opensFrom: '2026-12-01' });
    const view = (video: Partial<KpiDepartmentPillarsView>, prod: Partial<KpiDepartmentPillarsView> = {}) => ({ ...VIEW, next: company, departments: [production([teamRow(VIDEO, 'Video', video)], prod)] });
    let v = view({ next: videoOwn });
    expect(effectiveNewest(v, departmentRow(v, VIDEO)!)).toBe(videoOwn);
    v = view({}, { inForce: prodOwn });
    expect(effectiveNewest(v, departmentRow(v, VIDEO)!)).toBe(prodOwn);
    v = view({ inForce: videoOwn, next: videoBack }, { inForce: prodOwn });
    expect(effectiveNewest(v, departmentRow(v, VIDEO)!)).toBe(prodOwn);
    v = view({});
    expect(effectiveNewest(v, departmentRow(v, VIDEO)!)).toBe(company);
    // the form of a team without its own starts from them
    const form = frameworkFormOf(v, departmentRow(v, VIDEO)!, prodOwn);
    expect(form.pillars.map((p) => p.key)).toEqual(['delivery', 'craft', 'discipline']);
  });

  it('the month a team’s job title’s pillars apply from: the nearest own, held back by a level going back up', () => {
    const company = { next: version({ appliesFrom: '2026-11' }) };
    // its own coming
    expect(pillarsMonthOf(company, [teamRow(VIDEO, 'Video', { next: videoOwn }), production([])])).toBe('2026-12');
    // none of its own: its department's in force
    expect(pillarsMonthOf(company, [teamRow(VIDEO, 'Video'), production([], { inForce: prodOwn })])).toBeNull();
    // going back to its department's own in force: from its month
    expect(pillarsMonthOf(company, [teamRow(VIDEO, 'Video', { inForce: videoOwn, next: videoBack }), production([], { inForce: prodOwn })])).toBe('2027-01');
    // neither has its own: the company's next
    expect(pillarsMonthOf(company, [teamRow(VIDEO, 'Video'), production([])])).toBe('2026-11');
  });

  it('says a team’s pillars, its going back to its department’s, and counts the teams with their own', () => {
    expect(departmentPillarsText(teamRow(VIDEO, 'Video'))).toEqual({ now: 'Production’s pillars', next: null });
    expect(departmentPillarsText(teamRow(VIDEO, 'Video', { inForce: videoOwn, next: videoBack })).next).toBe('Back to Production’s pillars from January 2027’s scorecards.');
    expect(followCompanyConfirmText('Video', '2027-01', 'Production’s')).toMatch(/^Take Production’s pillars again for Video\? From January 2027’s scorecards, which open on 01\/02\/2027, its job titles take Production’s pillars\. /);
    expect(followCompanySavedText('Video', '2027-01', 'Production’s')).toBe(
      'Saved. Video takes Production’s pillars from January 2027’s scorecards: update each template marked “Uses the old pillars”.',
    );
    expect(ownPillarsCountText({ departments: [production([teamRow(VIDEO, 'Video', { inForce: videoOwn })])] })).toBe('1 team has its own pillars; the others take the company’s.');
    expect(ownPillarsCountText({ departments: [production([teamRow(VIDEO, 'Video', { inForce: videoOwn }), teamRow(DESIGN, 'Design', { next: videoOwn })], { inForce: prodOwn })] })).toBe(
      '1 department and 2 teams have their own pillars; the others take the company’s.',
    );
  });
});
