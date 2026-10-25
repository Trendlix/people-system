import {
  EMPTY_PAYROLL_INPUTS,
  KPI_ATTENDANCE_IN_KPI_DEFAULT,
  KPI_DEFAULT_PILLAR_SET,
  KPI_PERFORMANCE_ONLY_NOTE,
  KPI_SAMPLE_TEMPLATES,
  kpiAttendanceIn,
  kpiAveragesAttendance,
  kpiLevel,
  kpiPerformanceOnly,
  kpiPillarSetProblems,
  kpiScore,
  kpiTemplateProblems,
  PAYROLL_RULE_DEFAULTS,
  payrollLine,
  type KpiMetric,
  type KpiPillarSet,
  type KpiScoredMetric,
  type PayrollInputs,
  type PayrollTerms,
} from '@trendlix/shared';
import { payslipSource } from '../../test/fixtures/payslip.js';
import { keptAttendancePillar } from '../kpis/kpi-framework.service.js';
import { payslipContent } from '../payroll/payslip-content.js';

// Attendance leaves the KPI (owner, 25 October 2026, asked whether attendance is cut twice, on the fixed part of the pay
// below the 90% grace and through the KPI's Attendance metric on the variable part: "Fixed cut only"; packages/shared
// kpis.ts and payroll.ts). With the setting Attendance in the KPI off, the KPI measures performance only: no Attendance
// points in any pillar, the pillar Attendance was alone in left out with its weight spread over the others; the
// templates' Attendance points and the pillar sets' Attendance pillar aren't asked for; the legacy KPI average of a
// payroll line (KPI inputs typed, no scorecard) is of those inputs alone on the rules copied since. With it on, all is
// as it was. Invented figures.

/** One metric a pillar, targets 30 / 25 / 25 / 20, Attendance worth 20 in Discipline & Growth (as kpis.spec.ts). */
const metrics: KpiScoredMetric[] = [
  { id: 'd', pillar: 'delivery', targetPoints: 30, criteria: [{ label: 'All on time', points: 30 }, { label: '1 late', points: 20 }, { label: 'Way ahead', points: 36 }] },
  { id: 'q', pillar: 'quality', targetPoints: 25, criteria: [{ label: 'No errors', points: 25 }, { label: 'Some', points: 10 }] },
  { id: 'c', pillar: 'clients', targetPoints: 25, criteria: [{ label: 'Great', points: 25 }, { label: 'Fine', points: 15 }, { label: 'Poor', points: 0 }] },
  { id: 'g', pillar: 'discipline', targetPoints: 20, criteria: [{ label: '2 courses', points: 20 }, { label: 'None', points: 0 }] },
];
const picks = { d: 1, q: 0, c: 1, g: 0 };

