import { careersSiteOf } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The careers site's address the API builds its public careers links on (owner, 25 October 2026: the careers pages moved
// to www.trendlix.com/en/careers, and the links should stop relying on people.trendlix.com/careers' redirect; packages/
// shared careers-base.ts): "Careers site address" in Recruitment Settings, the standard when unset. Never the request's
// own address: the invitation to apply's link, the vacancy's links and LinkedIn's redirect URL all come from here.

/** The careers site in use: the address Recruitment Settings keep, else the standard (https://www.trendlix.com/en/careers). */
export async function careersSiteIn(db: PrismaService | Prisma.TransactionClient): Promise<string> {
  const row = await db.recruitmentSettings.findUnique({ where: { id: 1 }, select: { careersSite: true } });
  return careersSiteOf(row?.careersSite);
}
