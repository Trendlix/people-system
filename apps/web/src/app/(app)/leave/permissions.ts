import {
  isHalfHours,
  leaveStatusAfterApproval,
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  PERMISSION_DAY_MAX,
  PERMISSION_LABEL,
  PERMISSION_STEP_HOURS,
  permissionClock,
  permissionHoursText,
  permissionMonth,
  permissionRequestProblems,
  permissionTimes,
  underLabourLaw,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type Role,
} from '@trendlix/shared';
import { LEAVE_PATH, MY_TEAM } from '../../../components/nav';
import { formatDate, formatTime, parseDate, parseTime } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';
import type { LeaveRequestStep, LeaveRequestView, PermissionMonthView, PermissionRequestView, RequestApprover } from '../../../lib/types';
import { weekdayOf } from '../organization/holidays/holidays';
import { myRequestsHref } from '../my-requests/requests';
import { monthName } from '../payroll/list';
import {
  canSeeLeaveRequests,
  emptyLeaveText,
  hrStageName,
  LEAVE_MOVED_ON,
  leaveDecisionButton,
  leaveHref,
  leaveSentText,
  leaveStepText,
  type LeaveDone,
  type LeaveFilter,
} from './list';
import { asShown, REASON_MAX } from './request';

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day"; asked how it is asked for, "In the system, like leave"; asked where its limits live, "Yes, in Leave Setup"):
// an employee asks to be away for a few hours of a working day from My Requests → New permission, or HR records one on
// their behalf (approved at once, as Record leave): the day, the hours in half hours up to the day's most, the times when
// given (leaving at 17:00: with one of them the other follows from the hours), and a reason; the form shows what is left
// of the month's hours. Decided exactly as leave is (the direct manager, else the team lead, else the department's head,
// then HR; a C-level person's HR stage by the CEO), so the leave's words are reused where they fit; listed beside the
// leave on Leave Requests (?kind=permission), My Requests, My Team and the calendar. The rules are @trendlix/shared's
// (permissions.ts), which the API enforces; these helpers word what it sent, read the form and show the same checks
// live. Times are typed and shown in 12-hour time, as every time on screen (owner's decision, 14 October 2026); the API
// takes and sends HH:MM. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

// ---------- the addresses ----------

/** Where permission requests live: under Leave Requests. */
export const PERMISSIONS_PATH = `${LEAVE_PATH}/permissions`;

/** The new permission form, for anyone with an employee profile, for themself (from My Requests, or Leave Requests). */
export const NEW_PERMISSION_PATH = `${PERMISSIONS_PATH}/new`;

/** HR's form to record permission on an employee's behalf. */
export const RECORD_PERMISSION_PATH = `${PERMISSIONS_PATH}/record`;

/** HR's form with an employee chosen already: "/leave/permissions/record?employee=<id>". */
export const recordPermissionHref = (employeeId?: string | null) =>
  employeeId ? `${RECORD_PERMISSION_PATH}?employee=${encodeURIComponent(employeeId)}` : RECORD_PERMISSION_PATH;

/** A permission request's page, where it is decided and cancelled: "/leave/permissions/<id>". */
export const permissionHref = (id: string) => `${PERMISSIONS_PATH}/${encodeURIComponent(id)}`;

/** What was just done on a permission request, said on its page by `?done=`: as on a leave request. */
export type PermissionDone = LeaveDone;

/** A permission request's page after something was done on it: "/leave/permissions/<id>?done=sent". */
export const permissionDoneHref = (id: string, done: PermissionDone) => `${permissionHref(id)}?done=${done}`;

/** Where the employee's own permission is listed: its part of My Requests' Leave section. */
export const MY_PERMISSION_HREF = `${myRequestsHref({ kind: '', status: '' })}#my-permission`;

/** Where a permission request's page goes back to: as a leave request's (Leave Requests, My Requests, or My Team). */
export function permissionBack(user: WithRoles & { employeeId?: string | null }, r: Pick<PermissionRequestView, 'employee'>): { href: string; label: string } {
  if (canSeeLeaveRequests(user)) return { href: requestListHref(null, 'permission'), label: 'Leave Requests' };
  if (user.employeeId && r.employee.id === user.employeeId) return { href: MY_PERMISSION_HREF, label: 'My Requests' };
  return { href: MY_TEAM, label: 'My Team' };
}

