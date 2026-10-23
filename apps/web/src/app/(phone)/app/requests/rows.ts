import { isOpenReimbursement } from '@trendlix/shared';
import type { AttendanceCorrectionView } from '../../../../lib/correction-types';
import { formatDate } from '../../../../lib/format';
import type { HomeLocationView } from '../../../../lib/home-location-types';
import type { RaiseRequest } from '../../../../lib/raise-types';
import { APP_REQUEST_KINDS, appItemHref, type AppItemKind, type AppRequestKind, type AppSection } from '../../../../lib/surface';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../../lib/types';
import { correctionDayText, correctionKindName } from '../../../(app)/attendance/corrections/corrections';
import { homeProgressText, homeWhatText, isOpenHomeRequest } from '../../../(app)/home-locations/home-locations';
import { daysText, leaveProgressText, periodText } from '../../../(app)/leave/list';
import { permissionWhenText } from '../../../(app)/leave/permissions';
import { wfhDayText, wfhProgressText } from '../../../(app)/attendance/wfh/wfh';
import type { WfhRequestView } from '../../../../lib/wfh-types';
import { odProgressText, odWhenWords } from '../../../(app)/attendance/official-duty/od';
import type { OdRequestView } from '../../../../lib/od-types';
import { isOpenRaise } from '../../../(app)/my-requests/requests';
import { effectiveFromText, progressText as raiseProgressText } from '../../../(app)/raise-requests/list';
import { formatEgp } from '../../../(app)/employees/[id]/contracts/salary';
import { progressText as claimProgressText } from '../../../(app)/reimbursements/list';

// The phone pages' My Requests (owner, 20 October 2026: "what if we tried to build a mobile app for the employees? to
// enable them to check in and out, and apply for their requests"): every request of the employee's in one list, newest
// first, whatever its kind: leave, permission, reimbursement claims, attendance corrections and raise requests, each
// with where it stands as its own page says it, filtered by kind and open ones in the address. Each opens its page in
// the phone pages. Pure code, tested; the words are the site's (each kind's list.ts). Relative imports: vitest doesn't
// know the "@/" paths. Raise requests (owner, 20 October 2026: "raises not to be visible to employee level for now",
// then "Hide from managers too") only for someone who sees them (seesRaiseRequests, packages/shared raises.ts): no
// Raises chip otherwise, and ?kind=raise read as All. Home locations (owner, 20 October 2026: "allow other users to
// request to add their home locations when working from home"): their requests, each its label (or the point on the
// map) and radius, where it stands.

export type AppRequestRow =
  | { kind: 'leave'; id: string; at: string; open: boolean; request: LeaveRequestView }
  | { kind: 'permission'; id: string; at: string; open: boolean; request: PermissionRequestView }
  | { kind: 'reimbursement'; id: string; at: string; open: boolean; request: ReimbursementClaimView }
  | { kind: 'correction'; id: string; at: string; open: boolean; request: AttendanceCorrectionView }
  | { kind: 'raise'; id: string; at: string; open: boolean; request: RaiseRequest }
  | { kind: 'home'; id: string; at: string; open: boolean; request: HomeLocationView }
  | { kind: 'wfh'; id: string; at: string; open: boolean; request: WfhRequestView }
  | { kind: 'od'; id: string; at: string; open: boolean; request: OdRequestView };

/** The filter chips' words, the kinds in the order the New buttons are. */
export const APP_REQUEST_KIND_LABELS: Record<AppRequestKind, string> = {
  leave: 'Leave',
  permission: 'Permission',
  reimbursement: 'Reimbursements',
  correction: 'Corrections',
  raise: 'Raises',
  home: 'Home locations',
  wfh: 'Work from home',
  od: 'Official duty',
};

/** Still being decided: with the manager or HR (leave, permission, a correction); a claim or a raise being decided. */
const deciding = (status: string) => status === 'with_manager' || status === 'with_hr';

/** Their requests in one list, newest first (by when each was sent); each once. */
export function appRequestRows(from: {
  leave?: readonly LeaveRequestView[];
  permissions?: readonly PermissionRequestView[];
  claims?: readonly ReimbursementClaimView[];
  corrections?: readonly AttendanceCorrectionView[];
  raises?: readonly RaiseRequest[];
  homes?: readonly HomeLocationView[];
  wfh?: readonly WfhRequestView[];
  /** Official duty (23 October 2026). */
  od?: readonly OdRequestView[];
}): AppRequestRow[] {
  const rows: AppRequestRow[] = [
    ...(from.leave ?? []).map((r) => ({ kind: 'leave' as const, id: r.id, at: r.createdAt, open: deciding(r.status), request: r })),
    ...(from.permissions ?? []).map((r) => ({ kind: 'permission' as const, id: r.id, at: r.createdAt, open: deciding(r.status), request: r })),
    ...(from.claims ?? []).map((r) => ({ kind: 'reimbursement' as const, id: r.id, at: r.createdAt, open: isOpenReimbursement(r.status), request: r })),
    ...(from.corrections ?? []).map((r) => ({ kind: 'correction' as const, id: r.id, at: r.createdAt, open: deciding(r.status), request: r })),
    ...(from.raises ?? []).map((r) => ({ kind: 'raise' as const, id: r.id, at: r.createdAt, open: isOpenRaise(r), request: r })),
    ...(from.homes ?? []).map((r) => ({ kind: 'home' as const, id: r.id, at: r.createdAt, open: isOpenHomeRequest(r), request: r })),
    // working from home (21 October 2026)
    ...(from.wfh ?? []).map((r) => ({ kind: 'wfh' as const, id: r.id, at: r.createdAt, open: deciding(r.status), request: r })),
    // official duty (23 October 2026: "Manager, then HR")
    ...(from.od ?? []).map((r) => ({ kind: 'od' as const, id: r.id, at: r.createdAt, open: deciding(r.status), request: r })),
  ];
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
}

