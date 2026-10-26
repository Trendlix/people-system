// Leave (owner, 18 October 2026: "if we will work on the attendance and leaves, how will we build it?", leave first, as
// attendance needs leave to tell an absence from a leave; "can you apply the leaves according to the law?"): the leave
// types of Labour Law No. 14 of 2025 (Arts. 54–57 and 124–133) as the default types HR may change, turn off or add to;
// requests decided by the direct manager, then HR (no manager: straight to HR), each step logged, as reimbursement
// claims are; the annual balance by calendar year (January to December), a joiner's first year pro-rated; and a Year
// Closing where HR decides, per employee, how many unused days carry into the new year and how many are paid (owner,
// 18 October 2026: "make it with decision with the year closing"). The law forbids losing leave (Art. 125: "لا يجوز
// للعامل النزول عن إجازته … ويلتزم صاحب العمل بتسوية رصيد الإجازات، أو الأجر المقابل له كل ثلاث سنوات على الأكثر، فإذا
// انتهت علاقة العمل قبل استنفاد العامل رصيد إجازته السنوية استحق الأجر المقابل لهذا الرصيد"): what is carried and what
// is paid add up to what is unused, days carried for three years are settled, and the balance is paid on leaving.
// What the law asks that can't be enforced (at least 15 days taken a year, 6 of them in a row: Art. 125) is flagged, not
// blocked. The API enforces these rules; the web app uses them to show the same checks live. Dates are YYYY-MM-DD,
// days whole or half.

import { daysBetween } from './payroll-adjustments.js';
import { reimbursementPayMonth } from './reimbursements.js';

// ---------- the kinds of leave ----------

/** The law's leave types, by key, and 'custom' for a type HR adds. */
export const LEAVE_KINDS = ['annual', 'casual', 'birth', 'exam', 'hajj', 'sick', 'maternity', 'childcare', 'unpaid', 'custom'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
  annual: 'Annual leave',
  casual: 'Casual leave',
  birth: 'Birth of a child',
  exam: 'Exam leave',
  hajj: 'Hajj or Jerusalem visit',
  sick: 'Sick leave',
  maternity: 'Maternity leave',
  childcare: 'Childcare leave',
  unpaid: 'Unpaid leave',
  custom: 'Other leave',
};

export const LEAVE_KIND_LABELS_AR: Record<LeaveKind, string> = {
  annual: 'إجازة سنوية',
  casual: 'إجازة عارضة',
  birth: 'إجازة مولود',
  exam: 'إجازة امتحانات',
  hajj: 'إجازة الحج أو زيارة بيت المقدس',
  sick: 'إجازة مرضية',
  maternity: 'إجازة وضع',
  childcare: 'إجازة رعاية طفل',
  unpaid: 'إجازة بدون أجر',
  custom: 'إجازة أخرى',
};

export const isLeaveKind = (kind: string): kind is LeaveKind => (LEAVE_KINDS as readonly string[]).includes(kind);

/** Whether a type is paid: in full, not at all, or partly (sick leave at the percent HR sets). */
export const LEAVE_PAYS = ['paid', 'unpaid', 'partly'] as const;
export type LeavePay = (typeof LEAVE_PAYS)[number];

export const LEAVE_PAY_LABELS: Record<LeavePay, string> = { paid: 'Paid', unpaid: 'Unpaid', partly: 'Partly paid' };

/**
 * What a type's days are counted against: the annual balance itself (annual leave); the annual balance, with a yearly
 * limit of its own too (casual leave, Art. 128: "وتحسب الإجازة العارضة من الإجازة السنوية"); days of its own a year;
 * days a request (birth, Hajj, maternity, childcare); nothing (sick leave, exam days, unpaid leave).
 */
export const LEAVE_BALANCES = ['annual', 'from_annual', 'yearly', 'per_request', 'none'] as const;
export type LeaveBalanceKind = (typeof LEAVE_BALANCES)[number];

export const LEAVE_BALANCE_LABELS: Record<LeaveBalanceKind, string> = {
  annual: 'The annual balance',
  from_annual: 'From the annual balance',
  yearly: 'Its own days a year',
  per_request: 'Days a request',
  none: 'No balance',
};

/** The types whose days come out of the annual balance. */
export const takesFromAnnual = (balance: string) => balance === 'annual' || balance === 'from_annual';

export type LeaveGender = 'male' | 'female';

/** A leave type's rules, as HR sets them up (Leave Setup). A limit left empty (null) has none. */
export interface LeaveTypeRules {
  kind: LeaveKind;
  nameEn: string;
  paid: LeavePay;
  /** A partly paid type's pay, in percent (sick leave: 100 by default). Null for the others. */
  payPercent: number | null;
  balance: LeaveBalanceKind;
  /** Its days a year: a yearly type's own, a from_annual type's most a year (casual: 7). */
  daysPerYear: number | null;
  /** The most days one request may be for (casual: 2; birth: 1; Hajj: 30; maternity: 120). */
  maxPerRequest: number | null;
  /** The most times it may be taken while employed (birth and maternity: 3; Hajj: once). */
  maxTimesInService: number | null;
  /** The months of service with the company it needs first (Hajj: 60; childcare: 12). */
  minServiceMonths: number | null;
  /** The days' notice an employee's request needs (exam leave: 10). HR recording one on their behalf needs none. */
  noticeDays: number | null;
  /** A document is attached: a medical certificate, proof of sitting the exam. */
  documentRequired: boolean;
  /** For female or male employees only; null for everyone. */
  gender: LeaveGender | null;
  /** Counted in calendar days (Hajj, maternity, childcare); else in working days, rest days and holidays not counted. */
  calendarDays: boolean;
  /** May be taken as a half day. */
  halfDays: boolean;
}

