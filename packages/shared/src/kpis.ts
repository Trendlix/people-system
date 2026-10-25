// KPIs (owner, 21 October 2026: "lets start with the KPI's First"; trendlix-hrms-handoff docs/spec.md §11 and
// config/kpi-framework.json). The owner chose:
// - "Full framework per role": one framework of four pillars with fixed weights (Delivery & Timeliness 30%, Quality of
//   Work 25%, Clients & Teamwork 25%, Discipline & Growth 20%), and for every job title a KPI template built from its job
//   description: metrics, each with its pillar, name, definition, how it's measured, the linked JD duties (several from
//   25 October 2026: "Yes, several duties"; KpiMetric.jdDuties), the points that count as its target and a criteria
//   scale ("No delays = 35 / 1–2 delays = 30 / 3+ = 20"). Each month one criterion is picked per metric. Pillar % =
//   achieved ÷ max points; final % = Σ pillar % × weight, capped at 110% (a criterion may be worth more than the
//   metric's target). Levels: Unacceptable < 50 · Unsatisfactory 50–70 · Needs improvement
//   70–90 · Meets expectations 90–100 · Above expectations 100–110; shown, they don't change pay.
// - Pay "As the sheet: full at 80%+": the KPI payroll uses is the scorecard's final %: at or above the rules' KPI grace
//   percent (80) the variable part is paid in full, below it in proportion; with no final scorecard there is no cut.
// - Steps "Self, manager, HR, sign-off": the employee's self-rating, the manager's scoring with comments (seeing the
//   self-rating), HR's calibration (a changed pick needs a reason, audited), the sign-off by both ("I've read it"),
//   then final and locked. The manager is the approver in charge (direct manager → team lead → department head; none:
//   HR); a C-level person's is the CEO's, never HR's. Deadlines in the KPI settings (self-rating by the 3rd, manager by
//   the 6th, HR by the 8th, sign-off by the 10th of the next month): a missed self-rating doesn't block the manager
//   (noted), and a scorecard not signed by the sign-off day is final anyway (noted).
// - Attendance "Yes, as the sheet": every template's Discipline & Growth pillar (or the pillar the KPI framework chose
//   for it) has an automatic Attendance metric,
//   worth points set on the template (20 by default), achieved = those points × the month's attendance score as payroll
//   works it out for the person and month, capped at 1, rounded to whole points. Nobody picks it.
//   Out of the KPI from 25 October 2026 (the owner asked whether attendance is cut twice, on the fixed part below the
//   90% grace and through this metric on the variable part, and chose "Fixed cut only"): a company setting, Attendance
//   in the KPI (KpiSettingsView.attendanceInKpi), off from then and kept as a switch. Off, the KPI measures performance
//   only and attendance is cut on the fixed part alone: no Attendance points in any pillar (kpiScore with no
//   attendance), the metric hidden, its points and pillar kept for when it is switched on again; the pillar it was
//   alone in is left out, its weight spread over the other pillars in proportion. Each scorecard keeps whether it
//   counts (KpiScorecardAttendance.counted): those not final follow the setting, a final one keeps its result.
// - Timing "Last month's KPI, this pay": a month's scorecard opens on the 1st of the next month and counts in that
//   month's payroll: the payroll of month M reads the final scorecard of M − 1.
// - Templates "HR": HR (and the Super Admin) build them, a draft and published versions; a version published in a month
//   is used by the scorecards opened from the 1st of the next month, and a scorecard keeps the version it opened with.
// - The pillars "Fully flexible" (owner, 21 October 2026: "am i able to edit the pillars of the KPIs?"): HR adds,
//   removes and renames pillars and sets their weights (total 100%), from next month, in a versioned KPI framework
//   (kpi-framework.ts). The four above are its first version, and the default. Each template version keeps the pillars
//   it was published with (a KpiPillarSet), its metrics in their keys, and its scorecards are scored with those: past
//   scorecards never change.
// Pure code: the API enforces these rules, the web shows them live. Tested in apps/api/src/common/kpis.spec.ts.

import type { EmploymentType } from './index.js';
import type { KpiPracticeInfo, KpiPracticeStep } from './kpi-practice.js';

// ---------- the framework: pillars, weights, levels ----------

export interface KpiPillar {
  /**
   * Its key, which the metrics placed in it keep (e.g. "delivery"): unique among a framework's pillars, kept when it is
   * renamed or reweighted.
   */
  key: string;
  /** Title Case, as the framework names it. */
  name: string;
  /** A short name for narrow columns (the score's tiles, the department table). */
  short: string;
  /** Its weight in the final %, in whole percent: a framework's add up to 100. */
  weight: number;
}

/**
 * Pillars as a framework has them, and as a template version keeps them (its snapshot): in their order, and the pillar
 * the automatic Attendance metric counts in (its key).
 */
export interface KpiPillarSet {
  pillars: readonly KpiPillar[];
  attendancePillar: string;
}

/**
 * The four pillars of the plan (owner, 21 October 2026: "Full framework per role"): the KPI framework's first version,
 * which the migration put in force, and the pillars the samples and the role library are written for.
 */
export const KPI_PILLARS: readonly KpiPillar[] = [
  { key: 'delivery', name: 'Delivery & Timeliness', short: 'Delivery', weight: 30 },
  { key: 'quality', name: 'Quality of Work', short: 'Quality', weight: 25 },
  { key: 'clients', name: 'Clients & Teamwork', short: 'Clients', weight: 25 },
  { key: 'discipline', name: 'Discipline & Growth', short: 'Discipline', weight: 20 },
];

/** The default pillar the automatic Attendance metric counts in: Discipline & Growth. */
export const KPI_ATTENDANCE_PILLAR = 'discipline';

/** The four pillars with the Attendance metric in Discipline & Growth: the framework's first version, and the default. */
export const KPI_DEFAULT_PILLAR_SET: KpiPillarSet = { pillars: KPI_PILLARS, attendancePillar: KPI_ATTENDANCE_PILLAR };

/** A pillar of a set by its key; null when it has none. */
export const kpiPillarOf = (set: Pick<KpiPillarSet, 'pillars'>, key: string | null | undefined): KpiPillar | null => set.pillars.find((p) => p.key === key) ?? null;

/** The default pillars by their number in the plan (1 Delivery & Timeliness … 4 Discipline & Growth), as the samples and the library are written. */
export type KpiDefaultPillarNo = 1 | 2 | 3 | 4;
export const kpiDefaultPillarKey = (no: KpiDefaultPillarNo): string => KPI_PILLARS[no - 1].key;

/** The most a final % can be: a criterion may be worth more than its metric's target, up to here. */
export const KPI_FINAL_CAP = 110;

export const KPI_LEVELS = ['unacceptable', 'unsatisfactory', 'needs_improvement', 'meets', 'above'] as const;
export type KpiLevel = (typeof KPI_LEVELS)[number];

export const isKpiLevel = (value: unknown): value is KpiLevel => (KPI_LEVELS as readonly unknown[]).includes(value);

/** The levels as the screens name them (sentence case: they are labels and badges). */
export const KPI_LEVEL_LABELS: Record<KpiLevel, string> = {
  unacceptable: 'Unacceptable',
  unsatisfactory: 'Unsatisfactory',
  needs_improvement: 'Needs improvement',
  meets: 'Meets expectations',
  above: 'Above expectations',
};

/** The levels in Arabic, for the Arabic payslip. */
export const KPI_LEVEL_LABELS_AR: Record<KpiLevel, string> = {
  unacceptable: 'غير مقبول',
  unsatisfactory: 'غير مُرضٍ',
  needs_improvement: 'يحتاج إلى تحسين',
  meets: 'يلبي التوقعات',
  above: 'يفوق التوقعات',
};

