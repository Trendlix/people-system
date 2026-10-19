// Pay raises during a contract (owner's decisions, 16 October 2026). Asked "how to deal with an employee if he is
// getting a raise during his contract? how to track it? or the contract to be ended and a new one to be issued?", the
// owner chose both ways, HR choosing per case ("i want to have the amendment option and to terminate the current
// contract and generate a new one"):
// - an amendment: the new pay on the same contract from an effective date. The contract's term and end stay (a renewal
//   later still follows the original end), there is no probation, and a salary amendment letter (ملحق عقد) is printed to
//   sign instead of a whole contract;
// - a new contract: a new version with its own 1-year term from the effective date, the whole contract printed, which
//   replaces the version in force once signed.
// A raise takes effect on the 1st of a month ("1st of a month"), so each payroll month has one salary. HR enters it,
// the CEO approves it, returns it with a reason, or declines it ("HR, then the CEO"); only an approved one is signed and
// paid. A renewal that changes the pay goes through the same approval and counts as a raise (owner, 16 October 2026:
// "think about tracking the salary raises through the employment period too"); one with the same pay needs none.
// Social insurance ("From the next January unless amended in Form 2"): after a raise the insured wage stays as it was
// until the next 1 January (Law 148/2019 sets it each year), while the salary tax follows the new pay at once; unless HR
// files social insurance Form 2 (wage change), when it follows the new pay from the date given with the Form 2.
// A raise may come with a promotion: a new job title and grade, applied to the employment when the raise is signed.
// Raise requests (owner, 16 October 2026: "a place to request raise by employee, or his manager or the HR, with a reason
// and to be going through an approval cycle"): the employee for themself, their direct manager or HR asks, HR declines
// or prepares the raise from it, and the CEO's decision on that raise is the request's. Reworked on 17 October 2026
// ("requesting a raise should have a drop list reason first ( Annual Raise - Performance Raise - Counter Offer Raise -
// etc..) then add requester comment, suggest raise amount or percentage, then the approver to Approve - Approve with
// another raise amount or percentge - Reject, and add a comment, all the request steps to be logged in the request"): a
// reason from the list, the requester's comment, a suggested raise as an amount or a percent of the gross; HR, then the
// CEO, approve it as it reached them, approve it with another raise, or reject it, always with a comment; and every step
// logged on the request. Since 19 October 2026 ("when a raise request was sent to the CEO, is showed in approvals not
// raise requests, and after approved, it was not shown in the raise request history too") a raise HR prepares directly
// (on the contract, or a renewal with new pay) has its request too, prepared directly by HR, so every raise is on Raise
// Requests at every stage. Pure code, for the API and the screens.

import { monthlyFromHourly } from './contracts.js';