/** A leave type as the migration seeds it: the law's, by key. */
export interface LawLeaveType extends LeaveTypeRules {
  key: Exclude<LeaveKind, 'custom'>;
  nameAr: string;
  active: boolean;
  sortOrder: number;
}

const lawType = (t: Partial<LeaveTypeRules> & Pick<LawLeaveType, 'key' | 'sortOrder'> & { active?: boolean }): LawLeaveType => ({
  kind: t.key,
  nameEn: LEAVE_KIND_LABELS[t.key],
  nameAr: LEAVE_KIND_LABELS_AR[t.key],
  paid: 'paid',
  payPercent: null,
  balance: 'none',
  daysPerYear: null,
  maxPerRequest: null,
  maxTimesInService: null,
  minServiceMonths: null,
  noticeDays: null,
  documentRequired: false,
  gender: null,
  calendarDays: false,
  halfDays: false,
  active: true,
  ...t,
});

/**
 * The law's leave types, seeded as the default leave types (the migration inserts the same; HR may change the numbers,
 * turn a type off or add types):
 * - annual (Arts. 124–125): paid; working days ("لا يدخل فى حسابها أيام عطلات الأعياد والمناسبات الرسمية والراحة
 *   الأسبوعية"); the days by service, age and disability in the Leave Setup (LeaveRules).
 * - casual (Art. 128): "لمدة لا تجاوز سبعة أيام خلال السنة، وبحد أقصى يومان فى المرة الواحدة، وتحسب الإجازة العارضة من
 *   الإجازة السنوية".
 * - birth (Art. 128): "إجازة طارئة مدفوعة الأجر يوم الولادة لا تحسب من رصيد إجازاته السنوية، بحد أقصى ثلاث مرات طوال مدة
 *   الخدمة": for the father (the mother has maternity leave).
 * - exam (Art. 126): "إجازة دراسية بأجر عن أيام الامتحان الفعلية لا تحتسب من رصيد إجازاته السنوية … إخطار صاحب العمل قبل
 *   القيام بالإجازة بعشرة أيام على الأقل … إثبات ما يفيد دخوله الامتحان فعليا".
 * - hajj (Art. 130): "للعامل الذى أمضى فى خدمة صاحب عمل خمس سنوات متصلة، الحق فى إجازة بأجر لمدة شهر لأداء فريضة الحج،
 *   أو زيارة بيت المقدس، وتكون هذه الإجازة مرة واحدة طوال مدة خدمته".
 * - sick (Art. 131): "إجازة مرضية تحددها الجهة الطبية المختصة، ويستحق العامل خلالها تعويضا عن الأجر، تحدد نسبته ومدته،
 *   وفقا لأحكام قانون التأمينات الاجتماعية": its pay percent is HR's, 100 by default (the Social Insurance Law 148/2019
 *   sets it; the accountant confirms).
 * - maternity (Art. 54): "إجازة وضع لمدة أربعة أشهر … على ألا تقل مدة هذه الإجازة بعد الوضع عن خمسة وأربعين يوما، بشرط أن
 *   تقدم شهادة طبية … وفى جميع الأحوال لا تستحق العاملة هذه الإجازة لأكثر من ثلاث مرات طوال مدة خدمتها": paid; what
 *   social insurance pays for it is taken off what the employer owes ("ويخصم من الأجر الذى يلتزم به صاحب العمل، ما يلتزم
 *   بأدائه من تعويض عن الأجر"), a note for Finance, not worked out here.
 * - childcare (Art. 57): "للعاملة فى المنشأة التى تستخدم خمسين عاملا فأكثر الحق فى الحصول على إجازة دون أجر لمدة لا
 *   تجاوز سنتين … لأكثر من ثلاث مرات … شريطة أن يكون قد مر على وجودها فى المنشأة سنة على الأقل": seeded off, for a
 *   company of 50 or more.
 * - unpaid: by agreement, no balance.
 */
export const LAW_LEAVE_TYPES: readonly LawLeaveType[] = [
  lawType({ key: 'annual', sortOrder: 1, balance: 'annual', halfDays: true }),
  lawType({ key: 'casual', sortOrder: 2, balance: 'from_annual', daysPerYear: 7, maxPerRequest: 2, halfDays: true }),
  lawType({ key: 'sick', sortOrder: 3, paid: 'partly', payPercent: 100, documentRequired: true }),
  lawType({ key: 'birth', sortOrder: 4, balance: 'per_request', maxPerRequest: 1, maxTimesInService: 3, gender: 'male' }),
  lawType({ key: 'exam', sortOrder: 5, noticeDays: 10, documentRequired: true }),
  lawType({ key: 'maternity', sortOrder: 6, balance: 'per_request', maxPerRequest: 120, maxTimesInService: 3, documentRequired: true, gender: 'female', calendarDays: true }),
  lawType({ key: 'hajj', sortOrder: 7, balance: 'per_request', maxPerRequest: 30, maxTimesInService: 1, minServiceMonths: 60, calendarDays: true }),
  lawType({
    key: 'childcare',
    sortOrder: 8,
    paid: 'unpaid',
    balance: 'per_request',
    maxPerRequest: 730,
    maxTimesInService: 3,
    minServiceMonths: 12,
    gender: 'female',
    calendarDays: true,
    active: false,
  }),
  lawType({ key: 'unpaid', sortOrder: 9, paid: 'unpaid', halfDays: true }),
];

// ---------- the annual leave's days (Art. 124) ----------

