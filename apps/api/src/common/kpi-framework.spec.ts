import {
  KPI_DEFAULT_PILLAR_SET,
  KPI_PILLARS,
  KPI_SAMPLE_TEMPLATES,
  kpiFrameworkDefaultMonth,
  kpiFrameworkMonthProblems,
  kpiFrameworkOpensFrom,
  kpiLibraryDraft,
  kpiPercentsByName,
  kpiPillarColumns,
  kpiPillarKeyFor,
  kpiPillarNameKey,
  kpiPillarSetOf,
  kpiPillarSetProblems,
  kpiPillarsText,
  kpiPlaceMetrics,
  kpiSamePillars,
  kpiScore,
  kpiShortOf,
  kpiTemplateOpensFrom,
  kpiTemplateProblems,
  kpiUnplacedCount,
  kpiOwnWeights,
  kpiWeightsFit,
  kpiWeightsOf,
  kpiWeightsProblems,
  kpiWithWeights,
  type KpiMetric,
  type KpiPillarSet,
  type KpiScoredMetric,
} from '@trendlix/shared';

// The KPI framework (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?", "Fully flexible"; packages/
// shared kpi-framework.ts and kpis.ts): the pillars' rules (1 to 8, the names different, whole weights adding up to
// 100, the Attendance metric's pillar one of them), the month they apply from, scoring in any set of pillars, a
// template's metrics placed in new pillars by name (Unplaced for those gone), and the month's columns by name.
// Invented pillars.

const THREE: KpiPillarSet = {
  pillars: [
    { key: 'delivery', name: 'Delivery', short: 'Delivery', weight: 50 },
    { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 30 },
    { key: 'growth', name: 'Growth', short: 'Growth', weight: 20 },
  ],
  attendancePillar: 'growth',
};

const FIVE: KpiPillarSet = {
  pillars: [
    { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 30 },
    { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 20 },
    { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 20 },
    { key: 'innovation', name: 'Innovation', short: 'Ideas', weight: 15 },
    { key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 15 },
  ],
  attendancePillar: 'delivery',
};

const pillar = (name: string, weight: number, key = kpiPillarKeyFor(name, [])) => ({ key, name, short: kpiShortOf(name), weight });