/** Each level's band as the screens write it: "Below 50%", "50–70%" … "Above 100%". */
export const KPI_LEVEL_RANGES: Record<KpiLevel, string> = {
  unacceptable: 'Below 50%',
  unsatisfactory: '50–70%',
  needs_improvement: '70–90%',
  meets: '90–100%',
  above: 'Above 100%',
};

/**
 * The level of a final % (owner, 21 October 2026: "Unacceptable < 50 · Unsatisfactory 50–70 · Needs improvement 70–90 ·
 * Meets expectations 90–100 · Above expectations 100–110"). Each band includes its lower edge (50 is Unsatisfactory, 70
 * Needs improvement, 90 Meets expectations), and 100% exactly, every target met, Meets expectations: Above expectations
 * is beyond the targets, which only a criterion worth more than its target reaches.
 */
export function kpiLevel(percent: number): KpiLevel {
  if (percent > 100) return 'above';
  if (percent >= 90) return 'meets';
  if (percent >= 70) return 'needs_improvement';
  if (percent >= 50) return 'unsatisfactory';
  return 'unacceptable';
}

/** A percent as the screens write it: whole when it is ("86%"), else to one decimal ("89.6%"). */
export function kpiPercentText(percent: number): string {
  const rounded = round1(percent);
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

// ---------- templates: metrics and their criteria ----------

/** One step of a metric's criteria scale: what it says and the points it gives. */
export interface KpiCriterion {
  label: string;
  points: number;
}

/**
 * A metric of a template, as HR builds it from the job title's JD: its pillar, name, definition, how it's measured, the
 * JD duty it is linked to, the points that count as its target (100% of it), and its criteria scale, one picked a month.
 * A criterion may be worth more than the target (up to the final cap). `id`: the metric's, once saved.
 */
export interface KpiMetric {
  id?: string;
  /**
   * The key of its pillar in the template's pillars; null: a draft's metric in Unplaced, its pillar gone from the KPI
   * framework (kpi-framework.ts kpiPlaceMetrics), to be placed before the draft is published.
   */
  pillar: string | null;
  /** In Unplaced: the name of the pillar it was in; null otherwise. */
  wasIn?: string | null;
  name: string;
  definition: string | null;
  howMeasured: string | null;
  /**
   * The JD duties it measures (owner, 25 October 2026, asked on the draft's "JD duty": "can i select 2 job
   * descriptions?", then "Yes, several duties"): any of the job description's duty rows and duties typed, in order, each
   * once (kpiTidyDuties), at most KPI_TEMPLATE_LIMITS.duties; none: [].
   */
  jdDuties: string[];
  /**
   * The one duty a metric had before then: read as `[jdDuty]` (kpiMetricDuties), so what was saved before keeps it; no
   * longer sent or answered.
   */
  jdDuty?: string | null;
  targetPoints: number;
  criteria: KpiCriterion[];
}

/** What HR saves on a draft: the Attendance metric's points and the metrics, in order. */
export interface KpiTemplateContent {
  attendancePoints: number;
  metrics: KpiMetric[];
  /**
   * The job title's own weights for its pillars, by key (owner, 22 October 2026: "wights can be changed for each
   * department and Job title"; kpi-framework.ts KpiWeights); null: its department's (or the company's). Left out, those
   * it has are kept.
   */
  weights?: Record<string, number> | null;
}

/** The automatic metric's name, on every template in the pillar the framework chose (Discipline & Growth by default). */
export const KPI_ATTENDANCE_METRIC = 'Attendance';

/** The Attendance metric's points on a new template (owner's brief, 21 October 2026: "default 20"). */
export const KPI_ATTENDANCE_POINTS_DEFAULT = 20;

/**
 * Attendance in the KPI (owner, 25 October 2026: "Fixed cut only"): whether the Attendance metric counts in the KPI.
 * Off from then: attendance is cut on the fixed part of the pay only, so it is never cut twice. A company setting HR and
 * a Super Admin switch, kept in the KPI settings.
 */
export const KPI_ATTENDANCE_IN_KPI_DEFAULT = false;

/** The setting as the screens name it (a label: sentence case). */
export const KPI_ATTENDANCE_IN_KPI_LABEL = 'Attendance in the KPI';

/** What the payroll line, the payslip and the KPI pages say while attendance is out of the KPI (25 October 2026). */
export const KPI_PERFORMANCE_ONLY_NOTE = 'The KPI is performance only: attendance is cut on the fixed part.';

/** The Attendance metric as kpiScore takes it: its points and those achieved, or none (null) while it doesn't count. */
export const kpiAttendanceIn = (counted: boolean, points: number, achieved: number): { points: number; achieved: number } | null => (counted ? { points, achieved } : null);

/** The limits of a template's content. */
export const KPI_TEMPLATE_LIMITS = {
  metrics: 30,
  criteriaMin: 2,
  criteriaMax: 6,
  name: 120,
  text: 500,
  duty: 300,
  /** The most JD duties a metric is linked to (25 October 2026: "Yes, several duties"; kpi_metrics_jd_duties_check). */
  duties: 10,
  label: 80,
  /** The most points a criterion, a target or the Attendance metric may be worth. */
  points: 200,
} as const;

/** A duty as metrics' duties are compared: in any case, its spaces as one. */
const dutyKey = (duty: string): string => duty.trim().replace(/\s+/g, ' ').toLowerCase();

/** Whether two duties are the same one, in any case (kpiTidyDuties). */
export const kpiSameDuty = (a: string, b: string): boolean => dutyKey(a) === dutyKey(b);

/** A metric's JD duties tidied: each trimmed, empty ones left out, one given twice (in any case) kept once, the first. */
export function kpiTidyDuties(duties: readonly string[]): string[] {
  const seen = new Set<string>();
  const tidy: string[] = [];
  for (const duty of duties) {
    const key = dutyKey(duty);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tidy.push(duty.trim());
  }
  return tidy;
}

/**
 * A metric's JD duties, tidied, from what is kept or sent (25 October 2026: "Yes, several duties"): its `jdDuties` (a
 * list; one duty as text, as an old client may send it), else the one `jdDuty` a metric had before. So the templates,
 * the versions and the scorecards on them saved before keep their one duty, with nothing migrated. Anything not text
 * is left out.
 */
export function kpiMetricDuties(metric: { jdDuties?: unknown; jdDuty?: unknown }): string[] {
  const sent = typeof metric.jdDuties === 'string' ? [metric.jdDuties] : Array.isArray(metric.jdDuties) ? metric.jdDuties : [];
  const duties = kpiTidyDuties(sent.filter((d): d is string => typeof d === 'string'));
  return duties.length || typeof metric.jdDuty !== 'string' ? duties : kpiTidyDuties([metric.jdDuty]);
}

/** The highest points a metric's criteria give. */
export const topCriterionPoints = (metric: Pick<KpiMetric, 'criteria'>): number => metric.criteria.reduce((top, c) => Math.max(top, c.points), 0);

const isWholePoints = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= KPI_TEMPLATE_LIMITS.points;

/**
 * What is wrong with a template's content, each in words (none: it can be saved), its metrics placed in `pillars` (the
 * KPI framework's; the default four unless sent). A metric in Unplaced (no pillar) may be saved. `publishing`: also
 * what stops it being published: Unplaced emptied, a metric in each pillar but the Attendance metric's (which always
 * has Attendance), and each metric's best criterion reaching its target. `attendance`: whether the Attendance metric
 * counts in the KPI (the setting; on unless sent): off (owner, 25 October 2026: "Fixed cut only"), its points aren't
 * checked (kept as they are), and its pillar still needs no metric of its own: with none, it is left out of the score.
 */
export function kpiTemplateProblems(content: KpiTemplateContent, options: { publishing?: boolean; pillars?: KpiPillarSet; attendance?: boolean } = {}): string[] {
  const L = KPI_TEMPLATE_LIMITS;
  const set = options.pillars ?? KPI_DEFAULT_PILLAR_SET;
  const attendance = options.attendance !== false;
  const problems: string[] = [];
  if (attendance && !isWholePoints(content.attendancePoints, 1)) problems.push(`Give the Attendance metric whole points from 1 to ${L.points}.`);
  const metrics = Array.isArray(content.metrics) ? content.metrics : [];
  if (metrics.length > L.metrics) problems.push(`A template takes at most ${L.metrics} metrics.`);
  const names = new Map<string, number>();
  metrics.forEach((m, i) => {
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    const which = name ? `Metric ${i + 1} (${name})` : `Metric ${i + 1}`;
    if (m.pillar === null || m.pillar === undefined) {
      if (options.publishing) {
        const was = typeof m.wasIn === 'string' && m.wasIn.trim() ? `its pillar, ${m.wasIn.trim()}, is no longer in the KPI framework` : 'it has no pillar';
        problems.push(`${which} is in Unplaced: ${was}. Move it into a pillar, or remove it, before publishing.`);
      }
    } else if (!kpiPillarOf(set, m.pillar)) problems.push(`${which}: choose one of the framework’s pillars.`);
    if (!name) problems.push(`${which}: give it a name.`);
    else if (name.length > L.name) problems.push(`${which}: its name can be at most ${L.name} characters.`);
    else if (name.toLowerCase() === KPI_ATTENDANCE_METRIC.toLowerCase()) {
      problems.push(
        attendance
          ? `${which}: Attendance is filled in by the system already; name this metric otherwise.`
          : `${which}: attendance is out of the KPI, cut on the fixed part of the pay; name this metric otherwise.`,
      );
    } else {
      const key = name.toLowerCase();
      if (names.has(key)) problems.push(`${which}: metric ${names.get(key)! + 1} has the same name.`);
      else names.set(key, i);
    }
    for (const [field, label, max] of [
      ['definition', 'definition', L.text],
      ['howMeasured', 'how it’s measured', L.text],
    ] as const) {
      const value = m[field];
      if (value !== null && value !== undefined && (typeof value !== 'string' || value.length > max)) problems.push(`${which}: its ${label} can be at most ${max} characters.`);
    }
    // its JD duties (owner, 25 October 2026: "Yes, several duties"), tidied; one of before (jdDuty) read as a list of it
    const sentDuties: unknown = m.jdDuties === undefined ? kpiMetricDuties(m) : m.jdDuties;
    if (!Array.isArray(sentDuties) || sentDuties.some((d) => typeof d !== 'string')) problems.push(`${which}: its JD duties must be a list of texts.`);
    else {
      const duties = kpiTidyDuties(sentDuties as string[]);
      if (duties.length > L.duties) problems.push(`${which}: link it to at most ${L.duties} JD duties.`);
      duties.forEach((d, j) => {
        if (d.length > L.duty) problems.push(`${which}: its JD duty ${j + 1} can be at most ${L.duty} characters.`);
      });
    }
    if (!isWholePoints(m.targetPoints, 1)) problems.push(`${which}: give its target whole points from 1 to ${L.points}.`);
    const criteria = Array.isArray(m.criteria) ? m.criteria : [];
    if (criteria.length < L.criteriaMin || criteria.length > L.criteriaMax) problems.push(`${which}: give it from ${L.criteriaMin} to ${L.criteriaMax} criteria.`);
    const labels = new Set<string>();
    criteria.forEach((c, j) => {
      const label = typeof c.label === 'string' ? c.label.trim() : '';
      if (!label) problems.push(`${which}: criterion ${j + 1} needs a label.`);
      else if (label.length > L.label) problems.push(`${which}: criterion ${j + 1}'s label can be at most ${L.label} characters.`);
      else if (labels.has(label.toLowerCase())) problems.push(`${which}: two criteria are labelled "${label}".`);
      else labels.add(label.toLowerCase());
      if (!isWholePoints(c.points, 0)) problems.push(`${which}: criterion ${j + 1} needs whole points from 0 to ${L.points}.`);
    });
    if (options.publishing && isWholePoints(m.targetPoints, 1) && criteria.length && topCriterionPoints({ criteria }) < m.targetPoints) {
      problems.push(`${which}: its best criterion gives fewer points than its target (${m.targetPoints}), so nobody could reach 100% of it.`);
    }
  });
  if (options.publishing) {
    for (const pillar of set.pillars.filter((p) => p.key !== set.attendancePillar)) {
      if (!metrics.some((m) => m.pillar === pillar.key)) problems.push(`Add a metric to ${pillar.name}: every pillar is scored.`);
    }
  }
  return problems;
}

// ---------- scoring ----------

/** A metric as scoring reads it: its pillar, target and criteria (and its id, to find its pick). */
export type KpiScoredMetric = Pick<KpiMetric, 'pillar' | 'targetPoints' | 'criteria'> & { id: string };

/** One pillar's score: its points achieved of its max (the targets added up), and its percent. */
export interface KpiPillarScore {
  /** The pillar's key. */
  key: string;
  name: string;
  short: string;
  weight: number;
  achieved: number;
  max: number;
  /** achieved ÷ max × 100, to one decimal; unpicked metrics count 0 until picked. */
  percent: number;
  /** Every metric in it picked. */
  complete: boolean;
  /**
   * Left out of the final % (owner, 25 October 2026: "Fixed cut only"): the Attendance metric's pillar with no metric of
   * its own while attendance is out of the KPI, so nothing in it is scored; its weight is spread over the other pillars
   * in proportion to theirs. Left out of the answer otherwise.
   */
  leftOut?: true;
}

/** A scorecard's score: its pillars, the final % (capped at 110, to one decimal) and its level. */
export interface KpiScoreResult {
  pillars: KpiPillarScore[];
  finalPercent: number;
  level: KpiLevel;
  /** Every metric picked: the final % is the month's. */
  complete: boolean;
  /** The pillars added up past the cap: the final % is the cap. */
  capped: boolean;
}

/**
 * The automatic Attendance metric's points (owner, 21 October 2026: "Attendance: Yes, as the sheet"), in the pillar the
 * template's pillars chose for it (Discipline & Growth by default): its points × the
 * month's attendance score as payroll works it out (1 at or above the attendance grace, else worked ÷ expected hours),
 * capped at 1, rounded to whole points. With no score (attendance not counted for the month: no worked hours, no shift,
 * paid by the hour) the score is 1, as payroll counts it then.
 */
export function kpiAttendanceAchieved(points: number, score: number | null | undefined): number {
  const s = typeof score === 'number' && Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 1;
  return Math.round(points * s);
}

/**
 * The score of a template's metrics with the criteria picked (`choices`: by metric id, the criterion's index; missing
 * or null: not picked) and the Attendance metric's points achieved, in the template's pillars (`pillars`: the pillars
 * its version was published with; the default four unless sent). Pillar % = achieved ÷ max points (the targets added
 * up, Attendance's in its pillar); final % = Σ pillar % × that pillar's weight, at most 110 (owner, 21 October 2026).
 * A metric in no pillar of the set counts nowhere.
 * `attendance` null: the Attendance metric doesn't count (owner, 25 October 2026: "Fixed cut only"; kpiAttendanceIn).
 * No pillar has its points, so each pillar's % is its metrics' alone; the Attendance metric's pillar with no metric of
 * its own (the templates and the library leave Discipline & Growth to it alone) has nothing to score, and is left out
 * (`leftOut`): its weight is spread over the other pillars in proportion to theirs, so the final % is the performance
 * measured, never a free 100% nor a 0% for it. With the metric counting, the score is as it always was.
 */
export function kpiScore(
  metrics: readonly KpiScoredMetric[],
  choices: Readonly<Record<string, number | null | undefined>>,
  attendance: { points: number; achieved: number } | null,
  set: KpiPillarSet = KPI_DEFAULT_PILLAR_SET,
): KpiScoreResult {
  const scored = set.pillars.map((p) => {
    let achieved = 0;
    let max = 0;
    let complete = true;
    for (const m of metrics) {
      if (m.pillar !== p.key) continue;
      max += m.targetPoints;
      const choice = choices[m.id];
      const criterion = typeof choice === 'number' ? m.criteria[choice] : undefined;
      if (criterion) achieved += criterion.points;
      else complete = false;
    }
    if (attendance && p.key === set.attendancePillar) {
      max += attendance.points;
      achieved += attendance.achieved;
    }
    return { p, achieved, max, complete, leftOut: !attendance && p.key === set.attendancePillar && max === 0 };
  });
  // the weight of a pillar left out spread over the others in proportion: each counts its weight × all ÷ those kept
  const all = scored.reduce((sum, s) => sum + s.p.weight, 0);
  const kept = scored.reduce((sum, s) => sum + (s.leftOut ? 0 : s.p.weight), 0);
  const spread = kept !== all;
  let total = 0;
  const pillars = scored.map(({ p, achieved, max, complete, leftOut }): KpiPillarScore => {
    const fraction = max > 0 ? achieved / max : 0;
    if (!leftOut) total += spread ? (kept > 0 ? (fraction * p.weight * all) / kept : 0) : fraction * p.weight;
    return { key: p.key, name: p.name, short: p.short, weight: p.weight, achieved, max, percent: round1(fraction * 100), complete, ...(leftOut && { leftOut: true as const }) };
  });
  const capped = total > KPI_FINAL_CAP;
  const finalPercent = round1(Math.min(KPI_FINAL_CAP, total));
  return { pillars, finalPercent, level: kpiLevel(finalPercent), complete: pillars.every((p) => p.complete), capped };
}

// ---------- scorecards: statuses, steps, who scores ----------

/**
 * Where a scorecard is: the employee's self-rating, the manager's scoring, HR's calibration, the sign-off by both, and
 * final (locked).
 */
export const KPI_STATUSES = ['self_rating', 'manager', 'hr', 'sign_off', 'final'] as const;
export type KpiStatus = (typeof KPI_STATUSES)[number];

export const isKpiStatus = (value: unknown): value is KpiStatus => (KPI_STATUSES as readonly unknown[]).includes(value);

export const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  self_rating: 'Self-rating',
  manager: 'With the manager',
  hr: 'With HR',
  sign_off: 'Sign-off',
  final: 'Final',
};

