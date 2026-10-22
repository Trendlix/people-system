import { kpiMonthAdd, kpiMonthName, kpiPast, type KpiPersonRef, type KpiScorer, type KpiSignInput, type KpiStatus, type KpiUserRef } from './kpis.js';

// Practice KPI scorecards (owner, 22 October 2026: "i want to test the KPI's .. and it is locked to dates, HR and
// Admin.. how?", choosing "Practice scorecards"): "I or HR start a practice scorecard for any employee and month, from a
// draft or published template"; "Deadlines aren't enforced. Every step can be done by me, or through View as"; "It's
// marked Practice everywhere, notifies nobody, never reaches payroll, reports or exports, and deletes in one click".
// - HR and a Super Admin start one (those who open scorecards): for anyone they may see (HR never a C-level person),
//   any month from the person's join date to this one, from their job title's newest version or the one picked (a
//   draft, to try it). It opens as the month's real one would: the scorer, the Attendance metric so far, a row a metric.
// - Its deadlines show as they would be; no day holds a step back, nor moves it on (never self-missed, never final
//   unsigned, no reminder).
// - Its starter and any Super Admin, in their own session, stand in for each person in it: "Rate as Omar (practice)",
//   "Score as the manager", "Calibrate as HR", "Sign as Omar", "Sign as the manager", each kept as theirs and for whom
//   ("Hazem Magdy for the manager"). A Super Admin viewing as the employee or the manager sees it as they would, marked
//   Practice, and with Act as them on takes the step as them. The real people, signed in themselves, never see it.
// - Only a Super Admin deletes them, one or all (optionally only their own); a real scorecard never.
// Pure code: the API enforces these, the web words them. Tested in apps/api/src/common/kpi-practice.spec.ts.

// ---------- who ----------

/** Who starts practice scorecards: HR and a Super Admin. */
export const startsKpiPractice = (user: { roles: readonly string[] }): boolean => user.roles.includes('hr') || user.roles.includes('super_admin');

/**
 * Whether the caller stands in on a scorecard (takes its steps for the people in it): a practice one only, by its
 * starter or any Super Admin, in their own session. Viewing as someone, they take the steps as that person instead.
 */
export function kpiStandsIn(card: { practice: boolean; practiceById: string | null }, who: { userId: string; roles: readonly string[]; viewingAs: boolean }): boolean {
  if (!card.practice || who.viewingAs) return false;
  return who.roles.includes('super_admin') || (card.practiceById !== null && card.practiceById === who.userId);
}

// ---------- the steps, without dates ----------

/** The steps one stands in for on a practice scorecard. */
export const KPI_PRACTICE_STEPS = ['self_rate', 'score', 'calibrate', 'sign_employee', 'sign_manager'] as const;
export type KpiPracticeStep = (typeof KPI_PRACTICE_STEPS)[number];

export const isKpiPracticeStep = (value: unknown): value is KpiPracticeStep => (KPI_PRACTICE_STEPS as readonly unknown[]).includes(value);

/** For whom a step was taken by someone standing in, as kept on it: the employee, the scorer's side, or HR. */
export const KPI_STAND_INS = ['employee', 'scorer', 'hr'] as const;
export type KpiStandIn = (typeof KPI_STAND_INS)[number];

/** Whom each step stands in for. */
export const KPI_PRACTICE_STEP_FOR: Record<KpiPracticeStep, KpiStandIn> = {
  self_rate: 'employee',
  score: 'scorer',
  calibrate: 'hr',
  sign_employee: 'employee',
  sign_manager: 'scorer',
};

/** The steps open on a practice scorecard now, by where it stands alone: no day holds one back. */
export function kpiPracticeSteps(card: { status: KpiStatus | string; employeeSignedAt?: unknown; managerSignedAt?: unknown }): Record<KpiPracticeStep, boolean> {
  return {
    self_rate: card.status === 'self_rating',
    // the scoring may be sent while the self-rating is open: a practice one isn't held to the self-rating's day
    score: card.status === 'self_rating' || card.status === 'manager',
    calibrate: card.status === 'hr',
    sign_employee: card.status === 'sign_off' && !card.employeeSignedAt,
    sign_manager: card.status === 'sign_off' && !card.managerSignedAt,
  };
}

/** No step open: a scorecard the caller doesn't stand in on. */
export const KPI_NO_PRACTICE_STEPS: Record<KpiPracticeStep, boolean> = { self_rate: false, score: false, calibrate: false, sign_employee: false, sign_manager: false };

/**
 * Whether a step's deadline counts as gone by on `today` (YYYY-MM-DD): always for a practice scorecard (owner, 22 October
 * 2026: "Deadlines aren't enforced"), else once the day has passed (kpiPast). The scorer sends the scoring once the
 * self-rating is in or its day has gone by.
 */
export const kpiDeadlinePassed = (practice: boolean, deadline: string, today: string): boolean => practice || kpiPast(deadline, today);

// ---------- in words ----------

/** "Omar" of "Omar Ali": as the buttons name the employee. */
export const kpiFirstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** The scorer's side in words: "the manager", "HR", "the CEO", "a Super Admin". */
export function kpiScorerWords(scorer: KpiScorer | string): string {
  if (scorer === 'hr') return 'HR';
  if (scorer === 'ceo') return 'the CEO';
  if (scorer === 'super_admin') return 'a Super Admin';
  return 'the manager';
}

/** For whom a step was stood in: the employee's name, "the manager" (HR, the CEO …), or "HR". */
export function kpiStandInWho(standIn: KpiStandIn | string, card: { employeeName: string; scorer: KpiScorer | string }): string {
  if (standIn === 'employee') return card.employeeName;
  if (standIn === 'hr') return 'HR';
  return kpiScorerWords(card.scorer);
}