describe('the pillars', () => {
  it('passes the plan’s four, and sets of 1 to 8 whose weights add up to 100', () => {
    expect(kpiPillarSetProblems(KPI_DEFAULT_PILLAR_SET)).toEqual([]);
    expect(kpiPillarSetProblems(THREE)).toEqual([]);
    expect(kpiPillarSetProblems(FIVE)).toEqual([]);
    expect(kpiPillarSetProblems({ pillars: [pillar('Everything', 100)], attendancePillar: 'everything' })).toEqual([]);
    const eight = Array.from({ length: 8 }, (_, i) => pillar(`Pillar ${i + 1}`, i < 4 ? 13 : 12));
    expect(kpiPillarSetProblems({ pillars: eight, attendancePillar: eight[0].key })).toEqual([]);
  });

  it('refuses weights that don’t add up to 100, or aren’t whole percents from 1 to 100', () => {
    expect(kpiPillarSetProblems({ ...THREE, pillars: THREE.pillars.map((p, i) => (i === 0 ? { ...p, weight: 45 } : p)) })).toEqual([
      'The weights add up to 95%: make them add up to 100%.',
    ]);
    expect(kpiPillarSetProblems({ ...THREE, pillars: THREE.pillars.map((p, i) => (i === 0 ? { ...p, weight: 49.5 } : i === 1 ? { ...p, weight: 0 } : p)) })).toEqual([
      'Pillar 1 (Delivery): give its weight as a whole percent from 1 to 100.',
      'Pillar 2 (Quality of Work): give its weight as a whole percent from 1 to 100.',
    ]);
  });

  it('takes from 1 to 8 pillars', () => {
    expect(kpiPillarSetProblems({ pillars: [], attendancePillar: 'growth' })).toEqual(['Add a pillar: a framework has from 1 to 8.', 'Choose the pillar the Attendance metric counts in.']);
    const nine = Array.from({ length: 9 }, (_, i) => pillar(`Pillar ${i + 1}`, i === 0 ? 20 : 10));
    expect(kpiPillarSetProblems({ pillars: nine, attendancePillar: nine[0].key })).toEqual(['A framework takes at most 8 pillars.']);
  });

  it('wants each named, the names different (any case, “&” as “and”), a short name, its key, and the Attendance pillar one of them', () => {
    const problems = kpiPillarSetProblems({
      pillars: [
        { key: 'a', name: 'Clients & Teamwork', short: 'Clients', weight: 25 },
        { key: 'b', name: 'clients and  teamwork', short: 'Team', weight: 25 },
        { key: 'c', name: ' ', short: 'X', weight: 25 },
        { key: 'a', name: 'Growth', short: '', weight: 25 },
      ],
      attendancePillar: 'z',
    });
    expect(problems).toEqual([
      'Pillar 2 (clients and  teamwork): pillar 1 has the same name.',
      'Pillar 3: give it a name.',
      'Pillar 4 (Growth): give it a short name.',
      'Pillar 4 (Growth): another pillar has its key. Reload the page and try again.',
      'Choose the pillar the Attendance metric counts in.',
    ]);
  });

  it('tidies what is sent: names trimmed, a short name from the name when none', () => {
    expect(kpiPillarSetOf({ pillars: [{ key: 'client-care', name: '  Client   Care ', short: null, weight: 100 }], attendancePillar: ' client-care ' })).toEqual({
      pillars: [{ key: 'client-care', name: 'Client Care', short: 'Client', weight: 100 }],
      attendancePillar: 'client-care',
    });
  });

  it('gives a new pillar a key of its own from its name', () => {
    expect(kpiPillarKeyFor('Client Care', [])).toBe('client-care');
    expect(kpiPillarKeyFor('Delivery & Timeliness', ['delivery'])).toBe('delivery-and-timeliness');
    expect(kpiPillarKeyFor('Quality', ['quality', 'quality-2'])).toBe('quality-3');
    expect(kpiPillarKeyFor('الجودة', [])).toBe('pillar');
    expect(kpiPillarNameKey(' Clients &  Teamwork ')).toBe('clients and teamwork');
  });

  it('says them in words', () => {
    expect(kpiPillarsText(THREE)).toBe('Delivery 50% · Quality of Work 30% · Growth 20%');
  });

  it('compares sets by what scores: names and weights and the Attendance pillar, not keys, short names or order', () => {
    const reordered: KpiPillarSet = { pillars: [...KPI_PILLARS].reverse().map((p) => ({ ...p, key: `${p.key}-x`, short: 'S' })), attendancePillar: 'discipline-x' };
    expect(kpiSamePillars(KPI_DEFAULT_PILLAR_SET, reordered)).toBe(true);
    expect(kpiSamePillars(KPI_DEFAULT_PILLAR_SET, { ...KPI_DEFAULT_PILLAR_SET, attendancePillar: 'delivery' })).toBe(false);
    expect(kpiSamePillars(KPI_DEFAULT_PILLAR_SET, { ...KPI_DEFAULT_PILLAR_SET, pillars: KPI_PILLARS.map((p) => (p.key === 'quality' ? { ...p, name: 'Work Quality' } : p)) })).toBe(false);
    expect(kpiSamePillars(KPI_DEFAULT_PILLAR_SET, FIVE)).toBe(false);
  });
});

describe('the month they apply from', () => {
  const today = '2026-10-21';

  it('is next month unless chosen, its scorecards opening on the 1st of the month after', () => {
    expect(kpiFrameworkDefaultMonth(today)).toBe('2026-11');
    expect(kpiFrameworkOpensFrom('2026-11')).toBe('2026-12-01');
    expect(kpiFrameworkOpensFrom('2026-12')).toBe('2027-01-01');
  });

  it('may be this month (its scorecards open on the 1st of the next) to a year ahead, never a month already open', () => {
    expect(kpiFrameworkMonthProblems('2026-10', today)).toEqual([]);
    expect(kpiFrameworkMonthProblems('2027-10', today)).toEqual([]);
    expect(kpiFrameworkMonthProblems('2026-09', today)).toEqual(['The scorecards of September 2026 are open already: choose October 2026 or a later month.']);
    expect(kpiFrameworkMonthProblems('2027-11', today)).toEqual(['Choose a month within a year: October 2027 at the latest.']);
    expect(kpiFrameworkMonthProblems('2026-13', today)).toEqual(['Choose the month the pillars apply from, e.g. 2026-11.']);
  });

  it('holds a template version published on new pillars back until they apply', () => {
    // published on 21 October: from 1 November, unless its pillars apply from November (opening 1 December)
    expect(kpiTemplateOpensFrom(today, '2000-01')).toBe('2026-11-01');
    expect(kpiTemplateOpensFrom(today, '2026-10')).toBe('2026-11-01');
    expect(kpiTemplateOpensFrom(today, '2026-11')).toBe('2026-12-01');
    expect(kpiTemplateOpensFrom('2026-11-15', '2026-11')).toBe('2026-12-01');
  });
});

