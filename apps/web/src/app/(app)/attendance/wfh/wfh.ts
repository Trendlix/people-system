import {
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  leaveStatusAfterApproval,
  WFH_DAY_LABEL,
  WFH_SOURCES,
  wfhAllowanceText,
  wfhLimitProblems,
  wfhMonthUsed,
  wfhNoticeProblem,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type LeaveStepKind,
  type Role,
  type WfhSource,
} from '@trendlix/shared';
import { MY_REQUESTS, MY_TEAM } from '../../../../components/nav';
import { formatDate, parseDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import type { LeaveRequestStep, RequestApprover } from '../../../../lib/types';
import type { WfhAllowance, WfhRequestStep, WfhRequestView } from '../../../../lib/wfh-types';
import { hrStageName, leaveDecisionButton, leaveProgressText, leaveStepText } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { weekdayOf } from '../../organization/holidays/holidays';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; in
// Zoho People it was a leave type): a working day in another place, not leave. Asked for one day at a time from My
// Requests → Work from home, a day before at the latest ("A day before"), at most 2 a calendar month any two a week
// apart ("its 2 days per month with a gap of 1 week between each record (Biweekly)"; the limits in Leave Setup), by
// someone expected at the office that day (Office, or Hybrid on its office days); decided by the approver in charge, then
// HR ("Manager, then HR"), a C-level person's HR stage by the CEO; cancelled while it is being decided. HR records a day
// for someone (any day, past the limits, with a reason and warnings), and sees every request under Attendance → Work
// From Home. The rules are @trendlix/shared's (wfh.ts), which the API enforces; these helpers word what it sent, read the
// forms and show the same checks live. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest reason the API takes. */
export const WFH_REASON_MAX = 500;

// ---------- the addresses ----------

/** HR's and the CEO's list of every request and day, under Attendance. */
export const WFH_PATH = '/attendance/wfh';

/** The employee's form (from My Requests → Work from home). */
export const NEW_WFH_PATH = `${WFH_PATH}/new`;

/** HR's form to record a day for someone: "/attendance/wfh/record?employee=<id>". */
export const RECORD_WFH_PATH = `${WFH_PATH}/record`;
export const recordWfhHref = (employeeId?: string | null) => (employeeId ? `${RECORD_WFH_PATH}?employee=${encodeURIComponent(employeeId)}` : RECORD_WFH_PATH);

/** A request's page, where it is decided and cancelled: "/attendance/wfh/<id>". */
export const wfhHref = (id: string) => `${WFH_PATH}/${encodeURIComponent(id)}`;

/** What was just done on a request, said on its page by `?done=`. */
export type WfhDone = 'sent' | 'recorded' | 'cancelled' | 'moved' | `${LeaveStage}_${LeaveDecision}`;

/** A request's page after something was done on it: "/attendance/wfh/<id>?done=sent". */
export const wfhDoneHref = (id: string, done: WfhDone) => `${wfhHref(id)}?done=${done}`;

/** Where the employee's own requests are listed: their part of My Requests. */
export const MY_WFH_HREF = `${MY_REQUESTS}#my-wfh`;

/** Who sees everyone's requests (Attendance → Work From Home): HR, who decides and records them, and the CEO. */
export const seesAllWfh = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

/** Who records a day for someone: HR. */
export const recordsWfh = (user: WithRoles) => hasRole(user, 'hr');

/** Where a request's page goes back to: Work From Home for HR and the CEO, My Requests for its employee, else My Team. */
export function wfhBack(user: WithRoles & { employeeId?: string | null }, r: Pick<WfhRequestView, 'employee'>): { href: string; label: string } {
  if (user.employeeId && r.employee.id === user.employeeId) return { href: MY_WFH_HREF, label: 'My Requests' };
  if (seesAllWfh(user)) return { href: WFH_PATH, label: 'Work From Home' };
  return { href: MY_TEAM, label: 'My Team' };
}

// ---------- the list ----------

/** Which requests the list shows: those waiting for the caller, by status, or all. */
export type WfhFilter = 'waiting' | 'all' | LeaveStatus;

export const WFH_FILTERS: readonly { value: WfhFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'with_manager', label: LEAVE_STATUS_LABELS.with_manager },
  { value: 'with_hr', label: LEAVE_STATUS_LABELS.with_hr },
  { value: 'approved', label: LEAVE_STATUS_LABELS.approved },
  { value: 'rejected', label: LEAVE_STATUS_LABELS.rejected },
  { value: 'cancelled', label: LEAVE_STATUS_LABELS.cancelled },
  { value: 'all', label: 'All' },
];