/** What a contract version is: a whole contract (the first, a renewal, a raise's new contract), or a salary amendment. */
export const CONTRACT_KINDS = ['contract', 'amendment'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = { contract: 'Contract', amendment: 'Salary amendment' };

/** The two ways of a raise, HR choosing per case. */
export const RAISE_WAYS = ['amendment', 'contract'] as const;
export type RaiseWay = (typeof RAISE_WAYS)[number];
export const RAISE_WAY_LABELS: Record<RaiseWay, string> = { amendment: 'Amendment', contract: 'New contract' };
export const RAISE_WAY_HINTS: Record<RaiseWay, string> = {
  amendment: 'The new pay on the same contract: its term and end stay, and a salary amendment letter is signed.',
  contract: 'A new contract with its own term from the effective date, signed in full; it replaces the contract in force.',
};

/**
 * Why the pay changes, on a raise and on a raise request alike (owner, 17 October 2026: "requesting a raise should have
 * a drop list reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..)"). Adjustment, from before
 * then, stays readable on the versions that have it; the forms offer the others (RAISE_REASON_CHOICES).
 */
export const RAISE_REASONS = ['annual', 'performance', 'counter_offer', 'promotion', 'market_adjustment', 'cost_of_living', 'adjustment', 'other'] as const;
export type RaiseReason = (typeof RAISE_REASONS)[number];
/** The reasons a form offers, in this order: a raise request is asked for with one of them, and its raise takes it. */
export const RAISE_REASON_CHOICES = ['annual', 'performance', 'counter_offer', 'promotion', 'market_adjustment', 'cost_of_living', 'other'] as const satisfies readonly RaiseReason[];
export type RaiseReasonChoice = (typeof RAISE_REASON_CHOICES)[number];
export const RAISE_REASON_LABELS: Record<RaiseReason, string> = {
  annual: 'Annual raise',
  performance: 'Performance raise',
  counter_offer: 'Counter-offer raise',
  promotion: 'Promotion',
  market_adjustment: 'Market adjustment',
  cost_of_living: 'Cost of living',
  adjustment: 'Adjustment',
  other: 'Other',
};
/** As the salary amendment letter and the contract print them ({{raise_reason}} in an Arabic template). */
export const RAISE_REASON_LABELS_AR: Record<RaiseReason, string> = {
  annual: 'زيادة سنوية',
  performance: 'زيادة أداء',
  counter_offer: 'زيادة مقابل عرض عمل آخر',
  promotion: 'ترقية',
  market_adjustment: 'تعديل وفق أجور السوق',
  cost_of_living: 'زيادة غلاء المعيشة',
  adjustment: 'تعديل الأجر',
  other: 'أخرى',
};

/** The reasons a form offers for a version: the choices, and the one it has already if no longer offered (adjustment). */
export function raiseReasonOptions(current?: string | null): RaiseReason[] {
  const options: RaiseReason[] = [...RAISE_REASON_CHOICES];
  if (current && (RAISE_REASONS as readonly string[]).includes(current) && !options.includes(current as RaiseReason)) {
    options.splice(options.indexOf('other'), 0, current as RaiseReason);
  }
  return options;
}

/**
 * The CEO's step on a version that changes the pay: a draft HR prepares (also once returned, with the CEO's reason),
 * waiting for the CEO, or approved. Null on a version that needs no approval (the first contract, a renewal with the
 * same pay, a version from before 16 October 2026).
 */
export const RAISE_APPROVALS = ['draft', 'pending_ceo', 'approved'] as const;
export type RaiseApproval = (typeof RAISE_APPROVALS)[number];

/** Where a contract version stands, as the pay history shows it. */
export const PAY_STAGES = ['draft', 'returned', 'pending_ceo', 'approved', 'signed', 'replaced', 'ended'] as const;
export type PayStage = (typeof PAY_STAGES)[number];
export const PAY_STAGE_LABELS: Record<PayStage, string> = {
  draft: 'Draft',
  returned: 'Returned',
  pending_ceo: 'With the CEO',
  approved: 'Approved',
  signed: 'Signed',
  replaced: 'Replaced',
  ended: 'Ended',
};

/** A version's stage: signed, replaced or ended once signed; before, the CEO's step (returned: a draft with a reason). */
export function payStage(c: { status: string; approval: string | null; returnedReason?: string | null }): PayStage {
  if (c.status === 'active') return 'signed';
  if (c.status === 'superseded') return 'replaced';
  if (c.status === 'ended') return 'ended';
  if (c.approval === 'pending_ceo') return 'pending_ceo';
  if (c.approval === 'approved') return 'approved';
  return c.returnedReason ? 'returned' : 'draft';
}

/** What a version is to the one before it: the hire, an amendment, a new contract replacing it in its term, a renewal after it. */
export const PAY_CHANGES = ['hired', 'amendment', 'new_contract', 'renewal'] as const;
export type PayChange = (typeof PAY_CHANGES)[number];
export const PAY_CHANGE_LABELS: Record<PayChange, string> = { hired: 'Hired', amendment: 'Amendment', new_contract: 'New contract', renewal: 'Renewal' };

/**
 * What a version is to the one before it (null for the first): an amendment, a contract starting within the term of the
 * one before (a raise's new contract), or one starting after it ended (a renewal).
 */
export function payChangeOf(v: { kind: string; startDate: string }, previous: { endDate: string | null } | null): PayChange {
  if (!previous) return 'hired';
  if (v.kind === 'amendment') return 'amendment';
  return previous.endDate === null || v.startDate <= previous.endDate ? 'new_contract' : 'renewal';
}

// ---------- dates ----------

/** DD/MM/YYYY, as the screens show a date. */
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** A date (YYYY-MM-DD) on the 1st of a month. */
export const isFirstOfMonth = (ymd: string) => /^\d{4}-\d{2}-01$/.test(ymd);

/** The 1st of the month after a date: 2026-10-16 → 2026-11-01. */
export function nextFirstOfMonth(ymd: string): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * Why a raise can't take effect on that date, or null: on the 1st of a month, after the version in force started (one
 * salary a month, the latest start winning), and not after it ends (after then it is a renewal with the new pay).
 */
