import {
  RAISE_DECISION_DONE_LABELS,
  RAISE_REASON_LABELS,
  RAISE_REQUEST_STATUS_LABELS,
  RAISE_REQUEST_STATUSES,
  RAISE_REQUEST_STEP_LABELS,
  RAISE_REQUESTER_LABELS,
  RAISE_WAY_LABELS,
  payDifference,
  type RaiseRequester,
  type RaiseRequestStatus,
  type Role,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../lib/format';
import type { RaiseRequest, RaiseRequestStep, RaiseSuggestion } from '../../../lib/raise-types';
import { hasRole } from '../../../lib/roles';
import { changeText } from '../employees/[id]/salary-history/salary-history';
import { formatEgp } from '../employees/[id]/contracts/salary';

// Raise requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"; reworked 17 October 2026: "requesting a raise should have a
// drop list reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment,
// suggest raise amount or percentage, then the approver to Approve - Approve with another raise amount or percentge -
// Reject, and add a comment, all the request steps to be logged in the request"): the employee asks for themself, their
// direct manager for a direct report, or HR for anyone, with a reason from the list, a comment and a suggested raise (an
// amount, or a percent: a manager a percent only); one open per person. HR approves it as suggested or with another
// raise, which prepares the raise and sends it to the CEO, or rejects it; the CEO approves that raise as it reached
// them or with another raise, rejects it or returns it to HR, each with a comment; it is done once the raise is signed.
// Every step is logged on the request. The manager is told, not asked. Amounts stay private: the API leaves out what
// the caller may not see, and these helpers only word what it sent. Pure code, tested; relative imports, as vitest
// doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };

/** Who sees the Raise Requests page (the sidebar shows them the link): HR and the CEO, and Finance to view. */
export const RAISE_REQUESTS_ROLES: readonly Role[] = ['hr', 'ceo', 'finance'];

export function canSeeRaiseRequests(user: WithRoles): boolean {
  return hasRole(user, ...RAISE_REQUESTS_ROLES);
}

/** HR declines a request, or prepares the raise from it. The API checks this again. */
export function handlesRaiseRequests(user: WithRoles): boolean {
  return hasRole(user, 'hr');
}

/**
 * Whether a profile shows its Raise Requests (and so, to the employee or their manager, the Salary sub-tab): when there
 * are requests the caller may see, or they may ask for one now; also when they could not be loaded, to say so. Nothing
 * when the caller may not see them, or the server doesn't have them yet. `load`: GET /employees/:id/raise-requests as
 * read (data.ts).
 */
export function showsRaiseRequests(
  load: { kind: 'ok'; value: { requests: readonly unknown[]; canRequest: boolean } } | { kind: 'unavailable' | 'forbidden' | 'failed' },
): boolean {
  if (load.kind === 'ok') return load.value.requests.length > 0 || load.value.canRequest;
  return load.kind === 'failed';
}

/** The requests waiting for HR, for the count beside Raise Requests in the sidebar. */
export const WITH_HR_REQUESTS = '/raise-requests?status=with_hr';

// ---------- the status filter ----------

export type StatusFilter = RaiseRequestStatus | '';

/** All, then each status in the order a request goes through them. */
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All' },
  ...RAISE_REQUEST_STATUSES.map((s) => ({ value: s, label: RAISE_REQUEST_STATUS_LABELS[s] })),
];

type Query = Record<string, string | string[] | undefined>;

/** The status in the page's address; anything it doesn't know is All. */
export function readStatus(query: Query): StatusFilter {
  const v = typeof query.status === 'string' ? query.status : '';
  return (RAISE_REQUEST_STATUSES as readonly string[]).includes(v) ? (v as RaiseRequestStatus) : '';
}

/**
 * The page's address for a status: "/raise-requests?status=with_hr", or "/raise-requests" for All. The API's list is at
 * the same path (under /api), with the same ?status=.
 */
export const raiseRequestsHref = (status: StatusFilter) => (status ? `/raise-requests?status=${status}` : '/raise-requests');

/** "1 request", "12 requests". */
export const requestsLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

// ---------- a request, in words ----------

