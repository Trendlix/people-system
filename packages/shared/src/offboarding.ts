// Offboarding (owner, 21 October 2026, with the Employees list: "when an employee resigns or contract ends with no
// renewal, where will the data be stored? will it be another tab?"; 22 October 2026, the full module: "Former Employees
// tab, clearance checklist (assets returned, laptop, access), exit interview, rehire eligibility, turnover numbers").
// - A case per employment that ends: opened when the CEO approves its ending (the notice period starts), when an
//   employment is ended by hand (End employment), or by HR. Withdrawing the ending cancels an open case.
// - Its clearance checklist: HR's default items (an HR-editable list, copied into each case when it opens), each with
//   the role that clears it, plus two the system ticks itself: "Assets returned" (nothing left in custody) and "Final
//   settlement paid" (payroll's Unsettled). A case is completed once every item is done or not applicable; a Super
//   Admin may complete it anyway, with a reason.
// - The exit interview: a reason for leaving, five ratings from 1 to 5, whether they'd recommend working here, and
//   comments; filled in by the employee while they can still sign in, or recorded by HR, or declined. Seen by HR, the
//   CEO and a Super Admin, never the manager.
// - Rehire eligibility: Eligible, Eligible with conditions or Not eligible, with a reason; a warning when an offer or a
//   new employment is for that person again.
// - Turnover: leavers by month, the rate (leavers ÷ average headcount), voluntary or not, by department, reason and
//   tenure. Freelancers are outside the labour law, so outside the headcount and the leavers.
// Pure code: the API enforces these rules, the web shows them. Tested in apps/api/src/common/offboarding.spec.ts.

import type { EmploymentType, EndReason } from './index.js';

// ---------- the case ----------

export const OFFBOARDING_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type OffboardingStatus = (typeof OFFBOARDING_STATUSES)[number];

export const OFFBOARDING_STATUS_LABELS: Record<OffboardingStatus, string> = { open: 'In clearance', completed: 'Completed', cancelled: 'Cancelled' };

// ---------- the clearance checklist ----------

/** Who clears an item: HR, the leaver's direct manager, an Admin (IT and access), Finance, or the Assets custodians. */
export const CLEARANCE_OWNERS = ['hr', 'manager', 'admin', 'finance', 'assets'] as const;
export type ClearanceOwner = (typeof CLEARANCE_OWNERS)[number];

export const CLEARANCE_OWNER_LABELS: Record<ClearanceOwner, string> = {
  hr: 'HR',
  manager: 'Direct manager',
  admin: 'Admin / IT',
  finance: 'Finance',
  assets: 'Assets custodian',
};

export const isClearanceOwner = (value: unknown): value is ClearanceOwner => (CLEARANCE_OWNERS as readonly unknown[]).includes(value);

export const CLEARANCE_ITEM_STATUSES = ['pending', 'done', 'not_applicable'] as const;
export type ClearanceItemStatus = (typeof CLEARANCE_ITEM_STATUSES)[number];

export const CLEARANCE_ITEM_STATUS_LABELS: Record<ClearanceItemStatus, string> = { pending: 'Pending', done: 'Done', not_applicable: 'Not applicable' };

export const isClearanceItemStatus = (value: unknown): value is ClearanceItemStatus => (CLEARANCE_ITEM_STATUSES as readonly unknown[]).includes(value);

/**
 * An item's kind: one cleared by a person (manual), or one the system ticks: "Assets returned", done when the leaver
 * holds nothing in custody, and "Final settlement paid", done when payroll's Unsettled has it settled.
 */
export const CLEARANCE_KINDS = ['manual', 'assets', 'final_settlement'] as const;
export type ClearanceKind = (typeof CLEARANCE_KINDS)[number];

/** The two items the system ticks, on every case, first. */
export const CLEARANCE_AUTO_ITEMS: readonly { kind: Exclude<ClearanceKind, 'manual'>; label: string; owner: ClearanceOwner }[] = [
  { kind: 'assets', label: 'Assets returned', owner: 'assets' },
  { kind: 'final_settlement', label: 'Final settlement paid', owner: 'hr' },
];

