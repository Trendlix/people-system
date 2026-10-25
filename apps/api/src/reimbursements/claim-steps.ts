import type { ReimbursementDecision, ReimbursementStepKind } from '@trendlix/shared';
import { toDateOnly } from '../common/date-only.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The log of a reimbursement claim (owner's answer, 18 October 2026: every step logged on the claim, like a raise
// request's): each step in order, with who and when, written in the same transaction as the step itself.

/** The database, or a transaction in it. */
type Db = PrismaService | Prisma.TransactionClient;

/** A step as it is written: its kind, and what goes with it. */
export interface ClaimStepInput {
  kind: ReimbursementStepKind;
  decision?: ReimbursementDecision;
  /** EGP: claimed (submitted), approved at the step, or added to payroll. */
  amount?: number | null;
  comment?: string | null;
  /** added_to_payroll: the month's first day, YYYY-MM-DD. */
  payMonth?: string | null;
  /** The manager step decided by a stand-in: the manager they stood in for (25 October 2026). */
  onBehalfOf?: string | null;
}

/** Logs a step on a claim, by `actorId` (null: none, e.g. sent straight to HR), in the transaction the step is taken in. */
export async function recordClaimStep(db: Db, claimId: string, actorId: string | null, step: ClaimStepInput): Promise<void> {
  await db.reimbursementClaimStep.create({
    data: {
      claimId,
      actorId,
      kind: step.kind,
      decision: step.decision ?? null,
      amount: step.amount ?? null,
      comment: step.comment ?? null,
      payMonth: step.payMonth ? toDateOnly(step.payMonth) : null,
      onBehalfOfId: step.onBehalfOf ?? null,
    },
  });
}