/** The status pill's colours, as the change requests and the payroll show theirs: waiting, approved, declined, done. */
export const STATUS_BADGE: Record<RaiseRequestStatus, string> = {
  with_hr: 'bg-warn-soft text-warn',
  with_ceo: 'bg-warn-soft text-warn',
  approved: '', // the badge's own accent colours
  declined: 'bg-danger-soft text-danger',
  done: 'bg-ok-soft text-ok',
};

export const statusLabel = (status: RaiseRequestStatus) => RAISE_REQUEST_STATUS_LABELS[status] ?? status;

/** Who asked: "The direct manager", with their sign-in email when the API sends it. */
export function requesterText(r: Pick<RaiseRequest, 'requester' | 'requestedBy'>): { who: string; email: string | null } {
  return { who: RAISE_REQUESTER_LABELS[r.requester] ?? r.requester, email: r.requestedBy?.email ?? null };
}

/** Who asked, inside a sentence: "Asked for by the employee", "… by their direct manager", "… by HR". */
export const REQUESTER_PHRASES: Record<RaiseRequest['requester'], string> = { self: 'the employee', manager: 'their direct manager', hr: 'HR' };

/**
 * The raise HR prepared from a request, as far as the caller may see it: "CON-2026-0001-A1 · Amendment", then when it
 * takes effect, the gross from → to and the change ("From 01/11/2026 · EGP 10,000.00 → EGP 12,500.00 · +EGP 2,500.00
 * (+25%)"), each only when sent. Null without one.
 */
export function preparedRaiseText(raise: RaiseRequest['raise']): { title: string; detail: string | null } | null {
  if (!raise) return null;
  const parts: string[] = [];
  if (raise.effectiveDate) parts.push(`From ${formatDate(raise.effectiveDate)}`);
  if (raise.newGross !== null && raise.previousGross !== null) {
    parts.push(`${formatEgp(raise.previousGross)} → ${formatEgp(raise.newGross)}`);
    parts.push(changeText(payDifference(raise.previousGross, raise.newGross))!);
  } else if (raise.newGross !== null) {
    parts.push(`New gross ${formatEgp(raise.newGross)}`);
  }
  return { title: `${raise.number} · ${RAISE_WAY_LABELS[raise.way] ?? raise.way}`, detail: parts.length ? parts.join(' · ') : null };
}

/**
 * Where a request stands, for its Decision column and card: what happened last, and the comment given with it (HR's or
 * the CEO's rejection, the CEO's return to HR, which only HR, Finance and the CEO are sent).
 */
export function progressText(r: RaiseRequest): { text: string; reason: string | null } {
  const at = (iso: string | null) => (iso ? ` on ${formatDate(iso)}` : '');
  switch (r.status) {
    case 'declined': {
      const d = r.decision;
      const by = d?.stage === 'ceo' ? 'the CEO' : 'HR';
      return { text: `Rejected by ${by}${at(d?.at ?? null)}`, reason: d?.reason ?? null };
    }
    case 'done': {
      // the new gross for HR, Finance, the CEO and the employee themself; never for the manager (the API leaves it out)
      const gross = r.raise?.newGross ?? null;
      const from = r.raise?.effectiveDate ?? null;
      const pay = gross !== null && from ? `, ${formatEgp(gross)} from ${formatDate(from)}` : '';
      return { text: `Done${at(r.doneAt)}: the raise is signed${pay}`, reason: null };
    }
    case 'approved':
      return { text: `Approved by the CEO${at(r.raise?.approvedAt ?? null)}: the raise is to be signed`, reason: null };
    case 'with_ceo':
      return { text: 'HR approved it and sent the raise to the CEO', reason: null };
    case 'with_hr':
    default:
      if (r.raise?.returnedReason) return { text: 'Returned by the CEO to HR', reason: r.raise.returnedReason };
      if (r.raise) return { text: 'HR is preparing the raise', reason: null };
      return { text: 'Waiting for HR', reason: null };
  }
}

/** When it was asked: "16/10/2026, 5:42 PM". */
export const askedAt = (r: Pick<RaiseRequest, 'createdAt'>) => formatDateTime(r.createdAt);

/** The raise form, prepared from a request (the Contract section's raise page). */
export const prepareRaiseHref = (employeeId: string, requestId: string) =>
  `/employees/${encodeURIComponent(employeeId)}/contracts/raise?request=${encodeURIComponent(requestId)}`;

