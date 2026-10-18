import {
  decisionNeedsComment,
  lowerAmountProblem,
  REIMBURSEMENT_DECISIONS,
  REIMBURSEMENT_STAGE_LABELS,
  REIMBURSEMENT_STAGES,
  REIMBURSEMENT_STATUS_LABELS,
  REIMBURSEMENT_STATUSES,
  statusAfterApproval,
  type ReimbursementDecision,
  type ReimbursementStage,
  type ReimbursementStatus,
  type Role,
} from '@trendlix/shared';
import { REIMBURSEMENTS_PATH } from '../../../components/nav';
import { hasRole } from '../../../lib/roles';
import type { ReimbursementClaimStep, ReimbursementClaimView } from '../../../lib/types';
import { formatEgp, parseAmount } from '../employees/[id]/contracts/salary';
import { myRequestsHref } from '../my-requests/requests';
import { monthName, monthOf } from '../payroll/list';

// Reimbursement claims (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific preset
// up conditions"): an employee claims an expense of a type HR set up in Payroll Setup, within its conditions, from My
// Requests; it goes to their direct manager, then HR, then Finance (no manager: straight to HR), each approving it,
// approving a lower amount with a comment, or rejecting it with one, every step logged on the claim. Finance's approval
// adds it, untaxed, to the next payroll not yet approved. HR and Finance decide theirs from Requests → Reimbursements,
// which the CEO may view; a direct manager from My Team. The rules are @trendlix/shared's (reimbursements.ts), which the
// API enforces; these helpers only word what it sent, and read the decision form. Pure code, tested; relative imports,
// as vitest doesn't know the @/ paths.

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

export const statusLabel = (status: ReimbursementStatus) => REIMBURSEMENT_STATUS_LABELS[status] ?? status;

/** Each stage inside a sentence: "the direct manager", "HR", "Finance". */
const STAGE_PHRASE: Record<ReimbursementStage, string> = { manager: 'the direct manager', hr: 'HR', finance: 'Finance' };

/** Each stage starting a sentence: "The direct manager", "HR", "Finance". */
const STAGE_SUBJECT: Record<ReimbursementStage, string> = { manager: 'The direct manager', hr: 'HR', finance: 'Finance' };

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
export function progressText(c: Pick<ReimbursementClaimView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'payMonth' | 'payroll'>): {
  text: string;
  reason: string | null;
} {
  switch (c.status) {
    case 'with_manager':
      return { text: c.manager ? `Waiting for the direct manager, ${c.manager.fullNameEn}` : 'Waiting for the direct manager', reason: null };
    case 'with_hr':
      return { text: 'Waiting for HR', reason: null };
    case 'with_finance':
      return { text: 'Waiting for Finance', reason: null };
    case 'rejected':
      return { text: c.rejectedStage ? `Rejected by ${STAGE_PHRASE[c.rejectedStage]}` : 'Rejected', reason: c.rejectReason?.trim() || null };
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

/** What the page says once a claim is sent: where it goes, by where it starts (with the manager, or straight to HR). */
export function sentText(status: ReimbursementStatus): string {
  return status === 'with_manager'
    ? 'Claim sent. It goes to your direct manager, then HR, then Finance; each step shows on the claim. Once approved, it is paid with the next payroll.'
    : 'Claim sent. It goes to HR, then Finance; each step shows on the claim. Once approved, it is paid with the next payroll.';
}

/**
 * What the claim's page says after `?done=`, and in which tone (a decision refused as the claim had moved on: a
 * warning); null for anything else. `status`: the claim's now, for where a sent one goes.
 */
export function doneText(query: Query, status: ReimbursementStatus): { text: string; tone: 'ok' | 'warn' } | null {
  const done = typeof query.done === 'string' ? query.done : '';
  if (done === 'sent') return { text: sentText(status), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Claim cancelled. It stays on your list, cancelled.', tone: 'ok' };
  if (done === 'moved') return { text: MOVED_ON, tone: 'warn' };
  const [stage, ...rest] = done.split('_');
  const decision = rest.join('_');
  if (!(REIMBURSEMENT_STAGES as readonly string[]).includes(stage) || !(REIMBURSEMENT_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: decidedText(decision as ReimbursementDecision, stage as ReimbursementStage), tone: 'ok' };
}

/** Said when a decision is refused as the claim moved on since the page was opened (the API's 409). */
export const MOVED_ON = 'This claim has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

// ---------- the log ----------

/**
 * A step of a claim as its timeline shows it: what happened ("HR approved a lower amount"), and what goes with it (the
 * amount claimed or approved, the payroll it was added to).
 */
export function stepText(s: ReimbursementClaimStep): { title: string; detail: string | null } {
  const amount = s.amount !== null ? formatEgp(s.amount) : null;
  switch (s.kind) {
    case 'submitted':
      return { title: 'Claimed by the employee', detail: amount };
    case 'no_manager':
      return { title: 'No direct manager: sent straight to HR', detail: null };
    case 'manager_decision':
    case 'hr_decision':
    case 'finance_decision': {
      const who = STAGE_SUBJECT[s.kind.replace('_decision', '') as ReimbursementStage];
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

/** The decision form's button, by the decision and the stage: where an approved claim goes next. */
export function decisionButton(decision: ReimbursementDecision | '', stage: ReimbursementStage): { label: string; busy: string } {
  if (decision === 'reject') return { label: 'Reject the claim', busy: 'Rejecting…' };
  const next = statusAfterApproval(stage);
  const label = next === 'with_hr' ? 'Approve and send to HR' : next === 'with_finance' ? 'Approve and send to Finance' : 'Approve and add to payroll';
  return { label: decision === '' ? 'Save the decision' : label, busy: 'Approving…' };
}

/** What the page says once a decision went through. */
export function decidedText(decision: ReimbursementDecision, stage: ReimbursementStage): string {
  if (decision === 'reject') return 'Claim rejected. The employee sees your comment.';
  const next = statusAfterApproval(stage);
  if (next === 'approved') return 'Approved: it is added, untaxed, to the next payroll not yet approved.';
  return `Approved: the claim goes to ${REIMBURSEMENT_STAGE_LABELS[next === 'with_hr' ? 'hr' : 'finance']}.`;
}

/** Who reads the decision's comment, for the hint under its box. */
export const COMMENT_READERS = 'The employee sees your comment, and so do the direct manager, HR, Finance and the CEO.';
