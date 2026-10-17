import { CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_STATUSES, type ChangeRequestStatus } from '@trendlix/shared';
import { DETAILS_CHANGES_PATH } from '../../../../components/nav';
import { formatDateTime } from '../../../../lib/format';
import type { ChangeRequest } from '../../../../lib/types';

// Details Changes, under Requests in the sidebar (owner, 17 October 2026: "A Requests heading"): every employee's
// request to change their details, newest first, filtered by status in the address (so a link keeps it), each with its
// decision: who, when and why. HR and Admin decide the ones waiting there, as on Approvals. Pure code, tested; relative
// imports, as vitest doesn't know the @/ paths.

/** All, or one of the module's statuses: waiting for HR, approved, rejected, cancelled by the employee. */
export type StatusFilter = ChangeRequestStatus | '';

/** All, then each status in the order a request goes through them. */
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All' },
  ...CHANGE_REQUEST_STATUSES.map((s) => ({ value: s, label: CHANGE_REQUEST_STATUS_LABELS[s] })),
];

type Query = Record<string, string | string[] | undefined>;

/** The status in the page's address; anything it doesn't know is All. */
export function readStatus(query: Query): StatusFilter {
  const v = typeof query.status === 'string' ? query.status : '';
  return (CHANGE_REQUEST_STATUSES as readonly string[]).includes(v) ? (v as ChangeRequestStatus) : '';
}

/** What a decision made on the page says after it, by `?done=`. */
export const DONE = {
  'change-approved': 'Change request approved: the profile is updated.',
  'change-rejected': 'Change request rejected. The employee sees your note.',
} as const;

export type Done = keyof typeof DONE;

/** The message for the page's `?done=`; none for anything else. */
export function readDone(query: Query): string | null {
  const v = typeof query.done === 'string' ? query.done : '';
  return Object.hasOwn(DONE, v) ? DONE[v as Done] : null;
}

/**
 * The page's address: "/requests/details-changes?status=pending", or with no status for All; `done`, after a decision
 * made on it.
 */
export function detailsChangesHref(status: StatusFilter, done?: Done): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (done) params.set('done', done);
  const qs = params.toString();
  return qs ? `${DETAILS_CHANGES_PATH}?${qs}` : DETAILS_CHANGES_PATH;
}

/** The API's list for a status: GET /change-requests?status=…, `all` for All (without one, the API lists the waiting). */
export const changeRequestsPath = (status: StatusFilter) => `/change-requests?status=${status || 'all'}`;

/** "1 request", "12 requests". */
export const requestsLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

/** What the page says when no request has the status chosen. */
export function emptyText(status: StatusFilter): string {
  switch (status) {
    case '':
      return 'No change requests yet. Employees ask for them when they check their details on their profile.';
    case 'pending':
      return 'No change requests are waiting.';
    default:
      return `No ${CHANGE_REQUEST_STATUS_LABELS[status].toLowerCase()} change requests.`;
  }
}

/**
 * The heading of the column of what a request's fields were, beside what was requested: while it waits, what the
 * profile has (as Approvals calls it); once decided, what they were when it was asked.
 */
export const fromLabel = (status: ChangeRequestStatus) => (status === 'pending' ? 'Current' : 'When asked');

/**
 * A decided request's decision: who decided and when, and the note given with it (optional on an approval, the reason
 * on a rejection); cancelled, by the employee who asked. Null while it waits.
 */
export function decisionView(r: Pick<ChangeRequest, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote'>): {
  title: string;
  at: string | null;
  noteLabel: string;
  note: string | null;
} | null {
  if (r.status === 'pending') return null;
  const at = r.decidedAt ? formatDateTime(r.decidedAt) : null;
  const note = r.decisionNote?.trim() || null;
  if (r.status === 'cancelled') return { title: 'Cancelled by the employee', at, noteLabel: 'Note', note };
  const by = r.decidedBy?.email ? ` by ${r.decidedBy.email}` : '';
  return r.status === 'approved'
    ? { title: `Approved${by}`, at, noteLabel: 'Note', note }
    : { title: `Rejected${by}`, at, noteLabel: 'Why it was rejected', note };
}
