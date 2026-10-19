import {
  decisionNeedsComment,
  lowerAmountProblem,
  REIMBURSEMENT_DECISIONS,
  REIMBURSEMENT_STAGE_LABELS,
  REIMBURSEMENT_STAGES,
  REIMBURSEMENT_STATUS_LABELS,
  REIMBURSEMENT_STATUSES,
  seesConfidential,
  statusAfterApproval,
  type ReimbursementDecision,
  type ReimbursementStage,
  type ReimbursementStatus,
  type Role,
} from '@trendlix/shared';
import { REIMBURSEMENTS_PATH } from '../../../components/nav';
import { requestStatusLabel } from '../../../lib/confidential';
import { approverPhrase, approverSubject, withApproverText, yourApprover } from '../../../lib/department-leads';
import { hasRole } from '../../../lib/roles';
import type { ReimbursementClaimStep, ReimbursementClaimView, RequestApprover } from '../../../lib/types';
import { formatEgp, parseAmount } from '../employees/[id]/contracts/salary';
import { myRequestsHref } from '../my-requests/requests';
import { monthName, monthOf } from '../payroll/list';

// Reimbursement claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions"): an employee claims an expense of a type HR set up in Payroll Setup, within its conditions, from My
// Requests; it goes to their direct manager, then HR, then Finance (no manager: straight to HR), each approving it,
// approving a lower amount with a comment, or rejecting it with one, every step logged on the claim. Finance's approval
// adds it, untaxed, to the next payroll not yet approved. HR and Finance decide theirs from Requests → Reimbursements,
// which the CEO may view; a direct manager from My Team. The rules are @trendlix/shared's (reimbursements.ts), which the
// API enforces; these helpers only word what it sent, and read the decision form. Someone without a direct manager has
// their claim decided first by their team lead, else their department's head (owner, 19 October 2026: "i want to add
// department lead person, the person in charge"): the manager stage says which, by the claim's `manager.role`. A C-level
// person's claim (owner, 19 October 2026: "make C level Employees details not visible to HR"; `confidential`, from the
// API) has HR's and Finance's stages decided by the CEO (or HR, or Finance, with Super Admin), and isn't listed to HR or
// Finance without it: what is still to come names the CEO ("With the CEO", "Approve and send to the CEO"), and what was
// done names the stage ("Approved at Finance's stage"), as HR or Finance may have decided it before then and the log
// says who. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };

/** Who sees every claim, on Requests → Reimbursements (the sidebar shows them the link): HR and Finance decide, the CEO views. */
export const REIMBURSEMENTS_ROLES: readonly Role[] = ['hr', 'finance', 'ceo'];

export function canSeeReimbursements(user: WithRoles): boolean {
  return hasRole(user, ...REIMBURSEMENTS_ROLES);
}

// ---------- the addresses ----------

/** The new claim form, for anyone with an employee profile (from My Requests, or from the list for HR, Finance and the CEO). */
export const NEW_CLAIM_PATH = `${REIMBURSEMENTS_PATH}/new`;

/** A claim's page, where it is decided and cancelled: "/reimbursements/<id>". */
export const claimHref = (id: string) => `${REIMBURSEMENTS_PATH}/${encodeURIComponent(id)}`;

/**
 * What was just done on a claim, said on its page by `?done=`: sent, cancelled, a stage's decision ("hr_approve"), or a
 * decision refused because the claim had moved on meanwhile (`moved`). Its page then has no form left to say it (the
 * claim is no longer the caller's to decide or cancel).
 */
export type ClaimDone = 'sent' | 'cancelled' | 'moved' | `${ReimbursementStage}_${ReimbursementDecision}`;

/** A claim's page after something was done on it: "/reimbursements/<id>?done=sent". */
export const claimDoneHref = (id: string, done: ClaimDone) => `${claimHref(id)}?done=${done}`;

type Query = Record<string, string | string[] | undefined>;

