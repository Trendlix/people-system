import {
  advanceBalance,
  type AdjustmentKind,
  type AdjustmentStatus,
  type AdjustmentType,
  type AdvanceBalance,
  type AdvanceKind,
  type AdvanceStatus,
} from '@trendlix/shared';
import { fromDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { refOf, type UserRef } from './people.js';

// Additions and deductions, advances and loans as the API sends them (owner, 17 October 2026): months YYYY-MM, dates
// YYYY-MM-DD, money as numbers to the piaster. Salary data: HR, Finance and the CEO only.

export const ADJUSTMENT = 'payroll_adjustment';
export const ADVANCE = 'payroll_advance';

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
  recoveries: { orderBy: [{ month: 'asc' }, { createdAt: 'asc' }], select: { id: true, month: true, amount: true, status: true } },
} satisfies Prisma.PayrollAdvanceInclude;

export type AdvanceRow = Prisma.PayrollAdvanceGetPayload<{ include: typeof ADVANCE_INCLUDE }>;

/** A deduction recovering an advance or loan. */
export interface RecoveryView {
  id: string;
  month: string;
  amount: number;
  status: AdjustmentStatus;
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
  createdBy: UserRef | null;
  createdAt: Date;
  recoveries: RecoveryView[];
}

export const recoveriesOf = (a: Pick<AdvanceRow, 'recoveries'>): RecoveryView[] =>
  // a recovery always has its amount (only a bonus or penalty in days has none)
  a.recoveries.map((r) => ({ id: r.id, month: monthOfDate(r.month), amount: r.amount?.toNumber() ?? 0, status: r.status as AdjustmentStatus }));

/** An advance's balance from its recoveries as they are saved. */
export const balanceOf = (a: Pick<AdvanceRow, 'amount' | 'recoveries'>): AdvanceBalance => advanceBalance(a.amount.toNumber(), recoveriesOf(a));

export function advanceView(a: AdvanceRow, names: ReadonlyMap<string, UserRef>): AdvanceView {
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
    createdBy: refOf(names, a.createdBy),
    createdAt: a.createdAt,
    ...balanceOf(a),
    recoveries: recoveriesOf(a),
  };
}
