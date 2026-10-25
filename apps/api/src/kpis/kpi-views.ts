import {
  isKpiPillarKey,
  KPI_DEFAULT_PILLAR_SET,
  KPI_STEP_LABELS,
  kpiAttendanceIn,
  kpiDeadlines,
  kpiMetricDuties,
  kpiOwnWeights,
  kpiPayrollMonth,
  kpiPillarOf,
  kpiPracticeSteps,
  kpiScore,
  kpiStandsIn,
  kpiStepDeadline,
  kpiStoodInText,
  kpiWithWeights,
  type KpiCriterion,
  type KpiDeadlines,
  type KpiLevel,
  type KpiMetricView,
  type KpiPickView,
  type KpiPillar,
  type KpiPillarSet,
  type KpiPracticeInfo,
  type KpiScorecardMetric,
  type KpiScorecardSummary,
  type KpiScorecardView,
  type KpiScorer,
  type KpiScoreResult,
  type KpiSettings,
  type KpiStatus,
  type KpiStepKind,
} from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import { placeName, type UserRef } from '../payroll/adjustments/people.js';
import { kpiActionFor, kpiCan, kpiShown, takesOwnSteps, type KpiCaller } from './kpi-access.js';

// A KPI scorecard as the pages read it (owner, 21 October 2026: "Self, manager, HR, sign-off"; packages/shared kpis.ts
// KpiScorecardSummary and KpiScorecardView): who, the month, where it is, its scorer, the score as the caller may see it
// (the employee only from the sign-off on), its pillars with their metrics and the picks the caller may see, the
// automatic Attendance metric, each step's comments, the steps logged, the deadlines and what the caller may do. Pure.
// The pillars are its template version's, as it was published (owner, 21 October 2026: "Fully flexible"; packages/shared
// kpi-framework.ts): a scorecard is scored with them whatever the KPI framework has become since.
// A practice scorecard (owner, 22 October 2026: "Practice scorecards"; packages/shared kpi-practice.ts): marked so, with
// who started it and when; on a draft, scored with the draft's pillars and the job title's own weights as it would be
// published, its metrics in Unplaced left out. In one's own session nobody takes its steps as themself (no `can`, no
// action), its starter and a Super Admin see every pick and stand in for each step (`standIn`), and a step taken
// standing in says for whom ("Hazem Magdy for the manager").
// Attendance out of the KPI (owner, 25 October 2026: "Fixed cut only"): a scorecard whose Attendance metric doesn't
// count (attendance_counted: the setting while it isn't final, kept once it is) is scored without it (kpiScore with no
// attendance), the pillar the metric was alone in left out of its pillars' kept percents (null), and says so
// (attendance.counted false), so the pages hide the metric.

export const SCORECARD_ENTITY = 'kpi_scorecard';

/** A set of pillars as kept ([{ key, name, short, weight }]): those well formed; anything else none. */
export function pillarsOf(value: Prisma.JsonValue | null | undefined): KpiPillar[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
    const { key, name, short, weight } = p as Record<string, unknown>;
    return isKpiPillarKey(key) && typeof name === 'string' && typeof weight === 'number' ? [{ key, name, short: typeof short === 'string' ? short : name, weight }] : [];
  });
}

/** A template version's (or a framework's) pillars with the Attendance metric's; the plan's four when none are kept. */
export function pillarSetOf(row: { pillars: Prisma.JsonValue; attendancePillar: string }): KpiPillarSet & { pillars: KpiPillar[] } {
  const pillars = pillarsOf(row.pillars);
  return pillars.length ? { pillars, attendancePillar: row.attendancePillar } : { pillars: [...KPI_DEFAULT_PILLAR_SET.pillars], attendancePillar: KPI_DEFAULT_PILLAR_SET.attendancePillar };
}

/** A set of pillars as saved. */
export const pillarsJsonOf = (set: Pick<KpiPillarSet, 'pillars'>): Prisma.InputJsonValue => set.pillars.map((p) => ({ key: p.key, name: p.name, short: p.short, weight: p.weight }));