describe('scoring in other pillars', () => {
  const full = { points: 20, achieved: 20 };

  it('works the final % out as Σ pillar % × that pillar’s weight with 3 pillars, Attendance in the chosen one', () => {
    const metrics: KpiScoredMetric[] = [
      { id: 'd', pillar: 'delivery', targetPoints: 40, criteria: [{ label: 'All', points: 40 }, { label: 'Half', points: 20 }] },
      { id: 'q', pillar: 'quality', targetPoints: 30, criteria: [{ label: 'Clean', points: 30 }, { label: 'Some', points: 15 }] },
    ];
    // delivery 20/40 = 50%, quality 30/30 = 100%, growth: Attendance alone 15/20 = 75%
    const s = kpiScore(metrics, { d: 1, q: 0 }, { points: 20, achieved: 15 }, THREE);
    expect(s.pillars.map((p) => [p.key, p.short, p.weight, p.achieved, p.max, p.percent])).toEqual([
      ['delivery', 'Delivery', 50, 20, 40, 50],
      ['quality', 'Quality', 30, 30, 30, 100],
      ['growth', 'Growth', 20, 15, 20, 75],
    ]);
    // 50 × 0.5 + 30 × 1 + 20 × 0.75 = 25 + 30 + 15 = 70
    expect(s.finalPercent).toBe(70);
    expect(s.level).toBe('needs_improvement');
    expect(s.complete).toBe(true);
  });

  it('with 5 pillars, Attendance counted in Delivery', () => {
    const metrics: KpiScoredMetric[] = ['delivery', 'quality', 'clients', 'innovation', 'discipline'].map((pillar) => ({
      id: pillar,
      pillar,
      targetPoints: 20,
      criteria: [
        { label: 'Target', points: 20 },
        { label: 'Half', points: 10 },
      ],
    }));
    // delivery (20 + 20)/(20 + 20) = 100%, innovation 10/20 = 50%, the rest at target: 30 + 20 + 20 + 7.5 + 15 = 92.5
    const s = kpiScore(metrics, { delivery: 0, quality: 0, clients: 0, innovation: 1, discipline: 0 }, full, FIVE);
    expect(s.pillars.map((p) => [p.key, p.max, p.percent])).toEqual([
      ['delivery', 40, 100],
      ['quality', 20, 100],
      ['clients', 20, 100],
      ['innovation', 20, 50],
      ['discipline', 20, 100],
    ]);
    expect(s.finalPercent).toBe(92.5);
    expect(s.level).toBe('meets');
  });

  it('caps at 110 in any pillars, and counts a metric in no pillar of the set nowhere', () => {
    const metrics: KpiScoredMetric[] = [
      { id: 'd', pillar: 'delivery', targetPoints: 10, criteria: [{ label: 'Way over', points: 30 }] },
      { id: 'x', pillar: 'gone', targetPoints: 10, criteria: [{ label: 'None', points: 0 }] },
    ];
    const s = kpiScore(metrics, { d: 0, x: 0 }, full, THREE);
    expect(s.finalPercent).toBe(110);
    expect(s.capped).toBe(true);
    expect(s.pillars.map((p) => p.key)).toEqual(['delivery', 'quality', 'growth']);
  });
});

