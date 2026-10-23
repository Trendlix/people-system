import {
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  leaveStatusAfterApproval,
  OD_AFTER_DAYS,
  OD_DAY_LABEL,
  OD_PLACE_MAX,
  OD_REASON_MAX,
  odHoursProblems,
  odInputProblems,
  odTimingProblem,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type LeaveStepKind,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS, MY_TEAM } from '../../../../components/nav';
import { formatDate, formatTime, parseDate, parseTime } from '../../../../lib/format';
import type { OdDayView, OdForm, OdRequestStep, OdRequestView } from '../../../../lib/od-types';
import { hasRole } from '../../../../lib/roles';
import type { LeaveRequestStep, RequestApprover } from '../../../../lib/types';
import { hrStageName, leaveDecisionButton, leaveProgressText, leaveStepText } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { weekdayOf } from '../../organization/holidays/holidays';

// Official duty, OD (owner, 23 October 2026: "Official duty (OD) requests. The plan has OD as a third attendance mode
// beside Office and WFH, needing an approved request"): work for the company away from the office, a working day, not
// leave. Asked for from My Requests → Request official duty: one day or several in a row, a full day or part of one
// (one day only, inside the shift), where and why; ahead, or up to 3 days after ("Ahead or up to 3 days after"), the
// latter marked requested after; decided by the approver in charge, then HR ("Manager, then HR"), a C-level person's
// HR stage by the CEO; cancelled while it is being decided, by HR once approved. On an approved day the check-in is
// taken from anywhere ("Check in from anywhere") and the day counts as attended for its hours. HR and the CEO see every
// request under Attendance → Official Duty. The rules are @trendlix/shared's (official-duty.ts), which the API
// enforces; these helpers word what it sent, read the forms and show the same checks live. Pure code, tested; relative
// imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { OD_PLACE_MAX, OD_REASON_MAX };

// ---------- the addresses ----------

/** HR's and the CEO's list of every request, under Attendance beside Work From Home. */
export const OD_PATH = '/attendance/official-duty';

/** The employee's form (from My Requests → Request official duty). */
export const NEW_OD_PATH = `${OD_PATH}/new`;

/** A request's page, where it is decided and cancelled: "/attendance/official-duty/<id>". */
export const odHref = (id: string) => `${OD_PATH}/${encodeURIComponent(id)}`;

/** What was just done on a request, said on its page by `?done=`. */
export type OdDone = 'sent' | 'cancelled' | 'moved' | `${LeaveStage}_${LeaveDecision}`;

/** A request's page after something was done on it: "/attendance/official-duty/<id>?done=sent". */
export const odDoneHref = (id: string, done: OdDone) => `${odHref(id)}?done=${done}`;

/** Where the employee's own requests are listed: their part of My Requests. */
export const MY_OD_HREF = `${MY_REQUESTS}#my-od`;

/** Who sees everyone's requests (Attendance → Official Duty): HR, who decides them after the manager, and the CEO. */
export const seesAllOd = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

/** Where a request's page goes back to: My Requests for its employee, Official Duty for HR and the CEO, else My Team. */
export function odBack(user: WithRoles & { employeeId?: string | null }, r: Pick<OdRequestView, 'employee'>): { href: string; label: string } {
  if (user.employeeId && r.employee.id === user.employeeId) return { href: MY_OD_HREF, label: 'My Requests' };
  if (seesAllOd(user)) return { href: OD_PATH, label: 'Official Duty' };
  return { href: MY_TEAM, label: 'My Team' };
}

// ---------- the list ----------

/** Which requests the list shows: those waiting for the caller, by status, or all. */
export type OdFilter = 'waiting' | 'all' | LeaveStatus;

export const OD_FILTERS: readonly { value: OdFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'with_manager', label: LEAVE_STATUS_LABELS.with_manager },
  { value: 'with_hr', label: LEAVE_STATUS_LABELS.with_hr },
  { value: 'approved', label: LEAVE_STATUS_LABELS.approved },
  { value: 'rejected', label: LEAVE_STATUS_LABELS.rejected },
  { value: 'cancelled', label: LEAVE_STATUS_LABELS.cancelled },
  { value: 'all', label: 'All' },
];

/** The list's filters as the address has them. */
export interface OdQuery {
  filter: OdFilter;
  /** YYYY-MM: those with a day in it; null: every month. */
  month: string | null;
  departmentId: string | null;
  employeeId: string | null;
  /** Only those asked after their first day ("requested after"). */
  late: boolean;
}