/** The statuses from which the manager's (and HR's) picks are the scorecard's: shown to the employee from sign-off. */
export const kpiScored = (status: KpiStatus | string): boolean => status === 'hr' || status === 'sign_off' || status === 'final';

/** Whether the employee sees the manager's scoring and HR's calibration: from the sign-off on. */
export const kpiShownToEmployee = (status: KpiStatus | string): boolean => status === 'sign_off' || status === 'final';

/**
 * Who scores a scorecard (kept on it when it opens): `manager`, the approver in charge (the direct manager, else the
 * team lead, else the department head: department-leads.ts approverInCharge); `hr` when nobody is in charge; `ceo` for
 * a C-level person (owner, 21 October 2026: "For C-level people the CEO scores, and HR never sees them"); `super_admin`
 * for the CEO's own (the CEO can't score themself: as their requests' HR stage, 19 October 2026, a Super Admin's).
 */
export const KPI_SCORERS = ['manager', 'hr', 'ceo', 'super_admin'] as const;
export type KpiScorer = (typeof KPI_SCORERS)[number];

export const KPI_SCORER_LABELS: Record<KpiScorer, string> = {
  manager: 'Manager',
  hr: 'HR',
  ceo: 'The CEO',
  super_admin: 'A Super Admin',
};

/** Who scores someone: C-level → the CEO (a CEO themself: a Super Admin); else the person in charge; none: HR. */
export function kpiScorerOf(who: { confidential: boolean; isCeo: boolean; approverId: string | null }): KpiScorer {
  if (who.confidential) return who.isCeo ? 'super_admin' : 'ceo';
  return who.approverId ? 'manager' : 'hr';
}