/** Where the new permission form's back link and Cancel go: Leave Requests for those who see it, else My Requests. */
export const newPermissionBack = (user: WithRoles): { href: string; label: string } =>
  canSeeLeaveRequests(user) ? { href: LEAVE_PATH, label: 'Leave Requests' } : { href: MY_PERMISSION_HREF, label: 'My Requests' };

// ---------- the list: leave, permissions, or both ----------

/** Which requests Leave Requests lists: both, the leave only, or the permissions only (?kind=). */
export type RequestKind = 'all' | 'leave' | 'permission';

export const REQUEST_KIND_FILTERS: readonly { value: RequestKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'leave', label: 'Leave' },
  { value: 'permission', label: 'Permissions' },
];

/** The kind in the address (?kind=leave|permission); none, or anything else, is both. */
export function readRequestKind(query: Query): RequestKind {
  const v = one(query.kind);
  return v === 'leave' || v === 'permission' ? v : 'all';
}

/**
 * The list's address for a status and a kind, each kept by the other's links: "/leave?status=waiting&kind=permission";
 * without a status (null), the user's default one.
 */
export function requestListHref(filter: LeaveFilter | null, kind: RequestKind = 'all'): string {
  const params = new URLSearchParams();
  if (filter) params.set('status', filter);
  if (kind !== 'all') params.set('kind', kind);
  const qs = params.toString();
  return qs ? `${LEAVE_PATH}?${qs}` : LEAVE_PATH;
}

/** The API's permissions for a filter: GET /leave/permissions?status=waiting|<status>, without one for All; `employeeId` for one person's. */
export function permissionsPath(filter: LeaveFilter, employeeId?: string | null): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (employeeId) params.set('employeeId', employeeId);
  const qs = params.toString();
  return qs ? `/leave/permissions?${qs}` : '/leave/permissions';
}

/** The permission requests waiting for the caller: My Team's and the dashboard's Leave to Approve. */
export const WAITING_PERMISSIONS = permissionsPath('waiting');

const EMPTY_PERMISSIONS: Record<LeaveFilter, string> = {
  waiting: 'No permission requests are waiting for you.',
  all: 'No permission requests yet. Employees ask for permission from My Requests; HR records it on their behalf with Record permission.',
  with_manager: 'No permission requests are with a direct manager.',
  with_hr: 'No permission requests are with HR.',
  approved: 'No permission approved.',
  rejected: 'No permission requests rejected.',
  cancelled: 'No permission cancelled.',
};

const EMPTY_BOTH: Record<LeaveFilter, string> = {
  waiting: 'No leave or permission requests are waiting for you.',
  all: 'No leave or permission requests yet. Employees ask for them from My Requests; HR records them on their behalf with Record leave and Record permission.',
  with_manager: 'No leave or permission requests are with a direct manager.',
  with_hr: 'No leave or permission requests are with HR.',
  approved: 'No leave or permission approved.',
  rejected: 'No leave or permission requests rejected.',
  cancelled: 'No leave or permission cancelled.',
};

/** What the list says when nothing has the status and the kind chosen. */
export function emptyRequestsText(filter: LeaveFilter, kind: RequestKind): string {
  if (kind === 'leave') return emptyLeaveText(filter);
  return kind === 'permission' ? EMPTY_PERMISSIONS[filter] : EMPTY_BOTH[filter];
}

/** A row of the lists that show both: a leave request, or a permission request. */
export type RequestRow = LeaveRequestView | PermissionRequestView;

/** Whether a row is a permission request (a leave request has no `kind`). */
export const isPermission = (r: RequestRow): r is PermissionRequestView => 'kind' in r && r.kind === 'permission';

/** The leave and the permissions in one list, newest first: the latest day first, then the latest sent. */
export function mergeRequests(leave: readonly LeaveRequestView[], permissions: readonly PermissionRequestView[]): RequestRow[] {
  return [...leave, ...permissions].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
}

/** A row's page: the leave request's, or the permission request's. */
export const requestHref = (r: RequestRow) => (isPermission(r) ? permissionHref(r.id) : leaveHref(r.id));

// ---------- a permission, in words ----------

/** A time (HH:MM) as the screens show it: 12-hour, "5:00 PM". */
const shownTime = (hhmm: string) => formatTime(hhmm);

/** The permission's times as its row says them: "5:00 PM – 7:00 PM", "from 5:00 PM", "until 7:00 PM"; null without times. */
export function permissionTimesText(p: { fromTime?: string | null; toTime?: string | null }): string | null {
  if (p.fromTime && p.toTime) return `${shownTime(p.fromTime)} – ${shownTime(p.toTime)}`;
  if (p.fromTime) return `from ${shownTime(p.fromTime)}`;
  if (p.toTime) return `until ${shownTime(p.toTime)}`;
  return null;
}

