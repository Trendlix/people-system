import type { AdjustmentStatus } from '@trendlix/shared';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { monthName } from '../list';

// The unused annual leave paid on leaving (Labour Law 14/2025, Art. 125: "فإذا انتهت علاقة العمل قبل استنفاد العامل رصيد
// إجازته السنوية استحق الأجر المقابل لهذا الرصيد"; owner, 18 October 2026: "can you apply the leaves according to the
// law?"): a final settlement lists the days unused on the last working day as "Unused leave to pay", with the day rate
// (the gross ÷ the payroll's day divisor) and the amount; HR records it paid, an Unused leave paid addition on the final
// month's payroll (or the next one open). Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** GET /payroll/unsettled's unused leave of a final settlement (leave/leave-settlement.service.ts in the API). */
export interface UnusedLeave {
  /** The year of the last working day, whose balance it is. */
  year: number;
  days: number;
  dayRate: number;
  amount: number;
  /** Once HR recorded it paid: the Unused leave paid addition, as Additions / Deductions has it now. */
  paid: { adjustmentId: string; month: string; status: AdjustmentStatus; days: number; amount: number } | null;
}

const daysText = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Whether HR can record it paid now: days to pay, and no addition for them, or one cancelled since. */
export const canPayUnusedLeave = (u: Pick<UnusedLeave, 'days' | 'paid'>) => u.days > 0 && (!u.paid || u.paid.status === 'cancelled');

/** "5 days at EGP 500.00 a day", and where its payment stands. */
export function unusedLeaveText(u: UnusedLeave): { figures: string; status: string | null } {
  const figures = `${daysText(u.days)} of ${u.year}'s annual leave at ${formatEgp(u.dayRate)} a day`;
  if (!u.paid) return { figures, status: u.days > 0 ? null : 'Nothing unused: no leave to pay.' };
  const month = monthName(u.paid.month);
  if (u.paid.status === 'applied') return { figures, status: `Paid with the ${month} payroll: ${formatEgp(u.paid.amount)}.` };
  if (u.paid.status === 'cancelled') return { figures, status: `Its addition to the ${month} payroll was cancelled: record it paid again.` };
  return { figures, status: `Recorded: ${formatEgp(u.paid.amount)} added to the ${month} payroll as Unused leave paid.` };
}
