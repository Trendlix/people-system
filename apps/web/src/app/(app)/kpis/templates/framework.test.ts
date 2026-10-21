import { KPI_PILLARS, type KpiFrameworkVersionView, type KpiFrameworkView } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  addPillar,
  appliesFromHint,
  frameworkChangedText,
  frameworkConfirmText,
  frameworkFormOf,
  frameworkInputOf,
  frameworkProblems,
  frameworkSavedText,
  inForceText,
  monthChoices,
  movePillar,
  nextText,
  oldPillarsBanner,
  pillarsLabel,
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