/**
 * What HR may do with a request while it is with HR: decide it (approve it as suggested or with another raise, which
 * prepares the raise and sends it to the CEO, or reject it), or approve it in the whole raise form (`prepare`, for a
 * promotion or other allowances with it); once a raise is prepared from it (returned by the CEO, or prepared before 17
 * October 2026), carry on with that raise in the Contract section, or reject the request (the raise goes with it).
 */
export function requestActions(
  user: WithRoles,
  r: Pick<RaiseRequest, 'status' | 'raise'>,
): { decide: boolean; prepare: boolean; continueRaise: boolean; decline: boolean } {
  const hr = handlesRaiseRequests(user) && r.status === 'with_hr';
  return { decide: hr && !r.raise, prepare: hr && !r.raise, continueRaise: hr && !!r.raise, decline: hr && !!r.raise };
}

/** How many are waiting for HR. */
export const withHrCount = (requests: readonly Pick<RaiseRequest, 'status'>[]) => requests.filter((r) => r.status === 'with_hr').length;

// ---------- the reason, the comment, the figures ----------

/** The reason from the list ("Performance raise"); null on a request from before 17 October 2026. */
export const reasonText = (r: Pick<RaiseRequest, 'raiseReason'>): string | null => (r.raiseReason ? (RAISE_REASON_LABELS[r.raiseReason] ?? r.raiseReason) : null);

/** The requester's comment: what a request from before 17 October 2026 was asked with, too. */
export const commentText = (r: Pick<RaiseRequest, 'comment' | 'reason'>): string => r.comment ?? r.reason;

const sign = (n: number) => (n < 0 ? '−' : '+');
const amountText = (n: number) => `${sign(n)}${formatEgp(Math.abs(n))}`;
const percentText = (n: number) => `${sign(n)}${Math.abs(n)}%`;

/**
 * A raise's figures as far as the caller is sent them: the one typed first, the other in brackets, and the gross it
 * comes to: "+10% (+EGP 1,000.00) → EGP 11,000.00", "+EGP 1,500.00", "+8%"; worked out from the pay (none typed), the
 * amount first; a gross alone, "Gross EGP 12,000.00". Null with none.
 */
export function figureText(f: Pick<RaiseRequestStep, 'figure' | 'increaseAmount' | 'increasePercent' | 'gross'>): string | null {
  const amount = f.increaseAmount !== null ? amountText(f.increaseAmount) : null;
  const percent = f.increasePercent !== null ? percentText(f.increasePercent) : null;
  const [first, second] = f.figure === 'percent' ? [percent, amount] : [amount, percent];
  const change = first ? `${first}${second ? ` (${second})` : ''}` : second;
  if (change) return `${change}${f.gross !== null ? ` → ${formatEgp(f.gross)}` : ''}`;
  return f.gross !== null ? `Gross ${formatEgp(f.gross)}` : null;
}

/**
 * The raise suggested on a request, as far as the caller is sent it: "+EGP 1,500.00 → EGP 11,500.00", "+8%", or a
 * gross typed before 17 October 2026, "Gross EGP 12,000.00". Null without one, or none the caller may see.
 */
export function suggestionText(s: RaiseSuggestion | null | undefined): string | null {
  if (!s) return null;
  if (s.kind === 'gross') return s.gross !== null ? `Gross ${formatEgp(s.gross)}` : null;
  return figureText({ figure: s.kind, increaseAmount: s.amount, increasePercent: s.percent, gross: s.gross });
}

// ---------- the log ----------

/** How the log says who asked: "Asked for by the employee", "… by their direct manager", "… by HR". */
const ASKED_BY: Record<RaiseRequester, string> = { self: 'Asked for by the employee', manager: 'Asked for by their direct manager', hr: 'Asked for by HR' };

/**
 * A step of a request as its log shows it: what happened ("HR approved it with another raise", "The CEO rejected it"),
 * and what goes with it as far as the caller is sent it (the reason and the raise suggested, the figures decided, the
 * raise prepared and from when, the new pay once signed).
 */