export function raiseEffectiveProblem(effective: string, current: { startDate: string; endDate: string | null }): string | null {
  if (!isFirstOfMonth(effective)) return 'A raise takes effect on the 1st of a month, so each payroll month has one salary: choose the 1st, e.g. 01/12/2026.';
  if (effective <= current.startDate) {
    return `The contract in force started on ${shown(current.startDate)}: a raise takes effect on a later 1st of a month.`;
  }
  if (current.endDate && effective > current.endDate) {
    return `The contract in force ends on ${shown(current.endDate)}: a raise from after then is a renewal with the new pay. Renew the contract instead.`;
  }
  return null;
}

/** The first 1 January on or after a date: the insured wage is set each January (Law 148/2019). */
export const firstJanuaryFrom = (ymd: string) => (ymd.slice(5) === '01-01' ? ymd : `${Number(ymd.slice(0, 4)) + 1}-01-01`);

/**
 * From when the insured wage follows a raise's pay: the date given with the Form 2 filed (wage change), else the next
 * 1 January from its effective date (the date itself for a raise from 1 January).
 */
export const insuredWageDate = (effective: string, form2From: string | null) => form2From ?? firstJanuaryFrom(effective);

/**
 * Why Form 2 can't change the insured wage from that date, or null: a 1st of a month, from the raise's effective date,
 * and not after the next January, when the insured wage follows the new pay anyway.
 */
export function form2Problem(date: string, effective: string): string | null {
  if (!isFirstOfMonth(date)) return 'Form 2 changes the insured wage from the 1st of a month: choose the 1st, e.g. 01/11/2026.';
  if (date < effective) return `Form 2 can't change the insured wage before the raise takes effect, on ${shown(effective)}.`;
  const january = firstJanuaryFrom(effective);
  if (date > january) return `From ${shown(january)} the insured wage follows the new pay anyway (it is set each January): choose a date up to then.`;
  return null;
}

/**
 * The version a month's insured wage stands on: the one in force, unless the month starts before its insured-wage date
 * (a raise), when it is the one before it, and so on back. `monthStart`: the month's 1st, YYYY-MM-DD. A version without
 * its number or the one before it stays as it is.
 */
export function insuredWageVersion<V extends { version?: number; insuredWageFrom?: string | null }>(inForce: V, versions: readonly V[], monthStart: string): V {
  let v = inForce;
  for (let steps = 0; steps <= versions.length; steps++) {
    if (!v.insuredWageFrom || monthStart >= v.insuredWageFrom || v.version === undefined) return v;
    const before = versions.find((x) => x.version === v.version! - 1);
    if (!before) return v;
    v = before;
  }
  return v;
}

// ---------- the pay ----------

/** A version's pay, to compare: how it is set, the gross, the rate and hours by the hour, the basic share, the allowances. */
export interface PayTerms {
  payBasis: string;
  grossSalary: number;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  basicPercent: number;
  allowances: readonly { allowanceTypeId: string; amount: number }[];
}

const cents = (n: number | null) => (n === null ? null : Math.round(n * 100));

/** Whether two versions pay the same: the same basis, gross, rate, hours, basic share and allowances (kind and amount). */
export function samePay(a: PayTerms, b: PayTerms): boolean {
  if (a.payBasis !== b.payBasis || cents(a.grossSalary) !== cents(b.grossSalary) || a.basicPercent !== b.basicPercent) return false;
  if (cents(a.hourlyRate) !== cents(b.hourlyRate) || a.hoursPerWeek !== b.hoursPerWeek) return false;
  const sorted = (rows: PayTerms['allowances']) => [...rows].map((r) => `${r.allowanceTypeId}:${cents(r.amount)}`).sort().join('|');
  return sorted(a.allowances) === sorted(b.allowances);
}

/** A change of pay: the amount, and the percent of what it was (to one decimal; null from nothing). */
export function payDifference(from: number, to: number): { amount: number; percent: number | null } {
  const amount = (Math.round(to * 100) - Math.round(from * 100)) / 100;
  return { amount, percent: from > 0 ? Math.round((amount / from) * 1000) / 10 : null };
}

// ---------- raise requests ----------

