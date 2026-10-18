import type { PayrollStatus } from '@trendlix/shared';
import { fromDateOnly, toDateOnly } from '../../common/date-only.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { firstDay, monthName } from '../months.js';
import { STATUS_TEXT } from '../status.js';

// The months whose additions and deductions no longer change (owner, 17 October 2026): from the CEO's step on, the run
// is what the CEO approves; once approved or paid, it never changes. Installments and recurring deductions (owner, 18
// October 2026) are moved, changed, stopped and cancelled only in the other months.

/** The months given (YYYY-MM) whose run is with the CEO, approved or paid, with its status. */
export async function lockedMonths(db: Prisma.TransactionClient, months: readonly string[]): Promise<Map<string, PayrollStatus>> {
  const unique = [...new Set(months)];
  if (!unique.length) return new Map();
  const runs = await db.payrollRun.findMany({
    where: { month: { in: unique.map((m) => toDateOnly(firstDay(m))) }, status: { not: 'draft' } },
    select: { month: true, status: true },
  });
  return new Map(runs.map((r) => [fromDateOnly(r.month).slice(0, 7), r.status as PayrollStatus]));
}

/** "The October 2026 payroll is approved", to start a message with. */
export const payrollIs = (month: string, status: PayrollStatus) => `The ${monthName(month)} payroll ${STATUS_TEXT[status]}`;

/** The earliest of the months locked, with its status; null when none is. */
export function firstLocked(locked: ReadonlyMap<string, PayrollStatus>): { month: string; status: PayrollStatus } | null {
  const month = [...locked.keys()].sort()[0];
  return month === undefined ? null : { month, status: locked.get(month)! };
}