// ---------- the filters ----------

export interface AppRequestFilters {
  kind: AppRequestKind | '';
  status: 'open' | '';
}

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The kinds the list's chips offer: raise requests only to someone who sees them (20 October 2026). */
export const appRequestKindsFor = (seesRaises: boolean): AppRequestKind[] => APP_REQUEST_KINDS.filter((k) => seesRaises || k !== 'raise');

/** The filters in the address (?kind=leave&status=open); anything else is All, a kind not offered (`kinds`) too. */
export function readAppRequestFilters(query: Query, kinds: readonly AppRequestKind[] = APP_REQUEST_KINDS): AppRequestFilters {
  const kind = one(query.kind);
  return {
    kind: (kinds as readonly string[]).includes(kind) ? (kind as AppRequestKind) : '',
    status: one(query.status) === 'open' ? 'open' : '',
  };
}

/** The rows of a kind, open ones only when asked (each All when empty), in the list's order. */
export const filterAppRequests = (rows: readonly AppRequestRow[], f: AppRequestFilters): AppRequestRow[] =>
  rows.filter((r) => (!f.kind || r.kind === f.kind) && (!f.status || r.open));

/** How many each kind's chip lists, within the status chosen ('' for All). */
export function appRequestCounts(rows: readonly AppRequestRow[], f: Pick<AppRequestFilters, 'status'>): Record<AppRequestKind | '', number> {
  const shown = rows.filter((r) => !f.status || r.open);
  const counts: Record<AppRequestKind | '', number> = { '': shown.length, leave: 0, permission: 0, reimbursement: 0, correction: 0, raise: 0, home: 0, wfh: 0, od: 0 };
  for (const r of shown) counts[r.kind] += 1;
  return counts;
}

// ---------- a row ----------

/** What it is, in sentence case: the leave's type, "Permission", "Taxi reimbursement", "Attendance correction", "Raise request". */
export function appRequestTitle(row: AppRequestRow): string {
  switch (row.kind) {
    case 'leave':
      return row.request.type.nameEn;
    case 'permission':
      return 'Permission';
    case 'reimbursement':
      return `${row.request.type.nameEn} reimbursement`;
    case 'correction':
      return 'Attendance correction';
    case 'raise':
      return 'Raise request';
    case 'home':
      return 'Home location';
    case 'wfh':
      return 'Work from home';
    case 'od':
      return 'Official duty';
  }
}

/** When or what, in a line: the leave's days, the permission's day and hours, the claim's date and amount, … */
export function appRequestWhen(row: AppRequestRow): string {
  switch (row.kind) {
    case 'leave':
      return `${periodText(row.request)} · ${daysText(row.request.days)}`;
    case 'permission':
      return permissionWhenText(row.request);
    case 'reimbursement':
      return `${formatDate(row.request.expenseDate)} · ${formatEgp(row.request.approvedAmount ?? row.request.amount)}`;
    case 'correction':
      return `${correctionDayText(row.request)} · ${correctionKindName(row.request.correctionKind)}`;
    case 'raise':
      return `Effective from ${effectiveFromText(row.request)}`;
    case 'home':
      return homeWhatText(row.request);
    case 'wfh':
      return wfhDayText(row.request);
    case 'od':
      return odWhenWords(row.request);
  }
}

/** Where it stands, as its page says it. */
export function appRequestProgress(row: AppRequestRow): string {
  switch (row.kind) {
    case 'reimbursement':
      return claimProgressText(row.request).text;
    case 'raise':
      return raiseProgressText(row.request).text;
    case 'home':
      return homeProgressText(row.request).text;
    case 'wfh':
      return wfhProgressText(row.request).text;
    case 'od':
      return odProgressText(row.request).text;
    default:
      return leaveProgressText(row.request).text;
  }
}

/** Its page in a section of the phone pages. */
export const appRequestHref = (row: Pick<AppRequestRow, 'kind' | 'id'>, section: AppSection = 'requests') => appItemHref(section, row.kind as AppItemKind, row.id);