/** The default items a new list starts with (the owner's brief, 22 October 2026); HR changes them in Clearance Checklist. */
export const DEFAULT_CLEARANCE_ITEMS: readonly { label: string; owner: ClearanceOwner }[] = [
  { label: 'Work handed over to the manager', owner: 'manager' },
  { label: 'Access cards and keys returned', owner: 'admin' },
  { label: 'Email and system accounts disabled', owner: 'admin' },
  { label: 'Social insurance Form 6 filed', owner: 'hr' },
  { label: 'Experience certificate issued', owner: 'hr' },
];

export const CLEARANCE_LIMITS = { label: 120, note: 500, items: 20, overrideReason: 500 } as const;

/** What is wrong with a checklist item's label and owner, in words (none: it can be saved). */
export function clearanceItemProblems(item: { label?: unknown; owner?: unknown }, which = 'The item'): string[] {
  const problems: string[] = [];
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  if (!label) problems.push(`${which}: give it a name.`);
  else if (label.length > CLEARANCE_LIMITS.label) problems.push(`${which}: its name can be at most ${CLEARANCE_LIMITS.label} characters.`);
  if (!isClearanceOwner(item.owner)) problems.push(`${which}: choose who clears it.`);
  return problems;
}

/** What is wrong with the default checklist sent, each in words: 1 to 20 items, each named, the names different. */
export function clearanceChecklistProblems(items: readonly { label?: unknown; owner?: unknown }[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(items) || items.length === 0) return ['Keep at least one item on the checklist.'];
  if (items.length > CLEARANCE_LIMITS.items) problems.push(`The checklist takes at most ${CLEARANCE_LIMITS.items} items.`);
  const seen = new Map<string, number>();
  items.forEach((item, i) => {
    problems.push(...clearanceItemProblems(item, `Item ${i + 1}`));
    const key = typeof item.label === 'string' ? item.label.trim().toLowerCase() : '';
    if (key && seen.has(key)) problems.push(`Item ${i + 1}: item ${seen.get(key)! + 1} has the same name.`);
    else if (key) seen.set(key, i);
  });
  return problems;
}

/** Whether every item is done or not applicable: the case can be completed. */
export const clearanceComplete = (items: readonly { status: ClearanceItemStatus }[]): boolean => items.every((i) => i.status !== 'pending');

/** "3 of 7 cleared": the items done or not applicable, of all. */
export function clearanceProgress(items: readonly { status: ClearanceItemStatus }[]): { cleared: number; total: number } {
  return { cleared: items.filter((i) => i.status !== 'pending').length, total: items.length };
}

// ---------- the exit interview ----------

export const EXIT_REASONS = [
  'better_offer',
  'career_growth',
  'pay',
  'manager',
  'workload',
  'culture',
  'relocation',
  'studies',
  'personal',
  'health',
  'contract_end',
  'retirement',
  'other',
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  better_offer: 'A better offer elsewhere',
  career_growth: 'Career growth',
  pay: 'Pay and benefits',
  manager: 'Relationship with the manager',
  workload: 'Workload or hours',
  culture: 'Culture or team',
  relocation: 'Moving away',
  studies: 'Studies',
  personal: 'Personal or family reasons',
  health: 'Health',
  contract_end: 'The contract ended',
  retirement: 'Retirement',
  other: 'Other',
};

/** The five ratings, from 1 (very poor) to 5 (very good). */
export const EXIT_RATINGS = ['role', 'manager', 'pay', 'growth', 'culture'] as const;
export type ExitRating = (typeof EXIT_RATINGS)[number];

export const EXIT_RATING_LABELS: Record<ExitRating, string> = {
  role: 'The role itself',
  manager: 'Your manager',
  pay: 'Pay and benefits',
  growth: 'Growth and learning',
  culture: 'Culture and team',
};

/** The scale's words, 1 to 5. */
export const EXIT_RATING_SCALE: Record<1 | 2 | 3 | 4 | 5, string> = { 1: 'Very poor', 2: 'Poor', 3: 'Fair', 4: 'Good', 5: 'Very good' };

export const EXIT_RECOMMENDS = ['yes', 'maybe', 'no'] as const;
export type ExitRecommend = (typeof EXIT_RECOMMENDS)[number];

export const EXIT_RECOMMEND_LABELS: Record<ExitRecommend, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' };

export const EXIT_INTERVIEW_STATUSES = ['pending', 'submitted', 'declined'] as const;
export type ExitInterviewStatus = (typeof EXIT_INTERVIEW_STATUSES)[number];