/**
 * Whether HR's calibration is a step of its own: only after a manager's scoring. When HR scored (nobody in charge), or
 * the CEO (a C-level person's: the CEO takes HR's steps, 19 October 2026) or a Super Admin, the one who scored is the
 * calibration's own decider, so it is taken with the scoring and the scorecard goes on to the sign-off.
 */
export const kpiCalibrationStep = (scorer: KpiScorer | string): boolean => scorer === 'manager';

/** The status after the manager's scoring is sent. */
export const kpiStatusAfterScoring = (scorer: KpiScorer | string): KpiStatus => (kpiCalibrationStep(scorer) ? 'hr' : 'sign_off');

/** What is logged on a scorecard, in order, with who and when. */
export const KPI_STEP_KINDS = [
  'opened',
  'self_rated',
  'self_missed',
  'scored',
  'calibrated',
  'signed_employee',
  'signed_manager',
  'final',
  'final_unsigned',
] as const;
export type KpiStepKind = (typeof KPI_STEP_KINDS)[number];

export const KPI_STEP_LABELS: Record<KpiStepKind, string> = {
  opened: 'Opened',
  self_rated: 'Self-rating sent',
  self_missed: 'Self-rating missed',
  scored: 'Scored',
  calibrated: 'Calibrated by HR',
  signed_employee: 'Signed by the employee',
  signed_manager: 'Signed by the manager',
  final: 'Final',
  final_unsigned: 'Final without every signature',
};

/** What the caller may do on a scorecard now. */
export const KPI_ACTIONS = ['self_rate', 'score', 'calibrate', 'sign'] as const;
export type KpiAction = (typeof KPI_ACTIONS)[number];

export const KPI_ACTION_LABELS: Record<KpiAction, string> = {
  self_rate: 'Rate yourself',
  score: 'Score',
  calibrate: 'Calibrate',
  sign: 'Sign',
};

/** The longest comment on a pick, a step or a sign-off, and a calibration's reason. */
export const KPI_COMMENT_MAX = 1000;

/**
 * Who gets a scorecard (owner's brief, 21 October 2026): "Not freelancers or unpaid interns; trainees yes". The paid
 * trainee went on 25 October 2026 (owner: "unpaid internship and training are the same thing"), so: not freelancers or
 * interns.
 */
export const kpiEligibleType = (type: EmploymentType | string): boolean => type !== 'freelance' && type !== 'intern';

// ---------- months, deadlines and reminders ----------

/** The days of the next month each step is due by (owner's brief, 21 October 2026: "by the 3rd, … the 6th, … the 8th"; "by the 10th"). */
export interface KpiSettings {
  selfRatingDay: number;
  managerDay: number;
  hrDay: number;
  signOffDay: number;
}

export const KPI_SETTING_DEFAULTS: KpiSettings = { selfRatingDay: 3, managerDay: 6, hrDay: 8, signOffDay: 10 };

