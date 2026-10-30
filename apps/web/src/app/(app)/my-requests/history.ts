import { homeStatusLabel, PERMISSION_LABEL, type HomeStatus, type LeaveStatus, type RaiseRequestStatus, type ReimbursementStatus } from '@trendlix/shared';
import { formatDate } from '../../../lib/format';
import type { AttendanceCorrectionView } from '../../../lib/correction-types';
import type { CompensatoryRequestView } from '../../../lib/compensatory-types';
import type { HomeLocationView } from '../../../lib/home-location-types';
import type { OdRequestView } from '../../../lib/od-types';
import type { ResignationRequestView } from '../../../lib/resignation-types';
import type { LeaveRequestView, PermissionRequestView, ReimbursementClaimView } from '../../../lib/types';
import type { WfhRequestView } from '../../../lib/wfh-types';
import { compensatoryDaysLine, compensatoryHref } from '../attendance/compensatory/compensatory';
import { correctionDayText, correctionHref, correctionKindName } from '../attendance/corrections/corrections';
import { odHref, odSpanText, odWhenWords } from '../attendance/official-duty/od';
import { wfhDayText, wfhHref } from '../attendance/wfh/wfh';
import { homeEnded, homeLocationHref, homeWhatText } from '../home-locations/home-locations';
import { daysText, leaveHref, leaveStatusLabel, periodText } from '../leave/list';
import { permissionDayText, permissionHoursLine, permissionHref } from '../leave/permissions';
import { weekdayOf } from '../organization/holidays/holidays';
import { effectiveFromText, raiseRequestAnchor, statusLabel as raiseStatusLabel } from '../raise-requests/list';
import { claimHref, statusLabel as claimStatusLabel } from '../reimbursements/list';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { changeStatusLabel } from '../requests/details-changes/list';
import { resignationHref } from '../resignations/resignation';
import { myRequestsHref, requestLabel, type MyRequest } from './requests';

// My Requests' "Recent requests" (the owner's design, Figma "PeopleTrendlix", 30 October 2026: HISTORY, a table of the
// requests with All / Approved / Waiting): every request the person asked for, of every kind the page lists, in one
// table, newest asked first: what it is, the day (or days) it is for, how long, where it stands, opening its own page.
// Each kind keeps its section below on the page, with every detail its table had; this is the overview, with the
// "Requests this year" figure above it. Built from what the page already reads: nothing new is asked of the API. Pure
// code, tested; relative imports, as vitest reads them.

export type HistoryKind = 'leave' | 'permission' | 'correction' | 'wfh' | 'od' | 'compensatory' | 'home' | 'claim' | 'resignation' | 'details' | 'raise' | 'team';

/** Where a request stands, as the filter and the badge read it: approved (or recorded, done), being decided, or closed otherwise. */
export type HistoryState = 'approved' | 'waiting' | 'closed';

/** One row of the table. `at`: when it was asked (ISO), for the order and the year. */
export interface HistoryRow {
  key: string;
  kind: HistoryKind;
  title: string;
  /** The small line under the title: what it is about and when it was sent ("Recorded by HR 26/10/2026"). */
  sub: string;
  /** The day or days it is for; "—" for a request about no day. */
  date: string;
  duration: string;
  status: string;
  state: HistoryState;
  href: string;
  at: string;
}

/** What the page read, each kind as its section has it (left out: not read, e.g. an API from before it). */
export interface HistorySources {
  leave?: readonly LeaveRequestView[];
  permissions?: readonly PermissionRequestView[];
  corrections?: readonly AttendanceCorrectionView[];
  wfh?: readonly WfhRequestView[];
  od?: readonly OdRequestView[];
  compensatory?: readonly CompensatoryRequestView[];
  homes?: readonly HomeLocationView[];
  claims?: readonly ReimbursementClaimView[];
  resignations?: readonly ResignationRequestView[];
  /** The changes to their details and the raises, as myRequests puts them together. */
  requests?: readonly MyRequest[];
}

const NONE = '—';

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/** "Sent 26/10/2026", "Recorded by HR 26/10/2026": the day, in Cairo, it was asked. */
const sentOn = (at: string, byHr = false, hrWords = 'Recorded by HR') => `${byHr ? hrWords : 'Sent'} ${formatDate(at)}`;

/** The leave-like requests (leave, permission, corrections, work from home, official duty, compensatory days). */
export function leaveState(status: LeaveStatus): HistoryState {
  if (status === 'approved') return 'approved';
  return status === 'with_manager' || status === 'with_hr' ? 'waiting' : 'closed';
}

export function homeState(status: HomeStatus): HistoryState {
  if (status === 'approved') return 'approved';
  return status === 'with_hr' || status === 'with_ceo' ? 'waiting' : 'closed';
}

export function claimState(status: ReimbursementStatus): HistoryState {
  if (status === 'approved') return 'approved';
  return status === 'rejected' || status === 'cancelled' ? 'closed' : 'waiting';
}

/** A resignation HR recorded went through; sent is waiting for HR; withdrawn or returned is closed. */
export function resignationState(status: ResignationRequestView['status']): HistoryState {
  if (status === 'recorded') return 'approved';
  return status === 'sent' ? 'waiting' : 'closed';
}

