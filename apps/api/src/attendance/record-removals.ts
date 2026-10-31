import { withoutRemovedPresses, type DayPress, type DaySourceChoice, type ImportedDay } from '@trendlix/shared';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The records a Super Admin removed and the sources chosen (owner, 31 October 2026: "delete one of them" — "Stays
// removed"; "zoho or system"; packages/shared attendance-records.ts), read where days are worked out: the Zoho records
// removed left out of the nightly fetch's days and an import's (zoho-people-sync.service.ts, attendance-imports.service.ts),
// the sources chosen in every person's month (AttendanceDaysService.monthOf, the attendance history). Its own file, so
// the services that need it don't import each other.

type Db = PrismaService | Prisma.TransactionClient;

const keyOf = (employeeId: string, date: string) => `${employeeId}:${date}`;

/** The Zoho records removed and not restored, by person and day ("{employeeId}:{date}"). */
export async function zohoRemovalsOf(db: Db, employeeIds: readonly string[], from: string, to: string): Promise<Map<string, DayPress[]>> {
  const out = new Map<string, DayPress[]>();
  if (!employeeIds.length) return out;
  const rows = await db.attendanceRecordRemoval.findMany({
    where: { employeeId: { in: [...employeeIds] }, source: 'zoho', restoredAt: null, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    select: { employeeId: true, date: true, kind: true, at: true },
  });
  for (const r of rows) {
    const key = keyOf(r.employeeId, fromDateOnly(r.date));
    out.set(key, [...(out.get(key) ?? []), { kind: r.kind as DayPress['kind'], at: r.at.toISOString() }]);
  }
  return out;
}

/** A person's Zoho days without the records removed from them (and the open check-in kept with each, when there is one). */
export function withoutZohoRemovals<T extends { day: ImportedDay; openAt: string | null }>(employeeId: string, days: readonly T[], removals: ReadonlyMap<string, DayPress[]>): T[] {
  if (!removals.size) return [...days];
  return days.map((d) => {
    const removed = removals.get(keyOf(employeeId, d.day.date));
    if (!removed?.length) return d;
    const kept = withoutRemovedPresses(d.day, d.openAt, removed);
    return { ...d, day: kept.day, openAt: kept.openAt };
  });
}

/** The sources chosen for days, by person: date → the source the day uses. */
export async function dayChoicesOf(db: Db, employeeIds: readonly string[], from: string, to: string): Promise<Map<string, Map<string, DaySourceChoice>>> {
  const out = new Map<string, Map<string, DaySourceChoice>>();
  if (!employeeIds.length) return out;
  const rows = await db.attendanceDaySource.findMany({
    where: { employeeId: { in: [...employeeIds] }, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    select: { employeeId: true, date: true, source: true },
  });
  for (const r of rows) {
    const of = out.get(r.employeeId) ?? new Map<string, DaySourceChoice>();
    of.set(fromDateOnly(r.date), r.source as DaySourceChoice);
    out.set(r.employeeId, of);
  }
  return out;
}