/** A receipt, from the API under the web domain (./[id]/receipts/[receiptId]/route.ts): the browser never talks to the API. */
export const receiptHref = (claimId: string, receiptId: string) => `${claimHref(claimId)}/receipts/${encodeURIComponent(receiptId)}`;

/**
 * Where a claim's page goes back to: Reimbursements for those who see it; My Requests for the employee's own; My Team for
 * the direct manager deciding a report's.
 */
export function claimBack(user: WithRoles & { employeeId?: string | null }, claim: Pick<ReimbursementClaimView, 'employee'>): { href: string; label: string } {
  if (canSeeReimbursements(user)) return { href: REIMBURSEMENTS_PATH, label: 'Reimbursements' };
  if (user.employeeId && claim.employee.id === user.employeeId) return { href: myRequestsHref({ kind: '', status: '' }), label: 'My Requests' };
  return { href: '/my-team', label: 'My Team' };
}

/** Where the new claim form's back link and Cancel go: Reimbursements for those who see it, else My Requests. */
export const newClaimBack = (user: WithRoles): { href: string; label: string } =>
  canSeeReimbursements(user) ? { href: REIMBURSEMENTS_PATH, label: 'Reimbursements' } : { href: myRequestsHref({ kind: '', status: '' }), label: 'My Requests' };

// ---------- the status filter ----------

/** Waiting for you (the claims the caller decides now), All, or one status. */
export type ClaimFilter = 'waiting' | 'all' | ReimbursementStatus;

/** Waiting for you, All, then each status in the order a claim goes through them. */
export const CLAIM_FILTERS: readonly { value: ClaimFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'all', label: 'All' },
  ...REIMBURSEMENT_STATUSES.map((s) => ({ value: s, label: REIMBURSEMENT_STATUS_LABELS[s] })),
];

/** What the list shows when the address names no status: what waits for HR and Finance, who decide; every claim for the CEO. */
export const defaultFilter = (user: WithRoles): ClaimFilter => (hasRole(user, 'hr', 'finance') ? 'waiting' : 'all');

/** The status in the page's address; none, or anything it doesn't know, is the user's default. */
export function readFilter(query: Query, user: WithRoles): ClaimFilter {
  const v = typeof query.status === 'string' ? query.status : '';
  return CLAIM_FILTERS.some((f) => f.value === v) ? (v as ClaimFilter) : defaultFilter(user);
}

/** The page's address for a filter: "/reimbursements?status=waiting"; each names its status, so a link keeps it. */
export const reimbursementsHref = (filter: ClaimFilter) => `${REIMBURSEMENTS_PATH}?status=${filter}`;

/** The API's list for a filter: GET /reimbursements?status=waiting|<status>, without one for All. */
export const claimsPath = (filter: ClaimFilter, employeeId?: string | null) => {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (employeeId) params.set('employeeId', employeeId);
  const qs = params.toString();
  return qs ? `/reimbursements?${qs}` : '/reimbursements';
};

/** The claims waiting for the caller: My Team's and the dashboard's Reimbursements to Approve. */
export const WAITING_CLAIMS = claimsPath('waiting');

/** How many claims wait for the caller, beside Reimbursements (or My Team) in the sidebar. */
export const CLAIM_COUNTS = '/reimbursements/counts';

/** What the list says when no claim has the filter chosen. */
const EMPTY: Record<ClaimFilter, string> = {
  waiting: 'No claims are waiting for you.',
  all: 'No reimbursement claims yet. Employees claim them from My Requests.',
  with_manager: 'No claims are with a direct manager.',
  with_hr: 'No claims are with HR.',
  with_finance: 'No claims are with Finance.',
  approved: 'No claims approved.',
  rejected: 'No claims rejected.',
  cancelled: 'No claims cancelled.',
};

export const emptyText = (filter: ClaimFilter) => EMPTY[filter];

/** "1 claim", "12 claims". */
export const claimsLabel = (n: number) => `${n} ${n === 1 ? 'claim' : 'claims'}`;

