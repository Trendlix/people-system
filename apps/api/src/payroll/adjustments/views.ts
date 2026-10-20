import {
  advanceBalance,
  type AdjustmentKind,
  type AdjustmentStatus,
  type AdjustmentType,
  type AdvanceBalance,
  type AdvanceKind,
  type AdvanceSettledHow,
  type AdvanceStatus,
} from '@trendlix/shared';
import { fromDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { placeOf } from '../../reimbursements/views.js';
import { refOf, type UserRef } from './people.js';
import { recurringStatus, type RecurringStatus } from './plans.js';

// Additions and deductions, advances and loans as the API sends them (owner, 17 October 2026): months YYYY-MM, dates
// YYYY-MM-DD, money as numbers to the piaster. Salary data: HR, Finance and the CEO only.

export const ADJUSTMENT = 'payroll_adjustment';
export const ADVANCE = 'payroll_advance';
export const RECURRING = 'recurring_deduction';

const PERSON = { select: { id: true, employeeCode: true, fullNameEn: true } } as const;
const USER = { select: { id: true, email: true } } as const;

/** What an addition or deduction is shown with. */
export const ADJUSTMENT_INCLUDE = {
  employee: PERSON,
  advance: { select: { id: true, kind: true, givenOn: true, amount: true } },
  createdBy: USER,
  cancelledBy: USER,
} satisfies Prisma.PayrollAdjustmentInclude;

export type AdjustmentRow = Prisma.PayrollAdjustmentGetPayload<{ include: typeof ADJUSTMENT_INCLUDE }>;

export interface PersonRef {
  id: string;
  employeeCode: string;
  name: string;
}

export const personOf = (e: { id: string; employeeCode: string; fullNameEn: string }): PersonRef => ({ id: e.id, employeeCode: e.employeeCode, name: e.fullNameEn });

export interface AdjustmentView {
  id: string;
  employee: PersonRef;
  month: string;
  kind: AdjustmentKind;
  type: AdjustmentType;
  taxed: boolean;
  /**
   * A Recurring deduction of a recurring deduction ticked "Deducted before tax" (owner, 20 October 2026: "Before Tax i
   * think"): it lowers the taxable pay before the income tax. False for every other, which is after tax.
   */
  beforeTax: boolean;
  /**
   * EGP. One in days (owner, 17 October 2026): what the month's run worked it out to, as its line has it, or once
   * applied what the line paid; null while no run has it (no run yet, or not on it).
   */
  amount: number | null;
  /** A Bonus (days) or a Penalty (days): its days, whole or half; null for the others. */
  days: number | null;
  reason: string;
  /** The advance or loan an advance's recovery or a loan's installment recovers. */
  advance: { id: string; kind: AdvanceKind; givenOn: string; amount: number } | null;
  status: AdjustmentStatus;
  /** Applied: the run line it was paid on. */
  lineId: string | null;
  appliedAt: Date | null;
  createdBy: UserRef | null;
  createdAt: Date;
  updatedAt: Date;
  cancelledBy: UserRef | null;
  cancelledAt: Date | null;
}

export const monthOfDate = (d: Date) => fromDateOnly(d).slice(0, 7);

/**
 * An addition or deduction as the API sends it; `worked`: what the month's run worked the ones in days out to, by id
 * (an applied one has its own).
 */
export function adjustmentView(a: AdjustmentRow, names: ReadonlyMap<string, UserRef>, worked: ReadonlyMap<string, number> = new Map()): AdjustmentView {
  return {
    id: a.id,
    employee: personOf(a.employee),
    month: monthOfDate(a.month),
    kind: a.kind as AdjustmentKind,
    type: a.type as AdjustmentType,
    taxed: a.taxed,
    beforeTax: a.beforeTax,
    amount: a.amount?.toNumber() ?? worked.get(a.id) ?? null,
    days: a.days?.toNumber() ?? null,
    reason: a.reason,
    advance: a.advance && { id: a.advance.id, kind: a.advance.kind as AdvanceKind, givenOn: fromDateOnly(a.advance.givenOn), amount: a.advance.amount.toNumber() },
    status: a.status as AdjustmentStatus,
    lineId: a.lineId,
    appliedAt: a.appliedAt,
    createdBy: refOf(names, a.createdBy),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    cancelledBy: refOf(names, a.cancelledBy),
    cancelledAt: a.cancelledAt,
  };
}

// ---------- advances and loans ----------

/** What an advance or loan is shown with: its person and the deductions that recover it, oldest month first. */
export const ADVANCE_INCLUDE = {
  employee: PERSON,
  createdBy: USER,
  settledBy: USER,
  recoveries: { orderBy: [{ month: 'asc' }, { createdAt: 'asc' }], select: { id: true, month: true, amount: true, status: true, reason: true } },
} satisfies Prisma.PayrollAdvanceInclude;

export type AdvanceRow = Prisma.PayrollAdvanceGetPayload<{ include: typeof ADVANCE_INCLUDE }>;

/** A deduction recovering an advance or loan. */
export interface RecoveryView {
  id: string;
  month: string;
  amount: number;
  status: AdjustmentStatus;
}

/**
 * An installment (owner, 18 October 2026): a deduction recovering the advance or loan, made from its plan or linked by
 * hand. Locked: applied, or its month's run is with the CEO, approved or paid, so HR can't move or change it.
 */
export interface InstallmentView extends RecoveryView {
  locked: boolean;
}

export interface AdvanceView extends AdvanceBalance {
  id: string;
  employee: PersonRef;
  kind: AdvanceKind;
  amount: number;
  givenOn: string;
  reason: string;
  plan: string | null;
  status: AdvanceStatus;
  settledAt: Date | null;
  /** Null when settled automatically (nothing outstanding), or still open. */
  settledBy: UserRef | null;
  settledNote: string | null;
  /** How it was settled (18 October 2026): recovered, deducted from the final settlement, waived or paid back; null while open. */
  settledHow: AdvanceSettledHow | null;
  createdBy: UserRef | null;
  createdAt: Date;
  recoveries: RecoveryView[];
  /** Every deduction linked to it, in month order, with whether HR may still move or change it. */
  installments: InstallmentView[];
  /** The first one still to be deducted; null when none is. */
  nextInstallment: { month: string; amount: number } | null;
}

export const recoveriesOf = (a: Pick<AdvanceRow, 'recoveries'>): RecoveryView[] =>
  // a recovery always has its amount (only a bonus or penalty in days has none)
  a.recoveries.map((r) => ({ id: r.id, month: monthOfDate(r.month), amount: r.amount?.toNumber() ?? 0, status: r.status as AdjustmentStatus }));

/** An advance's balance from its recoveries as they are saved. */
export const balanceOf = (a: Pick<AdvanceRow, 'amount' | 'recoveries'>): AdvanceBalance => advanceBalance(a.amount.toNumber(), recoveriesOf(a));

/**
 * An advance or loan as the API sends it; `locked`: the months (YYYY-MM) whose run is with the CEO, approved or paid,
 * whose installments HR can't move or change.
 */
export function advanceView(a: AdvanceRow, names: ReadonlyMap<string, UserRef>, locked: ReadonlySet<string> = new Set()): AdvanceView {
  const recoveries = recoveriesOf(a);
  const next = recoveries.find((r) => r.status === 'pending') ?? null;
  return {
    id: a.id,
    employee: personOf(a.employee),
    kind: a.kind as AdvanceKind,
    amount: a.amount.toNumber(),
    givenOn: fromDateOnly(a.givenOn),
    reason: a.reason,
    plan: a.plan,
    status: a.status as AdvanceStatus,
    settledAt: a.settledAt,
    settledBy: refOf(names, a.settledBy),
    settledNote: a.settledNote,
    settledHow: a.settledHow as AdvanceSettledHow | null,
    createdBy: refOf(names, a.createdBy),
    createdAt: a.createdAt,
    ...balanceOf(a),
    recoveries,
    installments: recoveries.map((r) => ({ ...r, locked: r.status === 'applied' || locked.has(r.month) })),
    nextInstallment: next && { month: next.month, amount: next.amount },
  };
}

// ---------- recurring deductions ----------

/** What a recurring deduction is shown with: the employee and where they work (their latest employment), and its months' deductions. */
export const RECURRING_INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      fullNameEn: true,
      employments: {
        orderBy: [{ endDate: { sort: 'desc', nulls: 'first' } }, { joinDate: 'desc' }],
        take: 1,
        select: { department: { select: { nameEn: true, parent: { select: { nameEn: true } } } } },
      },
    },
  },
  deductions: { orderBy: [{ month: 'asc' }], select: { id: true, month: true, amount: true, status: true } },
  // the employee's written consent (Labour Law Art. 114; owner, 18 October 2026): who recorded it, and the signed consent
  consentRecordedBy: USER,
  consentPaperwork: { select: { id: true, fileName: true } },
} satisfies Prisma.RecurringDeductionInclude;