describe('scoring without attendance (owner, 25 October 2026: "Fixed cut only")', () => {
  it('is off from then, and kpiAttendanceIn gives kpiScore nothing for the Attendance metric while it is', () => {
    expect(KPI_ATTENDANCE_IN_KPI_DEFAULT).toBe(false);
    expect(kpiAttendanceIn(false, 20, 15)).toBeNull();
    expect(kpiAttendanceIn(true, 20, 15)).toEqual({ points: 20, achieved: 15 });
  });

  it('adds no Attendance points to any pillar: each pillar’s % is its metrics’ alone', () => {
    const s = kpiScore(metrics, picks, null);
    // delivery 20/30, quality 25/25, clients 15/25, discipline 20/20 (no Attendance points in it)
    expect(s.pillars.map((p) => [p.key, p.achieved, p.max, p.percent])).toEqual([
      ['delivery', 20, 30, 66.7],
      ['quality', 25, 25, 100],
      ['clients', 15, 25, 60],
      ['discipline', 20, 20, 100],
    ]);
    // 20 + 25 + 15 + 20 = 80
    expect(s.finalPercent).toBe(80);
    expect(s.pillars.some((p) => p.leftOut)).toBe(false);
  });

  it('scores poor attendance the same as full attendance: the KPI is performance only', () => {
    const off = kpiScore(metrics, picks, null);
    // the same scorecard with the metric counting: full attendance 80, none at all 70 (discipline 20 of 40)
    expect(kpiScore(metrics, picks, { points: 20, achieved: 20 }).finalPercent).toBe(80);
    expect(kpiScore(metrics, picks, { points: 20, achieved: 0 }).finalPercent).toBe(70);
    expect(off.finalPercent).toBe(80);
    expect(kpiScore(metrics, picks, kpiAttendanceIn(false, 20, 0))).toEqual(off);
  });

  it('leaves out the pillar Attendance was alone in, its weight spread over the others in proportion', () => {
    // no metric in Discipline & Growth (as the role library has many): its 20% spread over 30 / 25 / 25, ×100/80
    const s = kpiScore(metrics.slice(0, 3), { d: 1, q: 0, c: 0 }, null);
    expect(s.pillars[3]).toEqual({ key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 20, achieved: 0, max: 0, percent: 0, complete: true, leftOut: true });
    // (30 × 2/3 + 25 + 25) × 100 ÷ 80 = 70 × 1.25 = 87.5
    expect(s.finalPercent).toBe(87.5);
    expect(s.level).toBe('needs_improvement');
    // every target met: 100%, never a free 20% nor a lost one
    expect(kpiScore(metrics.slice(0, 3), { d: 0, q: 0, c: 0 }, null).finalPercent).toBe(100);
    // with the metric counting the pillar is Attendance's alone, as it was: 20 + 25 + 25 + 15 = 85
    const on = kpiScore(metrics.slice(0, 3), { d: 1, q: 0, c: 0 }, { points: 20, achieved: 15 });
    expect(on.pillars[3]).toMatchObject({ achieved: 15, max: 20, percent: 75 });
    expect(on.pillars[3]).not.toHaveProperty('leftOut');
    expect(on.finalPercent).toBe(85);
  });

  it('caps the spread score at 110 too, and with no other pillar scores 0', () => {
    const generous: KpiScoredMetric[] = [
      { id: 'a', pillar: 'delivery', targetPoints: 10, criteria: [{ label: 'Way over', points: 20 }, { label: 'Target', points: 10 }] },
      { id: 'b', pillar: 'quality', targetPoints: 10, criteria: [{ label: 'Way over', points: 20 }, { label: 'Target', points: 10 }] },
      { id: 'c', pillar: 'clients', targetPoints: 10, criteria: [{ label: 'Target', points: 10 }, { label: 'None', points: 0 }] },
    ];
    expect(kpiScore(generous, { a: 0, b: 0, c: 0 }, null)).toMatchObject({ finalPercent: 110, capped: true, level: 'above' });
    const alone: KpiPillarSet = { pillars: [{ key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 100 }], attendancePillar: 'discipline' };
    expect(kpiScore([], {}, null, alone)).toMatchObject({ finalPercent: 0, pillars: [{ key: 'discipline', leftOut: true }] });
  });

  it('only leaves out the Attendance metric’s pillar: another empty pillar still counts 0, as it always did', () => {
    // a practice scorecard on a draft may have a pillar with nothing placed in it yet
    const s = kpiScore(metrics.filter((m) => m.pillar !== 'quality'), { d: 0, c: 0, g: 0 }, null);
    expect(s.pillars[1]).toMatchObject({ key: 'quality', max: 0, percent: 0 });
    expect(s.pillars[1]).not.toHaveProperty('leftOut');
    expect(s.finalPercent).toBe(75);
  });
});

