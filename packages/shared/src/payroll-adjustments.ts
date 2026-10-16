// Additions and deductions, advances and loans, and what is still unsettled (owner, 17 October 2026: "make the Payroll in
// the side tab a main title below it - Unsettled - Additions / Deductions"). Asked, the owner chose:
// - Additions / Deductions: one-off amounts per employee and month, not recurring. Additions: a bonus, commission,
//   incentive or correction (taxed), a reimbursement (not taxed), or other (taxed or not, as HR chooses). Deductions,
//   all taken after tax: a penalty, damage or loss, an advance's recovery (linked to the advance), a loan's installment
//   (linked to the loan), or other. Each is pending until the month's run is approved with it (applied), or cancelled.
// - Unsettled: the runs not yet paid, the lines on hold not paid out since, the final settlements of people who left,
//   and the advances and loans still being recovered.
// The amounts are EGP to the piaster. A run takes a line's additions and deductions with adjustmentSums (payroll.ts):
// the taxed additions into the gross, the untaxed ones after tax, the deductions after tax.

export const ADJUSTMENT_KINDS = ['addition', 'deduction'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_KIND_LABELS: Record<AdjustmentKind, string> = { addition: 'Addition', deduction: 'Deduction' };

export const ADDITION_TYPES = ['bonus', 'commission', 'incentive', 'correction', 'reimbursement', 'other'] as const;
export type AdditionType = (typeof ADDITION_TYPES)[number];

export const DEDUCTION_TYPES = ['penalty', 'damage_loss', 'advance_recovery', 'loan_installment', 'other'] as const;
export type DeductionType = (typeof DEDUCTION_TYPES)[number];

export type AdjustmentType = AdditionType | DeductionType;

/** The types of each kind, in the order the form lists them. */
export const ADJUSTMENT_TYPES: { addition: readonly AdditionType[]; deduction: readonly DeductionType[] } = {
  addition: ADDITION_TYPES,
  deduction: DEDUCTION_TYPES,
};

export const ADDITION_TYPE_LABELS: Record<AdditionType, string> = {
  bonus: 'Bonus',
  commission: 'Commission',
  incentive: 'Incentive',
  correction: 'Correction',
  reimbursement: 'Reimbursement',
  other: 'Other addition',
};

export const DEDUCTION_TYPE_LABELS: Record<DeductionType, string> = {
  penalty: 'Penalty',
  damage_loss: 'Damage or loss',
  advance_recovery: 'Advance recovery',
  loan_installment: 'Loan installment',
  other: 'Other deduction',
};

/** The types as the Arabic payslip names them. */
export const ADDITION_TYPE_LABELS_AR: Record<AdditionType, string> = {
  bonus: 'مكافأة',
  commission: 'عمولة',
  incentive: 'حافز',
  correction: 'تصحيح',
  reimbursement: 'استرداد مصروفات',
  other: 'إضافة أخرى',
};

export const DEDUCTION_TYPE_LABELS_AR: Record<DeductionType, string> = {
  penalty: 'جزاء',
  damage_loss: 'تلفيات أو فقد',
  advance_recovery: 'استرداد سلفة',
  loan_installment: 'قسط قرض',
  other: 'استقطاع آخر',
};

/** A type's Arabic name, by its kind: "مكافأة", "استقطاع آخر"; anything else as it is. */
export function adjustmentTypeLabelAr(kind: string, type: string): string {
  const labels: Record<string, string> = kind === 'deduction' ? DEDUCTION_TYPE_LABELS_AR : ADDITION_TYPE_LABELS_AR;
  return labels[type] ?? type;
}

/** A type's name, by its kind: "Bonus", "Other deduction"; anything else as it is. */
export function adjustmentTypeLabel(kind: string, type: string): string {
  const labels: Record<string, string> = kind === 'deduction' ? DEDUCTION_TYPE_LABELS : ADDITION_TYPE_LABELS;
  return labels[type] ?? type;
}

/** Whether `type` is one of `kind`'s types. */
export function isAdjustmentType(kind: AdjustmentKind, type: string): type is AdjustmentType {
  return (ADJUSTMENT_TYPES[kind] as readonly string[]).includes(type);
}

/** Whether an addition of each type is taxed (the owner's list); null: HR chooses (Other). */
export const ADDITION_TAXED: Record<AdditionType, boolean | null> = {
  bonus: true,
  commission: true,
  incentive: true,
  correction: true,
  reimbursement: false,
  other: null,
};

/**
 * Whether an addition or deduction is taxed: an addition as its type says, Other as HR chose (null when not chosen,
 * which is refused); a deduction never, as every deduction is taken after tax.
 */
export function adjustmentTaxed(kind: AdjustmentKind, type: string, chosen: boolean | null | undefined): boolean | null {
  if (kind === 'deduction') return false;
  const fixed = ADDITION_TAXED[type as AdditionType];
  if (fixed === undefined) return null;
  return fixed ?? (typeof chosen === 'boolean' ? chosen : null);
}

export const ADJUSTMENT_STATUSES = ['pending', 'applied', 'cancelled'] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  pending: 'Pending',
  applied: 'Applied',
  cancelled: 'Cancelled',
};