export const EXIT_INTERVIEW_STATUS_LABELS: Record<ExitInterviewStatus, string> = { pending: 'Not done yet', submitted: 'Done', declined: 'Declined' };

/** Who filled it in: the employee themself, or HR from a conversation with them. */
export const EXIT_FILLED_BY = ['employee', 'hr'] as const;
export type ExitFilledBy = (typeof EXIT_FILLED_BY)[number];

export const EXIT_COMMENTS_MAX = 2000;

/** An exit interview's answers, as sent and kept. */
export interface ExitInterviewAnswers {
  reason: ExitReason;
  ratings: Record<ExitRating, number>;
  recommend: ExitRecommend;
  comments: string | null;
}

/** What is wrong with an exit interview's answers, each in words (none: they can be saved). */
export function exitInterviewProblems(input: { reason?: unknown; ratings?: unknown; recommend?: unknown; comments?: unknown }): string[] {
  const problems: string[] = [];
  if (!(EXIT_REASONS as readonly unknown[]).includes(input.reason)) problems.push('Choose the main reason for leaving.');
  const ratings = input.ratings && typeof input.ratings === 'object' && !Array.isArray(input.ratings) ? (input.ratings as Record<string, unknown>) : {};
  for (const key of EXIT_RATINGS) {
    const v = ratings[key];
    if (!(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)) problems.push(`${EXIT_RATING_LABELS[key]}: choose a rating from 1 to 5.`);
  }
  if (!(EXIT_RECOMMENDS as readonly unknown[]).includes(input.recommend)) problems.push('Say whether you would recommend working here.');
  if (input.comments !== undefined && input.comments !== null && (typeof input.comments !== 'string' || input.comments.length > EXIT_COMMENTS_MAX)) {
    problems.push(`Keep the comments to ${EXIT_COMMENTS_MAX} characters or fewer.`);
  }
  return problems;
}

/** The average of the five ratings, to one decimal; null without them. */
export function exitRatingAverage(ratings: Partial<Record<ExitRating, number | null>> | null | undefined): number | null {
  if (!ratings) return null;
  const values = EXIT_RATINGS.map((k) => ratings[k]).filter((v): v is number => typeof v === 'number');
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

// ---------- rehire eligibility ----------

export const REHIRE_ELIGIBILITIES = ['eligible', 'conditional', 'not_eligible'] as const;
export type RehireEligibility = (typeof REHIRE_ELIGIBILITIES)[number];

export const REHIRE_LABELS: Record<RehireEligibility, string> = { eligible: 'Eligible', conditional: 'Eligible with conditions', not_eligible: 'Not eligible' };

export const REHIRE_REASON_MAX = 500;

/** What is wrong with a rehire decision, in words: a reason is needed unless they are simply eligible. */
export function rehireProblems(input: { eligibility?: unknown; reason?: unknown }): string[] {
  if (!(REHIRE_ELIGIBILITIES as readonly unknown[]).includes(input.eligibility)) return ['Choose whether they could be hired again.'];
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length > REHIRE_REASON_MAX) return [`Keep the reason to ${REHIRE_REASON_MAX} characters or fewer.`];
  if (input.eligibility !== 'eligible' && !reason) {
    return [input.eligibility === 'conditional' ? 'Say on what conditions they could be hired again.' : 'Say why they shouldn’t be hired again.'];
  }
  return [];
}

// ---------- turnover ----------

/** Whether a leaver chose to go, was let go (or their term ended), or neither (death, disability, other). */
export const LEAVER_KINDS = ['voluntary', 'involuntary', 'other'] as const;
export type LeaverKind = (typeof LEAVER_KINDS)[number];

export const LEAVER_KIND_LABELS: Record<LeaverKind, string> = { voluntary: 'Voluntary', involuntary: 'Involuntary', other: 'Other' };

/**
 * Each end reason's kind (owner's brief, 22 October 2026: "voluntary (resigned, mutual agreement, retired) versus
 * involuntary (terminated, contract ended …)"): a fixed term or a training agreement that ends counts as involuntary, as
 * the company didn't renew it; a death, a disability and Other are neither.
 */
