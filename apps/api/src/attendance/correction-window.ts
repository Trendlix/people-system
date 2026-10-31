import { CORRECTION_ASK_LOOK_BACK, CORRECTION_ASK_WORKING_DAYS, correctionAskFrom } from '@trendlix/shared';
import { addDays, fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// How long an employee can ask to correct a day (owner, 31 October 2026: "asking for correction is to be locked after 2
// working days, i cant ask for correction after a week for example"): read from their shift's working days, the official
// holidays and their approved leave (packages/shared correctionAskFrom), for a correction asked (corrections.service.ts)
// and for My Attendance and the app, which offer it only on the days still open. HR correcting a day directly isn't held
// to it. Its own file, so the services that need it don't import each other.

type Db = PrismaService | Prisma.TransactionClient;

/** The days an employee can still ask to correct today: from `from` (YYYY-MM-DD) to today, within `workingDays` of the day. */
export interface CorrectionAskWindow {
  from: string;
  workingDays: number;
}

/**
 * The earliest day `employeeId` can still ask to correct on `today`: by their shift's working days (`workingDays`, 0 =
 * Sunday; none known: Sunday to Thursday), the official holidays and their approved leave on the days in between.
 */
export async function correctionAskFromFor(db: Db, employeeId: string, workingDays: readonly number[] | null | undefined, today: string): Promise<string> {
  const since = addDays(today, -CORRECTION_ASK_LOOK_BACK);
  const within = { gte: toDateOnly(since), lte: toDateOnly(today) };
  const [holidays, leave] = await Promise.all([
    db.holiday.findMany({ where: { date: within }, select: { date: true } }),
    db.leaveRequest.findMany({
      where: { employeeId, status: 'approved', startDate: { lte: within.lte }, endDate: { gte: within.gte } },
      select: { startDate: true, endDate: true },
    }),
  ]);
  const off = holidays.map((h) => fromDateOnly(h.date));
  for (const l of leave) for (let d = fromDateOnly(l.startDate); d <= fromDateOnly(l.endDate); d = addDays(d, 1)) off.push(d);
  return correctionAskFrom(today, workingDays, off);
}

/** The window for their own month's page: by the shift of their employment today (else their latest). */
export async function correctionAskWindowOf(db: Db, employeeId: string, today: string): Promise<CorrectionAskWindow> {
  const job =
    (await db.employment.findFirst({
      where: { employeeId, joinDate: { lte: toDateOnly(today) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] },
      orderBy: { joinDate: 'desc' },
      select: { shift: { select: { workingDays: true } } },
    })) ?? (await db.employment.findFirst({ where: { employeeId }, orderBy: { joinDate: 'desc' }, select: { shift: { select: { workingDays: true } } } }));
  return { from: await correctionAskFromFor(db, employeeId, job?.shift?.workingDays ?? null, today), workingDays: CORRECTION_ASK_WORKING_DAYS };
}