/** What a scorecard is read with, in a list and on its page. */
export const CARD_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullNameEn: true } },
  manager: { select: { id: true, fullNameEn: true } },
  department: { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } },
  template: {
    select: {
      id: true,
      version: true,
      jobTitleId: true,
      attendancePoints: true,
      pillars: true,
      attendancePillar: true,
      // a practice scorecard's draft: scored with the job title's own weights, as it would be published
      status: true,
      ownWeights: true,
      jobTitle: { select: { titleEn: true } },
      metrics: { orderBy: { position: 'asc' } },
    },
  },
  practiceBy: { select: { id: true, email: true } },
  scores: true,
  steps: { orderBy: { id: 'asc' }, select: { kind: true, comment: true, at: true, stoodInFor: true, actor: { select: { id: true, email: true } } } },
} as const satisfies Prisma.KpiScorecardInclude;

export type CardRow = Prisma.KpiScorecardGetPayload<{ include: typeof CARD_INCLUDE }>;

export const monthOfCard = (row: { month: Date }) => fromDateOnly(row.month).slice(0, 7);

/**
 * A saved metric as the pages read it: its pillar's key (none: in Unplaced, with the pillar it was in), and its JD
 * duties (25 October 2026: "Yes, several duties"), one saved before read as a list of it (kpiMetricDuties).
 */
export function metricView(m: {
  id: string;
  pillar: string | null;
  wasIn?: string | null;
  name: string;
  definition: string | null;
  howMeasured: string | null;
  jdDuty: string | null;
  jdDuties: string[];
  targetPoints: number;
  criteria: Prisma.JsonValue;
}): KpiMetricView {
  return {
    id: m.id,
    pillar: m.pillar,
    ...(m.pillar === null && { wasIn: m.wasIn ?? null }),
    name: m.name,
    definition: m.definition,
    howMeasured: m.howMeasured,
    jdDuties: kpiMetricDuties(m),
    targetPoints: m.targetPoints,
    criteria: criteriaOf(m.criteria),
  };
}

/** A metric's criteria as saved ([{ label, points }]); anything else: none. */
export function criteriaOf(value: Prisma.JsonValue): KpiCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return [];
    const { label, points } = c as { label?: unknown; points?: unknown };
    return typeof label === 'string' && typeof points === 'number' ? [{ label, points }] : [];
  });
}

/** The picks of a step, by metric id: the self-rating's, the manager's, or the manager's calibrated by HR. */
export function choicesOf(row: Pick<CardRow, 'scores'>, step: 'self' | 'manager' | 'final'): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const s of row.scores) out[s.metricId] = step === 'self' ? s.selfChoice : step === 'manager' ? s.managerChoice : (s.hrChoice ?? s.managerChoice);
  return out;
}

/**
 * The pillars a scorecard is scored with: its template version's, as it was published; a draft's (a practice
 * scorecard's) with the job title's own weights when they fit, as it would be published with them.
 */
export function cardPillarSet(template: Pick<CardRow['template'], 'pillars' | 'attendancePillar' | 'status' | 'ownWeights'>): KpiPillarSet & { pillars: KpiPillar[] } {
  const set = pillarSetOf(template);
  return template.status === 'draft' ? kpiWithWeights(set, kpiOwnWeights(set, template.ownWeights)) : set;
}

/**
 * The metrics a scorecard is scored on: every one of its version's; a practice scorecard's on a draft, those in one of
 * its pillars (a draft's metrics in Unplaced are left out until placed).
 */
export function scoredMetrics(row: Pick<CardRow, 'practice' | 'template'>): CardRow['template']['metrics'] {
  if (!row.practice) return row.template.metrics;
  const set = cardPillarSet(row.template);
  return row.template.metrics.filter((m) => !!kpiPillarOf(set, m.pillar));
}

/** A scorecard's Attendance metric as kpiScore takes it: none while it doesn't count (25 October 2026). */
export const attendanceOfCard = (row: Pick<CardRow, 'template' | 'attendanceAchieved' | 'attendanceCounted'>) =>
  kpiAttendanceIn(row.attendanceCounted, row.template.attendancePoints, row.attendanceAchieved);

/** The score of a scorecard's picks at a step, with its Attendance metric while it counts, in its template version's pillars. */
export function scoreOf(row: Pick<CardRow, 'scores' | 'template' | 'attendanceAchieved' | 'attendanceCounted'>, step: 'self' | 'manager' | 'final'): KpiScoreResult {
  const metrics = row.template.metrics.map(metricView);
  return kpiScore(metrics, choicesOf(row, step), attendanceOfCard(row), cardPillarSet(row.template));
}

