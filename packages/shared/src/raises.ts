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
// or prepares the raise from it, and the CEO's decision on that raise is the request's. Pure code, for the API and the
// screens.

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

/** Why the pay changes. */
export const RAISE_REASONS = ['annual', 'promotion', 'adjustment', 'other'] as const;
export type RaiseReason = (typeof RAISE_REASONS)[number];
export const RAISE_REASON_LABELS: Record<RaiseReason, string> = { annual: 'Annual raise', promotion: 'Promotion', adjustment: 'Adjustment', other: 'Other' };
export const RAISE_REASON_LABELS_AR: Record<RaiseReason, string> = { annual: 'زيادة سنوية', promotion: 'ترقية', adjustment: 'تعديل الأجر', other: 'أخرى' };

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
 * A request's progress, HR then the CEO: with HR (new, or returned by the CEO), with the CEO (HR prepared the raise and
 * sent it), approved (by the CEO, to sign), declined (by HR or the CEO), done (the raise is signed).
 */
export const RAISE_REQUEST_STATUSES = ['with_hr', 'with_ceo', 'approved', 'declined', 'done'] as const;
export type RaiseRequestStatus = (typeof RAISE_REQUEST_STATUSES)[number];
export const RAISE_REQUEST_STATUS_LABELS: Record<RaiseRequestStatus, string> = {
  with_hr: 'With HR',
  with_ceo: 'With the CEO',
  approved: 'Approved',
  declined: 'Declined',
  done: 'Done',
};

/** Open: one per person at a time. */
export const OPEN_RAISE_REQUEST_STATUSES: readonly RaiseRequestStatus[] = ['with_hr', 'with_ceo', 'approved'];
