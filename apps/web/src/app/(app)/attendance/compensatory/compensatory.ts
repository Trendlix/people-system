import {
  COMPENSATORY_OUTCOME_LABELS,
  compensatoryRequestProblems,
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  leaveStatusAfterApproval,
  type CompensatoryOffDay,
  type CompensatoryOutcome,
  type CompensatoryWorkedDay,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS, MY_TEAM } from '../../../../components/nav';
import { formatDate, parseDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import type { CompensatoryForm, CompensatoryRequestView } from '../../../../lib/compensatory-types';
import type { LeaveRequestStep, RequestApprover } from '../../../../lib/types';
import { hrStageName, leaveProgressText, leaveStepText } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { weekdayOf } from '../../organization/holidays/holidays';

// Compensatory days (owner, 26 October 2026: "is there compensatory leaves in the system?"; then "my compensatory is a
// compensation with another day in the same month. and rarely to be compensated in cash"; "if paid in cash make it 1.5";
// "if the day is compensated with a day, we pay nothing"). Someone who worked a rest day of their shift or an official
// holiday asks, from My Requests → Compensatory day, for a working day off in the same calendar month, a day before at
// the latest; decided by the approver in charge, then HR (a C-level person's HR stage by the CEO); HR approves it as a day
// off or, rarely, as cash instead, and records one for someone. The rules are @trendlix/shared's (compensatory.ts), which
// the API enforces; these helpers word what it sent, read the forms and show the same checks live. Pure code, tested;
// relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest reason the API takes. */
export const COMPENSATORY_REASON_MAX = 500;

// ---------- the addresses ----------

/** HR's and the CEO's list of every request, under Attendance. */
export const COMPENSATORY_PATH = '/attendance/compensatory';

/** The employee's form (from My Requests → Compensatory day). */
export const NEW_COMPENSATORY_PATH = `${COMPENSATORY_PATH}/new`;

/** HR's form to record one for someone: "/attendance/compensatory/record?employee=<id>". */
export const RECORD_COMPENSATORY_PATH = `${COMPENSATORY_PATH}/record`;

/** A request's page, where it is decided and cancelled: "/attendance/compensatory/<id>". */
export const compensatoryHref = (id: string) => `${COMPENSATORY_PATH}/${encodeURIComponent(id)}`;

/** What was just done on a request, said on its page by `?done=`. */
export type CompensatoryDone = 'sent' | 'recorded' | 'cancelled' | 'moved' | `${LeaveStage}_${LeaveDecision}` | 'hr_approve_cash';

/** A request's page after something was done on it: "/attendance/compensatory/<id>?done=sent". */
export const compensatoryDoneHref = (id: string, done: CompensatoryDone) => `${compensatoryHref(id)}?done=${done}`;

/** Where the employee's own requests are listed: their part of My Requests. */
export const MY_COMPENSATORY_HREF = `${MY_REQUESTS}#my-compensatory`;

/** Who sees everyone's requests (Attendance → Compensatory Days): HR, who decides and records them, and the CEO. */
export const seesAllCompensatory = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

/** Who records one for someone: HR. */
export const recordsCompensatory = (user: WithRoles) => hasRole(user, 'hr');

/** Where a request's page goes back to: Compensatory Days for HR and the CEO, My Requests for its employee, else My Team. */
export function compensatoryBack(user: WithRoles & { employeeId?: string | null }, r: Pick<CompensatoryRequestView, 'employee'>): { href: string; label: string } {
  if (user.employeeId && r.employee.id === user.employeeId) return { href: MY_COMPENSATORY_HREF, label: 'My Requests' };
  if (seesAllCompensatory(user)) return { href: COMPENSATORY_PATH, label: 'Compensatory Days' };
  return { href: MY_TEAM, label: 'My Team' };
}

// ---------- the list ----------

/** Which requests the list shows: those waiting for the caller, by status, or all. */
export type CompensatoryFilter = 'waiting' | 'all' | LeaveStatus;

export const COMPENSATORY_FILTERS: readonly { value: CompensatoryFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'with_manager', label: LEAVE_STATUS_LABELS.with_manager },
  { value: 'with_hr', label: LEAVE_STATUS_LABELS.with_hr },
  { value: 'approved', label: LEAVE_STATUS_LABELS.approved },
  { value: 'rejected', label: LEAVE_STATUS_LABELS.rejected },
  { value: 'cancelled', label: LEAVE_STATUS_LABELS.cancelled },
  { value: 'all', label: 'All' },
];