/** Who asked for a raise: the employee for themself, their direct manager, or HR. */
export const RAISE_REQUESTERS = ['self', 'manager', 'hr'] as const;
export type RaiseRequester = (typeof RAISE_REQUESTERS)[number];
export const RAISE_REQUESTER_LABELS: Record<RaiseRequester, string> = { self: 'The employee', manager: 'The direct manager', hr: 'HR' };

/**
 * A request's progress, HR then the CEO: with HR (new, or returned by the CEO), with the CEO (HR approved it, which
 * prepared the raise and sent it), approved (by the CEO, to sign), declined (rejected by HR or the CEO; "Rejected" on
 * screen since 17 October 2026, as the owner calls it), done (the raise is signed).
 */
export const RAISE_REQUEST_STATUSES = ['with_hr', 'with_ceo', 'approved', 'declined', 'done'] as const;
export type RaiseRequestStatus = (typeof RAISE_REQUEST_STATUSES)[number];
export const RAISE_REQUEST_STATUS_LABELS: Record<RaiseRequestStatus, string> = {
  with_hr: 'With HR',
  with_ceo: 'With the CEO',
  approved: 'Approved',
  declined: 'Rejected',
  done: 'Done',
};

/** Open: one per person at a time (of those asked for: a raise HR prepares directly doesn't count, as before). */
export const OPEN_RAISE_REQUEST_STATUSES: readonly RaiseRequestStatus[] = ['with_hr', 'with_ceo', 'approved'];

/**
 * A request's history (owner, 19 October 2026: "after approved, it was not shown in the raise request history too"):
 * approved by the CEO, done (signed) or rejected; for the Raise Requests page's History filter.
 */
export const RAISE_REQUEST_HISTORY_STATUSES: readonly RaiseRequestStatus[] = ['approved', 'done', 'declined'];

/**
 * Where a request came from (owner, 19 October 2026: "when a raise request was sent to the CEO, is showed in approvals not
 * raise requests, and after approved, it was not shown in the raise request history too"): asked for (by the employee,
 * their manager or HR), or prepared directly by HR, a raise entered on the contract in force or a renewal with new pay,
 * which gets its request when it gets the CEO's step, so Raise Requests is the one place for every raise. A direct one
 * follows its raise as an asked one does; HR doesn't reject it (nothing was asked for: the draft is changed and sent, or
 * deleted), it doesn't count as the person's one open request, and only HR, Finance and the CEO see it, as the raise
 * itself is kept from the others until it is signed.
 */
export const RAISE_REQUEST_ORIGINS = ['request', 'direct'] as const;
export type RaiseRequestOrigin = (typeof RAISE_REQUEST_ORIGINS)[number];
export const RAISE_REQUEST_ORIGIN_LABELS: Record<RaiseRequestOrigin, string> = { request: 'Asked for', direct: 'Prepared directly by HR' };

/** A direct request's comment when its raise has no note. */
export const PREPARED_DIRECTLY_COMMENT = 'Prepared directly by HR';

/**
 * What a direct request says, from its raise (owner, 19 October 2026): the raise's reason, its note as the comment (else
 * "Prepared directly by HR"), the raise as suggested, the increase in the gross over the pay it replaces (none when the
 * gross doesn't go up: an allowance changed, or a cut) and the gross it comes to, and its effective date as Effective
 * from (a renewal's start, which may not be a 1st).
 */
export function directRequestFields(raise: { raiseReason: string; note: string | null; grossSalary: number; startDate: string }, previousGross: number) {
  const { amount } = raiseFiguresOf(previousGross, raise.grossSalary);
  return {
    raiseReason: raise.raiseReason,
    comment: raise.note?.trim() || PREPARED_DIRECTLY_COMMENT,
    suggestedIncrease: amount > 0 ? amount : null,
    suggestedPercent: null,
    suggestedGross: raise.grossSalary,
    effectiveFrom: raise.startDate,
  };
}

// ---------- when a requested raise is to take effect ----------

// Effective from (owner, 17 October 2026: "in the request their should be a tab called Effective from"): the month the
// raise is asked from, as the 1st of it (a raise takes effect on the 1st of a month, 16 October 2026), picked when
// asking: this month or a later one, next month unless another is chosen. Required on a new request; a request from
// before has none. HR's approval takes it as the raise's effective date unless HR sets another.

/** How many months the request form offers, this month first. */
export const EFFECTIVE_FROM_CHOICES = 12;

