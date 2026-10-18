import type { LeaveDecision, LeaveStepKind } from '@trendlix/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// The log of a leave request (owner, 18 October 2026: every step logged on the request, as a reimbursement claim's):
// each step in order, with who and when, written in the same transaction as the step itself.

type Db = PrismaService | Prisma.TransactionClient;

/** Logs a step on a request, by `actorId` (null: none, e.g. sent straight to HR), in the transaction the step is taken in. */
export async function recordLeaveStep(
  db: Db,
  requestId: string,
  actorId: string | null,
  step: { kind: LeaveStepKind; decision?: LeaveDecision; comment?: string | null },
): Promise<void> {
  await db.leaveRequestStep.create({ data: { requestId, actorId, kind: step.kind, decision: step.decision ?? null, comment: step.comment ?? null } });
}
