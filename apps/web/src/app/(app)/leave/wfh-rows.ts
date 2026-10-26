import type { LeaveRequestView, PermissionRequestView } from '../../../lib/types';
import type { WfhRequestView } from '../../../lib/wfh-types';
import { wfhHref, type WfhFilter, type WfhQuery } from '../attendance/wfh/wfh';
import type { LeaveFilter } from './list';
import { emptyRequestsText, isPermission, requestHref, type RequestRow } from './permissions';
import type { ListKind } from './request-filters';

// Work from home shown with leave (owner, 26 October 2026, on Record leave's types: "YES move it to leaves"; asked what
// that means, "Show it with leave"): a working day, never a leave type (it stays a work from home request: no balance,
// checked in from home), listed on Leave Requests with the leave and the permissions: under All types, merged by its day
// as the permissions are, or alone with the Type Work from home; the status chips, the Employee and From–To apply to it
// as to them (GET /wfh takes the same status, employeeId, from and to); each row opens its own page. Pure code, tested;
// relative imports, as vitest doesn't know the @/ paths.

/** A row of Leave Requests: a leave request, a permission request, or a work from home request. */
export type LeaveListRow = RequestRow | WfhRequestView;

/** Whether a row is a work from home request. */
export const isWfh = (r: LeaveListRow): r is WfhRequestView => 'kind' in r && r.kind === 'wfh';

/** What a row is, for its key and its words: leave, a permission, or a work from home day. */
export const rowKind = (r: LeaveListRow): 'leave' | 'permission' | 'wfh' => (isWfh(r) ? 'wfh' : isPermission(r) ? 'permission' : 'leave');

/** The three lists in one, newest first: the latest day first, then the latest sent (a work from home day by its day). */
export function mergeLeaveList(leave: readonly LeaveRequestView[], permissions: readonly PermissionRequestView[], wfh: readonly WfhRequestView[]): LeaveListRow[] {
  return [...leave, ...permissions, ...wfh].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
}

/** A row's page: the leave request's, the permission request's, or the work from home request's (/attendance/wfh/<id>). */
export const rowHref = (r: LeaveListRow) => (isWfh(r) ? wfhHref(r.id) : requestHref(r));

/**
 * Leave Requests' status as the work from home list takes it: one for one (Waiting for you, the caller's to decide; All;
 * each status), as both go through the same stages.
 */
const WFH_FILTER_OF: Record<LeaveFilter, WfhFilter> = {
  waiting: 'waiting',
  all: 'all',
  with_manager: 'with_manager',
  with_hr: 'with_hr',
  approved: 'approved',
  rejected: 'rejected',
  cancelled: 'cancelled',
};

/** The work from home list's filters for Leave Requests' status, person and days (GET /wfh?status=&employeeId=&from=&to=). */
export function wfhQueryOf(filter: LeaveFilter, employeeId: string | null, days: { from: string | null; to: string | null }): Partial<WfhQuery> {
  return { filter: WFH_FILTER_OF[filter], employeeId, from: days.from, to: days.to };
}

/** The second line of a work from home row's When, where a leave has its days and a permission its hours. */
export const WFH_WHEN_NOTE = 'A working day, not leave';

const EMPTY_WFH: Record<LeaveFilter, string> = {
  waiting: 'No work from home requests are waiting for you.',
  all: 'No work from home requests yet. Employees ask from My Requests; HR records a day for someone with Record leave, choosing Work from home.',
  with_manager: 'No work from home requests are with a direct manager.',
  with_hr: 'No work from home requests are with HR.',
  approved: 'No work from home days approved.',
  rejected: 'No work from home requests rejected.',
  cancelled: 'No work from home days cancelled.',
};

const EMPTY_ALL: Record<LeaveFilter, string> = {
  waiting: 'No leave, permission or work from home requests are waiting for you.',
  all: 'No leave, permission or work from home requests yet. Employees ask for them from My Requests; HR records them on their behalf with Record leave (work from home too) and Record permission.',
  with_manager: 'No leave, permission or work from home requests are with a direct manager.',
  with_hr: 'No leave, permission or work from home requests are with HR.',
  approved: 'No leave, permission or work from home approved.',
  rejected: 'No leave, permission or work from home requests rejected.',
  cancelled: 'No leave, permission or work from home cancelled.',
};

/** What the list says when nothing has the status and the kind chosen: all three, the work from home alone, or as before. */
export function listEmptyText(filter: LeaveFilter, kind: ListKind): string {
  if (kind === 'all') return EMPTY_ALL[filter];
  return kind === 'wfh' ? EMPTY_WFH[filter] : emptyRequestsText(filter, kind);
}