/** Its day with the weekday: "Tuesday 03/11/2026". */
export const permissionDayText = (p: Pick<PermissionRequestView, 'date'>) => `${weekdayOf(p.date)} ${formatDate(p.date)}`;

/** Its hours, with the times when given: "2 hours (5:00 PM – 7:00 PM)", "1 hour 30 minutes". */
export function permissionHoursLine(p: { hours: number; fromTime?: string | null; toTime?: string | null }): string {
  const times = permissionTimesText(p);
  return times ? `${permissionHoursText(p.hours)} (${times})` : permissionHoursText(p.hours);
}

/** When it is, as its row and page say it: "Tuesday 03/11/2026 · 2 hours (5:00 PM – 7:00 PM)". */
export const permissionWhenText = (p: Pick<PermissionRequestView, 'date' | 'hours' | 'fromTime' | 'toTime'>) => `${permissionDayText(p)} · ${permissionHoursLine(p)}`;

/** The choices of hours, in half hours up to the day's most: "30 minutes", "1 hour", "1 hour 30 minutes", "2 hours". */
export function permissionHourOptions(maxHoursPerDay: number): { value: string; label: string }[] {
  const steps = Math.floor(Math.min(maxHoursPerDay, PERMISSION_DAY_MAX) / PERMISSION_STEP_HOURS + 1e-9);
  return Array.from({ length: Math.max(0, steps) }, (_, i) => {
    const hours = (i + 1) * PERMISSION_STEP_HOURS;
    return { value: String(hours), label: permissionHoursText(hours) };
  });
}

// ---------- coming up, on the employee's dashboard ----------

/** How many permissions the dashboard's My Leave lists coming up. */
export const UPCOMING_PERMISSIONS = 5;

/**
 * The employee's approved permission still to come, for their dashboard's My Leave (owner, 19 October 2026: "upcoming
 * permissions on the employee dashboard"): approved, on today or a later day, the soonest first (the earlier time first
 * on one day), at most `limit`. Those being decided are on My Requests.
 */
export function upcomingPermissions<P extends Pick<PermissionRequestView, 'status' | 'date' | 'fromTime'>>(requests: readonly P[], today: string, limit = UPCOMING_PERMISSIONS): P[] {
  return requests
    .filter((p) => p.status === 'approved' && p.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.fromTime ?? '99:99').localeCompare(b.fromTime ?? '99:99'))
    .slice(0, limit);
}