/** The filters in the address (?status=&month=&department=&employee=&late=1), waiting for you without a status. */
export function readOdQuery(query: Query): OdQuery {
  const status = one(query.status);
  const month = one(query.month);
  const department = one(query.department);
  const employee = one(query.employee);
  return {
    filter: OD_FILTERS.some((f) => f.value === status) ? (status as OdFilter) : 'waiting',
    month: MONTH.test(month) ? month : null,
    departmentId: UUID.test(department) ? department : null,
    employeeId: UUID.test(employee) ? employee : null,
    late: one(query.late) === '1',
  };
}

/** The list's address: "/attendance/official-duty?status=approved&month=2026-11&department=<id>&late=1". */
export function odListHref(q: Partial<OdQuery> = {}): string {
  const params = new URLSearchParams();
  if (q.filter && q.filter !== 'waiting') params.set('status', q.filter);
  if (q.month) params.set('month', q.month);
  if (q.departmentId) params.set('department', q.departmentId);
  if (q.employeeId) params.set('employee', q.employeeId);
  if (q.late) params.set('late', '1');
  const qs = params.toString();
  return qs ? `${OD_PATH}?${qs}` : OD_PATH;
}

const lastOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** The API's requests for the filters: GET /official-duty?status=waiting|<status>&from=&to=&departmentId=&employeeId=&late=true. */
export function odListPath(q: Partial<OdQuery> = {}): string {
  const params = new URLSearchParams();
  const filter = q.filter ?? 'waiting';
  if (filter !== 'all') params.set('status', filter);
  if (q.month) {
    params.set('from', `${q.month}-01`);
    params.set('to', lastOf(q.month));
  }
  if (q.departmentId) params.set('departmentId', q.departmentId);
  if (q.employeeId) params.set('employeeId', q.employeeId);
  if (q.late) params.set('late', 'true');
  const qs = params.toString();
  return qs ? `/official-duty?${qs}` : '/official-duty';
}

/** Those waiting for the caller: Approvals', My Team's and To Approve's. */
export const WAITING_OD = odListPath({ filter: 'waiting' });

/** GET /official-duty/counts: { waiting }. */
export const OD_COUNTS = '/official-duty/counts';

/** Those approved with a day on a date, as far as the caller sees requests (My Team's "who is on official duty today"). */
export const odOnDayPath = (date: string) => `/official-duty?status=approved&from=${date}&to=${date}`;

/** "1 request", "3 requests". */
export const odLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

const EMPTY: Record<OdFilter, string> = {
  waiting: 'No official duty requests are waiting for you.',
  all: 'No official duty requests yet. Employees ask from My Requests → Request official duty.',
  with_manager: 'No official duty requests are with a manager.',
  with_hr: 'No official duty requests are with HR.',
  approved: 'No official duties approved.',
  rejected: 'No official duty requests rejected.',
  cancelled: 'No official duty requests cancelled.',
};

export const emptyOdText = (filter: OdFilter) => EMPTY[filter];

// ---------- a request, in words ----------

/** A day with its weekday: "Monday 02/11/2026". */
const dayWords = (date: string) => `${weekdayOf(date)} ${formatDate(date)}`;

/**
 * Its days and hours: "Monday 02/11/2026", "Monday 02/11/2026, 10:00 AM–2:00 PM", "Sunday 01/11/2026 – Tuesday
 * 03/11/2026".
 */
export function odWhenWords(r: Pick<OdRequestView, 'startDate' | 'endDate' | 'fullDay' | 'fromTime' | 'toTime'>): string {
  if (r.startDate !== r.endDate) return `${dayWords(r.startDate)} – ${dayWords(r.endDate)}`;
  if (!r.fullDay && r.fromTime && r.toTime) return `${dayWords(r.startDate)}, ${formatTime(r.fromTime)}–${formatTime(r.toTime)}`;
  return dayWords(r.startDate);
}