/** Where the requests came from, as the list's filter: asked or recorded on the system, or imported from Zoho People. */
export const WFH_SOURCE_LABELS: Record<WfhSource, string> = { system: 'On the system', zoho: 'Imported from Zoho People' };

/** The list's filters as the address has them. */
export interface WfhQuery {
  filter: WfhFilter;
  /** YYYY-MM; null: every month. */
  month: string | null;
  departmentId: string | null;
  employeeId: string | null;
  source: WfhSource | null;
}

/** The filters in the address (?status=&month=&department=&employee=&source=), waiting for you without a status. */
export function readWfhQuery(query: Query): WfhQuery {
  const status = one(query.status);
  const month = one(query.month);
  const department = one(query.department);
  const employee = one(query.employee);
  const source = one(query.source);
  return {
    filter: WFH_FILTERS.some((f) => f.value === status) ? (status as WfhFilter) : 'waiting',
    month: MONTH.test(month) ? month : null,
    departmentId: UUID.test(department) ? department : null,
    employeeId: UUID.test(employee) ? employee : null,
    source: (WFH_SOURCES as readonly string[]).includes(source) ? (source as WfhSource) : null,
  };
}

/** The list's address: "/attendance/wfh?status=approved&month=2026-11&department=<id>". */
export function wfhListHref(q: Partial<WfhQuery> = {}): string {
  const params = new URLSearchParams();
  if (q.filter && q.filter !== 'waiting') params.set('status', q.filter);
  if (q.month) params.set('month', q.month);
  if (q.departmentId) params.set('department', q.departmentId);
  if (q.employeeId) params.set('employee', q.employeeId);
  if (q.source) params.set('source', q.source);
  const qs = params.toString();
  return qs ? `${WFH_PATH}?${qs}` : WFH_PATH;
}

const lastOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** The API's requests for the filters: GET /wfh?status=waiting|<status>&from=&to=&departmentId=&employeeId=&source=. */
export function wfhListPath(q: Partial<WfhQuery> = {}): string {
  const params = new URLSearchParams();
  const filter = q.filter ?? 'waiting';
  if (filter !== 'all') params.set('status', filter);
  if (q.month) {
    params.set('from', `${q.month}-01`);
    params.set('to', lastOf(q.month));
  }
  if (q.departmentId) params.set('departmentId', q.departmentId);
  if (q.employeeId) params.set('employeeId', q.employeeId);
  if (q.source) params.set('source', q.source);
  const qs = params.toString();
  return qs ? `/wfh?${qs}` : '/wfh';
}

/** Those waiting for the caller: Approvals', My Team's and To Approve's. */
export const WAITING_WFH = wfhListPath({ filter: 'waiting' });

/** GET /wfh/counts: { waiting }. */
export const WFH_COUNTS = '/wfh/counts';

/** Those approved on a day, as far as the caller sees requests (My Team's "who is home today"). */
export const wfhOnDayPath = (date: string) => `/wfh?status=approved&from=${date}&to=${date}`;

/** "1 request", "3 requests". */
export const wfhLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

const EMPTY: Record<WfhFilter, string> = {
  waiting: 'No work from home requests are waiting for you.',
  all: 'No work from home requests yet. Employees ask from My Requests; HR records a day for someone with Record a WFH day.',
  with_manager: 'No work from home requests are with a manager.',
  with_hr: 'No work from home requests are with HR.',
  approved: 'No work from home days approved.',
  rejected: 'No work from home requests rejected.',
  cancelled: 'No work from home requests cancelled.',
};

export const emptyWfhText = (filter: WfhFilter) => EMPTY[filter];

// ---------- a request, in words ----------

/** Its day with the weekday: "Monday 02/11/2026". */
export const wfhDayText = (r: { date: string }) => `${weekdayOf(r.date)} ${formatDate(r.date)}`;

/** How it came: asked by the employee, recorded by HR, or imported from Zoho People. */
export function wfhSourceText(r: Pick<WfhRequestView, 'source' | 'recordedByHr'>): string {
  if (r.source === 'zoho') return 'Imported from Zoho People';
  return r.recordedByHr ? 'Recorded by HR' : 'Asked by the employee';
}