/** How many different employees made these claims, for the group headings ("3 employees · 5 claims"). */
export const claimantCount = (claims: readonly Pick<ReimbursementClaimView, 'employee'>[]) => new Set(claims.map((c) => c.employee.id)).size;

/**
 * Where the claimant works, as the list groups them (lib/place-groups.ts): "Department › Team", the department alone, or
 * null. The API may send the team with the department or apart from it.
 */
export function placeOfClaim(e: Pick<ReimbursementClaimView['employee'], 'department' | 'team'>): string | null {
  const department = e.department?.trim() || null;
  const team = e.team?.trim() || null;
  if (department && team && !department.includes(' › ')) return `${department} › ${team}`;
  return department ?? team;
}

// ---------- a claim, in words ----------

/** The status pill's colours, as the other requests show theirs: waiting, approved, rejected, cancelled. */
export const STATUS_BADGE: Record<ReimbursementStatus, string> = {
  with_manager: 'bg-warn-soft text-warn',
  with_hr: 'bg-warn-soft text-warn',
  with_finance: 'bg-warn-soft text-warn',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
  cancelled: 'bg-line-soft text-muted',
};

/** "With HR", "With Finance", …; "With the CEO" for a C-level person's claim at either (19 October 2026). */
export const statusLabel = (status: ReimbursementStatus, confidential?: boolean | null) =>
  requestStatusLabel(status, REIMBURSEMENT_STATUS_LABELS[status] ?? status, confidential);

type Approver = Pick<RequestApprover, 'role'> | null | undefined;

/** Each stage inside a sentence: "the direct manager" (or "the team lead", "the head of department": `manager`), "HR", "Finance". */
const stagePhrase = (stage: ReimbursementStage, manager?: Approver) => (stage === 'manager' ? approverPhrase(manager) : stage === 'hr' ? 'HR' : 'Finance');

/** Each stage starting a sentence: "The direct manager" (or "The team lead", …), "HR", "Finance". */
const stageSubject = (stage: ReimbursementStage, manager?: Approver) => (stage === 'manager' ? approverSubject(manager) : stage === 'hr' ? 'HR' : 'Finance');

// ---------- a C-level person's claim (owner, 19 October 2026: their HR and Finance stages are the CEO's) ----------

/** Whether the stage is one the CEO decides for a C-level person: HR's or Finance's. */
const isStaffStage = (stage: ReimbursementStage | null | undefined): stage is 'hr' | 'finance' => stage === 'hr' || stage === 'finance';

/** "HR’s stage", "Finance’s stage": a C-level person's staff stage by its name, which the CEO decides. */
const stageOf = (stage: 'hr' | 'finance') => `${REIMBURSEMENT_STAGE_LABELS[stage]}’s stage`;

/**
 * Who decides the next stage, inside a sentence: "HR", "Finance"; a C-level person's (`confidential`), "the CEO" for
 * HR's stage and "Finance’s stage" for Finance's (the CEO decides both, one after the other).
 */
function nextStageName(next: ReimbursementStatus, confidential?: boolean | null): string {
  if (confidential !== true) return REIMBURSEMENT_STAGE_LABELS[next === 'with_hr' ? 'hr' : 'finance'];
  return next === 'with_hr' ? 'the CEO' : stageOf('finance');
}

/**
 * Who the user decides the stage as, in the decision section's heading ("Your Decision as …"): the direct manager (or
 * the team lead, the head of department: `managerTitle`), HR or Finance; HR's or Finance's stage of a C-level person's
 * claim (`confidential`), the CEO's, "the CEO, at HR's Stage", unless the user holds the stage's role with Super Admin.
 */
export function decidingAsTitle(user: WithRoles, stage: ReimbursementStage, managerTitle: string, confidential?: boolean | null): string {
  if (stage === 'manager') return managerTitle;
  if (confidential !== true || (hasRole(user, stage) && seesConfidential(user))) return REIMBURSEMENT_STAGE_LABELS[stage];
  return `the CEO, at ${REIMBURSEMENT_STAGE_LABELS[stage]}’s Stage`;
}

