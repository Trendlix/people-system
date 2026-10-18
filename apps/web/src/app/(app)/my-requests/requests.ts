import { OPEN_RAISE_REQUEST_STATUSES } from '@trendlix/shared';
import type { RaiseRequest } from '../../../lib/raise-types';
import type { ChangeRequest } from '../../../lib/types';

// My Requests (owner, 17 October 2026: "my suggestion for the employee side bar is 1- Dashboard 2- My Profile 3- My
// Requests"): everything the employee asked for, newest first, each with its decisions as the API gives them to the
// employee: the changes to their details they asked HR for (on their profile: the one waiting and the latest decided)
// and the raises they asked for; for a manager also the raises they asked for for their direct reports. Leave has a
// section of its own on the page (18 October 2026); attendance comes later. Pure code, tested: putting them in one list, and its filters by kind and status.
// Relative imports: the tests run without the "@/" alias.

/** Details changes, raises for themself, and a manager's raise requests for their direct reports. */
export const REQUEST_KINDS = ['details', 'raise', 'team'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  details: 'Details changes',
  raise: 'Raises',
  team: 'For my team',
};

/** Open: still being decided (a change waiting for HR; a raise with HR, with the CEO, or approved and to be signed). */
export const REQUEST_STATES = ['open', 'closed'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const REQUEST_STATE_LABELS: Record<RequestState, string> = { open: 'Open', closed: 'Closed' };

/** One of their requests, whatever its kind: `at`, when it was asked (ISO). */
export type MyRequest =
  | { kind: 'details'; id: string; at: string; open: boolean; request: ChangeRequest }
  | { kind: 'raise' | 'team'; id: string; at: string; open: boolean; request: RaiseRequest };

export const isOpenChange = (r: Pick<ChangeRequest, 'status'>) => r.status === 'pending';

export const isOpenRaise = (r: Pick<RaiseRequest, 'status'>) => OPEN_RAISE_REQUEST_STATUSES.includes(r.status);

/**
 * The raise requests a manager asked for themself (the direct manager, signed in with this email), among a direct
 * report's: not the employee's own, HR's, or an earlier manager's.
 */
export function askedByManager(requests: readonly RaiseRequest[], email: string): RaiseRequest[] {
  const me = email.trim().toLowerCase();
  return requests.filter((r) => r.requester === 'manager' && r.requestedBy?.email.toLowerCase() === me);
}

/** Their requests in one list, newest first; each once (by its kind and id). */
export function myRequests(from: {
  changes: readonly ChangeRequest[];
  raises: readonly RaiseRequest[];
  team?: readonly RaiseRequest[];
}): MyRequest[] {
  const all: MyRequest[] = [
    ...from.changes.map((r) => ({ kind: 'details' as const, id: r.id, at: r.requestedAt, open: isOpenChange(r), request: r })),
    ...from.raises.map((r) => ({ kind: 'raise' as const, id: r.id, at: r.createdAt, open: isOpenRaise(r), request: r })),
    ...(from.team ?? []).map((r) => ({ kind: 'team' as const, id: r.id, at: r.createdAt, open: isOpenRaise(r), request: r })),
  ];
  const seen = new Set<string>();
  return all
    .filter((r) => {
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
}

// ---------- the filters ----------

export interface RequestFilters {
  kind: RequestKind | '';
  status: RequestState | '';
}

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The filters in the page's address (?kind=raise&status=open); anything it doesn't know is All. */
export function readRequestFilters(query: Query): RequestFilters {
  const kind = one(query.kind);
  const status = one(query.status);
  return {
    kind: (REQUEST_KINDS as readonly string[]).includes(kind) ? (kind as RequestKind) : '',
    status: (REQUEST_STATES as readonly string[]).includes(status) ? (status as RequestState) : '',
  };
}

/** The page's address for these filters, leaving out the empty ones: "/my-requests?kind=raise&status=open". */
export function myRequestsHref(f: RequestFilters): string {
  const params = new URLSearchParams();
  if (f.kind) params.set('kind', f.kind);
  if (f.status) params.set('status', f.status);
  const qs = params.toString();
  return qs ? `/my-requests?${qs}` : '/my-requests';
}

const matchesStatus = (r: MyRequest, status: RequestFilters['status']) => !status || (status === 'open') === r.open;

/** The requests of a kind and a status (each All when empty), in the list's order. */
export function filterRequests(list: readonly MyRequest[], f: RequestFilters): MyRequest[] {
  return list.filter((r) => (!f.kind || r.kind === f.kind) && matchesStatus(r, f.status));
}

/**
 * How many each filter would list: by kind within the status chosen, and by status within the kind chosen, so each
 * chip says how many rows it shows.
 */
export function requestCounts(list: readonly MyRequest[], f: RequestFilters): { kinds: Record<RequestKind | '', number>; states: Record<RequestState | '', number> } {
  const ofStatus = list.filter((r) => matchesStatus(r, f.status));
  const ofKind = list.filter((r) => !f.kind || r.kind === f.kind);
  return {
    kinds: { '': ofStatus.length, details: 0, raise: 0, team: 0, ...count(ofStatus, (r) => r.kind) },
    states: { '': ofKind.length, open: 0, closed: 0, ...count(ofKind, (r) => (r.open ? 'open' : 'closed')) },
  };
}

function count<K extends string>(list: readonly MyRequest[], key: (r: MyRequest) => K): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const r of list) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
}

/** A request's heading on My Requests, in Title Case: "Change to Your Details", "Raise Request", "Raise Request for Nour Adel". */
export function requestTitle(r: MyRequest): string {
  if (r.kind === 'details') return 'Change to Your Details';
  return r.kind === 'team' ? `Raise Request for ${r.request.employee.fullNameEn}` : 'Raise Request';
}

/** The same in a list, in sentence case: "Change to your details", "Raise request", "Raise request for Nour Adel". */
export function requestLabel(r: MyRequest): string {
  if (r.kind === 'details') return 'Change to your details';
  return r.kind === 'team' ? `Raise request for ${r.request.employee.fullNameEn}` : 'Raise request';
}