/** The 1st of the month a date is in: 2026-10-17 → 2026-10-01. */
const startOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;

/** The month a request is asked from unless another is chosen: next month's 1st (today 17/10/2026 → 01/11/2026). */
export const defaultEffectiveFrom = (today: string) => nextFirstOfMonth(today);

/** The months a request may be asked from, as their 1sts: this month's (today in Cairo) and the next ones, `count` in all. */
export function effectiveFromChoices(today: string, count = EFFECTIVE_FROM_CHOICES): string[] {
  const out = [startOfMonth(today)];
  while (out.length < count) out.push(nextFirstOfMonth(out[out.length - 1]));
  return out;
}

/** Why a request can't be asked from that date, or null: the 1st of a month, this month (today in Cairo) or a later one. */
export function effectiveFromProblem(effectiveFrom: string, today: string): string | null {
  if (!isFirstOfMonth(effectiveFrom)) return 'Choose the month the raise is to take effect from: a raise takes effect on the 1st of a month, e.g. 01/11/2026.';
  if (effectiveFrom < startOfMonth(today)) return `A raise is asked for from this month or a later one: choose ${shown(startOfMonth(today))} or after.`;
  return null;
}

// ---------- the suggested and decided raise ----------

/**
 * How a raise is suggested on a request, or decided by HR or the CEO (owner, 17 October 2026: "suggest raise amount or
 * percentage"; "Approve with another raise amount or percentge"): an amount in EGP added to the monthly gross, or a
 * percent of the gross. Allowances stay as they are.
 */
export const RAISE_FIGURE_KINDS = ['amount', 'percent'] as const;
export type RaiseFigureKind = (typeof RAISE_FIGURE_KINDS)[number];
export const RAISE_FIGURE_KIND_LABELS: Record<RaiseFigureKind, string> = { amount: 'Amount', percent: 'Percent' };

/** A raise as an amount (EGP a month, added to the gross) or a percent of the gross. */
export interface RaiseFigure {
  kind: RaiseFigureKind;
  value: number;
}

/** A raise of more than this percent is refused: double the gross at most. */
export const MAX_RAISE_PERCENT = 100;

/**
 * What each requester may suggest: the employee for themself and HR an amount or a percent; a direct manager doesn't see
 * salaries, so a percent only (owner's decision, 16 October 2026: "Keep salaries private").
 */
export function suggestionKindsFor(requester: RaiseRequester): readonly RaiseFigureKind[] {
  return requester === 'manager' ? ['percent'] : RAISE_FIGURE_KINDS;
}

/** Why a raise figure can't be used, or null: more than 0, to the piaster (two decimals), a percent up to 100. */
export function raiseFigureProblem(figure: RaiseFigure): string | null {
  const { kind, value } = figure;
  if (!Number.isFinite(value) || value <= 0) {
    return kind === 'amount' ? 'Enter the raise as an amount in EGP of more than 0, e.g. 1,500.' : 'Enter the raise as a percent of more than 0, e.g. 10.';
  }
  if (Math.round(value * 100) !== Math.round(value * 1e6) / 1e4) {
    return kind === 'amount' ? 'Enter the amount to the piaster at most, e.g. 1,500.50.' : 'Enter the percent with two decimals at most, e.g. 7.5.';
  }
  if (kind === 'percent' && value > MAX_RAISE_PERCENT) return `A raise is ${MAX_RAISE_PERCENT}% of the gross at most.`;
  return null;
}

/**
 * The gross after a raise, to the piaster (half up): the amount added to it, or the percent of it added, e.g. 12,345.67
 * + 7.5% = 13,271.60 (12,345.67 × 1.075 = 13,271.595…).
 */
export function raisedGross(gross: number, figure: RaiseFigure): number {
  const cents = Math.round(gross * 100);
  if (figure.kind === 'amount') return (cents + Math.round(figure.value * 100)) / 100;
  const pct = Math.round(figure.value * 100); // hundredths of a percent, exact
  return Math.round((cents * (10_000 + pct)) / 10_000 + 1e-9) / 100;
}

/**
 * By the hour (the gross is the monthly estimate, rate × hours a week × 52 ÷ 12): the hourly rate after a raise, to the
 * piaster: a percent of the rate, or an amount a month spread over the month's hours.
 */