/** How many calendar days it covers: "1 day", "3 days" (its holidays and rest days aren't duty days). */
export function odSpanText(r: Pick<OdRequestView, 'startDate' | 'endDate' | 'fullDay'>): string {
  if (r.startDate === r.endDate) return r.fullDay ? 'A full day' : 'Part of a day';
  const days = Math.round((Date.parse(`${r.endDate}T00:00:00Z`) - Date.parse(`${r.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  return `${days} days in a row, full days`;
}

/** Where a request stands, for its list row and its page, as a leave request's (who has it now, or how it ended). */
export function odProgressText(r: Pick<OdRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'confidential' | 'steps'>): { text: string; reason: string | null } {
  return leaveProgressText({ ...r, recordedByHr: false, steps: r.steps as unknown as LeaveRequestStep[] });
}

/** Once sent: where it goes. */
export function odSentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  const hr = hrStageName(confidential);
  const first = manager?.role === 'team_lead' ? 'your team lead' : manager?.role === 'department_head' ? 'your head of department' : 'your direct manager';
  return status === 'with_manager' ? `Request sent. It goes to ${first}, then ${hr}; each step shows on the request.` : `Request sent. It goes to ${hr}; each step shows on the request.`;
}

/** Once a decision went through; a C-level person's goes on to the CEO, not HR (`confidential`). */
export function odDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null): string {
  if (decision === 'reject') return 'Request rejected. The employee sees your comment.';
  return leaveStatusAfterApproval(stage) === 'with_hr'
    ? `Approved: the request goes to ${hrStageName(confidential)}.`
    : 'Approved: on its days they check in from where they are, and the days count as attended for its hours.';
}

/** Said when a decision is refused as the request moved on since the page was opened (the API's 409). */
export const OD_MOVED_ON = 'This request has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

/** What a request's page says after `?done=`, and in which tone; null for anything else. */
export function odDoneText(query: Query, status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent') return { text: odSentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Official duty cancelled. It stays on the list, cancelled; its days are free again.', tone: 'ok' };
  if (done === 'moved') return { text: OD_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: odDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential), tone: 'ok' };
}

/** A step as its timeline shows it: as a leave request's, a cancelling in its words. */
export function odStepText(s: Pick<OdRequestStep | LeaveRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (s.kind === 'cancelled') return 'Cancelled';
  return leaveStepText({ ...s, kind: s.kind as LeaveStepKind }, manager, confidential);
}

/** The decision form's button: as a leave request's, the last approval approving the official duty. */
export function odDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, confidential?: boolean | null): { label: string; busy: string } {
  const b = leaveDecisionButton(decision, stage, confidential);
  return b.label === 'Approve the leave' ? { ...b, label: 'Approve the official duty' } : b;
}

/** HR cancelling an approved official duty: the comment is required (POST /official-duty/:id/cancel). */
export function odCancelBody(fd: FormData): { body: { comment: string } | null; errors: string[] } {
  const comment = String(fd.get('comment') ?? '').trim();
  return comment ? { body: { comment }, errors: [] } : { body: null, errors: ['Write why the official duty is cancelled: the employee sees it.'] };
}

// ---------- the form ----------

/** The form as typed: the first and last day (DD/MM/YYYY; the last left empty for one day), full or part of a day, its times, where and why. */
export interface TypedOd {
  startDate: string;
  endDate: string;
  /** "full" or "part". */
  span: string;
  fromTime: string;
  toTime: string;
  place: string;
  reason: string;
}

/** What POST /me/official-duty takes. */
export interface OdBody {
  startDate: string;
  endDate: string;
  fullDay: boolean;
  fromTime?: string;
  toTime?: string;
  place: string;
  reason: string;
}

/** What was typed, read: the API's values, and why it can't be read here. */
function read(t: TypedOd): { body: OdBody | null; errors: string[] } {
  const errors: string[] = [];
  const startDate = parseDate(t.startDate);
  const endTyped = t.endDate.trim();
  const endDate = endTyped === '' ? startDate : parseDate(t.endDate);
  if (t.startDate.trim() === '') errors.push('Enter the day of the official duty.');
  else if (!startDate) errors.push('Enter the day as DD/MM/YYYY, e.g. 02/11/2026.');
  if (endTyped !== '' && !endDate) errors.push('Enter the last day as DD/MM/YYYY, e.g. 04/11/2026, or leave it empty for one day.');
  const part = t.span === 'part';
  const fromTime = part ? parseTime(t.fromTime) : null;
  const toTime = part ? parseTime(t.toTime) : null;
  if (part) {
    if (t.fromTime.trim() === '' || t.fromTime.includes('--')) errors.push('Choose the time it starts, e.g. 10:00 AM.');
    else if (!fromTime) errors.push('Choose the time it starts as a 12-hour time, e.g. 10:00 AM.');
    if (t.toTime.trim() === '' || t.toTime.includes('--')) errors.push('Choose the time it ends, e.g. 2:00 PM.');
    else if (!toTime) errors.push('Choose the time it ends as a 12-hour time, e.g. 2:00 PM.');
  }
  if (errors.length || !startDate || !endDate) return { body: null, errors };
  const body: OdBody = { startDate, endDate, fullDay: !part, place: t.place.trim(), reason: t.reason.trim() };
  if (part && fromTime && toTime) {
    body.fromTime = fromTime;
    body.toTime = toTime;
  }
  // the shared checks of what can be read: the order of the days, at most 31, part of a day's times, the place, the reason
  const shared = odInputProblems({ ...body, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null }).map(shownMessage);
  return shared.length ? { body: null, errors: shared } : { body, errors: [] };
}

/**
 * Why the request can't be sent yet, in the order to fix them (none: it can): what can't be read, then the shared checks
 * against what the form read first (`form`; null while it couldn't be read: the API checks them): the timing (up to 3
 * days after) and part of a day inside their shift. A holiday, a rest day, leave, a work from home day or another
 * official duty on the same days aren't known here: the API refuses those when it is sent.
 */
export function odFormProblems(typed: TypedOd, form: Pick<OdForm, 'today' | 'shift' | 'refusal'> | null): string[] {
  const { body, errors } = read(typed);
  if (errors.length || !body) return errors;
  if (!form) return [];
  if (form.refusal) return [form.refusal];
  const timing = odTimingProblem(body.startDate, form.today);
  return [...(timing ? [timing] : []), ...odHoursProblems({ fullDay: body.fullDay, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null }, form.shift)].map(shownMessage);
}

/**
 * The note shown when the first day has gone by (owner, 23 October 2026: "Ahead or up to 3 days after"): it is marked
 * requested after; null otherwise.
 */
export function odAfterNote(typed: Pick<TypedOd, 'startDate'>, form: Pick<OdForm, 'today'> | null): string | null {
  const date = parseDate(typed.startDate);
  if (!date || !form || date >= form.today) return null;
  return `Asked after the day: it is marked “requested after”. That’s fine up to ${OD_AFTER_DAYS} days after; the reason tells your manager and HR why it wasn’t asked ahead.`;
}

/** What the form says once it can be sent: the days and where it goes (`toCeo`: a C-level person's goes to the CEO, not HR). */
export function odReadyText(typed: TypedOd, toCeo = false): string {
  const { body } = read(typed);
  const when = body ? ` for ${odWhenWords({ startDate: body.startDate, endDate: body.endDate, fullDay: body.fullDay, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null })}` : '';
  return `Ready to send: official duty${when}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}

/** The request sent, or what can't be read: the API checks the rest and answers what is wrong. */
export function odForm(fd: FormData): { body: OdBody | null; errors: string[] } {
  return read(typedOd(fd));
}

const FIELDS = ['startDate', 'endDate', 'span', 'fromTime', 'toTime', 'place', 'reason'] as const;

/** The fields as typed, from the form. */
export const typedOd = (fd: FormData): TypedOd => Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? (k === 'span' ? 'full' : ''))])) as unknown as TypedOd;