describe('a template in other pillars', () => {
  const metric = (pillar: string | null, name: string, over: Partial<KpiMetric> = {}): KpiMetric => ({
    pillar,
    name,
    definition: null,
    howMeasured: null,
    jdDuty: null,
    targetPoints: 10,
    criteria: [
      { label: 'Good', points: 10 },
      { label: 'Poor', points: 0 },
    ],
    ...over,
  });

  it('publishes with a metric in every pillar but the Attendance metric’s', () => {
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric('delivery', 'A'), metric('quality', 'B')] }, { publishing: true, pillars: THREE })).toEqual([]);
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric('delivery', 'A')] }, { publishing: true, pillars: THREE })).toEqual([
      'Add a metric to Quality of Work: every pillar is scored.',
    ]);
  });

  it('saves a metric in Unplaced, but not one in a pillar the framework hasn’t; publishes only once Unplaced is empty', () => {
    const content = { attendancePoints: 20, metrics: [metric('delivery', 'A'), metric('quality', 'B'), metric(null, 'C', { wasIn: 'Clients & Teamwork' }), metric(null, 'D')] };
    expect(kpiTemplateProblems(content, { pillars: THREE })).toEqual([]);
    expect(kpiTemplateProblems(content, { publishing: true, pillars: THREE })).toEqual([
      'Metric 3 (C) is in Unplaced: its pillar, Clients & Teamwork, is no longer in the KPI framework. Move it into a pillar, or remove it, before publishing.',
      'Metric 4 (D) is in Unplaced: it has no pillar. Move it into a pillar, or remove it, before publishing.',
    ]);
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric('clients', 'E')] }, { pillars: THREE })).toEqual(['Metric 1 (E): choose one of the framework’s pillars.']);
  });

  it('places metrics in new pillars by name, then by key (a renamed pillar keeps it); the rest in Unplaced, with the pillar they were in', () => {
    const to: KpiPillarSet = {
      pillars: [
        { key: 'speed', name: 'delivery and timeliness', short: 'Speed', weight: 40 }, // the same name, another key
        { key: 'quality', name: 'Work Quality', short: 'Quality', weight: 40 }, // renamed, the same key
        { key: 'growth', name: 'Growth', short: 'Growth', weight: 20 },
      ],
      attendancePillar: 'growth',
    };
    const placed = kpiPlaceMetrics(
      [metric('delivery', 'A'), metric('quality', 'B'), metric('clients', 'C'), metric('discipline', 'D'), metric(null, 'E', { wasIn: 'Growth' })],
      KPI_DEFAULT_PILLAR_SET,
      to,
    );
    expect(placed.map((m) => [m.name, m.pillar, m.wasIn])).toEqual([
      ['A', 'speed', null],
      ['B', 'quality', null],
      ['C', null, 'Clients & Teamwork'],
      ['D', null, 'Discipline & Growth'],
      // Unplaced before, its pillar back
      ['E', 'growth', null],
    ]);
    expect(kpiUnplacedCount([metric('clients', 'C')], KPI_DEFAULT_PILLAR_SET, to)).toBe(1);
    // the same pillars: nothing moves
    expect(kpiPlaceMetrics([metric('clients', 'C')], KPI_DEFAULT_PILLAR_SET, KPI_DEFAULT_PILLAR_SET)).toEqual([{ ...metric('clients', 'C'), wasIn: null }]);
  });

  it('places a sample and a role of the library, written for the plan’s four, in other pillars by name', () => {
    const sample = KPI_SAMPLE_TEMPLATES[0];
    const placed = kpiPlaceMetrics(sample.metrics, KPI_DEFAULT_PILLAR_SET, FIVE);
    expect(placed.every((m) => m.pillar !== null)).toBe(true);
    const library = kpiLibraryDraft('frontend-developer', { title: 'Frontend Developer' })!;
    const inThree = kpiPlaceMetrics(library.content.metrics, KPI_DEFAULT_PILLAR_SET, THREE);
    // Delivery & Timeliness isn't "Delivery", but its key is; Clients & Teamwork and Discipline & Growth are gone
    expect(new Set(inThree.map((m) => m.pillar))).toEqual(new Set(['delivery', 'quality', null]));
    expect(new Set(inThree.filter((m) => m.pillar === null).map((m) => m.wasIn))).toEqual(new Set(['Clients & Teamwork', 'Discipline & Growth']));
    const problems = kpiTemplateProblems({ attendancePoints: 25, metrics: inThree }, { publishing: true, pillars: THREE });
    expect(problems.length).toBe(inThree.filter((m) => m.pillar === null).length);
    expect(problems.every((p) => p.includes('is in Unplaced: its pillar, '))).toBe(true);
  });
});

describe('a month’s pillars, by name', () => {
  it('is one framework’s pillars, in their order, when every scorecard has them', () => {
    const { columns, changed } = kpiPillarColumns([KPI_DEFAULT_PILLAR_SET, KPI_DEFAULT_PILLAR_SET]);
    expect(changed).toBe(false);
    expect(columns.map((c) => [c.key, c.name, c.short, c.weight])).toEqual([
      ['delivery and timeliness', 'Delivery & Timeliness', 'Delivery', 30],
      ['quality of work', 'Quality of Work', 'Quality', 25],
      ['clients and teamwork', 'Clients & Teamwork', 'Clients', 25],
      ['discipline and growth', 'Discipline & Growth', 'Discipline', 20],
    ]);
  });

  it('mixed, the most scorecards’ pillars first, then the others’, a weight only when it is the same', () => {
    const { columns, changed } = kpiPillarColumns([THREE, KPI_DEFAULT_PILLAR_SET, THREE]);
    expect(changed).toBe(true);
    expect(columns.map((c) => [c.name, c.weight])).toEqual([
      ['Delivery', 50],
      ['Quality of Work', null], // 30 on three pillars, 25 on four
      ['Growth', 20],
      ['Delivery & Timeliness', 30],
      ['Clients & Teamwork', 25],
      ['Discipline & Growth', 20],
    ]);
    expect(kpiPercentsByName(THREE, { delivery: 80, quality: 90, growth: null })).toEqual({ delivery: 80, 'quality of work': 90, growth: null });
  });

  it('counts a change of the Attendance pillar alone as pillars changed', () => {
    expect(kpiPillarColumns([KPI_DEFAULT_PILLAR_SET, { ...KPI_DEFAULT_PILLAR_SET, attendancePillar: 'delivery' }]).changed).toBe(true);
  });
});

