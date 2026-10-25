import { exemptOn, type ExemptionPeriod } from '@trendlix/shared';
import { fromDateOnly, toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The periods exempt from check-in (owner, 25 October 2026: "allow me to select people that are not eligable for
// attendance checkins and outs, trat them as if they achived their full working hours"; packages/shared
// check-in-exemptions.ts), as the attendance, checking in and the reminders read them: plain reads, no service, as the
// official duties' (official-duty/od-days.ts).

type Db = PrismaService | Prisma.TransactionClient;

/** These people's exemption periods with a day from `from` to `to`, by employee, in date order. */
export async function exemptionsOf(db: Db, employeeIds: readonly string[], from: string, to: string): Promise<Map<string, ExemptionPeriod[]>> {
  const out = new Map<string, ExemptionPeriod[]>();
  if (!employeeIds.length) return out;
  const rows = await db.checkInExemption.findMany({
    // a period cancelled before it started never applied
    where: { employeeId: { in: [...employeeIds] }, cancelledAt: null, startDate: { lte: toDateOnly(to) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(from) } }] },
    orderBy: { startDate: 'asc' },
    select: { employeeId: true, startDate: true, endDate: true },
  });
  for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), { startDate: fromDateOnly(r.startDate), endDate: r.endDate ? fromDateOnly(r.endDate) : null }]);
  return out;
}

/** The person's exemption period on a day (YYYY-MM-DD), if any. */
export async function exemptionOn(db: Db, employeeId: string, date: string): Promise<ExemptionPeriod | null> {
  const periods = (await exemptionsOf(db, [employeeId], date, date)).get(employeeId) ?? [];
  return periods.find((p) => exemptOn(date, [p])) ?? null;
}