/** The fields as the form shows them again after a refusal. */
export const typedOdValues = (fd: FormData): Record<string, string> => Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? '')]));

// ---------- the attendance pages ----------

/** The badge of a day on official duty (Daily Attendance, a person's month, My Attendance). */
export const OD_DAY_BADGE = OD_DAY_LABEL;

/** The short mark of a press within an official duty. */
export const OD_PRESS_MARK = 'OD';

/** A person's approved official duty on a date, if any (an API from before it: none). */
export const odDayOf = (person: { odDays?: readonly OdDayView[] | null }, date: string): OdDayView | null => (person.odDays ?? []).find((d) => d.date === date) ?? null;

/** The badge's title: "On official duty" with a part day's times. */
export function odDayTitle(od: Pick<OdDayView, 'fullDay' | 'fromTime' | 'toTime'>): string {
  return !od.fullDay && od.fromTime && od.toTime ? `${OD_DAY_LABEL}, ${formatTime(od.fromTime)}–${formatTime(od.toTime)}` : `${OD_DAY_LABEL}, the full day`;
}

/** The people on official duty on a day, by name, once each (My Team's "who is out today"), from their approved requests. */
export function awayOn<R extends Pick<OdRequestView, 'status' | 'startDate' | 'endDate' | 'employee'>>(requests: readonly R[], date: string): R['employee'][] {
  const seen = new Map<string, R['employee']>();
  for (const r of requests) if (r.status === 'approved' && r.startDate <= date && date <= r.endDate && !seen.has(r.employee.id)) seen.set(r.employee.id, r.employee);
  return [...seen.values()].sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
}