/**
 * The pillars' percents kept with the score, for the departments' averages, by the pillars' keys: { "delivery": 92.5, … };
 * a pillar left out of it (attendance out of the KPI, 25 October 2026) null, so no average counts it.
 */
export const pillarsJson = (score: KpiScoreResult) => Object.fromEntries(score.pillars.map((p) => [p.key, p.leftOut ? null : p.percent]));

/** The pillars' percents kept with a score, by their keys (those kept as numbers). */
export function keptPillars(value: Prisma.JsonValue | null): Record<string, number | null> {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(v).map(([k, n]) => [k, typeof n === 'number' ? n : null]));
}

/** The deadlines of the scorecard's month. */
export const deadlinesOf = (row: { month: Date }, settings: KpiSettings): KpiDeadlines => kpiDeadlines(monthOfCard(row), settings);

const parties = (row: CardRow) => ({
  employeeId: row.employeeId,
  scorer: row.scorer,
  managerId: row.managerId,
  status: row.status,
  selfSubmittedAt: row.selfSubmittedAt,
  employeeSignedAt: row.employeeSignedAt,
  managerSignedAt: row.managerSignedAt,
  practice: row.practice,
});

/** Nothing the caller may do: a practice scorecard in one's own session (its steps are stood in for). */
const CAN_NOTHING = { selfRate: false, score: false, calibrate: false, signAsEmployee: false, signAsManager: false };

/**
 * What of it the caller sees: as kpiShown says; every pick on a practice scorecard in one's own session (HR and a Super
 * Admin trying the flow: nothing of it is anyone's yet).
 */
const shownOf = (row: CardRow, caller: KpiCaller) => (takesOwnSteps(row, caller) ? kpiShown(parties(row), caller) : { self: true, manager: true });

/** A practice scorecard's facts (null for a real one): who started it, when, and whether it is on a draft. */
export function practiceOf(row: Pick<CardRow, 'practice' | 'practiceBy' | 'practiceAt' | 'template'>, names?: ReadonlyMap<string, UserRef>): KpiPracticeInfo | null {
  if (!row.practice) return null;
  const by = row.practiceBy;
  return {
    startedBy: by ? { email: by.email, name: names?.get(by.id)?.name ?? null } : null,
    startedAt: (row.practiceAt ?? new Date(0)).toISOString(),
    draft: row.template.status === 'draft',
  };
}

/** Whether the caller stands in on it now: a practice scorecard's starter or a Super Admin, in their own session. */
export const standsIn = (row: Pick<CardRow, 'practice' | 'practiceById'>, caller: KpiCaller): boolean =>
  kpiStandsIn(row, { userId: caller.user.id, roles: caller.user.roles, viewingAs: !!caller.user.viewAs });

/** A scorecard in a list, as the caller sees it. `names`: a practice scorecard's starter's. */
export function summaryOf(row: CardRow, caller: KpiCaller, settings: KpiSettings, today: string, names?: ReadonlyMap<string, UserRef>): KpiScorecardSummary {
  const deadlines = deadlinesOf(row, settings);
  const shown = shownOf(row, caller);
  const own = takesOwnSteps(row, caller);
  const scored = shown.manager && row.finalPercent !== null;
  return {
    id: row.id,
    month: monthOfCard(row),
    employee: row.employee,
    jobTitle: row.template.jobTitle.titleEn,
    department: placeName(row.department),
    departmentId: row.departmentId,
    status: row.status as KpiStatus,
    templateVersion: row.template.version,
    scorer: { kind: row.scorer as KpiScorer, name: row.scorer === 'manager' ? (row.manager?.fullNameEn ?? null) : null },
    finalPercent: scored ? row.finalPercent!.toNumber() : null,
    level: scored ? (row.level as KpiLevel) : null,
    selfMissed: row.selfMissed,
    calibrated: shown.manager ? row.scores.filter((s) => s.hrChoice !== null).length : 0,
    signed: { employee: !!row.employeeSignedAt, manager: !!row.managerSignedAt },
    unsigned: row.status === 'final' && (!row.employeeSignedAt || !row.managerSignedAt),
    action: own ? kpiActionFor(parties(row), caller, deadlines, today) : null,
    deadline: kpiStepDeadline(row.status, deadlines),
    confidential: caller.confidential.all.has(row.employeeId),
    ...(row.practice && { practice: practiceOf(row, names) }),
  };
}

const pick = (choice: number | null, comment: string | null): KpiPickView | null => (choice === null && !comment ? null : { choice, comment });