export type RecurringRow = Prisma.RecurringDeductionGetPayload<{ include: typeof RECURRING_INCLUDE }>;

/** A recurring deduction's months as the shared rules take them (YYYY-MM). */
export const recurringMonths = (r: { startMonth: Date; endMonth: Date | null; stoppedFrom: Date | null }) => ({
  startMonth: monthOfDate(r.startMonth),
  endMonth: r.endMonth && monthOfDate(r.endMonth),
  stoppedFrom: r.stoppedFrom && monthOfDate(r.stoppedFrom),
});

export interface RecurringDeductionView {
  id: string;
  /** Where they work as their latest employment has it: a team as its department and the team. */
  employee: { id: string; employeeCode: string; fullNameEn: string; department: string | null; team: string | null };
  name: string;
  /** EGP a month. */
  amount: number;
  startMonth: string;
  endMonth: string | null;
  stoppedFrom: string | null;
  stopNote: string | null;
  /**
   * "Deducted before tax (lowers taxable pay)" (owner, 20 October 2026, asked whether the employee's medical share is
   * taken before or after tax: "Before Tax i think"): its months' Recurring deductions lower the taxable pay before the
   * income tax. False, as it is by default: after tax.
   */
  beforeTax: boolean;
  status: RecurringStatus;
  /** Its months' Recurring deductions, oldest first: added by each month's run. */
  deducted: { month: string; amount: number; status: AdjustmentStatus }[];
  /**
   * The employee's written consent (Labour Law 14/2025 Art. 114; owner, 18 October 2026, after reading the law: "record
   * the consent"): when HR recorded it was on file and who, and the signed consent if HR attached it (a paper in the
   * employee file). Null: not recorded, as on those set up before then.
   */
  consent: { recordedAt: Date; recordedBy: UserRef | null; paper: { id: string; fileName: string } | null } | null;
  createdAt: Date;
}

/** A recurring deduction as the API sends it; `current`: this month, YYYY-MM; `names`: the users' names, by id. */
export function recurringView(r: RecurringRow, current: string, names: ReadonlyMap<string, UserRef> = new Map()): RecurringDeductionView {
  const months = recurringMonths(r);
  const d = r.employee.employments[0]?.department ?? null;
  return {
    id: r.id,
    employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullNameEn: r.employee.fullNameEn, ...placeOf(d) },
    name: r.name,
    amount: r.amount.toNumber(),
    ...months,
    stopNote: r.stopNote,
    beforeTax: r.beforeTax,
    status: recurringStatus(months, current),
    deducted: r.deductions.map((x) => ({ month: monthOfDate(x.month), amount: x.amount?.toNumber() ?? 0, status: x.status as AdjustmentStatus })),
    consent: r.consentRecordedAt && { recordedAt: r.consentRecordedAt, recordedBy: refOf(names, r.consentRecordedBy), paper: r.consentPaperwork },
    createdAt: r.createdAt,
  };
}