describe('templates and pillars without attendance', () => {
  const metric = (over: Partial<KpiMetric> = {}): KpiMetric => ({
    pillar: 'delivery',
    name: 'On time',
    definition: null,
    howMeasured: null,
    jdDuty: null,
    targetPoints: 30,
    criteria: [
      { label: 'No delays', points: 30 },
      { label: '1–2 delays', points: 20 },
    ],
    ...over,
  });
  const full = [metric(), metric({ pillar: 'quality', name: 'Quality' }), metric({ pillar: 'clients', name: 'Clients' })];

  it('no longer asks for the Attendance points (kept as they are), on or off as the setting is', () => {
    for (const points of [0, 201, 1.5, Number.NaN]) {
      expect(kpiTemplateProblems({ attendancePoints: points, metrics: full }, { publishing: true, attendance: false })).toEqual([]);
      expect(kpiTemplateProblems({ attendancePoints: points, metrics: full }, { publishing: true })).toEqual(['Give the Attendance metric whole points from 1 to 200.']);
    }
  });

  it('still publishes with Discipline & Growth empty: it is left out of the score then', () => {
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: full }, { publishing: true, attendance: false })).toEqual([]);
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric()] }, { publishing: true, attendance: false })).toEqual([
      'Add a metric to Quality of Work: every pillar is scored.',
      'Add a metric to Clients & Teamwork: every pillar is scored.',
    ]);
    for (const s of KPI_SAMPLE_TEMPLATES) expect(kpiTemplateProblems(s, { publishing: true, attendance: false })).toEqual([]);
  });

  it('keeps a metric from being named Attendance, saying why', () => {
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric({ name: 'attendance' })] }, { attendance: false })).toEqual([
      'Metric 1 (attendance): attendance is out of the KPI, cut on the fixed part of the pay; name this metric otherwise.',
    ]);
    expect(kpiTemplateProblems({ attendancePoints: 20, metrics: [metric({ name: 'attendance' })] })).toEqual([
      'Metric 1 (attendance): Attendance is filled in by the system already; name this metric otherwise.',
    ]);
  });

  it('no longer asks for the pillar the Attendance metric counts in', () => {
    const set = { pillars: KPI_DEFAULT_PILLAR_SET.pillars, attendancePillar: '' };
    expect(kpiPillarSetProblems(set, { attendance: false })).toEqual([]);
    expect(kpiPillarSetProblems(set)).toEqual(['Choose the pillar the Attendance metric counts in.']);
    expect(kpiPillarSetProblems({ ...set, attendancePillar: 'gone' }, { attendance: true })).toEqual(['Choose the pillar the Attendance metric counts in.']);
  });

  it('keeps one, for when it is switched on again: the one of the pillars replaced, else Discipline & Growth, else the last', () => {
    const pillars = [...KPI_DEFAULT_PILLAR_SET.pillars];
    expect(keptAttendancePillar({ pillars }, { attendancePillar: 'clients' })).toBe('clients');
    expect(keptAttendancePillar({ pillars }, { attendancePillar: 'gone' })).toBe('discipline');
    expect(keptAttendancePillar({ pillars }, null)).toBe('discipline');
    expect(keptAttendancePillar({ pillars: pillars.slice(0, 3) }, { attendancePillar: 'discipline' })).toBe('clients');
  });
});