/** The list's filters as the address has them. The days are the day worked's. */
export interface CompensatoryQuery {
  filter: CompensatoryFilter;
  from: string | null;
  to: string | null;
  departmentId: string | null;
  employeeId: string | null;
}

const lastOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

function dayOf(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseDate(`${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`) || null;
  return parseDate(v) || null;
}

/** The filters in the address (?status=&from=&to=&department=&employee=), waiting for you without a status. From after To swapped. */
export function readCompensatoryQuery(query: Query): CompensatoryQuery {
  const status = one(query.status);
  const month = one(query.month);
  const department = one(query.department);
  const employee = one(query.employee);
  let from = dayOf(one(query.from));
  let to = dayOf(one(query.to));
  if (!from && !to && MONTH.test(month)) [from, to] = [`${month}-01`, lastOf(month)];
  if (from && to && from > to) [from, to] = [to, from];
  return {
    filter: COMPENSATORY_FILTERS.some((f) => f.value === status) ? (status as CompensatoryFilter) : 'waiting',
    from,
    to,
    departmentId: UUID.test(department) ? department : null,
    employeeId: UUID.test(employee) ? employee : null,
  };
}

/** Whether any filter but the status is on. */
export const hasCompensatoryFilters = (q: Pick<CompensatoryQuery, 'from' | 'to' | 'departmentId' | 'employeeId'>) => !!(q.from || q.to || q.departmentId || q.employeeId);

/** The days chosen in words: "between 01/10/2026 and 31/10/2026", "from 01/10/2026", "up to 31/10/2026"; null for any. */
export function compensatoryDaysText(q: Pick<CompensatoryQuery, 'from' | 'to'>): string | null {
  if (q.from && q.to) return q.from === q.to ? `on ${formatDate(q.from)}` : `between ${formatDate(q.from)} and ${formatDate(q.to)}`;
  if (q.from) return `from ${formatDate(q.from)}`;
  if (q.to) return `up to ${formatDate(q.to)}`;
  return null;
}

/** The list's address: "/attendance/compensatory?status=approved&from=2026-11-01&to=2026-11-30". */
export function compensatoryListHref(q: Partial<CompensatoryQuery> = {}): string {
  const params = new URLSearchParams();
  if (q.filter && q.filter !== 'waiting') params.set('status', q.filter);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.departmentId) params.set('department', q.departmentId);
  if (q.employeeId) params.set('employee', q.employeeId);
  const qs = params.toString();
  return qs ? `${COMPENSATORY_PATH}?${qs}` : COMPENSATORY_PATH;
}

/** The API's requests for the filters: GET /compensatory?status=waiting|<status>&from=&to=&departmentId=&employeeId=. */
export function compensatoryListPath(q: Partial<CompensatoryQuery> = {}): string {
  const params = new URLSearchParams();
  const filter = q.filter ?? 'waiting';
  if (filter !== 'all') params.set('status', filter);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.departmentId) params.set('departmentId', q.departmentId);
  if (q.employeeId) params.set('employeeId', q.employeeId);
  const qs = params.toString();
  return qs ? `/compensatory?${qs}` : '/compensatory';
}

/** Those waiting for the caller: Approvals', My Team's and the sidebar's. */
export const WAITING_COMPENSATORY = compensatoryListPath({ filter: 'waiting' });

/** GET /compensatory/counts: { waiting }. */
export const COMPENSATORY_COUNTS = '/compensatory/counts';

/** "1 request", "3 requests". */
export const compensatoryLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

const EMPTY: Record<CompensatoryFilter, string> = {
  waiting: 'No compensatory day requests are waiting for you.',
  all: 'No compensatory day requests yet. Employees ask from My Requests; HR records one for someone with Record a compensatory day.',
  with_manager: 'No compensatory day requests are with a manager.',
  with_hr: 'No compensatory day requests are with HR.',
  approved: 'No compensatory days approved.',
  rejected: 'No compensatory day requests rejected.',
  cancelled: 'No compensatory day requests cancelled.',
};

