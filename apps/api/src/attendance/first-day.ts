import { FIRST_DAY_LOOK_AHEAD, isFirstWorkingDay } from '@trendlix/shared';
import { addDays, fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// A new employee's first day (owner, 27 October 2026: "a new employee when checked in in his first day move the checkin to
// 9am automatically to prevent delay in instructions"; asked, "Counted from the shift start"): which day it is, read from
// the employment and the official holidays (packages/shared check-in.ts firstWorkingDayFrom), for a press
// (check-in.service.ts) and a correction made again over the day (correction-days.service.ts); the recount
// (hours-by-pairs.service.ts) reads every employment's at once with the same shared rule. Its own file, so the services
// that need it don't import each other.

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Whether `date` (YYYY-MM-DD) is the first working day of an employment: the shift's first working day on or after its
 * join date, official holidays skipped, within two weeks of it. A date outside those two weeks is never one, and asks the
 * database nothing.
 */
export async function firstWorkingDayOn(db: Db, job: { joinDate: Date; shift: { workingDays: number[] } | null }, date: string): Promise<boolean> {
  const joined = fromDateOnly(job.joinDate);
  const until = addDays(joined, FIRST_DAY_LOOK_AHEAD);
  if (date < joined || date > until) return false;
  const holidays = await db.holiday.findMany({ where: { date: { gte: toDateOnly(joined), lte: toDateOnly(until) } }, select: { date: true } });
  return isFirstWorkingDay(date, joined, job.shift?.workingDays ?? null, holidays.map((h) => fromDateOnly(h.date)));
}