/** How far off a permission's day is, as My Leave says it: "Today", "Tomorrow", "In 5 days". */
export function permissionInDaysText(p: Pick<PermissionRequestView, 'date'>, today: string): string {
  const days = Math.round((Date.parse(`${p.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'Today';
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}

/** Said in place of the form, and on My Requests, while Leave Setup gives no permission hours. */
export const PERMISSION_OFF_TEXT = 'Permission is turned off: Leave Setup gives no permission hours a month.';

/**
 * A month's permission hours in a line: "This month: 1:30 approved, 0:30 waiting, 2:00 left of 4:00" (another month by
 * its name; nothing waiting, not said); permission turned off, said so.
 */
export function permissionMonthText(m: PermissionMonthView, thisMonth: string): string {
  const when = m.month === thisMonth ? 'This month' : monthName(m.month);
  if (!(m.hoursPerMonth > 0)) return `${when}: permission is turned off in Leave Setup.`;
  const parts = [`${permissionClock(m.approved)} approved`];
  if (m.pending > 0) parts.push(`${permissionClock(m.pending)} waiting`);
  parts.push(`${permissionClock(m.left)} left of ${permissionClock(m.hoursPerMonth)}`);
  return `${when}: ${parts.join(', ')}`;
}

/** The hours already asked for on a day of the month (approved or being decided). */
export const usedOnDay = (m: Pick<PermissionMonthView, 'days'>, date: string) => m.days.find((d) => d.date === date)?.hours ?? 0;

/**
 * Why there is no permission for someone outside the labour law, whose leave isn't theirs either (as the API says it): a
 * freelancer and an unpaid intern; null for everyone else.
 */
export function noPermissionText(employmentType: string): string | null {
  if (underLabourLaw(employmentType)) return null;
  return employmentType === 'intern'
    ? 'No permission under an unpaid internship: an intern works outside the labour law, so permission, like leave, isn’t theirs.'
    : 'No permission under a freelance employment: a freelancer works outside the labour law (Art. 1(1)), so permission, like leave, isn’t theirs.';
}

// ---------- what the page says once something is done ----------

/** Once sent: where it goes (as a leave request), or, recorded by HR, that it is approved and counts as worked. */
export function permissionSentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (status === 'approved') return 'Permission recorded, approved at once. Its hours count as worked in the month’s payroll.';
  return leaveSentText(status, manager, confidential);
}

/** Once a decision went through; a C-level person's request goes on to the CEO, not HR (`confidential`). */
export function permissionDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null): string {
  if (decision === 'reject') return 'Request rejected. The employee sees your comment.';
  return leaveStatusAfterApproval(stage) === 'with_hr'
    ? `Approved: the request goes to ${hrStageName(confidential)}.`
    : 'Approved: its hours count as worked in the month’s payroll.';
}

/** What a permission request's page says after `?done=`, and in which tone; null for anything else. */
export function permissionDoneText(
  query: Query,
  status: LeaveStatus,
  manager?: Pick<RequestApprover, 'role'> | null,
  confidential?: boolean | null,
): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent' || done === 'recorded') return { text: permissionSentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Permission cancelled. Its hours are back in the month’s allowance; it stays on the list, cancelled.', tone: 'ok' };
  if (done === 'moved') return { text: LEAVE_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: permissionDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential), tone: 'ok' };
}

/** A step of a permission request as its timeline shows it: as a leave request's, its cancelling giving the hours back. */
export function permissionStepText(s: Pick<LeaveRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  return s.kind === 'cancelled' ? 'Cancelled, the hours given back' : leaveStepText(s, manager, confidential);
}

/** The decision form's button: as a leave request's, the last approval approving the permission. */
export function permissionDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, confidential?: boolean | null): { label: string; busy: string } {
  const b = leaveDecisionButton(decision, stage, confidential);
  return b.label === 'Approve the leave' ? { ...b, label: 'Approve the permission' } : b;
}

// ---------- the form ----------

/** The form as typed: the day (DD/MM/YYYY), the hours chosen ("1.5"), the times (12-hour, optional), the reason. */
export interface TypedPermission {
  date: string;
  hours: string;
  fromTime: string;
  toTime: string;
  reason: string;
}

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,٫]/g, '.');

/** The hours chosen, in half hours from 0.5 to a working day's 8; null when none or not hours. */
export function hoursFrom(raw: string): number | null {
  const s = latin(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isHalfHours(n) && n > 0 && n <= PERMISSION_DAY_MAX ? n : null;
}

const TIME_ERRORS = {
  fromTime: 'Enter the time it starts as a 12-hour time, e.g. 5:00 PM.',
  toTime: 'Enter the time it ends as a 12-hour time, e.g. 7:00 PM.',
} as const;

/** The times as typed (12-hour, or 24-hour), as HH:MM, null when left empty, with what can't be read. */
export function typedTimes(t: Pick<TypedPermission, 'fromTime' | 'toTime'>): { fromTime: string | null; toTime: string | null; problems: string[] } {
  const problems: string[] = [];
  const read = (key: 'fromTime' | 'toTime') => {
    const parsed = parseTime(t[key]);
    if (parsed === null) problems.push(TIME_ERRORS[key]);
    return parsed || null;
  };
  const fromTime = read('fromTime');
  const toTime = read('toTime');
  return { fromTime, toTime, problems };
}

/**
 * A message of the shared checks (or the API's) as the screens say it: its dates as DD/MM/YYYY and its times in
 * 12-hour time ("17:00" → "5:00 PM"), as they are typed here.
 */
export function shownMessage(message: string): string {
  return asShown(message)
    .replace(/as HH:MM/g, 'as a 12-hour time')
    .replace(/\b([01]\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, m: string) => formatTime(`${h}:${m}`));
}

/**
 * Why the permission can't be sent yet, in the order to fix them (none: it can): the day, the hours, the times, then the
 * shared checks against the month's figures (`month`, of the day's month; null while they couldn't be read: the API
 * checks them): the day's most, what is left of the day and of the month, permission turned off. A rest day, an official
 * holiday and a day of leave aren't known here: the API refuses them. `name`: the employee's when HR records it.
 */
export function permissionFormProblems(typed: TypedPermission, month: PermissionMonthView | null, name: string | null = null): string[] {
  const problems: string[] = [];
  const date = parseDate(typed.date);
  if (typed.date.trim() === '') problems.push('Enter the day of the permission.');
  else if (!date) problems.push('Enter the day as DD/MM/YYYY, e.g. 03/11/2026.');
  const hours = hoursFrom(typed.hours);
  if (hours === null) problems.push('Choose the hours.');
  const times = typedTimes(typed);
  problems.push(...times.problems);
  if (date && hours !== null && !times.problems.length) {
    const found =
      month && month.month === permissionMonth(date)
        ? permissionRequestProblems(
            { date, hours, fromTime: times.fromTime, toTime: times.toTime },
            { hoursPerMonth: month.hoursPerMonth, maxHoursPerDay: month.maxHoursPerDay },
            // what the API alone knows (the shift's days, the holidays, the leave) is checked when it is sent
            { workingDay: true, holiday: null, leave: null, usedThatDay: usedOnDay(month, date), usedInMonth: month.approved + month.pending },
            name,
          )
        : permissionTimes(hours, times.fromTime, times.toTime).problems;
    problems.push(...found.map(shownMessage));
  }
  if (typed.reason.trim().length > REASON_MAX) problems.push(`Keep the reason to ${REASON_MAX} characters; it has ${typed.reason.trim().length}.`);
  return problems;
}

/** The times as they will be saved, the other worked out from the hours ("5:00 PM – 7:00 PM"); null without times or while they can't be. */
export function workedOutTimes(typed: TypedPermission): string | null {
  const hours = hoursFrom(typed.hours);
  const times = typedTimes(typed);
  if (hours === null || times.problems.length) return null;
  const worked = permissionTimes(hours, times.fromTime, times.toTime);
  return worked.problems.length ? null : permissionTimesText(worked);
}

/**
 * What the form says once it can be sent: the hours and the day, the times, and where it goes (`byHr`: recorded for
 * `name`, approved at once; `toCeo`: a C-level person's goes to the CEO after the manager, not HR).
 */
export function permissionReadyText(typed: TypedPermission, byHr: boolean, name: string, toCeo = false): string {
  const hours = hoursFrom(typed.hours);
  const date = parseDate(typed.date);
  const times = workedOutTimes(typed);
  const what = `${hours === null ? PERMISSION_LABEL : permissionHoursText(hours)}${date ? ` on ${weekdayOf(date)} ${formatDate(date)}` : ''}${times ? ` (${times})` : ''}`;
  return byHr
    ? `Ready to record: ${what} for ${name}, approved at once.`
    : `Ready to send: ${what}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}

/** What POST /me/permissions takes (HR's POST /leave/permissions with the employee too). */
export interface PermissionBody {
  date: string;
  hours: number;
  fromTime?: string;
  toTime?: string;
  reason?: string;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/**
 * The request sent: the day as YYYY-MM-DD, the hours, the times typed as HH:MM (only those given: with one, the API
 * works the other out), the reason; or what is wrong with them. The limits are the API's to check: it answers what is
 * wrong.
 */
export function permissionForm(fd: FormData): { body: PermissionBody | null; errors: string[] } {
  const errors: string[] = [];
  const typedDate = text(fd, 'date');
  const date = parseDate(typedDate);
  if (typedDate === '') errors.push('Enter the day of the permission.');
  else if (!date) errors.push('Enter the day as DD/MM/YYYY, e.g. 03/11/2026.');
  const hours = hoursFrom(text(fd, 'hours'));
  if (hours === null) errors.push('Choose the hours.');
  const times = typedTimes({ fromTime: text(fd, 'fromTime'), toTime: text(fd, 'toTime') });
  errors.push(...times.problems);
  const reason = text(fd, 'reason');
  if (reason.length > REASON_MAX) errors.push(`Keep the reason to ${REASON_MAX} characters; it has ${reason.length}.`);
  if (errors.length || !date || hours === null) return { body: null, errors };
  const body: PermissionBody = { date, hours };
  if (times.fromTime) body.fromTime = times.fromTime;
  if (times.toTime) body.toTime = times.toTime;
  if (reason) body.reason = reason;
  return { body, errors };
}

/** The fields as the form shows them again after a refusal. */
export const typedPermissionValues = (fd: FormData): Record<string, string> =>
  Object.fromEntries(['date', 'hours', 'fromTime', 'toTime', 'reason', 'employeeId'].map((k) => [k, String(fd.get(k) ?? '')]));

/** Who records permission on an employee's behalf: HR, as leave (POST /leave/permissions). */
export const recordsPermission = (user: WithRoles) => hasRole(user, 'hr');