export const END_REASON_KINDS: Record<EndReason, LeaverKind> = {
  resigned: 'voluntary',
  mutual_agreement: 'voluntary',
  retired: 'voluntary',
  terminated: 'involuntary',
  contract_ended: 'involuntary',
  training_completed: 'involuntary',
  deceased: 'other',
  disability: 'other',
  other: 'other',
};

/** A leaver's kind by their end reason; Other when there is none. */
export const leaverKindOf = (reason: string | null | undefined): LeaverKind => (reason && reason in END_REASON_KINDS ? END_REASON_KINDS[reason as EndReason] : 'other');

/** The tenure bands of the report, by whole months served. */
export const TENURE_BANDS = [
  { key: 'under_3m', label: 'Under 3 months', below: 3 },
  { key: '3_12m', label: '3 to 12 months', below: 12 },
  { key: '1_2y', label: '1 to 2 years', below: 24 },
  { key: '2_5y', label: '2 to 5 years', below: 60 },
  { key: '5y_plus', label: '5 years or more', below: Infinity },
] as const;
export type TenureBand = (typeof TENURE_BANDS)[number]['key'];

const dateParts = (d: string) => d.slice(0, 10).split('-').map(Number) as [number, number, number];

/** Whole months from the join date to the last working day (YYYY-MM-DD): 1 March to 31 May is 2, to 1 June 3. */
export function tenureMonths(joinDate: string, endDate: string): number {
  const [y1, m1, d1] = dateParts(joinDate);
  const [y2, m2, d2] = dateParts(endDate);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) months -= 1;
  return Math.max(0, months);
}

/** The band a tenure of `months` falls in. */
export const tenureBandOf = (months: number): TenureBand => TENURE_BANDS.find((b) => months < b.below)!.key;

/** "2 years 3 months", "5 months", "Under a month". */
export function tenureText(months: number): string {
  if (months < 1) return 'Under a month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [y ? part(y, 'year') : '', m ? part(m, 'month') : ''].filter(Boolean).join(' ');
}

/** Whether an employment counts in turnover: everyone employed under the labour law, not a freelancer. */
export const countsInTurnover = (type: EmploymentType | string): boolean => type !== 'freelance';

/** An employment as the turnover sees it. */
export interface TurnoverEmployment {
  joinDate: string;
  /** Its last working day; null while current. */
  endDate: string | null;
  endReason: string | null;
  employmentType: EmploymentType | string;
  /** Its department's name (a team's department), or null. */
  department: string | null;
}

/** People employed on a day (YYYY-MM-DD): joined on or before it, and not left before it. */
export const headcountOn = (employments: readonly TurnoverEmployment[], day: string): number =>
  employments.filter((e) => countsInTurnover(e.employmentType) && e.joinDate <= day && (e.endDate === null || e.endDate >= day)).length;

const pad = (n: number) => String(n).padStart(2, '0');

/** The last day of a month (YYYY-MM). */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** Leavers ÷ average headcount, as a percent to one decimal; null with nobody employed. */
export function turnoverRate(leavers: number, averageHeadcount: number): number | null {
  if (!(averageHeadcount > 0)) return null;
  return Math.round((leavers / averageHeadcount) * 1000) / 10;
}

/** A month of the report. */
export interface TurnoverMonth {
  month: string;
  /** Headcount on its first day, and on its last (or today, for the month going on). */
  start: number;
  end: number;
  average: number;
  leavers: number;
  voluntary: number;
  involuntary: number;
  other: number;
  /** Leavers ÷ the month's average headcount; null with nobody employed. */
  rate: number | null;
  /** Whether the month is still going (its numbers so far). */
  partial: boolean;
}

/** A count of leavers by something (a department, a reason, a tenure band). */
export interface TurnoverCount {
  key: string;
  label: string;
  leavers: number;
  voluntary: number;
}

/** The turnover of a year, worked out from every employment (TurnoverReport, the API's answer, adds who left). */
export interface TurnoverFigures {
  year: number;
  months: TurnoverMonth[];
  leavers: number;
  voluntary: number;
  involuntary: number;
  other: number;
  /** The average of the months' average headcounts (those started). */
  averageHeadcount: number;
  /** The year's leavers ÷ its average headcount; null with nobody employed. */
  rate: number | null;
  /** The average tenure of the year's leavers, in months (one decimal); null with none. */
  averageTenureMonths: number | null;
  byDepartment: TurnoverCount[];
  byReason: TurnoverCount[];
  byTenure: TurnoverCount[];
}