/**
 * Where a request stands, for its list row and its page, as a leave request's (who has it now, or how it ended, with a
 * rejection's comment); a day imported from Zoho People says so.
 */
export function wfhProgressText(r: Pick<WfhRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'recordedByHr' | 'confidential' | 'source' | 'steps'>): {
  text: string;
  reason: string | null;
} {
  if (r.status === 'approved' && r.source === 'zoho') return { text: 'Imported from Zoho People', reason: null };
  return leaveProgressText({ ...r, steps: r.steps.filter((s) => s.kind !== 'imported') as LeaveRequestStep[] });
}

/** Once sent: where it goes, or, recorded by HR, that it is approved at once. */
export function wfhSentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (status === 'approved') return 'Work from home day recorded, approved at once. That day they check in from home, without the office network.';
  const hr = hrStageName(confidential);
  const first = manager?.role === 'team_lead' ? 'your team lead' : manager?.role === 'department_head' ? 'your head of department' : 'your direct manager';
  return status === 'with_manager' ? `Request sent. It goes to ${first}, then ${hr}; each step shows on the request.` : `Request sent. It goes to ${hr}; each step shows on the request.`;
}

/** Once a decision went through; a C-level person's goes on to the CEO, not HR (`confidential`). */
export function wfhDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null): string {
  if (decision === 'reject') return 'Request rejected. The employee sees your comment.';
  return leaveStatusAfterApproval(stage) === 'with_hr'
    ? `Approved: the request goes to ${hrStageName(confidential)}.`
    : 'Approved: that day they work from home, and check in from there without the office network.';
}

/** Said when a decision is refused as the request moved on since the page was opened (the API's 409). */
export const WFH_MOVED_ON = 'This request has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

/** What a request's page says after `?done=`, and in which tone; null for anything else. */
export function wfhDoneText(query: Query, status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent' || done === 'recorded') return { text: wfhSentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Work from home cancelled. It stays on the list, cancelled; the day is free again.', tone: 'ok' };
  if (done === 'moved') return { text: WFH_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: wfhDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential), tone: 'ok' };
}

/** A step as its timeline shows it: as a leave request's, HR's recording, an import and a cancelling in their words. */
export function wfhStepText(s: Pick<WfhRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (s.kind === 'imported') return 'Imported from Zoho People, approved';
  if (s.kind === 'recorded_by_hr') return 'Recorded by HR, approved at once';
  if (s.kind === 'cancelled') return 'Cancelled';
  return leaveStepText({ ...s, kind: s.kind as LeaveStepKind }, manager, confidential);
}

/** The decision form's button: as a leave request's, the last approval approving the day. */
export function wfhDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, confidential?: boolean | null): { label: string; busy: string } {
  const b = leaveDecisionButton(decision, stage, confidential);
  return b.label === 'Approve the leave' ? { ...b, label: 'Approve working from home' } : b;
}

/** HR cancelling an approved day: the comment is required (POST /wfh/:id/cancel). */
export function wfhCancelBody(fd: FormData): { body: { comment: string } | null; errors: string[] } {
  const comment = String(fd.get('comment') ?? '').trim();
  return comment ? { body: { comment }, errors: [] } : { body: null, errors: ['Write why the work from home day is cancelled: the employee sees it.'] };
}

// ---------- the forms ----------

/** The employee's form as typed: the day (DD/MM/YYYY) and why (optional). HR's has the employee and a reason required. */
export interface TypedWfh {
  date: string;
  reason: string;
}

/** What POST /me/wfh takes; HR's POST /wfh has the employee too, and the reason. */
export interface WfhBody {
  date: string;
  reason?: string;
}

function read(t: TypedWfh, reasonRequired: boolean): { body: WfhBody | null; date: string | null; errors: string[] } {
  const errors: string[] = [];
  const date = parseDate(t.date);
  if (t.date.trim() === '') errors.push('Enter the day you work from home.');
  else if (!date) errors.push('Enter the day as DD/MM/YYYY, e.g. 02/11/2026.');
  const reason = t.reason.trim();
  if (reasonRequired && !reason) errors.push('Write why HR records this day.');
  if (reason.length > WFH_REASON_MAX) errors.push(`Keep the reason to ${WFH_REASON_MAX} characters; it has ${reason.length}.`);
  if (errors.length || !date) return { body: null, date: date || null, errors };
  return { body: reason ? { date, reason } : { date }, date, errors };
}