export const emptyCompensatoryText = (filter: CompensatoryFilter) => EMPTY[filter];

// ---------- a request, in words ----------

/** A day with the weekday: "Friday 06/11/2026". */
export const compensatoryDateText = (date: string) => `${weekdayOf(date)} ${formatDate(date)}`;

/** The two days of a request: "Worked Friday 06/11/2026 · day off Tuesday 10/11/2026" (cash instead: no day off). */
export function compensatoryDaysLine(r: Pick<CompensatoryRequestView, 'dayWorked' | 'dayOff' | 'outcome'>): string {
  const worked = `Worked ${compensatoryDateText(r.dayWorked)}`;
  if (r.outcome === 'cash') return `${worked} · paid in cash instead`;
  return r.dayOff ? `${worked} · day off ${compensatoryDateText(r.dayOff)}` : worked;
}

/** HR's decision once approved, in words; null while undecided. */
export const compensatoryOutcomeText = (outcome: CompensatoryOutcome | null): string | null => (outcome ? COMPENSATORY_OUTCOME_LABELS[outcome] : null);

/** How it came: asked by the employee or recorded by HR. */
export const compensatorySourceText = (r: Pick<CompensatoryRequestView, 'recordedByHr'>): string => (r.recordedByHr ? 'Recorded by HR' : 'Asked by the employee');

/** Where a request stands, as a leave request's (who has it now, or how it ended, with a rejection's comment). */
export function compensatoryProgressText(
  r: Pick<CompensatoryRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'recordedByHr' | 'confidential' | 'steps'>,
): { text: string; reason: string | null } {
  return leaveProgressText({ ...r, steps: r.steps as unknown as LeaveRequestStep[] });
}

/** Once sent: where it goes, or, recorded by HR, that it is approved at once. */
export function compensatorySentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (status === 'approved') return 'Compensatory day recorded, approved at once.';
  const hr = hrStageName(confidential);
  const first = manager?.role === 'team_lead' ? 'your team lead' : manager?.role === 'department_head' ? 'your head of department' : 'your direct manager';
  return status === 'with_manager' ? `Request sent. It goes to ${first}, then ${hr}; each step shows on the request.` : `Request sent. It goes to ${hr}; each step shows on the request.`;
}

/** Once a decision went through; a C-level person's goes on to the CEO, not HR (`confidential`). */
export function compensatoryDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null, cash = false): string {
  if (decision === 'reject') return 'Request rejected. The employee sees your comment.';
  if (leaveStatusAfterApproval(stage) === 'with_hr') return `Approved: the request goes to ${hrStageName(confidential)}.`;
  return cash ? 'Approved as cash instead: the addition is on the month’s draft payroll, and there is no day off.' : 'Approved as a day off: it counts as a full paid day.';
}

/** Said when a decision is refused as the request moved on since the page was opened (the API's 409). */
export const COMPENSATORY_MOVED_ON = 'This request has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

/** What a request's page says after `?done=`, and in which tone; null for anything else. */
export function compensatoryDoneText(query: Query, status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null, outcome: CompensatoryOutcome | null = null): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent' || done === 'recorded') return { text: compensatorySentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Compensatory day cancelled. It stays on the list, cancelled; the day off is a working day again.', tone: 'ok' };
  if (done === 'moved') return { text: COMPENSATORY_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: compensatoryDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential, outcome === 'cash'), tone: 'ok' };
}

/** A step as its timeline shows it. */
export function compensatoryStepText(s: Pick<LeaveRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (s.kind === 'cancelled') return 'Cancelled';
  return leaveStepText(s, manager, confidential);
}

/** HR cancelling an approved one: the comment is required (POST /compensatory/:id/cancel). */
export function compensatoryCancelBody(fd: FormData): { body: { comment: string } | null; errors: string[] } {
  const comment = String(fd.get('comment') ?? '').trim();
  return comment ? { body: { comment }, errors: [] } : { body: null, errors: ['Write why the compensatory day is cancelled: the employee sees it.'] };
}