describe('the payroll without attendance in the KPI', () => {
  /** A salaried line: gross 12,000, fixed 9,600, variable 2,400; a shift of 270 hours. */
  const terms: PayrollTerms = {
    year: 2026,
    payBasis: 'monthly',
    gross: 12_000,
    basicPercent: 80,
    hourlyRate: null,
    allowances: [],
    paidDays: 30,
    statutory: true,
    insured: true,
    insuredWage: 12_000,
    hoursPerDay: 9,
    expectedHours: 270,
  };
  const inputs = (given: Partial<PayrollInputs> = {}): PayrollInputs => ({ ...EMPTY_PAYROLL_INPUTS, ...given });
  /** Attendance at 85% (229.5 of 270 hours), performance 60% typed. */
  const typed = inputs({ workedHours: 229.5, performance: 60 });
  const { kpiIncludesAttendance: _, ...snapshotBefore } = PAYROLL_RULE_DEFAULTS;

  it('copies the switch, off, into the rules of the runs made since; a run’s rules from before read as on', () => {
    expect(PAYROLL_RULE_DEFAULTS.kpiIncludesAttendance).toBe(false);
    expect(kpiAveragesAttendance(PAYROLL_RULE_DEFAULTS)).toBe(false);
    expect(kpiAveragesAttendance({ ...PAYROLL_RULE_DEFAULTS, kpiIncludesAttendance: true })).toBe(true);
    expect(kpiAveragesAttendance(snapshotBefore)).toBe(true);
  });

  it('averages the KPI inputs typed alone on rules without attendance: the fixed part alone pays for the short hours', () => {
    const now = payrollLine(terms, typed, PAYROLL_RULE_DEFAULTS);
    // the fixed part 9,600 × 15% = 1,440 off for the attendance, as before; the KPI 60% alone: 2,400 × 40% = 960
    expect(now).toMatchObject({ attendanceScore: 0.85, attendanceCut: 1_440, kpiScore: 0.6, kpiCut: 960 });
    // several typed: (70 + 60 + 80) ÷ 3 = 70%
    expect(payrollLine(terms, inputs({ workedHours: 229.5, softSkills: 70, performance: 60, clientSatisfaction: 80 }), PAYROLL_RULE_DEFAULTS)).toMatchObject({ kpiScore: 0.7, kpiCut: 720 });
    // at or above the grace in full; none typed, no cut
    expect(payrollLine(terms, inputs({ workedHours: 200, performance: 85 }), PAYROLL_RULE_DEFAULTS)).toMatchObject({ kpiScore: 1, kpiCut: 0, attendanceCut: piastersOf(9_600 * (1 - 200 / 270)) });
    expect(payrollLine(terms, inputs({ workedHours: 229.5 }), PAYROLL_RULE_DEFAULTS)).toMatchObject({ kpiScore: 1, kpiCut: 0 });
  });

  it('works an old snapshot out as it was: the attendance averaged in', () => {
    // (85 + 60) ÷ 2 = 72.5%: 2,400 × 27.5% = 660, and the same 1,440 off the fixed part
    expect(payrollLine(terms, typed, snapshotBefore)).toMatchObject({ attendanceCut: 1_440, kpiScore: 0.725, kpiCut: 660 });
    expect(payrollLine(terms, typed, { ...PAYROLL_RULE_DEFAULTS, kpiIncludesAttendance: true })).toMatchObject({ kpiScore: 0.725, kpiCut: 660 });
  });

  it('never changes a line with a scorecard: its final % is the KPI, whatever the rules', () => {
    const kpi = { month: '2026-09', scorecardId: 's1', finalPercent: 70, level: kpiLevel(70), attendanceCounted: false };
    for (const rules of [PAYROLL_RULE_DEFAULTS, snapshotBefore]) {
      expect(payrollLine({ ...terms, kpi }, typed, rules)).toMatchObject({ attendanceCut: 1_440, kpiScore: 0.7, kpiCut: 720 });
    }
    expect(kpiPerformanceOnly(kpi)).toBe(true);
    expect(kpiPerformanceOnly({ attendanceCounted: true })).toBe(false);
    // a line made before 25 October 2026 has no such field: its scorecard counted attendance
    expect(kpiPerformanceOnly({})).toBe(false);
    expect(kpiPerformanceOnly(null)).toBe(false);
  });

  it('says so on the payslip: the KPI average of the inputs alone, and a scorecard performance only', () => {
    // Mariam: 165:30 of 176:00 (94.03%, counted in full); soft skills 70, performance 65, client satisfaction 72
    const before = payslipContent(payslipSource('monthly'), 'en');
    expect(before.thisMonth!.cells.find((c) => c.label === 'KPI average')).toMatchObject({ value: '76.75%' });
    expect(before.thisMonth!.line).toBe('Soft skills 70% · Performance 65% · Client satisfaction 72% · Attendance 100%');
    const since = payslipContent(payslipSource('monthly', { rules: { kpiIncludesAttendance: false } }), 'en');
    // (70 + 65 + 72) ÷ 3 = 69%
    expect(since.thisMonth!.cells.find((c) => c.label === 'KPI average')).toMatchObject({ value: '69.00%', note: 'Below 80%: variable paid at 69.00%' });
    expect(since.thisMonth!.line).toBe(`Soft skills 70% · Performance 65% · Client satisfaction 72%. ${KPI_PERFORMANCE_ONLY_NOTE}`);
    const scorecard = (attendanceCounted?: boolean) =>
      payslipContent(payslipSource('monthly', { terms: { kpi: { month: '2026-09', scorecardId: 'k1', finalPercent: 86, level: 'needs_improvement', ...(attendanceCounted !== undefined && { attendanceCounted }) } } }), 'en');
    expect(scorecard(false).thisMonth!.line).toBe(`Last month's KPI counts in this month's pay. ${KPI_PERFORMANCE_ONLY_NOTE}`);
    expect(scorecard(true).thisMonth!.line).toBe("Last month's KPI counts in this month's pay.");
    expect(scorecard().thisMonth!.line).toBe("Last month's KPI counts in this month's pay.");
    const arabic = payslipContent(payslipSource('monthly', { terms: { kpi: { month: '2026-09', scorecardId: 'k1', finalPercent: 86, level: 'needs_improvement', attendanceCounted: false } } }), 'ar');
    expect(arabic.thisMonth!.line).toBe('مؤشرات أداء الشهر الماضي تُحتسب في أجر هذا الشهر. مؤشرات الأداء للأداء فقط: يُخصم الحضور من الجزء الثابت.');
  });
});

/** An amount to the piaster, as payrollLine rounds it. */
function piastersOf(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