/** A raise approved (to be signed) or done went through; with HR or the CEO is waiting; declined is closed. */
export function raiseState(status: RaiseRequestStatus): HistoryState {
  if (status === 'approved' || status === 'done') return 'approved';
  return status === 'with_hr' || status === 'with_ceo' ? 'waiting' : 'closed';
}

/** The resignation rule's notice as a length: "3 months’ notice", "1 month’s notice". */
export const noticeText = (notice: string) => `${notice}${notice.endsWith('s') ? '’' : '’s'} notice`;

/** The anchor of a change to their details on My Requests (its card), for a row of one that has no page of its own. */
export const detailsRequestAnchor = (id: string) => `details-request-${id}`;

function fromRequest(item: MyRequest): HistoryRow {
  if (item.kind === 'details') {
    const r = item.request;
    return {
      key: `details:${r.id}`,
      kind: 'details',
      title: requestLabel(item),
      sub: join(r.changes.map((c) => c.label).join(', '), sentOn(r.requestedAt)),
      date: NONE,
      duration: NONE,
      status: changeStatusLabel(r.status, r.confidential),
      state: r.status === 'pending' ? 'waiting' : r.status === 'approved' ? 'approved' : 'closed',
      // the one waiting opens its page (see or cancel it); a decided one, its card below
      href: item.open
        ? `/employees/${encodeURIComponent(r.employee.id)}/change-request`
        : `${myRequestsHref({ kind: 'details', status: '' })}#${detailsRequestAnchor(r.id)}`,
      at: item.at,
    };
  }
  const r = item.request;
  return {
    key: `${item.kind}:${r.id}`,
    kind: item.kind,
    title: requestLabel(item),
    sub: `Asked ${formatDate(r.createdAt)}`,
    date: r.effectiveFrom ? `From ${effectiveFromText(r)}` : NONE,
    duration: NONE,
    status: raiseStatusLabel(r.status, r.confidential),
    state: raiseState(r.status),
    href: `${myRequestsHref({ kind: item.kind, status: '' })}#${raiseRequestAnchor(r.id)}`,
    at: item.at,
  };
}

/** Every request in one list, newest asked first; each once (by its kind and id). */
export function historyRows(s: HistorySources): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...(s.leave ?? []).map((r) => ({
      key: `leave:${r.id}`,
      kind: 'leave' as const,
      title: r.type.nameEn,
      sub: sentOn(r.createdAt, r.recordedByHr),
      date: periodText(r),
      duration: daysText(r.days),
      status: leaveStatusLabel(r.status, r.confidential),
      state: leaveState(r.status),
      href: leaveHref(r.id),
      at: r.createdAt,
    })),
    ...(s.permissions ?? []).map((r) => ({
      key: `permission:${r.id}`,
      kind: 'permission' as const,
      title: PERMISSION_LABEL,
      sub: sentOn(r.createdAt, r.recordedByHr),
      date: permissionDayText(r),
      duration: permissionHoursLine(r),
      status: leaveStatusLabel(r.status, r.confidential),
      state: leaveState(r.status),
      href: permissionHref(r.id),
      at: r.createdAt,
    })),
    ...(s.corrections ?? []).map((c) => ({
      key: `correction:${c.id}`,
      kind: 'correction' as const,
      title: 'Attendance correction',
      sub: join(correctionKindName(c.correctionKind), sentOn(c.createdAt, c.recordedByHr, 'Corrected by HR')),
      date: correctionDayText(c),
      duration: NONE,
      status: leaveStatusLabel(c.status, c.confidential),
      state: leaveState(c.status),
      href: correctionHref(c.id),
      at: c.createdAt,
    })),
    ...(s.wfh ?? []).map((r) => ({
      key: `wfh:${r.id}`,
      kind: 'wfh' as const,
      title: 'Work from home',
      sub: sentOn(r.createdAt, r.recordedByHr),
      date: wfhDayText(r),
      // a request is for one working day
      duration: daysText(1),
      status: leaveStatusLabel(r.status, r.confidential),
      state: leaveState(r.status),
      href: wfhHref(r.id),
      at: r.createdAt,
    })),
    ...(s.od ?? []).map((r) => ({
      key: `od:${r.id}`,
      kind: 'od' as const,
      title: 'Official duty',
      sub: join(r.dutyPlace, sentOn(r.createdAt, r.recordedByHr === true)),
      date: odWhenWords(r),
      duration: odSpanText(r),
      status: leaveStatusLabel(r.status, r.confidential),
      state: leaveState(r.status),
      href: odHref(r.id),
      at: r.createdAt,
    })),
    ...(s.compensatory ?? []).map((r) => ({
      key: `compensatory:${r.id}`,
      kind: 'compensatory' as const,
      title: 'Compensatory day',
      sub: sentOn(r.createdAt, r.recordedByHr),
      date: compensatoryDaysLine(r),
      duration: NONE,
      status: leaveStatusLabel(r.status, r.confidential),
      state: leaveState(r.status),
      href: compensatoryHref(r.id),
      at: r.createdAt,
    })),
    ...(s.homes ?? []).map((r) => ({
      key: `home:${r.id}`,
      kind: 'home' as const,
      title: 'Check-in location',
      sub: join(homeWhatText(r), sentOn(r.createdAt)),
      date: NONE,
      duration: NONE,
      status: homeEnded(r) ? 'Ended' : homeStatusLabel(r.status, r.confidential),
      state: homeState(r.status),
      href: homeLocationHref(r.id),
      at: r.createdAt,
    })),
    ...(s.claims ?? []).map((c) => ({
      key: `claim:${c.id}`,
      kind: 'claim' as const,
      title: 'Reimbursement',
      sub: join(c.type.nameEn, formatEgp(c.amount), sentOn(c.createdAt)),
      date: `${weekdayOf(c.expenseDate)} ${formatDate(c.expenseDate)}`,
      duration: NONE,
      status: claimStatusLabel(c.status, c.confidential),
      state: claimState(c.status),
      href: claimHref(c.id),
      at: c.createdAt,
    })),
    ...(s.resignations ?? []).map((r) => ({
      key: `resignation:${r.id}`,
      kind: 'resignation' as const,
      title: 'Resignation',
      sub: `Sent ${formatDate(r.sentOn)}`,
      // the last working day its notice gives, and the notice
      date: `Last day ${formatDate(r.ruleLastDay)}`,
      duration: r.notice ? noticeText(r.notice) : NONE,
      status: r.statusLabel,
      state: resignationState(r.status),
      href: resignationHref(r.id),
      at: r.createdAt,
    })),
    ...(s.requests ?? []).map(fromRequest),
  ];
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (seen.has(r.key)) return false;
      seen.add(r.key);
      return true;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.key.localeCompare(a.key));
}