/**
 * Why the employee's request can't be sent yet, in the order to fix them (none: it can): the day, the reason, then the
 * shared checks against their days (`allowance`; null while they couldn't be read: the API checks them): the notice and
 * the limits. Whether the day is a working office day of theirs, a holiday or a day of leave isn't known here: the API
 * refuses those.
 */
export function wfhFormProblems(typed: TypedWfh, allowance: Pick<WfhAllowance, 'today' | 'daysPerMonth' | 'minGapDays' | 'taken' | 'refusal'> | null): string[] {
  const { date, errors } = read(typed, false);
  if (errors.length || !date) return errors;
  if (!allowance) return [];
  if (allowance.refusal) return [allowance.refusal];
  const notice = wfhNoticeProblem(date, allowance.today);
  const taken = allowance.taken.map((t) => t.date);
  return [...(notice ? [notice] : []), ...wfhLimitProblems(date, { daysPerMonth: allowance.daysPerMonth, minGapDays: allowance.minGapDays }, taken)].map(shownMessage);
}

/**
 * The line under the form's day (owner's brief, 21 October 2026): "1 of 2 this month · next possible from 05/11/2026",
 * of the month of the day chosen (this month without one).
 */
export function wfhAllowanceLine(allowance: Pick<WfhAllowance, 'daysPerMonth' | 'minGapDays' | 'taken' | 'nextPossible' | 'month'>, date: string | null = null): string {
  const month = date ? date.slice(0, 7) : allowance.month;
  const used = wfhMonthUsed(month, allowance.taken.map((t) => t.date));
  const line = wfhAllowanceText(used, { daysPerMonth: allowance.daysPerMonth, minGapDays: allowance.minGapDays }, allowance.nextPossible);
  return month === allowance.month || !date ? line : line.replace('this month', `in ${monthWords(month)}`);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** What the form says once it can be sent: the day and where it goes (`toCeo`: a C-level person's goes to the CEO, not HR). */
export function wfhReadyText(typed: TypedWfh, toCeo = false): string {
  const date = parseDate(typed.date);
  const day = date ? ` on ${weekdayOf(date)} ${formatDate(date)}` : '';
  return `Ready to send: working from home${day}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}

/** The employee's request sent, or what can't be read: the API checks the rest and answers what is wrong. */
export function wfhForm(fd: FormData): { body: WfhBody | null; errors: string[] } {
  const { body, errors } = read(typedWfh(fd), false);
  return { body, errors };
}

/** HR's record: the employee, the day and the reason (required). */
export function wfhRecordForm(fd: FormData): { body: (WfhBody & { employeeId: string; reason: string }) | null; errors: string[] } {
  const employeeId = String(fd.get('employeeId') ?? '').trim();
  const { body, errors } = read(typedWfh(fd), true);
  if (!employeeId) errors.unshift('Choose the employee whose day it is.');
  if (!body || !employeeId) return { body: null, errors };
  return { body: { employeeId, date: body.date, reason: body.reason ?? '' }, errors: [] };
}

/** The fields as typed, from the form. */
export const typedWfh = (fd: FormData): TypedWfh => ({ date: String(fd.get('date') ?? ''), reason: String(fd.get('reason') ?? '') });

/** The fields as the form shows them again after a refusal. */
export const typedWfhValues = (fd: FormData): Record<string, string> => Object.fromEntries(['date', 'reason', 'employeeId'].map((k) => [k, String(fd.get(k) ?? '')]));

// ---------- the attendance pages ----------

/** The badge of a day worked from home (Daily Attendance, a person's month, My Attendance, the phone pages). */
export const WFH_DAY_BADGE = WFH_DAY_LABEL;

/** Whether a day of someone's month is a work from home day approved for them (an API from before it: none). */
export const isWfhDay = (person: { wfhDays?: readonly string[] | null }, date: string): boolean => (person.wfhDays ?? []).includes(date);

/** The people working from home on a day, by name, once each (My Team's "who is home today"), from their approved days. */
export function homeOn<R extends Pick<WfhRequestView, 'status' | 'date' | 'employee'>>(requests: readonly R[], date: string): R['employee'][] {
  const seen = new Map<string, R['employee']>();
  for (const r of requests) if (r.status === 'approved' && r.date === date && !seen.has(r.employee.id)) seen.set(r.employee.id, r.employee);
  return [...seen.values()].sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
}