// ---------- advances and loans ----------

export const ADVANCE_KINDS = ['advance', 'loan'] as const;
export type AdvanceKind = (typeof ADVANCE_KINDS)[number];

export const ADVANCE_KIND_LABELS: Record<AdvanceKind, string> = { advance: 'Advance', loan: 'Loan' };

export const ADVANCE_STATUSES = ['open', 'settled'] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = { open: 'Being recovered', settled: 'Settled' };

/** The deduction that recovers each kind: an advance's recovery, a loan's installment. */
export const RECOVERY_TYPE: Record<AdvanceKind, DeductionType> = { advance: 'advance_recovery', loan: 'loan_installment' };

/** The kind of advance a deduction recovers: an advance for an advance's recovery, a loan for an installment; else null. */
export function recoveredKind(kind: string, type: string): AdvanceKind | null {
  if (kind !== 'deduction') return null;
  if (type === 'advance_recovery') return 'advance';
  if (type === 'loan_installment') return 'loan';
  return null;
}

// ---------- sums ----------

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100 + 0;

/** Amounts added to the piaster, without the noise of adding fractions. */
export const sumAmounts = (values: readonly number[]): number => money(values.reduce((s, v) => s + cents(v), 0));

/** What a sum reads of an addition or deduction. */
export interface AdjustmentAmount {
  kind: AdjustmentKind;
  taxed: boolean;
  amount: number;
  status: AdjustmentStatus;
}

/** A line's (or a person's, a month's) additions and deductions summed, the cancelled ones left out. */
export interface AdjustmentSums {
  /** Taxed additions: in the gross, taxed with the pay. */
  taxedAdditions: number;
  /** Untaxed additions: added after tax. */
  untaxedAdditions: number;
  additions: number;
  /** Every deduction: taken after tax. */
  deductions: number;
  /** The pay's change: the additions less the deductions (before the tax the taxed additions bring). */
  net: number;
  /** How many were summed. */
  count: number;
}

/**
 * The additions and deductions summed, leaving out those cancelled: what a run adds to a line's pay (payrollLine: the taxed
 * additions into the gross, the untaxed after tax, the deductions after tax), and the totals the page shows.
 */
export function adjustmentSums(list: readonly AdjustmentAmount[]): AdjustmentSums {
  const counted = list.filter((a) => a.status !== 'cancelled');
  const taxed = counted.filter((a) => a.kind === 'addition' && a.taxed).map((a) => a.amount);
  const untaxed = counted.filter((a) => a.kind === 'addition' && !a.taxed).map((a) => a.amount);
  const deductions = sumAmounts(counted.filter((a) => a.kind === 'deduction').map((a) => a.amount));
  const additions = sumAmounts([...taxed, ...untaxed]);
  return {
    taxedAdditions: sumAmounts(taxed),
    untaxedAdditions: sumAmounts(untaxed),
    additions,
    deductions,
    net: money(cents(additions) - cents(deductions)),
    count: counted.length,
  };
}

/** Where an advance or loan stands: what was recovered (applied), what is planned (pending), what is outstanding. */
export interface AdvanceBalance {
  recovered: number;
  planned: number;
  /** The amount less what was recovered, never below 0. */
  outstanding: number;
  /** What is outstanding with no recovery planned for it yet. */
  unplanned: number;
}

/**
 * An advance's or a loan's balance from the deductions linked to it: the applied ones count as recovered, the pending
 * ones as planned, the cancelled ones not at all.
 */
export function advanceBalance(amount: number, recoveries: readonly Pick<AdjustmentAmount, 'amount' | 'status'>[]): AdvanceBalance {
  const recovered = sumAmounts(recoveries.filter((r) => r.status === 'applied').map((r) => r.amount));
  const planned = sumAmounts(recoveries.filter((r) => r.status === 'pending').map((r) => r.amount));
  const outstanding = money(Math.max(0, cents(amount) - cents(recovered)));
  return { recovered, planned, outstanding, unplanned: money(Math.max(0, cents(outstanding) - cents(planned))) };
}

/** Whether nothing is outstanding: settled automatically. */
export const isRecovered = (b: Pick<AdvanceBalance, 'outstanding'>) => cents(b.outstanding) <= 0;

// ---------- final settlements and held pay ----------

export const FINAL_SETTLEMENT_STATUSES = ['open', 'settled'] as const;
export type FinalSettlementStatus = (typeof FINAL_SETTLEMENT_STATUSES)[number];

/** How held pay was paid out since: by a transfer of its own, in cash, or with a later run. */
export const HOLD_RELEASE_METHODS = ['bank_transfer', 'cash', 'later_run'] as const;
export type HoldReleaseMethod = (typeof HOLD_RELEASE_METHODS)[number];

export const HOLD_RELEASE_METHOD_LABELS: Record<HoldReleaseMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  later_run: 'With a later run',
};

/** Whole days from one day to another (YYYY-MM-DD), never below 0: how long a final settlement has been open. */
export function daysBetween(from: string, to: string): number {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}
