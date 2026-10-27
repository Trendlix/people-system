import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The approved compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month"; packages/shared compensatory.ts), as the attendance reads them: a plain read, no service, so the attendance
// module takes it without depending on the compensatory module.

type Db = PrismaService | Prisma.TransactionClient;

/**
 * The compensatory days of one person: the days off (approved as a day off), the hours off (approved for part of a day
 * worked, 27 October 2026), and the days worked they compensate (either way).
 */
export interface PersonCompensatory {
  daysOff: string[];
  hoursOff: { date: string; hours: number }[];
  daysWorked: string[];
}

/** These people's approved compensatory days with a day off or a day worked from `from` to `to`, by person. */
export async function approvedCompensatory(db: Db, employeeIds: readonly string[], from: string, to: string): Promise<Map<string, PersonCompensatory>> {
  const out = new Map<string, PersonCompensatory>();
  if (!employeeIds.length) return out;
  const range = { gte: toDateOnly(from), lte: toDateOnly(to) };
  const rows = await db.compensatoryRequest.findMany({
    where: { employeeId: { in: [...employeeIds] }, status: 'approved', OR: [{ dayWorked: range }, { dayOff: range }] },
    select: { employeeId: true, dayWorked: true, dayOff: true, outcome: true, hoursOff: true },
  });
  for (const r of rows) {
    const mine = out.get(r.employeeId) ?? { daysOff: [], hoursOff: [], daysWorked: [] };
    mine.daysWorked.push(fromDateOnly(r.dayWorked));
    if (r.outcome !== 'cash' && r.dayOff) {
      if (r.hoursOff) mine.hoursOff.push({ date: fromDateOnly(r.dayOff), hours: r.hoursOff.toNumber() });
      else mine.daysOff.push(fromDateOnly(r.dayOff));
    }
    out.set(r.employeeId, mine);
  }
  return out;
}
