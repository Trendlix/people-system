import { applicationNumber } from '@trendlix/shared';
import { todayInCairo } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';

// The applications' references (APP-2026-0001 …), one series for the applications and the general CVs (owner, 22 October
// 2026: general-cvs.ts), so a reference names one person's CV whichever list it is on; a general CV moved to a vacancy
// keeps its own for the application made from it. Given under a lock, the highest of the year in either table plus one.

const NUMBER_LOCK = 'people-system:application-number';

/** The next reference of the year, holding the series' lock until the transaction ends. */
export async function nextApplicationNumber(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${NUMBER_LOCK}))`;
  const year = todayInCairo().slice(0, 4);
  const pattern = `^APP-${year}-[0-9]+$`;
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT max(n) AS max FROM (
      SELECT substring(number from 10)::int AS n FROM job_applications WHERE number ~ ${pattern}
      UNION ALL
      SELECT substring(number from 10)::int AS n FROM general_cvs WHERE number ~ ${pattern}
    ) AS numbers`;
  return applicationNumber(year, (max ?? 0) + 1);
}