/** The decision form's button: approving as a day off or as cash, or rejecting. */
export function compensatoryDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, outcome: CompensatoryOutcome, confidential?: boolean | null): { label: string; busy: string } {
  if (decision === 'reject') return { label: 'Reject the request', busy: 'Rejecting…' };
  if (decision === 'approve' && stage === 'hr') return outcome === 'cash' ? { label: 'Approve as cash instead', busy: 'Approving…' } : { label: 'Approve as a day off', busy: 'Approving…' };
  if (decision === 'approve') return { label: `Approve and send to ${hrStageName(confidential)}`, busy: 'Approving…' };
  return { label: 'Choose your decision', busy: 'Saving…' };
}

/** The decision a form sends: the decision, the comment, and for HR's approval the outcome and the check-in confirmation. */
export interface CompensatoryDecisionBody {
  decision: LeaveDecision;
  comment?: string;
  outcome?: CompensatoryOutcome;
  confirmNoCheckIn?: boolean;
}

export function compensatoryDecisionBody(fd: FormData, stage: LeaveStage): { body: CompensatoryDecisionBody | null; errors: string[] } {
  const decision = String(fd.get('decision') ?? '');
  if (!(LEAVE_DECISIONS as readonly string[]).includes(decision)) return { body: null, errors: ['Choose your decision: approve or reject.'] };
  const body: CompensatoryDecisionBody = { decision: decision as LeaveDecision };
  const comment = String(fd.get('comment') ?? '').trim();
  if (comment) body.comment = comment;
  else if (decision === 'reject') return { body: null, errors: ['Write your comment: why the request is rejected.'] };
  if (decision === 'approve' && stage === 'hr') {
    body.outcome = String(fd.get('outcome') ?? '') === 'cash' ? 'cash' : 'day_off';
    if (fd.get('confirmNoCheckIn') === 'on') body.confirmNoCheckIn = true;
  }
  return { body, errors: [] };
}

// ---------- the forms ----------

/** The employee's form as typed: the day worked and the day off (DD/MM/YYYY), and why (optional). */
export interface TypedCompensatory {
  dayWorked: string;
  dayOff: string;
  reason: string;
}

/** What POST /me/compensatory takes. */
export interface CompensatoryBody {
  dayWorked: string;
  dayOff: string;
  reason?: string;
}

const weekdayNumber = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function readDays(t: TypedCompensatory, needOff: boolean): { dayWorked: string | null; dayOff: string | null; errors: string[] } {
  const errors: string[] = [];
  const dayWorked = parseDate(t.dayWorked);
  if (t.dayWorked.trim() === '') errors.push('Enter the day you worked.');
  else if (!dayWorked) errors.push('Enter the day worked as DD/MM/YYYY, e.g. 06/11/2026.');
  const dayOff = parseDate(t.dayOff);
  if (t.dayOff.trim() === '') {
    if (needOff) errors.push('Enter the day off you ask for.');
  } else if (!dayOff) errors.push('Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.');
  const reason = t.reason.trim();
  if (reason.length > COMPENSATORY_REASON_MAX) errors.push(`Keep the reason to ${COMPENSATORY_REASON_MAX} characters; it has ${reason.length}.`);
  return { dayWorked: dayWorked || null, dayOff: dayOff || null, errors };
}

/**
 * Why the employee's request can't be sent yet, in the order to fix them (none: it can): the days typed, then the shared
 * checks against what the API gave the form (`form`; null while it couldn't be read: the API checks them): the day worked a
 * rest day or an official holiday, not claimed, not to come; the day off a working day free of leave and other days off, in
 * the same month, a day ahead.
 */
