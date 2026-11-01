import { APPROVER_ROLE_LABELS } from '@trendlix/shared';
import type { RequestApprover } from './types';

// The steps a request still has to go through, under the ones already logged on its Every Step card (owner, 1 November
// 2026: "in the everystep, can we add all the steps and show where the request is standing?"): the step it waits at now
// first ("Waiting for Yasmine Ali (direct manager) to decide"), then each step after it ("Then HR"), then where it ends ("Then it's
// approved"). A request decided, cancelled or withdrawn has none ahead. Pure, tested.

/** One step ahead: what it says, and whether the request waits at it now. */
export interface StepAhead {
  key: string;
  text: string;
  now: boolean;
}

/** A step of the path: the status that means the request waits at it, and who decides it. */
interface Stage {
  status: string;
  who: string;
}

/** "Yasmine Ali (direct manager)" (or just the name when the role isn't known); "their manager" without one. */
export function approverText(a: Pick<RequestApprover, 'fullNameEn' | 'role'> | null | undefined): string {
  if (!a) return 'their manager';
  return a.role ? `${a.fullNameEn} (${APPROVER_ROLE_LABELS[a.role].toLowerCase()})` : a.fullNameEn;
}

/** The steps from the one at `status` on, then the end; none when the request waits at none of them (it is closed). */
function ahead(stages: readonly Stage[], status: string, end: string): StepAhead[] {
  const at = stages.findIndex((s) => s.status === status);
  if (at < 0) return [];
  return [
    ...stages.slice(at).map((s, i) => ({ key: s.status, text: i === 0 ? `Waiting for ${s.who} to decide` : `Then ${s.who}`, now: i === 0 })),
    { key: 'end', text: end, now: false },
  ];
}

/**
 * A request decided as leave is (leave, permission, attendance correction, work from home, official duty, compensatory
 * day): its manager stage when someone decides it (the direct manager, else the team lead, else the head of department),
 * then HR, the CEO for a C-level person, then approved.
 */
export function leaveStepsAhead(r: { status: string; manager?: Pick<RequestApprover, 'fullNameEn' | 'role'> | null; confidential?: boolean | null }): StepAhead[] {
  const stages: Stage[] = [
    ...(r.manager || r.status === 'with_manager' ? [{ status: 'with_manager', who: approverText(r.manager) }] : []),
    { status: 'with_hr', who: r.confidential ? 'the CEO' : 'HR' },
  ];
  return ahead(stages, r.status, 'Then it’s approved');
}

/** A reimbursement claim: its manager stage when someone decides it, then HR (the CEO for a C-level person), then Finance. */
export function claimStepsAhead(r: { status: string; manager?: Pick<RequestApprover, 'fullNameEn' | 'role'> | null; confidential?: boolean | null }): StepAhead[] {
  const stages: Stage[] = [
    ...(r.manager || r.status === 'with_manager' ? [{ status: 'with_manager', who: approverText(r.manager) }] : []),
    { status: 'with_hr', who: r.confidential ? 'the CEO' : 'HR' },
    { status: 'with_finance', who: 'Finance' },
  ];
  return ahead(stages, r.status, 'Then it’s approved for payment');
}

/** An approved home location: HR, then the CEO. */
export function homeStepsAhead(r: { status: string }): StepAhead[] {
  return ahead(
    [
      { status: 'with_hr', who: 'HR' },
      { status: 'with_ceo', who: 'the CEO' },
    ],
    r.status,
    'Then it’s approved',
  );
}
