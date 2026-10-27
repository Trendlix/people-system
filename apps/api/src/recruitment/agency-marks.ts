import type { AgencyMarks } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// HR's marks of marketing agencies (owner, 27 October 2026: "Name words + your list"; packages/shared
// marketing-agencies.ts), read as the CV fits and the CV views tell a CV's agency background: a plain read, so every
// recruitment service takes it without depending on AgencyMarksService.

type Db = PrismaService | Prisma.TransactionClient;

/** Every mark, by company key: true a marketing agency, false not one. */
export async function agencyMarksOf(db: Db): Promise<AgencyMarks> {
  const rows = await db.agencyMark.findMany({ select: { key: true, agency: true } });
  return new Map(rows.map((r) => [r.key, r.agency]));
}