export function stepText(s: RaiseRequestStep, requester: RaiseRequester): { title: string; detail: string | null } {
  const figures = figureText(s);
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || null;
  switch (s.kind) {
    case 'submitted':
      return { title: ASKED_BY[requester] ?? RAISE_REQUEST_STEP_LABELS.submitted, detail: join(s.raiseReason ? (RAISE_REASON_LABELS[s.raiseReason] ?? s.raiseReason) : null, figures && `Suggested ${figures}`) };
    case 'hr_decision':
    case 'ceo_decision': {
      const who = s.kind === 'hr_decision' ? 'HR' : 'The CEO';
      const what =
        s.decision === 'approve' ? (s.kind === 'hr_decision' ? 'approved it as suggested' : 'approved it') : s.decision === 'approve_other' ? 'approved it with another raise' : 'rejected it';
      return { title: `${who} ${what}`, detail: s.decision === 'reject' ? null : figures };
    }
    case 'prepared': {
      const way = s.way ? RAISE_WAY_LABELS[s.way] : null;
      return { title: 'HR prepared the raise', detail: join(s.contractNumber, way && (s.effectiveDate ? `${way} from ${formatDate(s.effectiveDate)}` : way)) };
    }
    case 'sent':
      return { title: 'Sent to the CEO', detail: figures };
    case 'returned':
      return { title: 'The CEO returned it to HR', detail: null };
    case 'changed':
      return { title: 'HR changed the approved raise: it goes to the CEO again', detail: figures };
    case 'signed':
      return { title: 'Signed: the request is done', detail: join(s.effectiveDate && `In force from ${formatDate(s.effectiveDate)}`, s.gross !== null ? `New gross ${formatEgp(s.gross)}` : null) };
    case 'unsigned':
      return { title: 'Signing undone: the raise is to be signed again', detail: s.contractNumber };
    case 'raise_deleted':
      return { title: 'The raise was deleted: the request is with HR again', detail: s.contractNumber };
    default:
      return { title: RAISE_REQUEST_STEP_LABELS[s.kind] ?? s.kind, detail: figures };
  }
}

/** Whether a step is a decision, and which way, for its mark on the timeline. */
export function stepTone(s: Pick<RaiseRequestStep, 'kind' | 'decision'>): 'ok' | 'danger' | 'warn' | null {
  if (s.decision === 'reject') return 'danger';
  if (s.decision) return 'ok';
  if (s.kind === 'signed') return 'ok';
  if (s.kind === 'returned' || s.kind === 'raise_deleted' || s.kind === 'unsigned') return 'warn';
  return null;
}

/** "Rejected", "Approved with another raise": a decision as the log calls it. */
export const decisionLabel = (s: Pick<RaiseRequestStep, 'decision'>) => (s.decision ? RAISE_DECISION_DONE_LABELS[s.decision] : null);

/** "3 steps", "1 step". */
export const stepsLabel = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

// ---------- who reads a comment ----------

/**
 * Who reads a comment, for the hint under its box (owner, 17 October 2026: the comment boxes say who will read the
 * comment). The requester's: HR, Finance, the CEO and the direct manager (the employee doesn't see a request they didn't
 * make). HR's or the CEO's decision: the employee too when they asked themself. A return, or HR's note on sending: HR
 * and the CEO only. `requester` null: a raise without a request, whose decision stays with HR.
 */
export function commentReaders(step: 'request' | 'decision' | 'return' | 'send', requester: RaiseRequester | null, forSelf = false): string {
  if (step === 'return') return 'HR sees this comment, with the raise returned to them; the employee and their manager don’t.';
  if (step === 'send') return 'The CEO sees this note; the employee and their manager don’t.';
  if (step === 'request') {
    if (forSelf) return 'HR, Finance, the CEO and your direct manager see this comment.';
    return requester === 'manager'
      ? 'HR, Finance and the CEO see this comment; the employee doesn’t see a request you make.'
      : 'Finance, the CEO and the employee’s direct manager see this comment; the employee doesn’t see a request HR makes.';
  }
  if (requester === null) return 'HR, Finance and the CEO see this comment, with the raise.';
  return requester === 'self'
    ? 'The employee and their manager see this comment.'
    : 'The employee’s manager sees this comment; the employee doesn’t see this request.';
}
