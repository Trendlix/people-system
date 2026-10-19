import { decidesConfidentialStage, reimbursementStage, type ReimbursementStage } from '@trendlix/shared';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ConfidentialView } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';

// Who may see, decide and cancel a reimbursement claim (owner, 18 October 2026: "allow the employee to add
// reimbursement request … for specific preset up conditions"; asked, the owner chose the direct manager, then HR, then
// Finance). Pure code: the rules themselves are packages/shared reimbursements.ts. A C-level person's claim (owner, 19
// October 2026: "make C level Employees details not visible to HR"; their HR stages go to the CEO): HR's and Finance's
// stages are the CEO's (or HR's and Finance's with Super Admin: packages/shared decidesConfidentialStage), and HR and
// Finance don't see it; the manager it was sent to still decides the manager stage, as the request is theirs to decide.

/**
 * The caller, their own employee profile (the one whose work email they sign in with), if any, and the C-level people,
 * those hidden from the caller among them (none left out: nobody is C-level).
 */
export interface Caller {
  user: SessionUser;
  employeeId: string | null;
  confidential?: ConfidentialView;
}

/** Whether the claim is a C-level person's (its HR and Finance stages the CEO's). */
export const isConfidentialClaim = (claim: ClaimParties, caller: Caller) => caller.confidential?.all.has(claim.employeeId) ?? false;

/** Whether the claim's person is hidden from the caller: C-level, and not the caller themself. */
const hiddenClaim = (claim: ClaimParties, caller: Caller) => caller.confidential?.hidden.has(claim.employeeId) ?? false;

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

/**
 * Who sees a claim: the employee who claimed it, the manager it was sent to, HR, Finance and the CEO; a C-level person's,
 * not HR nor Finance (owner, 19 October 2026), the CEO and a Super Admin with HR or Finance instead.
 */
export const seesClaim = (claim: ClaimParties, caller: Caller) =>
  (seesEveryClaim(caller.user) && !hiddenClaim(claim, caller)) || isClaimant(claim, caller) || isClaimManager(claim, caller);

/**
 * Whether the caller decides a stage of the claim: the manager stage its direct manager, HR's stage HR and Finance's
 * Finance; a C-level person's HR and Finance stages the CEO (or HR and Finance with Super Admin); nobody their own claim.
 */
export function decidesStage(stage: ReimbursementStage, claim: ClaimParties, caller: Caller): boolean {
  if (isClaimant(claim, caller)) return false;
  if (stage === 'manager') return isClaimManager(claim, caller);
  if (isConfidentialClaim(claim, caller)) return decidesConfidentialStage(caller.user, [stage]);
  return actsAs(caller.user.roles, [stage]);
}

/** Whether the claim waits for the caller's decision now. */
export function waitsFor(claim: ClaimParties & { status: string }, caller: Caller): boolean {
  const stage = reimbursementStage(claim.status);
  return stage !== null && decidesStage(stage, claim, caller);
}

/**
 * The claims waiting for the caller's decision: their reports' with them, those with HR for HR, with Finance for
 * Finance; a C-level person's with HR or Finance for the CEO (and HR or Finance with Super Admin), not for HR nor
 * Finance; never their own.
 */
export function waitingWhere(caller: Caller): Prisma.ReimbursementClaimWhereInput {
  const or: Prisma.ReimbursementClaimWhereInput[] = [];
  const confidential = [...(caller.confidential?.all ?? [])];
  if (caller.employeeId) or.push({ status: 'with_manager', managerId: caller.employeeId });
  for (const stage of ['hr', 'finance'] as const) {
    const status = stage === 'hr' ? 'with_hr' : 'with_finance';
    const ordinary = actsAs(caller.user.roles, [stage]);
    const theirs = confidential.length > 0 && decidesConfidentialStage(caller.user, [stage]);
    if (ordinary && (theirs || !confidential.length)) or.push({ status });
    else if (ordinary) or.push({ status, employeeId: { notIn: confidential } });
    else if (theirs) or.push({ status, employeeId: { in: confidential } });
  }
  if (!or.length) return { id: { in: [] } };
  return { OR: or, ...(caller.employeeId && { employeeId: { not: caller.employeeId } }) };
}