export function compensatoryFormProblems(typed: TypedCompensatory, form: Pick<CompensatoryForm, 'today' | 'workingDays' | 'holidays' | 'leave' | 'other' | 'claimed' | 'checkedIn' | 'refusal'> | null): string[] {
  const { dayWorked, dayOff, errors } = readDays(typed, true);
  if (errors.length || !dayWorked || !dayOff) return errors;
  if (!form) return [];
  if (form.refusal) return [form.refusal];
  const holiday = (d: string) => form.holidays.find((h) => h.date === d)?.nameEn ?? null;
  const worked: CompensatoryWorkedDay = {
    workingDay: form.workingDays.includes(weekdayNumber(dayWorked)),
    holiday: holiday(dayWorked),
    claimed: form.claimed.includes(dayWorked),
    checkedIn: form.checkedIn.includes(dayWorked),
  };
  const leave = form.leave.find((l) => l.date === dayOff);
  const off: CompensatoryOffDay = {
    workingDay: form.workingDays.includes(weekdayNumber(dayOff)),
    holiday: holiday(dayOff),
    leave: leave ? { type: leave.type, status: leave.status } : null,
    other: form.other.find((o) => o.date === dayOff)?.what ?? null,
  };
  return compensatoryRequestProblems(dayWorked, dayOff, worked, off, form.today).map(shownMessage);
}

/** A warning (not a refusal) under the form: no check-in is kept on the day worked, so HR will confirm it. */
export function compensatoryFormWarning(typed: TypedCompensatory, form: Pick<CompensatoryForm, 'checkedIn'> | null): string | null {
  const dayWorked = parseDate(typed.dayWorked);
  if (!form || !dayWorked || form.checkedIn.includes(dayWorked)) return null;
  return `No check-in is kept on ${formatDate(dayWorked)}: HR will ask to confirm you worked that day.`;
}

/** What the form says once it can be sent: the days and where it goes (`toCeo`: a C-level person's goes to the CEO, not HR). */
export function compensatoryReadyText(typed: TypedCompensatory, toCeo = false): string {
  const worked = parseDate(typed.dayWorked);
  const off = parseDate(typed.dayOff);
  const days = worked && off ? ` for ${compensatoryDateText(worked)}, with a day off on ${compensatoryDateText(off)}` : '';
  return `Ready to send: a compensatory day${days}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}

/** The employee's request sent, or what can't be read: the API checks the rest and answers what is wrong. */
export function compensatoryForm(fd: FormData): { body: CompensatoryBody | null; errors: string[] } {
  const t = typedCompensatory(fd);
  const { dayWorked, dayOff, errors } = readDays(t, true);
  if (errors.length || !dayWorked || !dayOff) return { body: null, errors };
  const reason = t.reason.trim();
  return { body: reason ? { dayWorked, dayOff, reason } : { dayWorked, dayOff }, errors: [] };
}

/** HR's record: the employee, the days, the outcome and the reason (required). A cash one has no day off. */
export function compensatoryRecordForm(fd: FormData): { body: { employeeId: string; dayWorked: string; dayOff?: string; outcome: CompensatoryOutcome; reason: string } | null; errors: string[] } {
  const employeeId = String(fd.get('employeeId') ?? '').trim();
  const outcome: CompensatoryOutcome = String(fd.get('outcome') ?? '') === 'cash' ? 'cash' : 'day_off';
  const t = typedCompensatory(fd);
  const { dayWorked, dayOff, errors } = readDays(t, outcome === 'day_off');
  const reason = t.reason.trim();
  if (!reason) errors.push('Write why HR records this compensatory day.');
  if (!employeeId) errors.unshift('Choose the employee whose day it is.');
  if (errors.length || !dayWorked) return { body: null, errors };
  return { body: { employeeId, dayWorked, ...(outcome === 'day_off' && dayOff ? { dayOff } : {}), outcome, reason }, errors: [] };
}

/** The fields as typed, from the form. */
export const typedCompensatory = (fd: FormData): TypedCompensatory => ({
  dayWorked: String(fd.get('dayWorked') ?? ''),
  dayOff: String(fd.get('dayOff') ?? ''),
  reason: String(fd.get('reason') ?? ''),
});

/** The fields as the form shows them again after a refusal. */
export const typedCompensatoryValues = (fd: FormData): Record<string, string> =>
  Object.fromEntries(['dayWorked', 'dayOff', 'reason', 'employeeId', 'outcome'].map((k) => [k, String(fd.get(k) ?? '')]));

// ---------- the attendance pages ----------

/** The label of a compensatory day off on the attendance pages. */
export { COMPENSATORY_DAY_OFF_LABEL as COMPENSATORY_DAY_BADGE } from '@trendlix/shared';