/** A payroll month (its first day, or "YYYY-MM") by name: "November 2026". */
export const payMonthText = (month: string) => monthName(monthOf(month));

/** The amount as last approved when it is less than claimed, else null (approved as claimed, or not yet). */
export const lowerApproved = (c: Pick<ReimbursementClaimView, 'amount' | 'approvedAmount'>) =>
  c.approvedAmount !== null && Math.round(c.approvedAmount * 100) < Math.round(c.amount * 100) ? c.approvedAmount : null;

/** The amount it is decided on now: the one an earlier approver approved, else as claimed. */
export const currentAmount = (c: Pick<ReimbursementClaimView, 'amount' | 'approvedAmount'>) => c.approvedAmount ?? c.amount;

/**
 * Where a claim stands, for its list row and its page: who has it now, or how it ended, and the comment given with a
 * rejection. Once approved, the payroll it is paid with: to be paid with it, paid with it, or its addition cancelled.
 */
export function progressText(c: Pick<ReimbursementClaimView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'payMonth' | 'payroll' | 'confidential'>): {
  text: string;
  reason: string | null;
} {
  const clevel = c.confidential === true;
  switch (c.status) {
    case 'with_manager':
      // "With the team lead (Sara Ali)": who decides it now
      return { text: withApproverText(c.manager), reason: null };
    // a C-level person's: the CEO decides HR's stage, then Finance's (19 October 2026)
    case 'with_hr':
      return { text: clevel ? `Waiting for the CEO, at ${stageOf('hr')}` : 'Waiting for HR', reason: null };
    case 'with_finance':
      return { text: clevel ? `Waiting for the CEO, at ${stageOf('finance')}` : 'Waiting for Finance', reason: null };
    case 'rejected': {
      const reason = c.rejectReason?.trim() || null;
      if (clevel && isStaffStage(c.rejectedStage)) return { text: `Rejected at ${stageOf(c.rejectedStage)}`, reason };
      return { text: c.rejectedStage ? `Rejected by ${stagePhrase(c.rejectedStage, c.manager)}` : 'Rejected', reason };
    }
    case 'cancelled':
      return { text: 'Cancelled by the employee', reason: null };
    case 'approved':
    default: {
      const month = c.payroll?.runMonth ?? c.payMonth;
      if (!month) return { text: 'Approved', reason: null };
      const name = payMonthText(month);
      if (c.payroll?.status === 'applied') return { text: `Approved: paid with the ${name} payroll`, reason: null };
      if (c.payroll?.status === 'cancelled') return { text: `Approved: its addition to the ${name} payroll was cancelled`, reason: null };
      return { text: `Approved: to be paid with the ${name} payroll`, reason: null };
    }
  }
}

/** The pay month column: "November 2026", or a dash (null) until Finance approves it. */
export const payMonthOf = (c: Pick<ReimbursementClaimView, 'payMonth' | 'payroll'>) => {
  const month = c.payroll?.runMonth ?? c.payMonth;
  return month ? payMonthText(month) : null;
};

/**
 * What the page says once a claim is sent: where it goes, by where it starts (with the manager, or straight to HR);
 * `manager`, who decides it first: the direct manager, or the team lead or head of department of someone without one;
 * a C-level person's (`confidential`) goes to the CEO, who decides HR's and Finance's stages (19 October 2026).
 */
export function sentText(status: ReimbursementStatus, manager?: Approver, confidential?: boolean | null): string {
  const then = confidential === true ? 'the CEO, for HR’s and Finance’s stages' : 'HR, then Finance';
  const paid = 'each step shows on the claim. Once approved, it is paid with the next payroll.';
  return status === 'with_manager' ? `Claim sent. It goes to ${yourApprover(manager)}, then ${then}; ${paid}` : `Claim sent. It goes to ${then}; ${paid}`;
}

