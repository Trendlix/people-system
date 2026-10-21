import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The approved work from home days (owner, 21 October 2026: "think about how should we handle the working from home in
// out erp"; packages/shared wfh.ts), as checking in and the attendance pages read them: a plain read, no service, so the
// attendance module takes it without depending on the work from home module.

type Db = PrismaService | Prisma.TransactionClient;

/** Whether someone has a work from home day approved on a date (YYYY-MM-DD). */
export async function approvedWfhOn(db: Db, employeeId: string, date: string): Promise<boolean> {
  return (await db.wfhRequest.count({ where: { employeeId, status: 'approved', date: toDateOnly(date) } })) > 0;
}

/** The approved work from home days of these people from `from` to `to`, by person, in date order. */
export async function approvedWfhDays(db: Db, employeeIds: readonly string[], from: string, to: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!employeeIds.length) return out;
  const rows = await db.wfhRequest.findMany({
    where: { employeeId: { in: [...employeeIds] }, status: 'approved', date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    orderBy: { date: 'asc' },
    select: { employeeId: true, date: true },
  });
  for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), fromDateOnly(r.date)]);
  return out;
}