export const KPI_SETTING_LABELS: Record<keyof KpiSettings, string> = {
  selfRatingDay: 'Self-rating by',
  managerDay: 'Manager’s scoring by',
  hrDay: 'HR’s calibration by',
  signOffDay: 'Sign-off by',
};

/** The latest day a deadline may be: one every month has. */
export const KPI_LAST_DEADLINE_DAY = 28;

/** What is wrong with the deadlines: each a whole day from 1 to 28 of the next month, each step after the one before. */
export function kpiSettingsProblems(s: KpiSettings): string[] {
  const problems: string[] = [];
  const keys = Object.keys(KPI_SETTING_DEFAULTS) as (keyof KpiSettings)[];
  for (const k of keys) {
    const v = s[k];
    if (!(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= KPI_LAST_DEADLINE_DAY)) problems.push(`${KPI_SETTING_LABELS[k]}: choose a day from 1 to ${KPI_LAST_DEADLINE_DAY}.`);
  }
  if (problems.length) return problems;
  const steps: Record<keyof KpiSettings, string> = { selfRatingDay: 'the self-rating', managerDay: 'the manager’s scoring', hrDay: 'HR’s calibration', signOffDay: 'the sign-off' };
  for (let i = 1; i < keys.length; i++) {
    const step = steps[keys[i]];
    if (s[keys[i]] <= s[keys[i - 1]]) problems.push(`${step[0].toUpperCase()}${step.slice(1)} must be due after ${steps[keys[i - 1]]}: choose a later day.`);
  }
  return problems;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" for "2026-10" (or a day of it). */
export const kpiMonthName = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** "October" for "2026-10": the month alone, as the short texts say it ("Your October KPI is ready to sign"). */
export const kpiMonthOnly = (month: string): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1];

