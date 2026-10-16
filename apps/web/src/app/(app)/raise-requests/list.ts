import {
  RAISE_REQUEST_STATUS_LABELS,
  RAISE_REQUEST_STATUSES,
  RAISE_REQUESTER_LABELS,
  RAISE_WAY_LABELS,
  payDifference,
  type RaiseRequestStatus,
  type Role,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../lib/format';
import type { RaiseRequest } from '../../../lib/raise-types';
import { hasRole } from '../../../lib/roles';
import { changeText } from '../employees/[id]/salary-history/salary-history';
import { formatEgp } from '../employees/[id]/contracts/salary';

// Raise requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"): the employee asks for themself, their direct manager for a
// direct report, or HR for anyone, with a reason and (the employee or HR) a suggested gross; one open per person. HR
// declines it with a reason, or prepares the raise from it, which goes to the CEO; the CEO's approval, return or decline
// of that raise is the request's, and it is done once the raise is signed. The manager is told, not asked. Amounts stay
// private: the API leaves out what the caller may not see, and these helpers only word what it sent. Pure code, tested;
// relative imports, as vitest doesn't know the @/ paths.

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
 * Where a request stands, for its Decision column and card: what happened last, and a reason given with it (HR's or the
 * CEO's decline, the CEO's return to HR, which only HR, Finance and the CEO are sent).
 */
export function progressText(r: RaiseRequest): { text: string; reason: string | null } {
  const at = (iso: string | null) => (iso ? ` on ${formatDate(iso)}` : '');
  switch (r.status) {
    case 'declined': {
      const d = r.decision;
      const by = d?.stage === 'ceo' ? 'the CEO' : 'HR';
      return { text: `Declined by ${by}${at(d?.at ?? null)}`, reason: d?.reason ?? null };
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
      return { text: 'HR prepared the raise and sent it to the CEO', reason: null };
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
 * What HR may do with a request: while it is with HR, decline it (a raise prepared and not yet sent goes with it), and
 * prepare the raise from it, or, once prepared (or returned by the CEO), carry on with it in the Contract section.
 */
export function requestActions(
  user: WithRoles,
  r: Pick<RaiseRequest, 'status' | 'raise'>,
): { prepare: boolean; continueRaise: boolean; decline: boolean } {
  const hr = handlesRaiseRequests(user) && r.status === 'with_hr';
  return { prepare: hr && !r.raise, continueRaise: hr && !!r.raise, decline: hr };
}

/** How many are waiting for HR. */
export const withHrCount = (requests: readonly Pick<RaiseRequest, 'status'>[]) => requests.filter((r) => r.status === 'with_hr').length;