/** A scorecard on its page, as the caller sees it. `names`: who took its steps. */
export function scorecardView(row: CardRow, caller: KpiCaller, settings: KpiSettings, today: string, names: ReadonlyMap<string, UserRef>): KpiScorecardView {
  const summary = summaryOf(row, caller, settings, today, names);
  const shown = shownOf(row, caller);
  const scores = new Map(row.scores.map((s) => [s.metricId, s]));
  // the score that counts as the caller sees it: the manager's picks, calibrated (the scorer's own while scoring)
  const official = shown.manager && row.scores.some((s) => s.managerChoice !== null) ? scoreOf(row, 'final') : null;
  const self = shown.self && row.scores.some((s) => s.selfChoice !== null) ? scoreOf(row, 'self') : null;
  const metrics = row.template.metrics.map((m): KpiScorecardMetric => {
    const view = metricView(m);
    const s = scores.get(m.id);
    const managerChoice = shown.manager ? (s?.managerChoice ?? null) : null;
    const hrChoice = shown.manager ? (s?.hrChoice ?? null) : null;
    const counted = hrChoice ?? managerChoice;
    return {
      ...view,
      self: shown.self && s ? pick(s.selfChoice, s.selfComment) : null,
      manager: shown.manager && s ? pick(s.managerChoice, s.managerComment) : null,
      hr: shown.manager && s && s.hrChoice !== null ? { choice: s.hrChoice, comment: s.hrReason } : null,
      points: counted !== null ? (view.criteria[counted]?.points ?? null) : null,
    };
  });
  const set = cardPillarSet(row.template);
  const score = official ?? kpiScore(metrics, {}, attendanceOfCard(row), set);
  const pillars = set.pillars.map((p) => {
    const s = score.pillars.find((x) => x.key === p.key)!;
    return { ...p, metrics: metrics.filter((m) => m.pillar === p.key), achieved: s.achieved, max: s.max, percent: s.percent, complete: s.complete, ...(s.leftOut && { leftOut: true as const }) };
  });
  return {
    ...summary,
    template: { id: row.template.id, version: row.template.version, jobTitleId: row.template.jobTitleId },
    pillars,
    attendancePillar: set.attendancePillar,
    attendance: {
      points: row.template.attendancePoints,
      achieved: row.attendanceAchieved,
      ratio: row.attendanceRatio?.toNumber() ?? null,
      score: row.attendanceScore?.toNumber() ?? null,
      source: row.attendanceSource as 'payroll' | 'attendance' | 'none',
      counted: row.attendanceCounted,
    },
    score: official,
    selfScore: self,
    comments: {
      self: shown.self ? row.selfComment : null,
      manager: shown.manager ? row.managerComment : null,
      hr: shown.manager ? row.hrComment : null,
      employeeSign: row.employeeSignComment,
      managerSign: row.managerSignComment,
    },
    steps: row.steps.map((s) => ({
      kind: s.kind as KpiStepKind,
      label: KPI_STEP_LABELS[s.kind as KpiStepKind] ?? s.kind,
      at: s.at.toISOString(),
      by: stepBy(s, row, names),
      // a step's comment as the caller may see it: the self-rating's with the self-rating, the scoring's and HR's with the scoring
      comment: (s.kind === 'self_rated' && !shown.self) || ((s.kind === 'scored' || s.kind === 'calibrated') && !shown.manager) ? null : s.comment,
    })),
    deadlines: deadlinesOf(row, settings),
    can: takesOwnSteps(row, caller) ? kpiCan(parties(row), caller) : CAN_NOTHING,
    payrollMonth: kpiPayrollMonth(monthOfCard(row)),
    ...(row.practice && {
      standIn: standsIn(row, caller) ? kpiPracticeSteps(row) : null,
      unplaced: row.template.metrics.length - scoredMetrics(row).length,
    }),
  };
}

/** Who took a step: their name (else their email); standing in on a practice scorecard, for whom ("… for the manager"). */
function stepBy(s: CardRow['steps'][number], row: CardRow, names: ReadonlyMap<string, UserRef>): string | null {
  if (!s.actor) return null;
  const name = names.get(s.actor.id)?.name ?? s.actor.email;
  return s.stoodInFor ? kpiStoodInText(name, s.stoodInFor, { employeeName: row.employee.fullNameEn, scorer: row.scorer }) : name;
}