/** The month `n` months after "YYYY-MM" (before, when negative). */
export function kpiMonthAdd(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The month a scorecard opens in: the month after its own (October's opens on 1 November). */
export const kpiOpeningMonth = (month: string): string => kpiMonthAdd(month.slice(0, 7), 1);

/** The month whose scorecards open in the month of `day` (YYYY-MM-DD): the month before (on 1 November, October). */
export const kpiScorecardMonthOn = (day: string): string => kpiMonthAdd(day.slice(0, 7), -1);

/**
 * The payroll month a scorecard counts in (owner, 21 October 2026: "Last month's KPI, this pay"): the month after its
 * own. The other way round, the payroll of month M reads the final scorecard of M − 1 (kpiMonthForPayroll).
 */
export const kpiPayrollMonth = (month: string): string => kpiMonthAdd(month.slice(0, 7), 1);
export const kpiMonthForPayroll = (payrollMonth: string): string => kpiMonthAdd(payrollMonth.slice(0, 7), -1);

/** A month's scorecard's deadlines, YYYY-MM-DD, days of the next month. */
export interface KpiDeadlines {
  selfRating: string;
  manager: string;
  hr: string;
  signOff: string;
}

export function kpiDeadlines(month: string, s: KpiSettings = KPI_SETTING_DEFAULTS): KpiDeadlines {
  const next = kpiOpeningMonth(month);
  const day = (d: number) => `${next}-${String(d).padStart(2, '0')}`;
  return { selfRating: day(s.selfRatingDay), manager: day(s.managerDay), hr: day(s.hrDay), signOff: day(s.signOffDay) };
}

/** Whether a deadline has gone by on `today` (YYYY-MM-DD): a step due "by the 3rd" may be taken all through the 3rd. */
export const kpiPast = (deadline: string, today: string): boolean => today > deadline;

/** The deadline of the step a scorecard is at; none once final. */
export function kpiStepDeadline(status: KpiStatus | string, d: KpiDeadlines): string | null {
  switch (status) {
    case 'self_rating':
      return d.selfRating;
    case 'manager':
      return d.manager;
    case 'hr':
      return d.hr;
    case 'sign_off':
      return d.signOff;
    default:
      return null;
  }
}

/**
 * What the days gone by do to a scorecard on `today` (owner's brief, 21 October 2026): a self-rating not sent by its
 * deadline is missed (noted) and the scorecard goes on to the manager; a sign-off not done by its deadline is final
 * anyway (noted). Null: nothing to do.
 */
export function kpiDueChange(status: KpiStatus | string, d: KpiDeadlines, today: string): 'self_missed' | 'final_unsigned' | null {
  if (status === 'self_rating' && kpiPast(d.selfRating, today)) return 'self_missed';
  if (status === 'sign_off' && kpiPast(d.signOff, today)) return 'final_unsigned';
  return null;
}

/** The reminders, one the day before each deadline (owner's brief, 21 October 2026). */
export const KPI_REMINDERS = ['self_rating', 'manager', 'hr', 'sign_off'] as const;
export type KpiReminder = (typeof KPI_REMINDERS)[number];

/** The day before a deadline (YYYY-MM-DD); none for a deadline on the 1st (the scorecard opens that day). */
export function kpiDayBefore(deadline: string): string | null {
  const day = Number(deadline.slice(8, 10));
  return day > 1 ? `${deadline.slice(0, 8)}${String(day - 1).padStart(2, '0')}` : null;
}

/**
 * The reminder due today for a scorecard at this status (the step it waits at, the day before its deadline), unless it
 * was sent already; null: none.
 */
export function kpiReminderDue(status: KpiStatus | string, d: KpiDeadlines, today: string, sent: readonly string[]): KpiReminder | null {
  const step: KpiReminder | null = status === 'self_rating' || status === 'manager' || status === 'hr' || status === 'sign_off' ? status : null;
  if (!step || sent.includes(step)) return null;
  const deadline = kpiStepDeadline(step, d)!;
  return kpiDayBefore(deadline) === today ? step : null;
}

// ---------- the payroll ----------

/**
 * The KPI a payroll line's variable part follows (owner, 21 October 2026: "Last month's KPI, this pay"): the final
 * scorecard of the month before the payroll's, its final % and level. Kept with the line's terms when the run is made
 * or refreshed (PayrollTerms.kpi).
 */
export interface PayrollKpi {
  /** The scorecard's month, YYYY-MM: the month before the payroll's. */
  month: string;
  scorecardId: string;
  finalPercent: number;
  level: KpiLevel;
  /**
   * Whether its Attendance metric counted in it (owner, 25 October 2026: "Fixed cut only": false since, the KPI being
   * performance only); missing on the lines made before then, whose scorecards all counted it.
   */
  attendanceCounted?: boolean;
}

/** Whether a line's KPI is performance only: its scorecard's Attendance metric didn't count (25 October 2026). */
export const kpiPerformanceOnly = (kpi: Pick<PayrollKpi, 'attendanceCounted'> | null | undefined): boolean => kpi?.attendanceCounted === false;

/**
 * The KPI score payroll works the variable part out with (owner, 21 October 2026: "As the sheet: full at 80%+"): 1 at
 * or above the grace percent, else the final % as a fraction; with no final scorecard (null), 1: not cut.
 */
export function kpiPayScore(kpi: Pick<PayrollKpi, 'finalPercent'> | null | undefined, gracePercent: number): number {
  if (!kpi) return 1;
  const fraction = Math.max(0, kpi.finalPercent) / 100;
  return kpi.finalPercent >= gracePercent ? 1 : Math.round(fraction * 1e10) / 1e10;
}

/**
 * The line's KPI in words, on the payroll line's breakdown and the payslip: "KPI (September 2026): 86% · Needs
 * improvement · paid in full (80%+)", "KPI (September 2026): 70% · Needs improvement · variable paid at 70%"; with none,
 * "KPI (September 2026): no final scorecard · not cut".
 */
export function kpiPayText(month: string, kpi: Pick<PayrollKpi, 'finalPercent' | 'level'> | null, gracePercent: number): string {
  const head = `KPI (${kpiMonthName(month)})`;
  if (!kpi) return `${head}: no final scorecard · not cut`;
  const pay = kpi.finalPercent >= gracePercent ? `paid in full (${gracePercent}%+)` : `variable paid at ${kpiPercentText(kpi.finalPercent)}`;
  return `${head}: ${kpiPercentText(kpi.finalPercent)} · ${KPI_LEVEL_LABELS[kpi.level]} · ${pay}`;
}

/** What the payroll line and the payslip say of the timing (owner, 21 October 2026: "Say this on the payroll line and the payslip"). */
export const KPI_PAY_TIMING_NOTE = "Last month's KPI counts in this month's pay.";

// ---------- the views (the API's answers, the web's contract) ----------

/** A person as the KPI pages name them. */
export interface KpiPersonRef {
  id: string;
  employeeCode: string;
  fullNameEn: string;
}

/** A sign-in account as the KPI pages name who did something: their employee name, else their email. */
export interface KpiUserRef {
  email: string;
  name: string | null;
}

/** A saved metric: its id, and whether it is the automatic Attendance metric (not on a template's metrics list). */
export type KpiMetricView = KpiMetric & { id: string };

/** A version of a job title's template. */
export interface KpiTemplateView {
  id: string;
  jobTitleId: string;
  version: number;
  status: 'draft' | 'published';
  attendancePoints: number;
  metrics: KpiMetricView[];
  /**
   * Published: the 1st of the month from which the scorecards opened use it (the month after it was published), YYYY-MM-
   * DD; null for a draft.
   */
  opensFrom: string | null;
  /** Published: the first month whose KPI it scores (the month before opensFrom), YYYY-MM; null for a draft. */
  firstMonth: string | null;
  /** The version the scorecards opened now use. */
  inForce: boolean;
  publishedAt: string | null;
  publishedBy: KpiUserRef | null;
  createdAt: string;
  updatedAt: string;
  /** How many scorecards opened with it (the real ones: never a practice one). */
  scorecards: number;
  /**
   * The practice scorecards on it (owner, 22 October 2026: "Practice scorecards"): a draft's are started again when it
   * is saved changed, and deleted with it when it is discarded.
   */
  practiceScorecards?: number;
  /** A draft: what stops it being published (kpiTemplateProblems with publishing); none for a published version. */
  problems: string[];
  /**
   * Its pillars, in order, with the Attendance metric's: a published version's own, as it was published (its
   * scorecards are scored with them); a draft's, the KPI framework's newest, which it is published with, its metrics
   * placed in them by name (kpiPlaceMetrics), those whose pillar is gone in Unplaced (`pillar` null).
   */
  pillars: KpiPillar[];
  attendancePillar: string;
  /** A draft whose metrics were written for other pillars than the framework's newest: placed in them by name, to check. */
  pillarsChanged: boolean;
  /** A published version whose pillars aren't the KPI framework's newest: "Uses the old pillars". */
  oldPillars: boolean;
  /**
   * Whose pillars they are (owner, 22 October 2026: "i need pillars to each department"): a department's own (a
   * published version: the framework it was published with; a draft: its job title's department's newest), or the
   * company's (null).
   */
  pillarsFrom: { departmentId: string; nameEn: string } | null;
  /** Its pillars' weights as the department (or the company) has them, by key: what its own weights differ from. */
  baseWeights: Record<string, number>;
  /** Its pillars' weights are the job title's own, not the department's (or the company's). */
  ownWeights: boolean;
  /** A draft whose own weights were dropped, its pillars having gained or lost one: it takes the department's again. */
  weightsReset: boolean;
}

/** A job title on the KPI Templates list. */
export interface KpiTemplateRow {
  jobTitle: { id: string; titleEn: string; department: { id: string; nameEn: string; parentName: string | null } };
  /** The version the scorecards opened now use; null: none yet. */
  inForce: { id: string; version: number; metrics: number; opensFrom: string } | null;
  /** The newest published version, when it isn't the one in force yet (it opens from next month). */
  upcoming: { id: string; version: number; opensFrom: string } | null;
  draft: { id: string; version: number; updatedAt: string } | null;
  /** Published versions in all. */
  versions: number;
  /** Current employees under this job title who get a scorecard (not freelancers or unpaid interns). */
  people: number;
  /**
   * Its newest published version uses other pillars than the KPI framework's newest: "Uses the old pillars: update
   * it". Its scorecards keep opening on that version, with its pillars, until a version on the new ones applies.
   */
  oldPillars: boolean;
}

/** GET /kpis/templates/job-titles/:jobTitleId: the builder's page. */
export interface KpiJobTitleTemplates {
  jobTitle: {
    id: string;
    titleEn: string;
    titleAr: string | null;
    department: { id: string; nameEn: string; parentName: string | null };
    /** The JD, as saved (cleaned HTML), shown next to the builder; null when empty. */
    jdPurpose: string | null;
    jdDuties: string | null;
    jdRequirements: string | null;
    /** The JD's duty rows, to link a metric to. */
    duties: string[];
  };
  draft: KpiTemplateView | null;
  /** Published versions, newest first. */
  versions: KpiTemplateView[];
  /** Whether the caller builds templates (HR, Super Admin). */
  canEdit: boolean;
  /**
   * The setting Attendance in the KPI now (owner, 25 October 2026: "Fixed cut only"): off, the Attendance metric is
   * hidden and its points aren't checked. Missing from an API before then: on.
   */
  attendanceInKpi?: boolean;
}

/** A sample to start a draft from (KPI_SAMPLE_TEMPLATES), as GET /kpis/templates/samples lists them. */
export interface KpiSampleView {
  code: string;
  role: string;
  department: string;
  jdDuties: string[];
  attendancePoints: number;
  metrics: KpiMetric[];
}

/**
 * POST /kpis/templates/job-titles/:jobTitleId/draft: where a new draft's content comes from; `library`: a role of the
 * KPI role library (kpi-library.ts, owner, 21 October 2026: "can you add templetes for all departments and job roles").
 */
export type KpiDraftSource =
  | { from: 'blank' }
  | { from: 'published' }
  | { from: 'sample'; sampleCode: string }
  | { from: 'template'; templateId: string }
  | { from: 'library'; libraryKey: string };

/** A scorecard in a list. */
export interface KpiScorecardSummary {
  id: string;
  /** YYYY-MM. */
  month: string;
  employee: KpiPersonRef;
  jobTitle: string | null;
  /** "Web Development", or a team as "Web Development › Frontend" (as a payroll line names it). */
  department: string | null;
  departmentId: string | null;
  status: KpiStatus;
  templateVersion: number;
  scorer: { kind: KpiScorer; name: string | null };
  /**
   * The score once the manager has sent it (calibrated by HR, when HR did), for those who see it: the employee only
   * from the sign-off on; null otherwise.
   */
  finalPercent: number | null;
  level: KpiLevel | null;
  selfMissed: boolean;
  /** How many picks HR changed. */
  calibrated: number;
  signed: { employee: boolean; manager: boolean };
  /** Final without every signature (by the sign-off day). */
  unsigned: boolean;
  /** What the caller may do on it now; null: nothing. */
  action: KpiAction | null;
  /** The deadline of the step it is at (YYYY-MM-DD); null once final. */
  deadline: string | null;
  confidential: boolean;
  /**
   * A practice scorecard (owner, 22 October 2026: "Practice scorecards"; kpi-practice.ts): who started it and when, and
   * whether its template version is a draft; null or left out for a real one.
   */
  practice?: KpiPracticeInfo | null;
}

/** A pick at a step: the criterion's index (null: not picked) and its comment. */
export interface KpiPickView {
  choice: number | null;
  comment: string | null;
}

/** A metric on a scorecard, with the picks the caller may see (null: hidden from them, or not picked yet). */
export interface KpiScorecardMetric extends KpiMetricView {
  self: KpiPickView | null;
  manager: KpiPickView | null;
  /** HR's change of the manager's pick, with its reason (`comment`); null: none. */
  hr: KpiPickView | null;
  /** The pick that counts as the caller sees the scorecard (HR's, else the manager's), and its points; null: none. */
  points: number | null;
}

export interface KpiScorecardPillar extends KpiPillar {
  metrics: KpiScorecardMetric[];
  achieved: number;
  max: number;
  percent: number;
  complete: boolean;
  /** Nothing in it is scored while attendance is out of the KPI: its weight spread over the others (KpiPillarScore.leftOut). */
  leftOut?: true;
}

/** The automatic Attendance metric on a scorecard. */
export interface KpiScorecardAttendance {
  points: number;
  achieved: number;
  /** Worked ÷ expected hours as payroll counts them; null when attendance isn't counted for the month. */
  ratio: number | null;
  /** The attendance score (1 at or above the grace); null when not counted (then counted as full). */
  score: number | null;
  /** Where it was read: the month's payroll line, the attendance days, or nothing (counted as full). */
  source: 'payroll' | 'attendance' | 'none';
  /**
   * Whether it counts in the score (owner, 25 October 2026: "Fixed cut only"): as the setting Attendance in the KPI is
   * while the scorecard isn't final, kept once it is. False: the scorecard is performance only, and the metric is
   * hidden. Missing from an API before then: it counted.
   */
  counted?: boolean;
}

/** GET /kpis/scorecards/:id. */
export interface KpiScorecardView extends KpiScorecardSummary {
  template: { id: string; version: number; jobTitleId: string };
  /** Its template version's pillars, as it was published: the scorecard is scored with them. */
  pillars: KpiScorecardPillar[];
  /** The key of the pillar the Attendance metric counts in. */
  attendancePillar: string;
  attendance: KpiScorecardAttendance;
  /** The scorecard's score as the caller sees it (the manager's picks, calibrated): null when hidden from them or not scored. */
  score: KpiScoreResult | null;
  /** The employee's self-rating's own score, for those who see it; null otherwise. */
  selfScore: KpiScoreResult | null;
  comments: { self: string | null; manager: string | null; hr: string | null; employeeSign: string | null; managerSign: string | null };
  steps: { kind: KpiStepKind; label: string; at: string; by: string | null; comment: string | null }[];
  deadlines: KpiDeadlines;
  can: { selfRate: boolean; score: boolean; calibrate: boolean; signAsEmployee: boolean; signAsManager: boolean };
  /** The payroll it counts in: "November 2026", YYYY-MM. */
  payrollMonth: string;
  /**
   * A practice scorecard's steps the caller may take now standing in for the people in it (its starter or a Super
   * Admin, in their own session: kpi-practice.ts kpiStandsIn); null or left out for anyone else, and for a real one.
   */
  standIn?: Record<KpiPracticeStep, boolean> | null;
  /** A practice scorecard on a draft: its metrics in Unplaced (no pillar), left out of it until placed. */
  unplaced?: number;
}

/** GET /kpis/counts: what waits for the caller. */
export interface KpiCounts {
  /** Their own scorecard: to rate themself, or to sign. */
  self: number;
  /** Their people's: to score, or to sign as the manager. */
  team: number;
  /** To calibrate: HR's (a C-level person's for the CEO, never shown to HR). */
  hr: number;
}

/** GET /kpis/heatmap: people × months, final % coloured by level, and the latest month's level distribution. */
export interface KpiHeatmap {
  /** YYYY-MM, oldest first. */
  months: string[];
  rows: {
    employee: KpiPersonRef;
    jobTitle: string | null;
    department: string | null;
    cells: ({ id: string; finalPercent: number | null; level: KpiLevel | null; status: KpiStatus } | null)[];
  }[];
  /** The levels of the last month's scored scorecards. */
  distribution: { month: string; counts: Record<KpiLevel, number>; scored: number; total: number };
}

/** GET /kpis/overview?month=: HR's, the CEO's and the Super Admin's month. */
export interface KpiOverview {
  month: string;
  /** Months that have scorecards, newest first. */
  months: string[];
  total: number;
  byStatus: Record<KpiStatus, number>;
  /** Scorecards whose picks HR changed. */
  calibrated: number;
  selfMissed: number;
  /** Final without every signature. */
  unsigned: number;
  /** The scored scorecards' average final %; null with none. */
  average: number | null;
  /** The month before's, to compare; null with none. */
  previousAverage: number | null;
  distribution: Record<KpiLevel, number>;
  /**
   * The pillars the departments' averages are by: those of the month's scored scorecards (their template versions'), by
   * name (kpi-framework.ts kpiPillarColumns); a weight null when it differs between them.
   */
  pillars: KpiPillarColumn[];
  /** The month's scored scorecards have different pillars (the framework changed): "Pillars changed this month: averages by name". */
  pillarsChanged: boolean;
  /** The average pillar % of each department's scored scorecards (teams under their department), by the columns' keys. */
  departments: { id: string | null; name: string; scored: number; average: number | null; pillars: Record<string, number | null> }[];
  /** C-level people left out for the caller. */
  hidden: number;
}

/** A pillar as a column of the month's overview and its Excel, by its name. */
export interface KpiPillarColumn {
  /** Its name in lower case, single-spaced: the departments' averages are by it. */
  key: string;
  name: string;
  short: string;
  /** Its weight when every scorecard with it has the same; null when they differ. */
  weight: number | null;
}

/** POST /kpis/open: the month whose scorecards were opened, and how many. */
export interface KpiOpenResult {
  month: string;
  opened: number;
}

/**
 * GET and PATCH /kpis/settings: the deadlines, Attendance in the KPI (owner, 25 October 2026: "Fixed cut only"; off
 * from then; missing from an API before then: on), and who changed them last.
 */
export interface KpiSettingsView extends KpiSettings {
  attendanceInKpi?: boolean;
  updatedAt: string | null;
  updatedBy: KpiUserRef | null;
}

/** PATCH /kpis/settings: the days sent, and Attendance in the KPI switched on or off (25 October 2026). */
export type KpiSettingsInput = Partial<KpiSettings> & { attendanceInKpi?: boolean };

// ---------- what the pages send ----------

/**
 * POST /kpis/scorecards/:id/self and …/score: the picks (a criterion's index a metric, null: not picked; never the
 * Attendance metric, the system's), each with its comment, the step's overall comment, and whether it is sent (`submit`:
 * every metric picked; false: saved for later).
 */
export interface KpiPicksInput {
  picks: { metricId: string; choice: number | null; comment?: string | null }[];
  comment?: string | null;
  submit: boolean;
}

/** POST /kpis/scorecards/:id/calibrate: HR's changes of the manager's picks, each with its reason, and HR's comment. */
export interface KpiCalibrateInput {
  changes: { metricId: string; choice: number; reason: string }[];
  comment?: string | null;
}

/** POST /kpis/scorecards/:id/sign: "I've read it", with an optional comment. */
export interface KpiSignInput {
  comment?: string | null;
}

// ---------- the samples (kpi-framework.json's three role templates) ----------

/**
 * The three sample role templates from TrendLIX's HR KPI sheet (trendlix-hrms-handoff config/kpi-framework.json), for
 * "Start from a sample". Each metric's target is its best criterion's points. Their own attendance metric ("Attendance
 * & punctuality", "Attendance & OD discipline") is left out: the automatic Attendance metric takes its place, worth its
 * best points (25); the HR Specialist's, without one, the default 20.
 */
export const KPI_SAMPLE_TEMPLATES: readonly KpiSampleView[] = [
  {
    code: 'FE-SR v2',
    role: 'Senior Frontend Developer',
    department: 'Web Development',
    jdDuties: [
      'Deliver sprint tasks on time with accurate estimates',
      'Convert designs into responsive, accessible UI',
      'Write clean code; keep reopened bugs low',
      'Update PMs, join client calls, mentor juniors',
    ],
    attendancePoints: 25,
    metrics: [
      sample(1, 'Sprint tasks delivered on time', 'Share of assigned sprint tasks closed by their due date', '(Tasks on time ÷ tasks due) × 100, from Tasks; client-blocked tasks excluded', 'Deliver sprint tasks on time', [['95–100%', 35], ['85–94%', 25], ['Below 85%', 10]]),
      sample(1, 'Estimate accuracy', 'How close actual hours are to the estimate', 'Actual ÷ estimated hours per task, monthly average', 'Estimate work accurately', [['Within 10%', 25], ['10–25% off', 15], ['Over 25% off', 5]]),
      sample(2, 'Reopened bugs after QA', 'Tickets sent back after being marked done', 'Count of reopened tickets in the month', 'Fix bugs before release', [['0', 35], ['1–2', 25], ['3 or more', 10]]),
      sample(2, 'Code review findings', 'Major issues raised during code review', 'Major findings logged by the reviewer', 'Write clean, maintainable code', [['No major', 25], ['1 major', 15], ['2+ major', 5]]),
      sample(3, 'PM / client feedback', 'Rating from the PM, and the client where relevant', 'Monthly 1–5 rating form', 'Update PMs and join client calls', [['4.5 – 5', 30], ['4.0 – 4.4', 20], ['Below 4', 10]]),
      sample(3, 'Knowledge sharing & mentoring', 'Support given to juniors and shared documentation', 'Manager judgement with examples', 'Mentor juniors, document components', [['Regular, documented', 20], ['Some', 12], ['None', 5]]),
      sample(4, 'Development plan', 'Courses completed from the agreed plan', 'Certificates uploaded to Documents', 'Company policy', [['2 courses', 25], ['1 course', 20], ['None', 0]]),
    ],
  },
  {
    code: 'MED-VP v1',
    role: 'Video Producer',
    department: 'Media Production',
    jdDuties: [
      'Plan shoots: call sheets, shot lists, equipment',
      'Produce and edit videos to brief and brand',
      'Deliver edits by the content-calendar dates',
      'Lead crew on set and represent TrendLIX with clients',
    ],
    attendancePoints: 25,
    metrics: [
      sample(1, 'Deliverables on schedule', 'Edits delivered by the content-calendar date', 'Delivered vs planned date; client delays excluded', 'Deliver edits by agreed dates', [['All on time', 35], ['1 late', 25], ['2+ late', 10]]),
      sample(1, 'Shoot preparation', 'Call sheet, shot list and gear ready 24 h before', 'Checklist per shoot', 'Plan and prepare shoots', [['All ready', 25], ['1 miss', 15], ['2+ misses', 5]]),
      sample(2, 'Revision rounds', 'Average client revision rounds per deliverable', 'From the project deliverables log', 'Produce to brief first time', [['≤ 1 round', 35], ['2 rounds', 25], ['3+ rounds', 10]]),
      sample(2, 'Technical & brand QC', 'Issues found in internal QC: audio, colour, brand', 'Art Director review', 'Meet brand and technical standards', [['0 issues', 25], ['1 issue', 15], ['2+ issues', 5]]),
      sample(3, 'Client satisfaction', 'Client rating after each delivery', 'Satisfaction survey 1–5', 'Represent TrendLIX with clients', [['4.5 – 5', 30], ['4.0 – 4.4', 20], ['Below 4', 10]]),
      sample(3, 'Crew coordination', 'How smoothly the crew runs on set', 'Manager and crew feedback', 'Lead crew on set', [['Smooth', 20], ['Minor issues', 12], ['Escalations', 5]]),
      sample(4, 'Development plan', 'Courses completed from the agreed plan', 'Certificates uploaded to Documents', 'Company policy', [['2 courses', 25], ['1 course', 20], ['None', 0]]),
    ],
  },
  {
    code: 'HR-SP v3',
    role: 'HR Specialist',
    department: 'Operations & HR',
    jdDuties: [
      'Run recruitment and onboarding end to end',
      'Maintain employee files, contracts and system data',
      'Prepare monthly payroll inputs accurately',
      'Handle employee requests and run engagement activities',
    ],
    attendancePoints: KPI_ATTENDANCE_POINTS_DEFAULT,
    metrics: [
      sample(1, 'Time-to-hire & screening accuracy', 'Vacancies filled on time with well-matched candidates', 'Days from posting to offer + % of hires passing probation', 'Run recruitment end to end', [['No delays', 35], ['1–2 delays', 30], ['3+ delays', 20]]),
      sample(1, 'HR tasks delivered on time', 'Reliability in meeting HR deadlines', '(Completed HR tasks ÷ total tasks) × 100', 'Deliver HR operations on schedule', [['95–100%', 30], ['85–94%', 15], ['Below 85%', 5]]),
      sample(2, 'Accuracy of HR documentation', 'Employee files, contracts and system entries correct', 'Monthly file audit + corrections needed', 'Maintain files, contracts and data', [['No errors', 25], ['1 error', 15], ['2+ major', 5]]),
      sample(2, 'Monthly payroll accuracy', 'Payroll inputs and calculations complete and correct', 'Checked by Finance before approval', 'Prepare payroll inputs', [['0 errors', 50], ['1–2 errors', 40], ['3+ errors', 20]]),
      sample(3, 'Responsiveness to employees', 'Speed of answering HR requests and urgent cases', 'Average response time under 24 h', 'Handle employee requests', [['No complaints', 25], ['1 delay', 15], ['2+ delays', 5]]),
      sample(3, 'Issue resolution & relations', 'Fair, fast resolution of employee concerns', 'Resolution rate + CEO / employee feedback', 'Resolve employee concerns', [['95–100%', 30], ['85–94%', 15], ['Below 85%', 2]]),
      sample(4, 'Development plan', 'Courses completed from the agreed plan', 'Certificates uploaded to Documents', 'Company policy', [['2 courses', 50], ['1 course', 40], ['None', 0]]),
      sample(4, 'Engagement & culture support', 'Participation in engagement initiatives', 'Monthly engagement report + participation rate', 'Run engagement activities', [['30%+ up', 50], ['10–29% up', 45], ['Below 10%', 25]]),
    ],
  },
];

/**
 * A sample's metric in one of the four pillars it is written for (by their number: their keys in KPI_PILLARS), its
 * target its best criterion's points, its one duty as a list of it. A draft from it is placed in the framework's
 * pillars by name.
 */
function sample(pillar: KpiDefaultPillarNo, name: string, definition: string, howMeasured: string, duty: string, criteria: [string, number][]): KpiMetric {
  const scale = criteria.map(([label, points]) => ({ label, points }));
  return { pillar: kpiDefaultPillarKey(pillar), name, definition, howMeasured, jdDuties: [duty], targetPoints: topCriterionPoints({ criteria: scale }), criteria: scale };
}

/** A sample by its code (FE-SR v2, MED-VP v1, HR-SP v3); none for another. */
export const kpiSample = (code: string): KpiSampleView | null => KPI_SAMPLE_TEMPLATES.find((s) => s.code === code) ?? null;