/**
 * The turnover of `year` (owner's brief, 22 October 2026: "leavers per month and year, turnover rate (leavers ÷ average
 * headcount), voluntary versus involuntary, by department, reason and tenure band, and the average tenure at exit"):
 * months up to `today`'s (YYYY-MM-DD; the one going on counted so far, later ones left out). A leaver is counted in the
 * month of their last working day. `reasonLabel` names an end reason. Freelancers are left out.
 */
export function turnoverOf(employments: readonly TurnoverEmployment[], year: number, today: string, reasonLabel: (reason: string) => string): TurnoverFigures {
  const counted = employments.filter((e) => countsInTurnover(e.employmentType));
  const months: TurnoverMonth[] = [];
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${pad(m)}`;
    const first = `${month}-01`;
    if (first > today) break;
    const last = monthEnd(month);
    const partial = last > today;
    const start = headcountOn(counted, first);
    const end = headcountOn(counted, partial ? today : last);
    const left = counted.filter((e) => e.endDate !== null && e.endDate >= first && e.endDate <= last);
    const kinds = { voluntary: 0, involuntary: 0, other: 0 };
    for (const e of left) kinds[leaverKindOf(e.endReason)] += 1;
    const average = (start + end) / 2;
    months.push({ month, start, end, average, leavers: left.length, ...kinds, rate: turnoverRate(left.length, average), partial });
  }
  const yearFirst = `${year}-01-01`;
  const yearLast = `${year}-12-31`;
  const leavers = counted.filter((e) => e.endDate !== null && e.endDate >= yearFirst && e.endDate <= yearLast && e.endDate <= today);
  const averageHeadcount = months.length ? Math.round((months.reduce((s, m) => s + m.average, 0) / months.length) * 10) / 10 : 0;
  const kinds = { voluntary: 0, involuntary: 0, other: 0 };
  for (const e of leavers) kinds[leaverKindOf(e.endReason)] += 1;
  const tenures = leavers.map((e) => tenureMonths(e.joinDate, e.endDate!));

  const tally = (keyOf: (e: TurnoverEmployment, i: number) => { key: string; label: string }, order?: readonly string[]): TurnoverCount[] => {
    const map = new Map<string, TurnoverCount>();
    leavers.forEach((e, i) => {
      const { key, label } = keyOf(e, i);
      const row = map.get(key) ?? { key, label, leavers: 0, voluntary: 0 };
      row.leavers += 1;
      if (leaverKindOf(e.endReason) === 'voluntary') row.voluntary += 1;
      map.set(key, row);
    });
    const rows = [...map.values()];
    return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.leavers - a.leavers || a.label.localeCompare(b.label));
  };

  return {
    year,
    months,
    leavers: leavers.length,
    ...kinds,
    averageHeadcount,
    rate: turnoverRate(leavers.length, averageHeadcount),
    averageTenureMonths: tenures.length ? Math.round((tenures.reduce((a, b) => a + b, 0) / tenures.length) * 10) / 10 : null,
    byDepartment: tally((e) => ({ key: e.department ?? '', label: e.department ?? 'No department' })),
    byReason: tally((e) => ({ key: e.endReason ?? 'none', label: e.endReason ? reasonLabel(e.endReason) : 'Not recorded' })),
    byTenure: tally(
      (_e, i) => {
        const band = TENURE_BANDS.find((b) => b.key === tenureBandOf(tenures[i]!))!;
        return { key: band.key, label: band.label };
      },
      TENURE_BANDS.map((b) => b.key),
    ),
  };
}

// ---------- the API's answers ----------

/** A clearance item of a case. */
export interface ClearanceItemView {
  id: string;
  kind: ClearanceKind;
  label: string;
  owner: ClearanceOwner;
  status: ClearanceItemStatus;
  /** Who cleared it (a name, or the system for the two it ticks) and when (ISO); null while pending. */
  doneBy: string | null;
  doneAt: string | null;
  note: string | null;
  /** The caller may mark it: its owner (or HR, the CEO, a Super Admin), never one the system ticks. */
  canMark: boolean;
}

/** Something the leaver still holds, on "Assets returned". */
export interface ClearanceHolding {
  assetCode: string;
  assetName: string;
  custodyCode: string;
  /** shoot or assignment. */
  custodyKind: string;
  dueDate: string | null;
}

/** An exit interview as HR, the CEO and a Super Admin read it. */
export interface ExitInterviewView {
  status: ExitInterviewStatus;
  filledBy: ExitFilledBy | null;
  answers: ExitInterviewAnswers | null;
  declinedNote: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
}

/** A case on the list. */
export interface OffboardingCaseSummary {
  id: string;
  status: OffboardingStatus;
  employee: { id: string; employeeCode: string; fullNameEn: string };
  jobTitle: string | null;
  department: string | null;
  /** The last working day (the ending's, else the employment's end date); null when neither is known yet. */
  lastWorkingDay: string | null;
  /** The employment ended (its end date is set and past or today). */
  ended: boolean;
  endReason: string | null;
  progress: { cleared: number; total: number };
  /** Items waiting for the caller. */
  mine: number;
  /** Null for those who may not read it. */
  exitInterview: ExitInterviewStatus | null;
  rehire: RehireEligibility | null;
  openedAt: string;
  completedAt: string | null;
}

/** A case's page. Those who only clear items (a manager, an Admin, Finance) get the checklist alone: the rest null. */
export interface OffboardingCaseView extends OffboardingCaseSummary {
  employmentId: string;
  joinDate: string;
  employmentType: string;
  /** The ending recorded for it, when there is one. */
  ending: { id: string; status: string; rule: string; noticeGivenOn: string; lastWorkingDay: string; reason: string | null } | null;
  items: ClearanceItemView[];
  holdings: ClearanceHolding[];
  finalSettlement: { status: 'open' | 'settled' | 'not_yet'; settledOn: string | null } | null;
  /** null for those who may not read it. */
  interview: ExitInterviewView | null;
  rehireReason: string | null;
  rehireSetBy: string | null;
  /** The leaver's sign-in: none, active, disabled (on), or to be disabled after the last working day. */
  signIn: { state: 'none' | 'active' | 'disabled' | 'kept'; email: string | null; note: string | null } | null;
  overrideReason: string | null;
  completedBy: string | null;
  /** What the caller may do. */
  can: { manage: boolean; complete: boolean; override: boolean; addItem: boolean; interview: boolean; rehire: boolean };
}

/** GET /offboarding/my/exit-interview: the caller's own exit interview while their case is open; null without one. */
export interface MyExitInterviewView {
  caseId: string;
  lastWorkingDay: string | null;
  status: ExitInterviewStatus;
  /** Their answers once sent (they can't change them then). */
  answers: ExitInterviewAnswers | null;
}

/** A former employee on Former Employees. */
export interface FormerEmployeeRow {
  employee: { id: string; employeeCode: string; fullNameEn: string };
  employmentId: string;
  joinDate: string;
  endDate: string;
  endReason: string | null;
  leaverKind: LeaverKind;
  tenureMonths: number;
  department: string | null;
  jobTitle: string | null;
  caseId: string | null;
  clearance: OffboardingStatus | null;
  rehire: RehireEligibility | null;
  /** Their details are hidden from the caller (C-level for HR): the row has their name and dates only. */
  restricted: boolean;
}

/** A former employee an offer or a new employment may be for (rehire eligibility's warning). */
export interface RehireMatch {
  employeeId: string;
  fullNameEn: string;
  leftOn: string | null;
  endReason: string | null;
  eligibility: RehireEligibility | null;
  reason: string | null;
  /** How they matched: the same person, national ID or email. */
  matchedBy: 'employee' | 'national_id' | 'email';
}

/** GET /offboarding/turnover: the year's figures and who left (C-level hidden for HR, counted). */
export interface TurnoverReport extends TurnoverFigures {
  leaversList: { employee: { id: string; fullNameEn: string } | null; endDate: string; endReason: string | null; leaverKind: LeaverKind; department: string | null; tenureMonths: number }[];
  /** Years with any employment, for the year picker, newest first. */
  years: number[];
}

/** A default checklist item, as Clearance Checklist edits them. */
export interface ClearanceDefaultView {
  id: string;
  label: string;
  owner: ClearanceOwner;
}