/** Who took a step standing in: "Hazem Magdy for the manager", "Hazem Magdy for Omar Ali". */
export const kpiStoodInText = (by: string, standIn: KpiStandIn | string, card: { employeeName: string; scorer: KpiScorer | string }): string =>
  `${by} for ${kpiStandInWho(standIn, card)}`;

/** The step-in buttons: "Rate as Omar (practice)", "Score as the manager", "Calibrate as HR", "Sign as Omar", "Sign as the manager". */
export function kpiPracticeStepLabel(step: KpiPracticeStep, card: { employeeName: string; scorer: KpiScorer | string }): string {
  switch (step) {
    case 'self_rate':
      return `Rate as ${kpiFirstName(card.employeeName)} (practice)`;
    case 'score':
      return `Score as ${kpiScorerWords(card.scorer)}`;
    case 'calibrate':
      return 'Calibrate as HR';
    case 'sign_employee':
      return `Sign as ${kpiFirstName(card.employeeName)}`;
    case 'sign_manager':
      return `Sign as ${kpiScorerWords(card.scorer)}`;
  }
}

/** The banner on a practice scorecard, and what it means. */
export const KPI_PRACTICE_BANNER = 'Practice: not counted anywhere';
export const KPI_PRACTICE_NOTE =
  'Nobody is told of it, no deadline holds a step back, and it never reaches payroll, the payslips, the KPI figures or the Excel. The employee and their manager never see it in their own sign-in.';

/** The badge in any list a practice scorecard appears in. */
export const KPI_PRACTICE_BADGE = 'Practice';

// ---------- the month ----------

/** The most months the start form offers, newest first (any month from the join date may still be sent). */
export const KPI_PRACTICE_MONTHS_OFFERED = 24;

/**
 * The months a practice scorecard may be for, newest first: this month (the attendance so far) back to the month the
 * person joined (`joinDate`, YYYY-MM-DD), at most `max`.
 */
export function kpiPracticeMonths(joinDate: string, today: string, max = KPI_PRACTICE_MONTHS_OFFERED): string[] {
  const out: string[] = [];
  const first = joinDate.slice(0, 7);
  for (let m = today.slice(0, 7); m >= first && out.length < max; m = kpiMonthAdd(m, -1)) out.push(m);
  return out;
}

/** What is wrong with a practice scorecard's month (YYYY-MM) for someone who joined on `joinDate`; null: nothing. */
export function kpiPracticeMonthProblem(month: string, joinDate: string, today: string, name = 'They'): string | null {
  const current = today.slice(0, 7);
  if (month > current) return `Choose ${kpiMonthName(current)} or an earlier month: a practice scorecard is for a month that has begun.`;
  const first = joinDate.slice(0, 7);
  if (month < first) return `${name} joined in ${kpiMonthName(first)}: choose that month or a later one.`;
  return null;
}

/** Whether the Attendance metric of a practice scorecard is this month's so far (the month isn't over on `today`). */
export const kpiAttendanceSoFar = (month: string, today: string): boolean => month.slice(0, 7) >= today.slice(0, 7);

// ---------- the views ----------

/** A practice scorecard's facts, on its summary and its page (KpiScorecardSummary.practice; null for a real one). */
export interface KpiPracticeInfo {
  startedBy: KpiUserRef | null;
  startedAt: string;
  /** Its template version is a draft: being tried before it is published. */
  draft: boolean;
}

/** GET /kpis/practice: a practice scorecard on the Practice list (HR, a Super Admin; HR never a C-level person's). */
export interface KpiPracticeRow {
  id: string;
  /** YYYY-MM. */
  month: string;
  employee: KpiPersonRef;
  jobTitle: string | null;
  department: string | null;
  template: { id: string; version: number; draft: boolean };
  status: KpiStatus;
  scorer: KpiScorer;
  startedBy: KpiUserRef | null;
  startedAt: string;
  /** Started by the caller. */
  mine: boolean;
  confidential: boolean;
}

/** A version a practice scorecard may start from: the job title's draft or a published one. */
export interface KpiPracticeTemplateChoice {
  id: string;
  version: number;
  draft: boolean;
  /** The version the real scorecards open on now. */
  inForce: boolean;
  metrics: number;
}

/** Someone a practice scorecard may be started for, with the months and the versions to pick from. */
export interface KpiPracticeChoice {
  employee: KpiPersonRef;
  jobTitle: { id: string; titleEn: string };
  department: string | null;
  /** Their (latest) employment's join date, YYYY-MM-DD. */
  joinDate: string;
  /** The months offered, newest first (kpiPracticeMonths). */
  months: string[];
  /** Their job title's versions, newest first (a draft is the newest): the start form's default is the first. */
  templates: KpiPracticeTemplateChoice[];
  confidential: boolean;
}

/** GET /kpis/practice/choices: whom a practice scorecard may be started for (those whose job title has a template). */
export interface KpiPracticeChoices {
  /** This month, YYYY-MM: the default. */
  month: string;
  people: KpiPracticeChoice[];
}

/** POST /kpis/practice: whom, which month (default: this one) and which version (default: the job title's newest). */
export interface KpiPracticeStartInput {
  employeeId: string;
  month?: string | null;
  templateId?: string | null;
}

/** POST /kpis/practice/:id/sign: "I've read it", standing in for the employee or for the scorer's side. */
export interface KpiPracticeSignInput extends KpiSignInput {
  as: 'employee' | 'manager';
}

/** DELETE /kpis/practice/:id → 204; DELETE /kpis/practice?mine=true → how many were deleted (a Super Admin only). */
export interface KpiPracticeDeleted {
  deleted: number;
}
