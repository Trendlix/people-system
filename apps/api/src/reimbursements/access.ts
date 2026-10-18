import { reimbursementStage, type ReimbursementStage } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { Prisma } from '../generated/prisma/client.js';

// Who may see, decide and cancel a reimbursement claim (owner, 18 October 2026: "allow the employee to add
// reimbursement request … for specific preset up conditions"; asked, the owner chose the direct manager, then HR, then
// Finance). Pure code: the rules themselves are packages/shared reimbursements.ts.

/** The caller, and their own employee profile (the one whose work email they sign in with), if any. */
export interface Caller {
  user: SessionUser;
  employeeId: string | null;
}

/** What a claim's access is worked out from: whose it is, and the direct manager deciding its first stage. */
export interface ClaimParties {
  employeeId: string;
  managerId: string | null;
}

/** HR, Finance and the CEO see every claim. */
export const seesEveryClaim = (user: SessionUser) => actsAs(user.roles, ['hr', 'finance', 'ceo']);

/** The employee who claimed it. */
export const isClaimant = (claim: ClaimParties, caller: Caller) => caller.employeeId !== null && claim.employeeId === caller.employeeId;

/** The direct manager it was sent to. */
export const isClaimManager = (claim: ClaimParties, caller: Caller) => caller.employeeId !== null && claim.managerId === caller.employeeId;

/** Who sees a claim: the employee who claimed it, the manager it was sent to, HR, Finance and the CEO. */
export const seesClaim = (claim: ClaimParties, caller: Caller) => seesEveryClaim(caller.user) || isClaimant(claim, caller) || isClaimManager(claim, caller);

/**
 * Whether the caller decides a stage of the claim: the manager stage its direct manager, HR's stage HR and Finance's
 * Finance; nobody their own claim.
 */
export function decidesStage(stage: ReimbursementStage, claim: ClaimParties, caller: Caller): boolean {
  if (isClaimant(claim, caller)) return false;
  if (stage === 'manager') return isClaimManager(claim, caller);
  return actsAs(caller.user.roles, [stage]);
}

/** Whether the claim waits for the caller's decision now. */
export function waitsFor(claim: ClaimParties & { status: string }, caller: Caller): boolean {
  const stage = reimbursementStage(claim.status);
  return stage !== null && decidesStage(stage, claim, caller);
}

/** The claims waiting for the caller's decision: their reports' with them, those with HR for HR, with Finance for Finance; never their own. */
export function waitingWhere(caller: Caller): Prisma.ReimbursementClaimWhereInput {
  const or: Prisma.ReimbursementClaimWhereInput[] = [];
  if (caller.employeeId) or.push({ status: 'with_manager', managerId: caller.employeeId });
  if (actsAs(caller.user.roles, ['hr'])) or.push({ status: 'with_hr' });
  if (actsAs(caller.user.roles, ['finance'])) or.push({ status: 'with_finance' });
  if (!or.length) return { id: { in: [] } };
  return { OR: or, ...(caller.employeeId && { employeeId: { not: caller.employeeId } }) };
}