/**
 * What the claim's page says after `?done=`, and in which tone (a decision refused as the claim had moved on: a
 * warning); null for anything else. `status`: the claim's now, for where a sent one goes, and `manager` to whom;
 * `confidential`: a C-level person's, whose HR and Finance stages are the CEO's.
 */
export function doneText(query: Query, status: ReimbursementStatus, manager?: Approver, confidential?: boolean | null): { text: string; tone: 'ok' | 'warn' } | null {
  const done = typeof query.done === 'string' ? query.done : '';
  if (done === 'sent') return { text: sentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Claim cancelled. It stays on your list, cancelled.', tone: 'ok' };
  if (done === 'moved') return { text: MOVED_ON, tone: 'warn' };
  const [stage, ...rest] = done.split('_');
  const decision = rest.join('_');
  if (!(REIMBURSEMENT_STAGES as readonly string[]).includes(stage) || !(REIMBURSEMENT_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: decidedText(decision as ReimbursementDecision, stage as ReimbursementStage, confidential), tone: 'ok' };
}

/** Said when a decision is refused as the claim moved on since the page was opened (the API's 409). */
export const MOVED_ON = 'This claim has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

// ---------- the log ----------

/**
 * A step of a claim as its timeline shows it: what happened ("HR approved a lower amount", "The team lead approved it":
 * the manager stage by who decides it, the claim's `manager`), and what goes with it (the amount claimed or approved,
 * the payroll it was added to). A C-level person's (`confidential`) HR and Finance stages by the stage ("Approved at
 * Finance's stage"): the CEO decides them since 19 October 2026, and the step says who.
 */
export function stepText(s: ReimbursementClaimStep, manager?: Approver, confidential?: boolean | null): { title: string; detail: string | null } {
  const amount = s.amount !== null ? formatEgp(s.amount) : null;
  switch (s.kind) {
    case 'submitted':
      return { title: 'Claimed by the employee', detail: amount };
    case 'no_manager':
      // nobody in charge: no direct manager, and no team lead or head of department other than the employee
      return { title: 'No direct manager or lead: sent straight to HR', detail: null };
    case 'manager_decision':
    case 'hr_decision':
    case 'finance_decision': {
      const stage = s.kind.replace('_decision', '') as ReimbursementStage;
      if (confidential === true && isStaffStage(stage)) {
        const at = `at ${stageOf(stage)}`;
        if (s.decision === 'reject') return { title: `Rejected ${at}`, detail: null };
        if (s.decision === 'approve_other') return { title: `A lower amount approved ${at}`, detail: amount };
        return { title: `Approved ${at}`, detail: amount };
      }
      const who = stageSubject(stage, manager);
      if (s.decision === 'reject') return { title: `${who} rejected it`, detail: null };
      if (s.decision === 'approve_other') return { title: `${who} approved a lower amount`, detail: amount };
      return { title: `${who} approved it`, detail: amount };
    }
    case 'cancelled':
      return { title: 'Cancelled by the employee', detail: null };
    case 'added_to_payroll':
      return { title: s.payMonth ? `Added to the ${payMonthText(s.payMonth)} payroll` : 'Added to the payroll', detail: amount && `${amount}, untaxed` };
    default:
      return { title: String(s.kind), detail: amount };
  }
}

/** Whether a step is a decision, and which way, for its mark on the timeline. */
export function stepTone(s: Pick<ReimbursementClaimStep, 'kind' | 'decision'>): 'ok' | 'danger' | 'warn' | null {
  if (s.decision === 'reject') return 'danger';
  if (s.decision === 'approve_other') return 'warn';
  if (s.decision || s.kind === 'added_to_payroll') return 'ok';
  return null;
}

/** "3 steps", "1 step". */
export const stepsLabel = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

// ---------- amounts as typed ----------

/**
 * An amount as typed (parseAmount: "250", "1,250.50", Arabic digits), the Arabic decimal mark too ("٢٥٠٫٥٠", as the
 * Arabic keyboard types it). "" → null; anything else not an amount → NaN.
 */
export const amountTyped = (raw: string) => parseAmount(raw.replace(/٫/g, '.'));

// ---------- deciding a claim ----------

/** What the decision form sends the API (POST /reimbursements/:id/decide). */
export interface DecisionBody {
  decision: ReimbursementDecision;
  amount?: number;
  comment?: string;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** Why a comment is needed, by the decision. */
const COMMENT_NEEDED: Record<Exclude<ReimbursementDecision, 'approve'>, string> = {
  approve_other: 'Write your comment: why a lower amount is approved.',
  reject: 'Write your comment: why the claim is rejected.',
};

/**
 * The decision form as the API takes it, and what is wrong with it: a decision; for a lower amount, the amount (less
 * than `current`, the amount it is decided on: lowerAmountProblem) and a comment; for a rejection, a comment
 * (decisionNeedsComment). A comment on an approval is optional.
 */
export function decisionBody(fd: FormData, current: number): { body: DecisionBody | null; errors: string[] } {
  const decision = text(fd, 'decision');
  if (!(REIMBURSEMENT_DECISIONS as readonly string[]).includes(decision)) {
    return { body: null, errors: ['Choose your decision: approve, approve a lower amount or reject.'] };
  }
  const d = decision as ReimbursementDecision;
  const errors: string[] = [];
  const body: DecisionBody = { decision: d };
  if (d === 'approve_other') {
    const amount = amountTyped(text(fd, 'amount'));
    const problem = lowerAmountProblem(amount ?? NaN, current);
    if (problem) errors.push(problem);
    else body.amount = amount!;
  }
  const comment = text(fd, 'comment');
  if (comment) body.comment = comment;
  else if (decisionNeedsComment(d)) errors.push(COMMENT_NEEDED[d as keyof typeof COMMENT_NEEDED]);
  return { body: errors.length ? null : body, errors };
}

/**
 * The decision form's button, by the decision and the stage: where an approved claim goes next (a C-level person's,
 * `confidential`: to the CEO, then on to Finance's stage, which the CEO decides too).
 */
export function decisionButton(decision: ReimbursementDecision | '', stage: ReimbursementStage, confidential?: boolean | null): { label: string; busy: string } {
  if (decision === 'reject') return { label: 'Reject the claim', busy: 'Rejecting…' };
  const next = statusAfterApproval(stage);
  const label = next === 'approved' ? 'Approve and add to payroll' : `Approve and send to ${nextStageName(next, confidential)}`;
  return { label: decision === '' ? 'Save the decision' : label, busy: 'Approving…' };
}

/** What the page says once a decision went through; a C-level person's claim (`confidential`) goes on to the CEO's stages. */
export function decidedText(decision: ReimbursementDecision, stage: ReimbursementStage, confidential?: boolean | null): string {
  if (decision === 'reject') return 'Claim rejected. The employee sees your comment.';
  const next = statusAfterApproval(stage);
  if (next === 'approved') return 'Approved: it is added, untaxed, to the next payroll not yet approved.';
  if (confidential === true && next === 'with_finance') return `Approved: the claim goes on to ${stageOf('finance')}, which the CEO decides too.`;
  return `Approved: the claim goes to ${nextStageName(next, confidential)}.`;
}

/** Who reads the decision's comment, for the hint under its box. */
export const COMMENT_READERS = 'The employee sees your comment, and so do the direct manager, HR, Finance and the CEO.';

/**
 * Who reads the decision's comment: COMMENT_READERS; a C-level person's claim (`confidential`) HR and Finance don't
 * see, only the CEO and the Super Admin (19 October 2026).
 */
export const commentReaders = (confidential?: boolean | null) =>
  confidential === true ? 'The employee sees your comment, and so do the direct manager, the CEO and the Super Admin.' : COMMENT_READERS;
