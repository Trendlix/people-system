import { BadRequestException } from '@nestjs/common';
import { isTrainingType, lastTrainingEnd, trainingTooSoon, trainingTooSoonMessage, type TrainingHistory } from '@trendlix/shared';
import { fromDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { traineeStagesOf } from './views.js';

// A trainee's training agreement and an intern's internship agreement over time (owner, 19 October 2026: "or can be
// only renewed 1 time, after that it should be converted to a full time contract. a new trainee contract can be issued
// after 6 months of the expiration of the last trainee contract"): which versions of an employment are its agreements,
// and when the person's last one ended, which a new one starts 6 months after at the earliest. The rules themselves
// are packages/shared employment-types.ts.

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** What an employment is read with to tell when its agreements ended. */
export const TRAINING_HISTORY = {
  id: true,
  employmentType: true,
  endDate: true,
  contracts: { select: { version: true, kind: true, status: true, startDate: true, endDate: true, convertsTo: true, traineeStages: true } },
} satisfies Prisma.EmploymentSelect;

type HistoryRow = Prisma.EmploymentGetPayload<{ select: typeof TRAINING_HISTORY }>;

/** The rows as lastTrainingEnd reads them (dates as YYYY-MM-DD). */
export function trainingHistoryOf(rows: readonly HistoryRow[]): TrainingHistory[] {
  return rows.map((e) => ({
    employmentType: e.employmentType,
    endDate: fromDateOnly(e.endDate),
    contracts: e.contracts.map((c) => ({
      version: c.version,
      kind: c.kind,
      status: c.status,
      startDate: fromDateOnly(c.startDate),
      endDate: fromDateOnly(c.endDate),
      convertsTo: c.convertsTo,
      hasStages: traineeStagesOf(c) !== null,
    })),
  }));
}

/** The last day of the person's last training or internship agreement, null for none; `except`: an employment left out. */
export async function lastTrainingEndOf(db: Db, employeeId: string, except?: string): Promise<string | null> {
  const rows = await db.employment.findMany({ where: { employeeId, ...(except && { id: { not: except } }) }, select: TRAINING_HISTORY });
  return lastTrainingEnd(trainingHistoryOf(rows));
}

/**
 * Refuses a trainee's or an intern's new agreement for this person starting before 6 months after their last one ended
 * (400, with the day it becomes possible). Nothing to check for another employment type. `except`: the employment being
 * changed, whose own agreements don't count.
 */
export async function assertTrainingGap(db: Db, person: { id: string; fullNameEn: string }, type: string, startDate: string, except?: string): Promise<void> {
  if (!isTrainingType(type)) return;
  const lastEnded = await lastTrainingEndOf(db, person.id, except);
  if (trainingTooSoon(lastEnded, startDate)) throw new BadRequestException(trainingTooSoonMessage(person.fullNameEn, type, lastEnded!));
}
