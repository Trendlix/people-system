import {
  isKpiPillarKey,
  KPI_DEFAULT_PILLAR_SET,
  KPI_STEP_LABELS,
  kpiDeadlines,
  kpiPayrollMonth,
  kpiScore,
  kpiStepDeadline,
  type KpiCriterion,
  type KpiDeadlines,
  type KpiLevel,
  type KpiMetricView,
  type KpiPickView,
  type KpiPillar,
  type KpiPillarSet,
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
import { kpiActionFor, kpiCan, kpiShown, type KpiCaller } from './kpi-access.js';

// A KPI scorecard as the pages read it (owner, 21 October 2026: "Self, manager, HR, sign-off"; packages/shared kpis.ts
// KpiScorecardSummary and KpiScorecardView): who, the month, where it is, its scorer, the score as the caller may see it
// (the employee only from the sign-off on), its pillars with their metrics and the picks the caller may see, the
// automatic Attendance metric, each step's comments, the steps logged, the deadlines and what the caller may do. Pure.
// The pillars are its template version's, as it was published (owner, 21 October 2026: "Fully flexible"; packages/shared
// kpi-framework.ts): a scorecard is scored with them whatever the KPI framework has become since.

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
      jobTitle: { select: { titleEn: true } },
      metrics: { orderBy: { position: 'asc' } },
    },
  },
  scores: true,
  steps: { orderBy: { id: 'asc' }, select: { kind: true, comment: true, at: true, actor: { select: { id: true, email: true } } } },
} as const satisfies Prisma.KpiScorecardInclude;

export type CardRow = Prisma.KpiScorecardGetPayload<{ include: typeof CARD_INCLUDE }>;

export const monthOfCard = (row: { month: Date }) => fromDateOnly(row.month).slice(0, 7);

/** A saved metric as the pages read it: its pillar's key (none: in Unplaced, with the pillar it was in). */
export function metricView(m: {
  id: string;
  pillar: string | null;
  wasIn?: string | null;
  name: string;
  definition: string | null;
  howMeasured: string | null;
  jdDuty: string | null;
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
    jdDuty: m.jdDuty,
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

/** The score of a scorecard's picks at a step, with its Attendance metric, in its template version's pillars. */
export function scoreOf(row: Pick<CardRow, 'scores' | 'template' | 'attendanceAchieved'>, step: 'self' | 'manager' | 'final'): KpiScoreResult {
  const metrics = row.template.metrics.map(metricView);
  return kpiScore(metrics, choicesOf(row, step), { points: row.template.attendancePoints, achieved: row.attendanceAchieved }, pillarSetOf(row.template));
}

/** The pillars' percents kept with the score, for the departments' averages, by the pillars' keys: { "delivery": 92.5, … }. */
export const pillarsJson = (score: KpiScoreResult) => Object.fromEntries(score.pillars.map((p) => [p.key, p.percent]));

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
});

/** A scorecard in a list, as the caller sees it. */
export function summaryOf(row: CardRow, caller: KpiCaller, settings: KpiSettings, today: string): KpiScorecardSummary {
  const deadlines = deadlinesOf(row, settings);
  const shown = kpiShown(parties(row), caller);
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
    action: kpiActionFor(parties(row), caller, deadlines, today),
    deadline: kpiStepDeadline(row.status, deadlines),
    confidential: caller.confidential.all.has(row.employeeId),
  };
}

const pick = (choice: number | null, comment: string | null): KpiPickView | null => (choice === null && !comment ? null : { choice, comment });

/** A scorecard on its page, as the caller sees it. `names`: who took its steps. */
export function scorecardView(row: CardRow, caller: KpiCaller, settings: KpiSettings, today: string, names: ReadonlyMap<string, UserRef>): KpiScorecardView {
  const summary = summaryOf(row, caller, settings, today);
  const shown = kpiShown(parties(row), caller);
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
  const set = pillarSetOf(row.template);
  const score = official ?? kpiScore(metrics, {}, { points: row.template.attendancePoints, achieved: row.attendanceAchieved }, set);
  const pillars = set.pillars.map((p) => {
    const s = score.pillars.find((x) => x.key === p.key)!;
    return { ...p, metrics: metrics.filter((m) => m.pillar === p.key), achieved: s.achieved, max: s.max, percent: s.percent, complete: s.complete };
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
      by: s.actor ? (names.get(s.actor.id)?.name ?? s.actor.email) : null,
      // a step's comment as the caller may see it: the self-rating's with the self-rating, the scoring's and HR's with the scoring
      comment: (s.kind === 'self_rated' && !shown.self) || ((s.kind === 'scored' || s.kind === 'calibrated') && !shown.manager) ? null : s.comment,
    })),
    deadlines: deadlinesOf(row, settings),
    can: kpiCan(parties(row), caller),
    payrollMonth: kpiPayrollMonth(monthOfCard(row)),
  };
}