// A job title's own weights (owner, 22 October 2026: "wights can be changed for each department and Job title").
describe('a job title\'s own weights', () => {
  const own = { delivery: 40, quality: 20, clients: 20, discipline: 20 };

  it('reads a set\'s weights by key', () => {
    expect(kpiWeightsOf(KPI_DEFAULT_PILLAR_SET)).toEqual({ delivery: 30, quality: 25, clients: 25, discipline: 20 });
  });

  it('fits only weights for exactly the set\'s pillars', () => {
    expect(kpiWeightsFit(KPI_DEFAULT_PILLAR_SET, own)).toBe(true);
    expect(kpiWeightsFit(KPI_DEFAULT_PILLAR_SET, { delivery: 50, quality: 50 })).toBe(false);
    expect(kpiWeightsFit(KPI_DEFAULT_PILLAR_SET, { ...own, growth: 0 })).toBe(false);
    expect(kpiWeightsFit(KPI_DEFAULT_PILLAR_SET, null)).toBe(false);
    expect(kpiWeightsFit(KPI_DEFAULT_PILLAR_SET, [40, 20, 20, 20])).toBe(false);
  });

  it('wants whole percents from 1 to 100 adding up to 100, each pillar named', () => {
    expect(kpiWeightsProblems(KPI_DEFAULT_PILLAR_SET, own)).toEqual([]);
    expect(kpiWeightsProblems(KPI_DEFAULT_PILLAR_SET, { ...own, delivery: 50 })).toEqual(['The pillars’ weights add up to 110%: make them add up to 100%.']);
    expect(kpiWeightsProblems(KPI_DEFAULT_PILLAR_SET, { ...own, quality: 0, delivery: 60 })).toEqual(['Quality of Work: give its weight as a whole percent from 1 to 100.']);
    expect(kpiWeightsProblems(KPI_DEFAULT_PILLAR_SET, { ...own, quality: 20.5 })).toEqual(['Quality of Work: give its weight as a whole percent from 1 to 100.']);
    expect(kpiWeightsProblems(KPI_DEFAULT_PILLAR_SET, { delivery: 100 })).toEqual(['The pillars have changed since the page was opened. Reload the page and set the weights again.']);
  });

  it('puts own weights in place when they fit, and leaves the set as it is when they don\'t', () => {
    const weighted = kpiWithWeights(KPI_DEFAULT_PILLAR_SET, own);
    expect(weighted.pillars.map((p) => [p.key, p.name, p.weight])).toEqual([
      ['delivery', 'Delivery & Timeliness', 40],
      ['quality', 'Quality of Work', 20],
      ['clients', 'Clients & Teamwork', 20],
      ['discipline', 'Discipline & Growth', 20],
    ]);
    expect(weighted.attendancePillar).toBe('discipline');
    expect(kpiWithWeights(KPI_DEFAULT_PILLAR_SET, { delivery: 100 }).pillars).toEqual(KPI_PILLARS);
    expect(kpiWithWeights(KPI_DEFAULT_PILLAR_SET, null).pillars).toEqual(KPI_PILLARS);
  });

  it('keeps own weights only when they fit and differ from the set\'s', () => {
    expect(kpiOwnWeights(KPI_DEFAULT_PILLAR_SET, own)).toEqual(own);
    expect(kpiOwnWeights(KPI_DEFAULT_PILLAR_SET, kpiWeightsOf(KPI_DEFAULT_PILLAR_SET))).toBeNull();
    expect(kpiOwnWeights(KPI_DEFAULT_PILLAR_SET, { delivery: 100 })).toBeNull();
    expect(kpiOwnWeights(KPI_DEFAULT_PILLAR_SET, undefined)).toBeNull();
  });

  it('scores with the own weights once in place', () => {
    const a = kpiSamePillars(kpiWithWeights(KPI_DEFAULT_PILLAR_SET, own), KPI_DEFAULT_PILLAR_SET);
    expect(a).toBe(false);
    expect(kpiSamePillars(kpiWithWeights(KPI_DEFAULT_PILLAR_SET, own), kpiWithWeights(KPI_DEFAULT_PILLAR_SET, own))).toBe(true);
  });
});
