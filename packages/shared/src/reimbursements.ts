// Reimbursement claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions", and "in the setup i need to enter for it a cap"). HR sets up the reimbursement types in Payroll
// Setup, each with its conditions: caps (a claim, a month, a year), a receipt required or not, a claim deadline (days
// after the expense) and who may claim it (departments, grades, employment types; none chosen: everyone). An employee
// claims one from My Requests; a claim that breaks a condition can't be sent. It goes to their direct manager, then HR,
// then Finance (no manager: straight to HR); each approves, approves a lower amount with a comment, or rejects it with
// one, every step logged on the claim. Finance's approval adds it, untaxed, to the next payroll (a Reimbursement
// addition, payroll-adjustments.ts). The API enforces these rules; the web app uses them to show the same checks live.

import { daysBetween } from './payroll-adjustments.js';

// ---------- statuses and stages ----------

/** Where a claim is: with the manager, HR or Finance; approved (and added to a payroll); rejected; cancelled by its employee. */
export const REIMBURSEMENT_STATUSES = ['with_manager', 'with_hr', 'with_finance', 'approved', 'rejected', 'cancelled'] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

export const REIMBURSEMENT_STATUS_LABELS: Record<ReimbursementStatus, string> = {
  with_manager: 'With the manager',
  with_hr: 'With HR',
  with_finance: 'With Finance',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** The statuses of a claim still being decided: its employee may cancel it meanwhile. */
export const REIMBURSEMENT_OPEN_STATUSES = ['with_manager', 'with_hr', 'with_finance'] as const satisfies readonly ReimbursementStatus[];
export type ReimbursementOpenStatus = (typeof REIMBURSEMENT_OPEN_STATUSES)[number];

export const isOpenReimbursement = (status: string): status is ReimbursementOpenStatus =>
  (REIMBURSEMENT_OPEN_STATUSES as readonly string[]).includes(status);

/** Who decides a claim, in order: the direct manager, HR, then Finance. */
export const REIMBURSEMENT_STAGES = ['manager', 'hr', 'finance'] as const;
export type ReimbursementStage = (typeof REIMBURSEMENT_STAGES)[number];

export const REIMBURSEMENT_STAGE_LABELS: Record<ReimbursementStage, string> = { manager: 'Direct manager', hr: 'HR', finance: 'Finance' };

/** The stage deciding a claim with this status; null once it is decided or cancelled. */
export function reimbursementStage(status: string): ReimbursementStage | null {
  if (status === 'with_manager') return 'manager';
  if (status === 'with_hr') return 'hr';
  if (status === 'with_finance') return 'finance';
  return null;
}

/** Where an approved claim goes next: the manager's approval to HR, HR's to Finance, Finance's approves it. */
export function statusAfterApproval(stage: ReimbursementStage): ReimbursementStatus {
  return stage === 'manager' ? 'with_hr' : stage === 'hr' ? 'with_finance' : 'approved';
}

/** Where a new claim starts: with the employee's direct manager, or with HR when they have none. */
export const firstReimbursementStatus = (hasManager: boolean): ReimbursementStatus => (hasManager ? 'with_manager' : 'with_hr');

// ---------- decisions and the steps logged ----------

/** Each approver's choice (owner's answer, 18 October 2026: a lower amount may be approved, with a comment). */
export const REIMBURSEMENT_DECISIONS = ['approve', 'approve_other', 'reject'] as const;
export type ReimbursementDecision = (typeof REIMBURSEMENT_DECISIONS)[number];

export const REIMBURSEMENT_DECISION_LABELS: Record<ReimbursementDecision, string> = {
  approve: 'Approve',
  approve_other: 'Approve a lower amount',
  reject: 'Reject',
};

/** A decision that needs a comment: a lower amount (why), a rejection (why). */
export const decisionNeedsComment = (decision: ReimbursementDecision) => decision !== 'approve';

/**
 * The steps logged on a claim, in the order taken: sent; sent straight to HR (no direct manager); each stage's decision;
 * cancelled by its employee; added to a month's payroll (on Finance's approval).
 */
export const REIMBURSEMENT_STEP_KINDS = ['submitted', 'no_manager', 'manager_decision', 'hr_decision', 'finance_decision', 'cancelled', 'added_to_payroll'] as const;
export type ReimbursementStepKind = (typeof REIMBURSEMENT_STEP_KINDS)[number];

/** The step a stage's decision is logged as. */
export const decisionStepKind = (stage: ReimbursementStage): ReimbursementStepKind => `${stage}_decision`;

/**
 * What a lower amount approved may be: more than 0, in piastres, and less than the amount it is decided on (the claim's,
 * or the one an earlier approver approved). Null when it may.
 */
export function lowerAmountProblem(amount: number, current: number): string | null {
  if (!isMoney(amount) || amount <= 0) return 'Enter the amount approved, more than 0, e.g. 250 or 250.50.';
  if (amount >= current) return `The amount approved must be less than ${current.toFixed(2)}. To approve the whole amount, choose Approve.`;
  return null;
}

// ---------- the conditions of a reimbursement type ----------

/** A reimbursement type's conditions. A cap or the deadline left empty (null) has no limit; an empty list, everyone. */
export interface ReimbursementRules {
  receiptRequired: boolean;
  /** EGP at most a claim. */
  capPerClaim: number | null;
  /** EGP at most in a calendar month, by the expense's date. */
  capPerMonth: number | null;
  /** EGP at most in a calendar year, by the expense's date. */
  capPerYear: number | null;
  /** Claimed at most this many days after the expense. */
  claimWithinDays: number | null;
  departmentIds: readonly string[];
  gradeIds: readonly string[];
  employmentTypes: readonly string[];
}

/** Where the employee is: their current employment's department, grade and employment type. */
export interface ReimbursementClaimant {
  departmentId: string | null;
  gradeId: string | null;
  employmentType: string | null;
}

/** Whether the employee may claim this type: in each list chosen (none chosen: everyone). */
export function mayClaimReimbursement(rules: Pick<ReimbursementRules, 'departmentIds' | 'gradeIds' | 'employmentTypes'>, who: ReimbursementClaimant): boolean {
  const within = (list: readonly string[], value: string | null) => list.length === 0 || (value !== null && list.includes(value));
  return within(rules.departmentIds, who.departmentId) && within(rules.gradeIds, who.gradeId) && within(rules.employmentTypes, who.employmentType);
}

/**
 * What the employee's claims of the type already take of its caps, in the expense's month and year: the claims still
 * being decided and those approved (the amount as last approved, else as claimed); never rejected or cancelled ones.
 */
export interface ReimbursementUse {
  usedInMonth: number;
  usedInYear: number;
}

/** The amount a claim takes of its type's caps: none once rejected or cancelled; else the amount last approved, or as claimed. */
export function amountCounted(claim: { status: string; amount: number; approvedAmount: number | null }): number {
  if (claim.status === 'rejected' || claim.status === 'cancelled') return 0;
  return claim.approvedAmount ?? claim.amount;
}

/** What is left under each cap (null: that cap isn't set), never below 0. */
export function reimbursementLeft(rules: Pick<ReimbursementRules, 'capPerClaim' | 'capPerMonth' | 'capPerYear'>, use: ReimbursementUse) {
  const left = (cap: number | null, used: number) => (cap === null ? null : money(Math.max(0, cents(cap) - cents(used))));
  return { claim: rules.capPerClaim, month: left(rules.capPerMonth, use.usedInMonth), year: left(rules.capPerYear, use.usedInYear) };
}

/** The most that can be claimed now: the smallest of what is left under the caps; null without caps. */
export function reimbursementMost(rules: Pick<ReimbursementRules, 'capPerClaim' | 'capPerMonth' | 'capPerYear'>, use: ReimbursementUse): number | null {
  const left = reimbursementLeft(rules, use);
  const limits = [left.claim, left.month, left.year].filter((n): n is number => n !== null);
  return limits.length ? Math.min(...limits) : null;
}

/** A new claim as typed: the amount, the expense's date and today (YYYY-MM-DD, Cairo), and how many receipts it has. */
export interface ReimbursementClaimInput {
  amount: number;
  expenseDate: string;
  today: string;
  receipts: number;
}

/**
 * Why a claim can't be sent, in the order to fix them (none: it can): the amount, the date (not after today, not past
 * the deadline), the receipt, and each cap. `use`: the employee's claims of the type already in the expense's month and
 * year (ReimbursementUse); the API counts them, the web shows them.
 */
export function reimbursementProblems(input: ReimbursementClaimInput, rules: ReimbursementRules, use: ReimbursementUse): string[] {
  const problems: string[] = [];
  if (!isMoney(input.amount) || input.amount <= 0) problems.push('Enter the amount spent, more than 0, e.g. 250 or 250.50.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) problems.push('Enter the date of the expense.');
  else if (input.expenseDate > input.today) problems.push("The expense's date can't be after today.");
  else if (rules.claimWithinDays !== null) {
    const age = daysBetween(input.expenseDate, input.today);
    if (age > rules.claimWithinDays) {
      problems.push(`This type must be claimed within ${days(rules.claimWithinDays)} of the expense; this one was ${days(age)} ago.`);
    }
  }
  if (rules.receiptRequired && input.receipts < 1) problems.push('Attach the receipt: this type needs one.');
  if (problems.some((p) => p.startsWith('Enter the amount'))) return problems;

  const egp = (n: number) => `EGP ${n.toFixed(2)}`;
  if (rules.capPerClaim !== null && cents(input.amount) > cents(rules.capPerClaim)) {
    problems.push(`At most ${egp(rules.capPerClaim)} can be claimed at once for this type.`);
  }
  const left = reimbursementLeft(rules, use);
  if (left.month !== null && cents(input.amount) > cents(left.month)) {
    problems.push(`Only ${egp(left.month)} is left of this type's ${egp(rules.capPerMonth ?? 0)} for the expense's month.`);
  }
  if (left.year !== null && cents(input.amount) > cents(left.year)) {
    problems.push(`Only ${egp(left.year)} is left of this type's ${egp(rules.capPerYear ?? 0)} for the expense's year.`);
  }
  return problems;
}

/** What a type's conditions say, in short, e.g. "Receipt needed · Up to EGP 500.00 a claim, 1,000.00 a month · Within 30 days". */
export function reimbursementRulesText(rules: Omit<ReimbursementRules, 'departmentIds' | 'gradeIds' | 'employmentTypes'>): string {
  const egp = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const caps = [
    rules.capPerClaim !== null ? `${egp(rules.capPerClaim)} a claim` : null,
    rules.capPerMonth !== null ? `${egp(rules.capPerMonth)} a month` : null,
    rules.capPerYear !== null ? `${egp(rules.capPerYear)} a year` : null,
  ].filter(Boolean);
  return [
    rules.receiptRequired ? 'Receipt needed' : 'No receipt needed',
    caps.length ? `Up to EGP ${caps.join(', ')}` : 'No cap',
    rules.claimWithinDays !== null ? `Within ${days(rules.claimWithinDays)} of the expense` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---------- receipts ----------

/** A claim's receipts: photos or PDFs, at most so many, each at most so large. */
export const REIMBURSEMENT_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const REIMBURSEMENT_RECEIPTS_MAX = 5;
export const REIMBURSEMENT_RECEIPT_MAX_MB = 10;

// ---------- the payroll it is paid with ----------

/**
 * The month (its first day) whose payroll an approved claim is paid with: the month it was approved in, or the first
 * after it whose run isn't approved yet (`closedMonths`: the first days of the months whose run is approved or paid).
 */
export function reimbursementPayMonth(approvedOn: string, closedMonths: readonly string[]): string {
  const closed = new Set(closedMonths);
  let [y, m] = [Number(approvedOn.slice(0, 4)), Number(approvedOn.slice(5, 7))];
  for (let i = 0; i < 240; i++) {
    const month = `${y}-${String(m).padStart(2, '0')}-01`;
    if (!closed.has(month)) return month;
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

// ---------- helpers ----------

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100 + 0;
const isMoney = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
