import type { ContractFacts } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

// What the Employees list sends of a current employment's contract, for the contract status it shows in place of the
// employee code (owner, 21 October 2026: "instead of the Emp code, add contract status"; packages/shared
// contract-status.ts): the version in force, else the latest draft, with its status, form and dates. Nothing of its pay.

/** A current employment's versions the status reads: the signed (active) ones and the drafts, newest first. */
export const STATUS_CONTRACTS = {
  where: { status: { in: ['active', 'draft'] } },
  orderBy: { version: 'desc' },
  select: { status: true, form: true, startDate: true, endDate: true, approval: true },
} satisfies Prisma.Employment$contractsArgs;

/** The approved ending, if any: the CEO approved it, the notice runs to its last working day. */
export const STATUS_ENDING = {
  where: { status: 'approved' },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { lastWorkingDay: true },
} satisfies Prisma.Employment$endingsArgs;

type StatusContract = Prisma.ContractGetPayload<{ select: (typeof STATUS_CONTRACTS)['select'] }>;

/**
 * The contract the status is about: the newest signed version (in force: signing one replaces the one before), else the
 * newest draft; null for none. A draft that changes the pay (a raise, a renewal with new pay: it has the CEO's step) stays
 * with those who see salaries until it is signed, as on the Employment tab (ContractsService.list).
 */
export function contractFactsOf(rows: readonly StatusContract[], seesSalary: boolean): ContractFacts | null {
  const c = rows.find((r) => r.status === 'active') ?? rows.find((r) => r.status === 'draft' && (seesSalary || r.approval === null));
  if (!c) return null;
  return { status: c.status, form: c.form, startDate: fromDateOnly(c.startDate)!, endDate: fromDateOnly(c.endDate) };
}