// ---------- the filter: All, Approved, Waiting ----------

export const HISTORY_FILTERS = ['approved', 'waiting'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number] | '';

export const HISTORY_FILTER_LABELS: Record<HistoryFilter, string> = {
  '': 'All',
  approved: 'Approved',
  waiting: 'Waiting',
};

/** The panel's anchor: the filter's links come back to it. */
export const HISTORY_ID = 'recent-requests';

/** How many rows the panel shows before "Show all". */
export const HISTORY_LIMIT = 10;

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The filter in the address (?show=waiting); anything else is All. */
export function readHistoryFilter(query: Query): HistoryFilter {
  const v = one(query.show);
  return (HISTORY_FILTERS as readonly string[]).includes(v) ? (v as HistoryFilter) : '';
}

/** Whether every row is asked for (?all=1), not only the latest HISTORY_LIMIT. */
export const readHistoryAll = (query: Query) => one(query.all) === '1';

/**
 * The page's address for the panel's filter, keeping the changes-and-raises filters already chosen (?kind=, ?status=)
 * and landing on the panel: "/my-requests?kind=raise&show=waiting#recent-requests".
 */
export function historyHref(query: Query, show: HistoryFilter, all = false): string {
  const params = new URLSearchParams();
  for (const key of ['kind', 'status'] as const) {
    const v = one(query[key]);
    if (v) params.set(key, v);
  }
  if (show) params.set('show', show);
  if (all) params.set('all', '1');
  const qs = params.toString();
  return `/my-requests${qs ? `?${qs}` : ''}#${HISTORY_ID}`;
}

export const filterHistory = (rows: readonly HistoryRow[], show: HistoryFilter): HistoryRow[] => (show ? rows.filter((r) => r.state === show) : [...rows]);

/** What the panel says when nothing matches its filter. */
export function emptyHistoryText(show: HistoryFilter): string {
  if (show === 'approved') return 'None of your requests is approved yet.';
  if (show === 'waiting') return 'Nothing is waiting: every request you sent is decided.';
  return 'You haven’t asked for anything yet. Start a request below.';
}

// ---------- "Requests this year" ----------

/** The year a request was asked in, in Cairo: "2026". */
const yearOf = (at: string) => formatDate(at).slice(-4);

/**
 * The requests asked for this year (`year`, "2026") and where they stand, in the figure's note: "Both requests approved",
 * "3 approved · 1 waiting · 1 closed"; "None asked for yet".
 */
export function yearSummary(rows: readonly HistoryRow[], year: string): { count: number; approved: number; waiting: number; note: string } {
  const mine = rows.filter((r) => yearOf(r.at) === year);
  const count = mine.length;
  const approved = mine.filter((r) => r.state === 'approved').length;
  const waiting = mine.filter((r) => r.state === 'waiting').length;
  const closed = count - approved - waiting;
  let note: string;
  if (count === 0) note = 'None asked for yet';
  else if (approved === count) note = count === 1 ? 'Approved' : count === 2 ? 'Both requests approved' : 'All approved';
  else note = join(approved ? `${approved} approved` : null, waiting ? `${waiting} waiting` : null, closed ? `${closed} closed` : null);
  return { count, approved, waiting, note };
}

/** The figure as the design writes it, two digits: "02", "14". */
export const twoDigits = (n: number) => (n >= 0 && n < 10 ? `0${n}` : String(n));