export function raisedHourlyRate(rate: number, hoursPerWeek: number, figure: RaiseFigure): number {
  if (figure.kind === 'percent') return raisedGross(rate, figure);
  const perHour = figure.value / (hoursPerWeek * (52 / 12));
  return Math.round((rate + perHour) * 100 + 1e-9) / 100;
}

/**
 * The pay a raise comes to from the pay before it, allowances as they are: a monthly gross raised by the figure; by the
 * hour, the rate raised (for `hoursPerWeek`, the raise's own hours), the gross being the monthly estimate.
 */
export function raisedPay(
  before: { payBasis: string; grossSalary: number; hourlyRate: number | null; hoursPerWeek: number | null },
  figure: RaiseFigure,
  hoursPerWeek: number | null = before.hoursPerWeek,
): { grossSalary: number; hourlyRate: number | null; hoursPerWeek: number | null } {
  if (before.payBasis === 'hourly' && before.hourlyRate !== null && hoursPerWeek) {
    const hourlyRate = raisedHourlyRate(before.hourlyRate, hoursPerWeek, figure);
    return { grossSalary: monthlyFromHourly(hourlyRate, hoursPerWeek), hourlyRate, hoursPerWeek };
  }
  return { grossSalary: raisedGross(before.grossSalary, figure), hourlyRate: null, hoursPerWeek: null };
}

/** A raise from one gross to another in both figures: the amount, and the percent of what it was (two decimals; null from 0). */
export function raiseFiguresOf(from: number, to: number): { amount: number; percent: number | null } {
  const amount = (Math.round(to * 100) - Math.round(from * 100)) / 100;
  return { amount, percent: from > 0 ? Math.round((amount / from) * 10_000) / 100 : null };
}

// ---------- the decisions ----------

/**
 * HR's decision on a request, then the CEO's on its raise (owner, 17 October 2026: "Approve - Approve with another raise
 * amount or percentge - Reject, and add a comment"): approve it as suggested (HR) or as it reached them (the CEO), approve
 * it with another raise, or reject it, always with a comment. HR's approval prepares the raise and sends it to the CEO;
 * the CEO's approval with another raise changes the raise's pay to it and approves it in the same step.
 */
export const RAISE_DECISIONS = ['approve', 'approve_other', 'reject'] as const;
export type RaiseDecision = (typeof RAISE_DECISIONS)[number];
export const RAISE_DECISION_LABELS: Record<RaiseDecision, string> = { approve: 'Approve', approve_other: 'Approve with another raise', reject: 'Reject' };
/** As the log says it. */
export const RAISE_DECISION_DONE_LABELS: Record<RaiseDecision, string> = { approve: 'Approved', approve_other: 'Approved with another raise', reject: 'Rejected' };

/**
 * HR's decision when it prepares the raise in the whole raise form, by the pay it sets: as suggested when the gross is
 * the one the suggestion came to, else with another raise.
 */
export function hrDecisionOf(suggestedGross: number | null, newGross: number): 'approve' | 'approve_other' {
  return suggestedGross !== null && Math.round(suggestedGross * 100) === Math.round(newGross * 100) ? 'approve' : 'approve_other';
}

// ---------- the log ----------

/**
 * Each step of a request, in order, as it is logged on it (owner, 17 October 2026: "all the request steps to be logged in
 * the request"): submitted; HR's decision; the raise prepared from it (the way, the effective date); sent to the CEO;
 * the CEO's decision; returned to HR; the raise changed after its approval (back to HR to send again); signed (the
 * request is done); a signing undone; the raise draft deleted (the request back with HR).
 */
export const RAISE_REQUEST_STEP_KINDS = ['submitted', 'hr_decision', 'prepared', 'sent', 'ceo_decision', 'returned', 'changed', 'signed', 'unsigned', 'raise_deleted'] as const;
export type RaiseRequestStepKind = (typeof RAISE_REQUEST_STEP_KINDS)[number];
export const RAISE_REQUEST_STEP_LABELS: Record<RaiseRequestStepKind, string> = {
  submitted: 'Submitted',
  hr_decision: "HR's decision",
  prepared: 'Raise prepared',
  sent: 'Sent to the CEO',
  ceo_decision: "The CEO's decision",
  returned: 'Returned to HR',
  changed: 'Raise changed',
  signed: 'Signed',
  unsigned: 'Signing undone',
  raise_deleted: 'Raise deleted',
};