/** The Leave Setup: the annual leave's days by service, age and disability (Art. 124), and how long days may be carried. */
export interface LeaveRules {
  /** "خمسة عشر يوما فى السنة الأولى". */
  firstYearDays: number;
  /** "واحد وعشرون يوما اعتبارا من السنة الثانية". */
  standardDays: number;
  /** "ثلاثون يوما لمن أمضى عشر سنوات كاملة لدى صاحب عمل أو أكثر، أو لمن تجاوزت سنه خمسين عاما". */
  longServiceDays: number;
  longServiceYears: number;
  longServiceAge: number;
  /** "خمسة وأربعون يوما للأشخاص ذوى الإعاقة والأقزام". */
  disabilityDays: number;
  /** "تزاد مدة الإجازة السنوية بمقدار سبعة أيام للعمال الذين يعملون فى الأعمال الخطرة، أو المضرة بالصحة، أو فى المناطق النائية". */
  hazardousExtraDays: number;
  /** "بشرط أن يكون قد أمضى ستة أشهر على الأقل فى خدمة صاحب العمل": the months before the first year's leave may be used. */
  firstYearMinMonths: number;
  /** "ويلتزم صاحب العمل بتسوية رصيد الإجازات، أو الأجر المقابل له كل ثلاث سنوات على الأكثر" (Art. 125). */
  settleWithinYears: number;
}

export const LEAVE_RULE_DEFAULTS: LeaveRules = {
  firstYearDays: 15,
  standardDays: 21,
  longServiceDays: 30,
  longServiceYears: 10,
  longServiceAge: 50,
  disabilityDays: 45,
  hazardousExtraDays: 7,
  firstYearMinMonths: 6,
  settleWithinYears: 3,
};

/** What a year's annual leave is worked out from. */
export interface AnnualEntitlementInput {
  year: number;
  /** The first day of service with the company (the employment's join date). */
  joinDate: string;
  /** The employment's last day; null while current. */
  endDate: string | null;
  dateOfBirth: string | null;
  /** Service with earlier employers, for the 30 days of 10 years' service "لدى صاحب عمل أو أكثر"; null: none. */
  priorServiceMonths: number | null;
  disability: boolean;
  hazardousWork: boolean;
  rules: LeaveRules;
}

export interface AnnualEntitlement {
  /** The calendar year's annual leave, in whole or half days. */
  days: number;
  /**
   * The first day it may be used: six months after joining while that is still to come ("بشرط أن يكون قد أمضى ستة أشهر
   * على الأقل"), else 1 January of the year.
   */
  usableFrom: string;
  /** The days a year each month (January first) was earned at; 0 for a month not employed in. */
  tierByMonth: number[];
}

/**
 * The days a year someone earns on a day (Art. 124): the first year's 15 until a full year of service with the company,
 * then 21; 30 once their service, the earlier employers' included, is 10 full years, or once they are over 50; 45 with
 * a disability; the most of those that applies (a joiner with 10 years' earlier service, or over 50, earns 30 from the
 * start: the law lists them as rights, the better one applying), and 7 more for hazardous or unhealthy work or work in a
 * remote area ("وفى جميع الأحوال").
 */
export function annualTier(on: string, input: Omit<AnnualEntitlementInput, 'year' | 'endDate'>): number {
  const r = input.rules;
  const service = fullMonthsBetween(input.joinDate, on);
  const withEarlier = service + Math.max(0, input.priorServiceMonths ?? 0);
  const over = input.dateOfBirth !== null && isDate(input.dateOfBirth) && on > plusMonths(input.dateOfBirth, r.longServiceAge * 12);
  let days = service < 12 ? r.firstYearDays : r.standardDays;
  if (withEarlier >= r.longServiceYears * 12 || over) days = Math.max(days, r.longServiceDays);
  if (input.disability) days = Math.max(days, r.disabilityDays);
  return days + (input.hazardousWork ? r.hazardousExtraDays : 0);
}

/**
 * A calendar year's annual leave (Art. 124), earned month by month: each month employed in the year earns a twelfth of
 * the days a year reached by its end (annualTier), a month employed for part of it its share by days; the year's total
 * rounded to the nearest half day. So a joiner's first year is pro-rata ("وإذا قلت مدة خدمة العامل عن سنة تكون إجازته
 * بنسبة المدة التى قضاها فى العمل"), and the year someone completes a year of service earns 15 a year until then and 21
 * after. It is usable once six months were served (usableFrom); someone who leaves before that never earned any
 * ("بشرط أن يكون قد أمضى ستة أشهر على الأقل فى خدمة صاحب العمل").
 */
export function annualEntitlement(input: AnnualEntitlementInput): AnnualEntitlement {
  const { year, joinDate, endDate, rules } = input;
  const jan1 = `${year}-01-01`;
  const tierByMonth = new Array<number>(12).fill(0);
  if (!isDate(joinDate) || (endDate !== null && !isDate(endDate))) return { days: 0, usableFrom: jan1, tierByMonth };
  const sixMonths = plusMonths(joinDate, rules.firstYearMinMonths);
  const usableFrom = sixMonths > jan1 ? sixMonths : jan1;
  // left before six months were served: never earned any
  if (endDate !== null && plusDays(endDate, 1) < sixMonths) return { days: 0, usableFrom, tierByMonth };
  let earned = 0;
  for (let m = 1; m <= 12; m++) {
    const first = `${year}-${pad(m)}-01`;
    const last = `${year}-${pad(m)}-${pad(daysInMonth(year, m))}`;
    const from = joinDate > first ? joinDate : first;
    const to = endDate !== null && endDate < last ? endDate : last;
    if (from > to) continue;
    const tier = annualTier(to, input);
    tierByMonth[m - 1] = tier;
    earned += (tier * (dayNumber(to) - dayNumber(from) + 1)) / daysInMonth(year, m) / 12;
  }
  return { days: toHalfDays(earned), usableFrom, tierByMonth };
}

