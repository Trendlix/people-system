import type { AllowanceBasis } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';

// A contract's or an offer's allowances as the API sends them and as the salary is worked out from them: each with the
// name and treatment its kind had when the record was drafted or last changed (the snapshot), and an amount a month;
// one paid per client account (25 October 2026) with no amount (0): eligibility only, payroll paying the accounts.

/** An allowance as sent: its kind and its amount a month (none for a kind paid per client account). */
export interface AllowanceInput {
  allowanceTypeId: string;
  amount?: number | null;
}

/** An allowance with its kind's name and treatment, as a contract or an offer keeps it. */
export interface AllowanceSnapshot {
  allowanceTypeId: string;
  nameEn: string;
  nameAr: string;
  taxable: boolean;
  insured: boolean;
  /** Fixed, or per client account (its amount 0). */
  basis: AllowanceBasis;
  amount: number;
}

/** A stored allowance row (contract_allowances, offer_allowances). */
export interface AllowanceRow {
  allowanceTypeId: string;
  nameEn: string;
  nameAr: string;
  taxable: boolean;
  insured: boolean;
  basis: string;
  amount: Prisma.Decimal;
}

/** How a record's allowances are read: in the kinds' order, then by name. */
export const ALLOWANCE_ORDER = [{ allowanceType: { sortOrder: 'asc' } }, { nameEn: 'asc' }] satisfies Prisma.ContractAllowanceOrderByWithRelationInput[];

/** A stored row as the API sends it, the amount as a number. */
export function allowanceView(a: AllowanceRow): AllowanceSnapshot {
  return { allowanceTypeId: a.allowanceTypeId, nameEn: a.nameEn, nameAr: a.nameAr, taxable: a.taxable, insured: a.insured, basis: a.basis as AllowanceBasis, amount: a.amount.toNumber() };
}

/** The total a month of some allowances, to the piaster. */
export function allowancesTotal(rows: readonly { amount: number }[]): number {
  return rows.reduce((cents, a) => cents + Math.round(a.amount * 100), 0) / 100;
}

/** What Prisma writes for a record's allowances. */
export function allowanceData(rows: readonly AllowanceSnapshot[]) {
  return rows.map(({ allowanceTypeId, nameEn, nameAr, taxable, insured, basis, amount }) => ({ allowanceTypeId, nameEn, nameAr, taxable, insured, basis, amount }));
}
