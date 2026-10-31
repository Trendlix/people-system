import { WFH_LABEL } from '@trendlix/shared';
import { LEAVE_PATH } from '../../../components/nav';
import { parseDate } from '../../../lib/format';
import type { LeaveTypeView } from '../../../lib/types';
import { type LeaveFilter } from './list';
import type { RequestKind } from './permissions';

// Leave Requests filtered by employee and type (owner, 26 October 2026: "i need to filter either by employee or typ"): an
// Employee and a Type beside the status, in the page's address (?employee=<id>&type=<leave type id | permission>, so a
// link keeps them and a refresh too), with Clear filters. The Type holds the leave types and Permission, and replaces the
// kind row (All · Leave · Permissions): choosing Permission is what the kind Permissions was. A link from before it
// (?kind=permission) still opens the permissions. Then a From and a To (owner, 26 October 2026: "add date filter too (from
// - to)"): the requests with a day between them (a leave ending on or after From and starting on or before To, a
// permission on a day between), either alone too (?from=YYYY-MM-DD&to=YYYY-MM-DD). Work from home with them (owner, 26
// October 2026: "YES move it to leaves", then "Show it with leave"): a Type of its own after Permission (?type=wfh), the
// work from home requests listed among the leave and the permissions; a working day, never a leave type (it stays a work
// from home request: no balance). Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** The Type filter's choice for permission requests. */
export const PERMISSION_TYPE = 'permission';

/** The Type filter's choice for work from home requests (26 October 2026): not a leave type, a working day. */
export const WFH_TYPE = 'wfh';

/** Which requests the list shows: the leave's and the permissions' kinds (permissions.ts), or the work from home requests. */
export type ListKind = RequestKind | 'wfh';

/**
 * How the list is ordered (owner, 31 October 2026: "allow me to sort by date without grouping"): by department and team,
 * newest first in each (as before, the default), or one list by the request's day, newest or oldest first.
 */
export const REQUEST_ORDERS = ['department', 'newest', 'oldest'] as const;
export type RequestOrder = (typeof REQUEST_ORDERS)[number];

export const ORDER_CHOICES: readonly { value: RequestOrder; label: string }[] = [
  { value: 'department', label: 'By department' },
  { value: 'newest', label: 'By date, newest first' },
  { value: 'oldest', label: 'By date, oldest first' },
];

/** The filters in the address: one person, one type (a leave type's id, "permission" or "wfh"), the first and last day (YYYY-MM-DD); null: any. And the order (none: by department). */
export interface RequestFilters {
  employeeId: string | null;
  type: string | null;
  from: string | null;
  to: string | null;
  order?: RequestOrder;
}

/** The rows in the order chosen: by date, one list by the request's first day (then when it was sent); by department, as they came. */
export function orderedRows<R extends { startDate: string; createdAt: string }>(rows: readonly R[], order: RequestOrder | undefined): R[] {
  if (order !== 'newest' && order !== 'oldest') return [...rows];
  const sign = order === 'newest' ? -1 : 1;
  return [...rows].sort((a, b) => sign * (a.startDate.localeCompare(b.startDate) || a.createdAt.localeCompare(b.createdAt)));
}

export const NO_FILTERS: RequestFilters = { employeeId: null, type: null, from: null, to: null };

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A day in the address: YYYY-MM-DD, or as typed in the form (DD/MM/YYYY); null for none or what isn't a day. */
function dayOf(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseDate(`${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`) || null;
  return parseDate(v) || null;
}

/** The filters in the page's address; what isn't a person's id, a type's id, "permission" or "wfh", or a day, is ignored; From after To swapped. */
export function readRequestFilters(query: Query): RequestFilters {
  const employee = one(query.employee);
  const type = one(query.type);
  // a link from before the Type filter: the kind Permissions
  const legacy = one(query.kind) === 'permission' ? PERMISSION_TYPE : null;
  let from = dayOf(one(query.from));
  let to = dayOf(one(query.to));
  if (from && to && from > to) [from, to] = [to, from];
  const order = one(query.order);
  return {
    employeeId: UUID.test(employee) ? employee : null,
    type: type === PERMISSION_TYPE || type === WFH_TYPE || UUID.test(type) ? type : legacy,
    from,
    to,
    // by department unless another order is chosen
    ...(order !== 'department' && (REQUEST_ORDERS as readonly string[]).includes(order) && { order: order as RequestOrder }),
  };
}

/** Whether any filter is on. */
export const hasRequestFilters = (f: RequestFilters) => f.employeeId !== null || f.type !== null || f.from !== null || f.to !== null;

/** Which requests the type chooses: all three without one, the permissions, the work from home requests, or a leave type's leave. */
export function kindOfFilters(f: RequestFilters): ListKind {
  if (f.type === null) return 'all';
  if (f.type === PERMISSION_TYPE) return 'permission';
  return f.type === WFH_TYPE ? 'wfh' : 'leave';
}

/** The leave type to ask the API for (typeId); null for any, and for Permission and Work from home. */
export const leaveTypeOf = (f: RequestFilters): string | null => (f.type !== null && f.type !== PERMISSION_TYPE && f.type !== WFH_TYPE ? f.type : null);

/**
 * The list's address for a status and the filters: "/leave?status=approved&employee=<id>&type=permission"; without a
 * status (null), the user's default one. Each link of the status row keeps the filters, and the form keeps the status.
 */
export function requestFiltersHref(status: LeaveFilter | null, f: RequestFilters): string {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (f.employeeId) params.set('employee', f.employeeId);
  if (f.type) params.set('type', f.type);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.order && f.order !== 'department') params.set('order', f.order);
  const qs = params.toString();
  return qs ? `${LEAVE_PATH}?${qs}` : LEAVE_PATH;
}

/** The Type's choices: Any type, the leave types in their order (turned off ones marked), then Permission and Work from home. */
export function typeChoices(types: readonly Pick<LeaveTypeView, 'id' | 'nameEn' | 'active' | 'sortOrder'>[]): { value: string; label: string }[] {
  return [
    { value: '', label: 'All types' },
    ...[...types].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => ({ value: t.id, label: t.active ? t.nameEn : `${t.nameEn} (off)` })),
    { value: PERMISSION_TYPE, label: 'Permission' },
    { value: WFH_TYPE, label: WFH_LABEL },
  ];
}

/** What the list says when no request has the filters chosen. */
export const NO_MATCH_TEXT = 'No requests match these filters.';