/**
 * The full months of service from the join date to a day (YYYY-MM-DD): 15 March to 14 April is 0, to 15 April 1. What a
 * type's months of service first (minServiceMonths) are checked against, on the request's first day.
 */
export const serviceMonths = (joinDate: string, on: string): number => fullMonthsBetween(joinDate, on);

// ---------- counting a leave's days ----------

/** The working days of an employment without a shift: Sunday to Thursday, as a shift's default (0 = Sunday … 6 = Saturday). */
export const DEFAULT_WORKING_DAYS: readonly number[] = [0, 1, 2, 3, 4];

export interface LeaveDayCount {
  /** The shift's working days, 0 = Sunday … 6 = Saturday. */
  workingDays: readonly number[];
  /** The official holidays (YYYY-MM-DD): not counted (Art. 124: "لا يدخل فى حسابها أيام عطلات الأعياد والمناسبات الرسمية"). */
  holidays: readonly string[];
  /** Counted in calendar days: every day from the first to the last. */
  calendarDays: boolean;
  /** A half day: half the one day (a request for more days with a half day ends with one). */
  halfDay: boolean;
}

/**
 * A leave's days from its first day to its last (YYYY-MM-DD, both counted): its working days, the shift's rest days and
 * the official holidays not counted (Art. 124), or its calendar days for a type counted so; less half a day for a half
 * day. 0 when the dates aren't dates or are the wrong way round.
 */
export function leaveDaysBetween(start: string, end: string, count: LeaveDayCount): number {
  if (!isDate(start) || !isDate(end) || end < start) return 0;
  let days = 0;
  if (count.calendarDays) days = dayNumber(end) - dayNumber(start) + 1;
  else {
    const working = new Set(count.workingDays);
    const off = new Set(count.holidays);
    for (let n = dayNumber(start); n <= dayNumber(end); n++) {
      const day = new Date(n * 86_400_000);
      if (working.has(day.getUTCDay()) && !off.has(day.toISOString().slice(0, 10))) days++;
    }
  }
  return count.halfDay && days > 0 ? days - 0.5 : days;
}

// ---------- requests: statuses, stages, steps ----------

/** Where a request is: with the manager, with HR, approved, rejected, cancelled. */
export const LEAVE_STATUSES = ['with_manager', 'with_hr', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  with_manager: 'With the manager',
  with_hr: 'With HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** The statuses of a request still being decided: its employee may cancel it meanwhile. */
export const LEAVE_OPEN_STATUSES = ['with_manager', 'with_hr'] as const satisfies readonly LeaveStatus[];
export type LeaveOpenStatus = (typeof LEAVE_OPEN_STATUSES)[number];

export const isOpenLeave = (status: string): status is LeaveOpenStatus => (LEAVE_OPEN_STATUSES as readonly string[]).includes(status);

/** Who decides a request, in order (owner, 18 October 2026): the direct manager, then HR. */
export const LEAVE_STAGES = ['manager', 'hr'] as const;
export type LeaveStage = (typeof LEAVE_STAGES)[number];

export const LEAVE_STAGE_LABELS: Record<LeaveStage, string> = { manager: 'Direct manager', hr: 'HR' };

/** The stage deciding a request with this status; null once it is decided or cancelled. */
export function leaveStage(status: string): LeaveStage | null {
  if (status === 'with_manager') return 'manager';
  if (status === 'with_hr') return 'hr';
  return null;
}

/** Where an approved request goes next: the manager's approval to HR, HR's approves it. */
export const leaveStatusAfterApproval = (stage: LeaveStage): LeaveStatus => (stage === 'manager' ? 'with_hr' : 'approved');

/** Where a new request starts: with the employee's direct manager, or with HR when they have none. */
export const firstLeaveStatus = (hasManager: boolean): LeaveStatus => (hasManager ? 'with_manager' : 'with_hr');

/**
 * The steps logged on a request, in the order taken: sent; sent straight to HR (no direct manager); recorded by HR on
 * the employee's behalf (approved at once); each stage's decision; cancelled (by its employee, or by HR once approved).
 */
export const LEAVE_STEP_KINDS = ['submitted', 'no_manager', 'recorded_by_hr', 'manager_decision', 'hr_decision', 'cancelled'] as const;
export type LeaveStepKind = (typeof LEAVE_STEP_KINDS)[number];

export const LEAVE_STEP_KIND_LABELS: Record<LeaveStepKind, string> = {
  submitted: 'Sent',
  no_manager: 'No direct manager: sent to HR',
  recorded_by_hr: 'Recorded by HR',
  manager_decision: 'Direct manager',
  hr_decision: 'HR',
  cancelled: 'Cancelled',
};

/**
 * A leave request's steps: those it shares with permission, working from home and official duty, and the colleague who
 * covers it changed by its employee (owner, 25 October 2026: "if the cover becomes unavailable, the requester can change
 * the cover"; leave-coverage.ts), and a Super Admin's edit of it (owner, 26 October 2026: "as a superadmin i need to edit
 * the leaves"; the step's comment lists what changed), and a Super Admin's undoing of a cancellation (owner, 26 October
 * 2026: "allow superadmin to undo cancellation"; the step's comment is the note).
 */
export const LEAVE_REQUEST_STEP_KINDS = [...LEAVE_STEP_KINDS, 'cover_changed', 'edited', 'restored'] as const;
export type LeaveRequestStepKind = (typeof LEAVE_REQUEST_STEP_KINDS)[number];

export const LEAVE_REQUEST_STEP_KIND_LABELS: Record<LeaveRequestStepKind, string> = { ...LEAVE_STEP_KIND_LABELS, cover_changed: 'Cover changed', edited: 'Edited', restored: 'Restored' };

/** A step as the restore reads it: its kind and, for a decision, which. */
export interface RestoreStep {
  kind: string;
  decision?: string | null;
}

/**
 * Where a cancelled leave stood before it was cancelled (owner, 26 October 2026: "allow superadmin to undo cancellation"),
 * read from its steps in order: approved (recorded by HR, or approved by HR), with the manager or with HR (a request its
 * employee withdrew). The steps are replayed, so a leave restored and cancelled again goes back to where the restore put
 * it. Edits and cover changes don't move it. An imported leave has no steps at all and is HR's history, approved. Null:
 * it isn't cancelled, or the steps don't say.
 */
export function statusBeforeCancel(steps: readonly RestoreStep[], recordedByHr: boolean): 'approved' | 'with_manager' | 'with_hr' | null {
  let state: string | null = null;
  let before: string | null = null;
  for (const s of steps) {
    if (s.kind === 'submitted') state = 'with_manager';
    else if (s.kind === 'no_manager') state = 'with_hr';
    else if (s.kind === 'recorded_by_hr') state = 'approved';
    else if (s.kind === 'manager_decision') state = s.decision === 'approve' ? 'with_hr' : 'rejected';
    else if (s.kind === 'hr_decision') state = s.decision === 'approve' ? 'approved' : 'rejected';
    else if (s.kind === 'cancelled') {
      before = state;
      state = 'cancelled';
    } else if (s.kind === 'restored' && state === 'cancelled') state = before;
  }
  if (state !== 'cancelled') return null;
  const found = before ?? (recordedByHr ? 'approved' : null);
  return found === 'approved' || found === 'with_manager' || found === 'with_hr' ? found : null;
}


/** The step a stage's decision is logged as. */
export const leaveDecisionStepKind = (stage: LeaveStage): LeaveStepKind => `${stage}_decision`;

/** Each approver's choice: approve, or reject with a comment. */
export const LEAVE_DECISIONS = ['approve', 'reject'] as const;
export type LeaveDecision = (typeof LEAVE_DECISIONS)[number];

export const LEAVE_DECISION_LABELS: Record<LeaveDecision, string> = { approve: 'Approve', reject: 'Reject' };

/** A decision that needs a comment: a rejection (why). */
export const leaveDecisionNeedsComment = (decision: LeaveDecision) => decision === 'reject';

/** Whether its employee may cancel a request: while it is being decided, or approved and not started yet. */
export function employeeMayCancelLeave(request: { status: string; startDate: string }, today: string): boolean {
  return isOpenLeave(request.status) || (request.status === 'approved' && request.startDate > today);
}

// ---------- documents ----------

/** A request's documents (a medical certificate, proof of sitting the exam): photos or PDFs, at most so many, each so large. */
export const LEAVE_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const LEAVE_DOCUMENTS_MAX = 3;
export const LEAVE_DOCUMENT_MAX_MB = 10;

// ---------- balances ----------

/** The annual balance's figures for a year. */
export interface AnnualBalanceFigures {
  /** The year's annual leave (annualEntitlement). */
  entitlement: number;
  /** The days carried in from the year before, as its Year Closing decided. */
  carriedIn: number;
  /** HR's adjustments for the year, more or fewer days. */
  adjustments: number;
  /** Approved leave from the annual balance (annual and casual) already started. */
  taken: number;
  /** Approved leave from it not started yet. */
  booked: number;
  /** Requests from it still being decided. */
  pending: number;
}

/** What is left of the annual balance to ask for: what was earned, carried in and adjusted less what is taken, booked and pending. */
export function annualAvailable(b: AnnualBalanceFigures): number {
  return halfOrTenth(b.entitlement + b.carriedIn + b.adjustments - b.taken - b.booked - b.pending);
}

/** What is unused at the year's end: what was earned, carried in and adjusted less what was approved (taken and booked). */
export function annualUnused(b: Omit<AnnualBalanceFigures, 'pending'>): number {
  return halfOrTenth(b.entitlement + b.carriedIn + b.adjustments - b.taken - b.booked);
}

/**
 * What is left of a type's own days in a year: a yearly type's days, a from_annual type's most a year (casual leave's
 * 7), less what was used (approved and pending); null for a type without days a year. The annual balance is shown on
 * its own; a from_annual type also takes from it.
 */
export function leaveTypeLeft(type: Pick<LeaveTypeRules, 'balance' | 'daysPerYear'>, usedInYear: number): number | null {
  if ((type.balance !== 'yearly' && type.balance !== 'from_annual') || type.daysPerYear === null) return null;
  return Math.max(0, halfOrTenth(type.daysPerYear - usedInYear));
}

/**
 * How many days a leave takes the annual balance below 0 (owner, 26 October 2026: "only allow super admin to add leaves
 * with a negative balance"): 0 when it fits. Only for a type that takes from the annual balance.
 */
export function overBalanceDays(type: { balance: string }, available: number, days: number): number {
  return takesFromAnnual(type.balance) ? Math.max(0, halfOrTenth(days - available)) : 0;
}

/** The warning a Super Admin sees before saving leave beyond the balance: "This leaves the annual balance at −2 days". */
export const overBalanceWarning = (available: number, days: number): string => {
  const left = halfOrTenth(available - days);
  return `This leaves the annual balance at ${left < 0 ? '−' : ''}${daysText(Math.abs(left))}.`;
};

/** What a step says of leave beyond the balance, allowed by a Super Admin. */
export const overBalanceStepText = (over: number): string => `Over the balance by ${daysText(over)}: allowed by a Super Admin`;

// ---------- a request's problems ----------

/** A new request as typed. */
export interface LeaveRequestInput {
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** Its days, as leaveDaysBetween counts them. */
  days: number;
  /** How many documents are attached. */
  documents: number;
  /** Today, YYYY-MM-DD (Cairo). */
  today: string;
  /** Recorded by HR on the employee's behalf (e.g. sick leave reported after): no notice is needed. */
  byHr: boolean;
}

/** The annual balance a request from it is checked against. */
export interface LeaveRequestBalance {
  /** What is left of the annual balance of the request's year, before this request (annualAvailable). */
  available: number;
  /** The first day the year's annual leave may be used (annualEntitlement.usableFrom). */
  usableFrom: string;
  /** A Super Admin may take it below 0 (owner, 26 October 2026): the balance isn't checked; the caller says so on the step. */
  allowNegative?: boolean;
}

/** The employee and what they have taken of the type. */
export interface LeaveHistory {
  /** Days of this type in the request's year, approved or being decided (not this request). */
  usedInYear: number;
  /** Requests of this type approved or being decided while employed (not this request). */
  timesInService: number;
  /** Full months of service with the company on the request's first day. */
  serviceMonths: number;
  gender: LeaveGender | null;
}

/**
 * Why a request can't be sent, in the order to fix them (none: it can): the dates, the half day, the days counted, who
 * may take the type (gender, service), the times in service, the days a request, the type's days a year, the annual
 * balance and when it may be used, the notice (an employee's request only: HR records on their behalf without), and the
 * document. An overlap with another request is the API's to find.
 */
export function leaveRequestProblems(input: LeaveRequestInput, type: LeaveTypeRules, balance: LeaveRequestBalance, history: LeaveHistory): string[] {
  const problems: string[] = [];
  if (!isDate(input.startDate)) problems.push('Enter the first day of the leave.');
  if (!isDate(input.endDate)) problems.push('Enter the last day of the leave.');
  if (problems.length) return problems;
  if (input.endDate < input.startDate) return ["The last day can't be before the first."];
  if (input.halfDay && !type.halfDays) problems.push(`${type.nameEn} can't be taken as a half day.`);
  else if (input.halfDay && input.startDate !== input.endDate) problems.push('A half day is for one day: make the first and last day the same.');
  if (!(input.days > 0)) {
    problems.push(
      type.calendarDays ? 'Choose the days of the leave.' : "These dates have no working days: rest days and official holidays aren't counted as leave.",
    );
  }
  const yearly = type.balance === 'annual' || type.balance === 'from_annual' || type.balance === 'yearly';
  if (yearly && input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) {
    problems.push(`A leave counted by the year can't run into the next one: end it on 31/12/${input.startDate.slice(0, 4)} and request the rest separately.`);
  }

  if (type.gender !== null && history.gender !== type.gender) {
    problems.push(
      history.gender === null
        ? `${type.nameEn} is for ${type.gender} employees: ask HR to record your gender first.`
        : `${type.nameEn} is for ${type.gender} employees only.`,
    );
  }
  if (type.minServiceMonths !== null && history.serviceMonths < type.minServiceMonths) {
    problems.push(`${type.nameEn} needs ${monthsText(type.minServiceMonths)} of service with the company first; by the first day there will be ${monthsText(history.serviceMonths)}.`);
  }
  if (type.maxTimesInService !== null && history.timesInService >= type.maxTimesInService) {
    problems.push(`${type.nameEn} can be taken ${timesText(type.maxTimesInService)} in service, and it has been already.`);
  }
  if (type.maxPerRequest !== null && input.days > type.maxPerRequest) {
    problems.push(`${type.nameEn} is at most ${daysText(type.maxPerRequest)} at a time; this is ${daysText(input.days)}.`);
  }
  if (yearly && type.daysPerYear !== null && type.balance !== 'annual') {
    const left = Math.max(0, halfOrTenth(type.daysPerYear - history.usedInYear));
    if (input.days > left) problems.push(`Only ${daysText(left)} left of ${type.nameEn.toLowerCase()}'s ${daysText(type.daysPerYear)} a year.`);
  }
  if (takesFromAnnual(type.balance)) {
    if (type.balance === 'annual' && input.startDate < balance.usableFrom) {
      problems.push(`Annual leave can be used from ${shown(balance.usableFrom)}, six months after joining.`);
    }
    if (!balance.allowNegative && input.days > balance.available) {
      problems.push(`Only ${daysText(Math.max(0, balance.available))} left of the annual balance${type.balance === 'from_annual' ? `, which ${type.nameEn.toLowerCase()} is counted against` : ''}.`);
    }
  }
  if (!input.byHr && type.noticeDays !== null && type.noticeDays > 0 && isDate(input.today)) {
    const notice = input.startDate < input.today ? -1 : daysBetween(input.today, input.startDate);
    if (notice < type.noticeDays) {
      problems.push(`${type.nameEn} needs ${daysText(type.noticeDays)}' notice: the first day can be ${shown(plusDays(input.today, type.noticeDays))} at the earliest.`);
    }
  }
  if (type.documentRequired && input.documents < 1) problems.push(`Attach a document: ${type.nameEn.toLowerCase()} needs one.`);
  return problems;
}

/** What a type's rules say, in short, e.g. "Paid · Working days · From the annual balance · At most 2 days at a time · 7 days a year". */
export function leaveTypeRulesText(type: LeaveTypeRules): string {
  const pay = type.paid === 'partly' ? `Paid at ${type.payPercent ?? 100}%` : LEAVE_PAY_LABELS[type.paid];
  return [
    pay,
    type.calendarDays ? 'Calendar days' : 'Working days',
    type.balance === 'annual'
      ? 'The annual balance'
      : type.balance === 'from_annual'
        ? 'From the annual balance'
        : type.balance === 'yearly'
          ? type.daysPerYear !== null
            ? `${daysText(type.daysPerYear)} a year`
            : null
          : type.balance === 'none'
            ? 'No balance'
            : null,
    type.balance === 'from_annual' && type.daysPerYear !== null ? `At most ${daysText(type.daysPerYear)} a year` : null,
    type.maxPerRequest !== null ? `At most ${daysText(type.maxPerRequest)} at a time` : null,
    type.maxTimesInService !== null ? `${capitalise(timesText(type.maxTimesInService))} in service` : null,
    type.minServiceMonths !== null ? `After ${monthsText(type.minServiceMonths)} of service` : null,
    type.noticeDays !== null && type.noticeDays > 0 ? `${daysText(type.noticeDays)}' notice` : null,
    type.documentRequired ? 'Document needed' : null,
    type.gender === 'female' ? 'Female employees' : type.gender === 'male' ? 'Male employees' : null,
    type.halfDays ? 'Half days allowed' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------- Year Closing (Art. 125) ----------

/**
 * The days unused at a year's end, by the year they were earned in (owner, 18 October 2026: "make it with decision with
 * the year closing"): the days carried in (by the year each was earned in) and the year's own (its entitlement and
 * adjustments), the days used taken from the oldest first. Days used beyond them all leave the year's own below 0.
 */
export function unusedByYear(carriedIn: Readonly<Record<string, number>>, year: number, earned: number, used: number): Record<string, number> {
  const pool = new Map<number, number>();
  // a balance below 0 carried in (more taken than earned) comes out of the year's own days
  let own = earned;
  for (const [y, d] of Object.entries(carriedIn)) {
    if (Number(y) < year && d > 0) pool.set(Number(y), (pool.get(Number(y)) ?? 0) + d);
    else own += d;
  }
  pool.set(year, own);
  let left = used;
  const out: Record<string, number> = {};
  for (const y of [...pool.keys()].sort((a, b) => a - b)) {
    const d = pool.get(y)!;
    const take = y === year ? left : Math.min(d, left);
    left -= take;
    const rest = halfOrTenth(d - take);
    if (rest !== 0 || y === year) out[String(y)] = rest;
  }
  return out;
}

/**
 * The days that must be settled at a year's closing (Art. 125: "ويلتزم صاحب العمل بتسوية رصيد الإجازات، أو الأجر المقابل
 * له كل ثلاث سنوات على الأكثر"): those earned `withinYears` years ago or more, counting the year closed (at the closing of
 * 2026, those earned in 2024 or before). They can't be carried again: paid now.
 */
export function settleByAge(carriedByYear: Readonly<Record<string, number>>, year: number, withinYears: number = LEAVE_RULE_DEFAULTS.settleWithinYears): number {
  let due = 0;
  for (const [y, d] of Object.entries(carriedByYear)) if (Number(y) <= year - withinYears + 1 && d > 0) due += d;
  return halfOrTenth(due);
}

/**
 * Why a year's closing for an employee can't be saved as decided (none: it can): the days carried and paid, each 0 or
 * more in whole or half days, adding up to the days unused (Art. 125: "لا يجوز للعامل النزول عن إجازته"), and the days
 * that must be settled (settleByAge) not carried again. A balance below 0 (more taken than earned) is carried as it is.
 */
export function yearClosingProblems(unused: number, carry: number, pay: number, mustSettle: number = 0): string[] {
  const problems: string[] = [];
  if (unused < 0) {
    if (carry !== unused || pay !== 0) problems.push(`More was taken than earned: the ${daysText(-unused)} over are carried into the next year as they are, with nothing paid.`);
    return problems;
  }
  if (!isLeaveDays(carry) || carry < 0) problems.push('Enter the days carried: 0 or more, in whole or half days.');
  if (!isLeaveDays(pay) || pay < 0) problems.push('Enter the days paid: 0 or more, in whole or half days.');
  if (problems.length) return problems;
  if (Math.round((carry + pay) * 10) !== Math.round(unused * 10)) {
    problems.push(`The days carried and paid must add up to the ${daysText(unused)} unused: leave can't be lost (Art. 125).`);
  }
  const due = Math.min(mustSettle, unused);
  if (due > 0 && pay < due) {
    problems.push(`${daysText(due)} ${due === 1 ? 'has' : 'have'} been carried for three years and must be paid now (Art. 125): pay at least ${daysText(due)}.`);
  }
  return problems;
}

/** Days as a balance takes them: whole or half days (an adjustment may be below 0). */
export const isLeaveDays = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;

/**
 * The days carried into the next year, by the year each was earned in: the year's unused days (unusedByYear) less the
 * days paid, the oldest paid first. Those below 0 (more taken than earned) are carried as they are.
 */
export function carriedAfterClosing(byYear: Readonly<Record<string, number>>, pay: number): Record<string, number> {
  let left = pay;
  const out: Record<string, number> = {};
  for (const y of Object.keys(byYear).sort()) {
    const d = byYear[y];
    const paid = d > 0 ? Math.min(d, left) : 0;
    left -= paid;
    const rest = halfOrTenth(d - paid);
    if (rest !== 0) out[y] = rest;
  }
  return out;
}

/**
 * The month (its first day) whose payroll a year's unused days are paid with: January of the next year, or the first
 * month after it whose run isn't approved yet (`closedMonths`: the first days of the months whose run is approved or paid).
 */
export const leavePayoutMonth = (year: number, closedMonths: readonly string[]): string => reimbursementPayMonth(`${year + 1}-01-01`, closedMonths);

/**
 * A day's pay for unused leave paid: the gross ÷ the payroll's day divisor (30), to the piaster, as a month's day rate is
 * worked out (payroll.ts).
 */
export function leaveDayRate(gross: number, dayDivisor: number): number {
  return dayDivisor > 0 ? Math.round((gross / dayDivisor + Number.EPSILON) * 100) / 100 : 0;
}

/** Unused days paid at a day rate, to the piaster. */
export const leavePayAmount = (days: number, dayRate: number): number => Math.round((days * dayRate + Number.EPSILON) * 100) / 100 + 0;

/**
 * The flags of a year's leave the law asks for but the system can't enforce (Art. 125: "يجب أن يحصل العامل على إجازة سنوية
 * مدتها خمسة عشر يوما، منها ستة أيام متصلة على الأقل"): fewer than 15 days of annual leave taken in the year, or none of 6
 * days in a row. `leaves`: the year's approved annual leave, each with its days. Only for someone with a whole year's
 * leave of 15 days or more.
 */
export function annualMinimumFlags(entitlement: number, leaves: readonly { days: number }[]): string[] {
  if (entitlement < 15) return [];
  const flags: string[] = [];
  const taken = leaves.reduce((sum, l) => sum + l.days, 0);
  if (taken < 15) flags.push(`${daysText(halfOrTenth(taken))} of annual leave taken this year: the law asks for at least 15 (Art. 125).`);
  if (!leaves.some((l) => l.days >= 6)) flags.push('No annual leave of 6 days in a row this year: the law asks for one (Art. 125).');
  return flags;
}

// ---------- payroll: the month's leave days ----------

/** An approved leave as the payroll reads it. */
export interface PayrollLeave {
  startDate: string;
  endDate: string;
  halfDay: boolean;
  paid: LeavePay;
  /** A partly paid type's percent; null for the others. */
  payPercent: number | null;
  calendarDays: boolean;
}

/**
 * The leave days in a month ('YYYY-MM') for the payroll's inputs (owner, 17 October 2026: "dont count abcent days or
 * leave days, as they already have their own deduction and fields"): each approved leave's days within the month and
 * the days employed (`from`, `to`; null: the month's own), counted as its type counts them (leaveDaysBetween), shared
 * between the paid days (the Leave days: nothing cut) and the unpaid (the Unpaid leave days: a day of the gross cut
 * each); a partly paid leave's days by its percent (sick leave at 75%: three quarters of each day paid, a quarter
 * unpaid). Both to two decimals.
 */
export function monthLeaveDays(
  leaves: readonly PayrollLeave[],
  month: string,
  count: Pick<LeaveDayCount, 'workingDays' | 'holidays'> & { from?: string | null; to?: string | null },
): { paid: number; unpaid: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return { paid: 0, unpaid: 0 };
  const first = `${month}-01`;
  const last = `${month}-${pad(daysInMonth(Number(m[1]), Number(m[2])))}`;
  const lo = count.from && count.from > first ? count.from : first;
  const hi = count.to && count.to < last ? count.to : last;
  let paid = 0;
  let unpaid = 0;
  for (const l of leaves) {
    const from = l.startDate > lo ? l.startDate : lo;
    const to = l.endDate < hi ? l.endDate : hi;
    if (from > to) continue;
    // the half day is the leave's last day: in the month only when its last day is
    const days = leaveDaysBetween(from, to, { workingDays: count.workingDays, holidays: count.holidays, calendarDays: l.calendarDays, halfDay: l.halfDay && to === l.endDate });
    const share = l.paid === 'paid' ? 1 : l.paid === 'unpaid' ? 0 : Math.min(100, Math.max(0, l.payPercent ?? 100)) / 100;
    paid += days * share;
    unpaid += days * (1 - share);
  }
  return { paid: hundredths(paid), unpaid: hundredths(unpaid) };
}

// ---------- helpers ----------

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDate = (s: string) => DATE.test(s);
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
const plusDays = (date: string, n: number) => new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
/** The date `n` months after `date`, its day kept or the month's last day (31 August + 6 months: 28 or 29 February). */
function plusMonths(date: string, n: number): string {
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + n;
  const [y, m] = [Math.floor(index / 12), (index % 12) + 1];
  return `${y}-${pad(m)}-${pad(Math.min(Number(date.slice(8, 10)), daysInMonth(y, m)))}`;
}
/** The full months from one date to another: 15 March to 14 April is 0, to 15 April 1. */
function fullMonthsBetween(from: string, to: string): number {
  if (!isDate(from) || !isDate(to) || to < from) return 0;
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  if (plusMonths(from, months) > to) months--;
  return Math.max(0, months);
}
/** To the nearest half day. */
const toHalfDays = (n: number) => Math.round(n * 2 + 1e-9) / 2 + 0;
/** Days added or taken without the noise of fractions: to a tenth (half days and the payroll's shares stay exact). */
const halfOrTenth = (n: number) => Math.round(n * 10) / 10 + 0;
const hundredths = (n: number) => Math.round(n * 100 + 1e-9) / 100 + 0;
/** A date as messages show it: DD/MM/YYYY. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const timesText = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "5 years", "1 year", "18 months". */
function monthsText(months: number): string {
  if (months > 0 && months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  return `${months} ${months === 1 ? 'month' : 'months'}`;
}
