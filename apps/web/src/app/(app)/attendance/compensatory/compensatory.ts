import {
  COMPENSATORY_CASH_HINT,
  COMPENSATORY_OUTCOME_LABELS,
  COMPENSATORY_RULE_DEFAULTS,
  compensationEarned,
  compensationEarnedText,
  compensatoryCashDays,
  compensatoryRequestProblems,
  compensatoryRulesProblems,
  hoursText,
  hoursWorkedProblems,
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  leaveStatusAfterApproval,
  type CompensationEarned,
  type CompensatoryOffDay,
  type CompensatoryOutcome,
  type CompensatoryRules,
  type CompensatoryWorkedDay,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS, MY_TEAM } from '../../../../components/nav';
import { formatDate, parseDate } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import { appItemHref, type Surface } from '../../../../lib/surface';
import type { CompensatoryForm, CompensatoryRequestView } from '../../../../lib/compensatory-types';
import type { LeaveRequestStep, RequestApprover } from '../../../../lib/types';
import { hrStageName, leaveProgressText, leaveStepText } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { weekdayOf } from '../../organization/holidays/holidays';
import { odHref } from '../official-duty/od';

// Compensatory days (owner, 26 October 2026: "is there compensatory leaves in the system?"; then "my compensatory is a
// compensation with another day in the same month. and rarely to be compensated in cash"; "if paid in cash make it 1.5";
// "if the day is compensated with a day, we pay nothing"). Someone who worked a rest day of their shift or an official
// holiday asks, from My Requests → Compensatory day, for a working day off in the same calendar month, a day before at
// the latest; decided by the approver in charge, then HR (a C-level person's HR stage by the CEO); HR approves it as a day
// off or, rarely, as cash instead, and records one for someone. The rules are @trendlix/shared's (compensatory.ts), which
// the API enforces; these helpers word what it sent, read the forms and show the same checks live. Pure code, tested;
// relative imports, as vitest doesn't know the @/ paths.
// Since 27 October 2026 (owner, asked "what if an employee is going to compensate per hour?", he chose "Hours off for
// hours worked"): part of a rest day worked earns the same hours off on a working day, or cash for those hours, by the
// Compensatory Setup's rules ("up to 4 hours to be compensated by hours - minimum 6 hours can be compensated by a day",
// between them "Capped at 4 hours"), which HR sets on its own page ("i need a setup dashboard for the compensatory
// leaves"); and an official duty on a rest day or an official holiday carries its compensatory day, decided and cancelled
// with the duty.

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

/**
 * The two days of a request: "Worked Friday 06/11/2026 · day off Tuesday 10/11/2026" (cash instead: no day off); part of a
 * day (27 October 2026: "Hours off for hours worked") with its hours: "Worked Friday 06/11/2026 (4 hours) · 4 hours off
 * Tuesday 10/11/2026".
 */
export function compensatoryDaysLine(r: Pick<CompensatoryRequestView, 'dayWorked' | 'dayOff' | 'outcome' | 'hoursWorked' | 'hoursOff'>): string {
  const hoursWorked = r.hoursWorked ?? null;
  const hoursOff = r.hoursOff ?? null;
  const worked = `Worked ${compensatoryDateText(r.dayWorked)}${hoursWorked !== null ? ` (${hoursText(hoursWorked)})` : ''}`;
  if (r.outcome === 'cash') return `${worked} · paid in cash instead`;
  if (!r.dayOff) return worked;
  return `${worked} · ${hoursOff !== null ? `${hoursText(hoursOff)} off` : 'day off'} ${compensatoryDateText(r.dayOff)}`;
}

/** "1 hour's pay", "4 hours' pay". */
const hoursPay = (n: number) => (n === 1 ? "1 hour's pay" : `${hoursText(n)}' pay`);

/** "1 day's pay", "0.75 days' pay". */
const daysPay = (n: number) => (n === 1 ? "1 day's pay" : `${Math.round(n * 100) / 100} days' pay`);

/** A number of hours as the Setup's words show it: 4, 3.5. */
const num = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Part of a day worked on a request's page (27 October 2026): "4 hours: earned 4 hours off", "5 hours: earned 4 hours off
 * (capped at 4)", "7 hours: earned a whole day off"; null for the whole day.
 */
export function compensatoryHoursFact(r: Pick<CompensatoryRequestView, 'hoursWorked' | 'hoursOff'>): string | null {
  const worked = r.hoursWorked ?? null;
  if (worked === null) return null;
  const off = r.hoursOff ?? null;
  if (off === null) return `${hoursText(worked)}: earned a whole day off`;
  return `${hoursText(worked)}: earned ${hoursText(off)} off${off < worked ? ` (capped at ${num(off)})` : ''}`;
}

/** An approved one paid in cash, on its page: "An addition of 1.5 days' pay …", for hours "… of 4 hours' pay at 1.5× …". */
export function compensatoryCashAddedText(r: Pick<CompensatoryRequestView, 'cashDays' | 'hoursOff'>): string {
  const hours = r.hoursOff ?? null;
  return hours !== null ? `An addition of ${hoursPay(hours)} at ${r.cashDays}× on the month's payroll.` : `An addition of ${daysPay(r.cashDays)} on the month's payroll.`;
}

/** The official duty a request goes with (27 October 2026), in words: "With the official duty on 06/11/2026". */
export const compensatoryOdText = (od: { startDate: string }) => `With the official duty on ${formatDate(od.startDate)}`;

/** What is said under it: the duty's decision and cancelling are this one's too (the API refuses them on their own). */
export const COMPENSATORY_WITH_OD_NOTE = 'It is decided and cancelled with the official duty, never on its own.';

/** The official duty's page: on the site, or in the phone pages' section the request is opened in. */
export const compensatoryOdHref = (od: { id: string }, surface: Surface = 'site') => (surface === 'site' ? odHref(od.id) : appItemHref(surface, 'od', od.id));

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

/**
 * Once sent: where it goes, or, recorded by HR, that it is approved at once; hours off (27 October 2026) said with their
 * hours.
 */
export function compensatorySentText(
  status: LeaveStatus,
  manager?: Pick<RequestApprover, 'role'> | null,
  confidential?: boolean | null,
  hoursOff: number | null = null,
  outcome: CompensatoryOutcome | null = null,
): string {
  if (status === 'approved') {
    if (hoursOff === null) return 'Compensatory day recorded, approved at once.';
    return `Compensatory hours recorded, approved at once: ${outcome === 'cash' ? `${hoursPay(hoursOff)} in cash instead` : `${hoursText(hoursOff)} off`}.`;
  }
  const hr = hrStageName(confidential);
  const first = manager?.role === 'team_lead' ? 'your team lead' : manager?.role === 'department_head' ? 'your head of department' : 'your direct manager';
  const sent = hoursOff === null ? 'Request sent.' : `Request sent for ${hoursText(hoursOff)} off.`;
  return status === 'with_manager' ? `${sent} It goes to ${first}, then ${hr}; each step shows on the request.` : `${sent} It goes to ${hr}; each step shows on the request.`;
}

/** Once a decision went through; a C-level person's goes on to the CEO, not HR (`confidential`); hours off with their hours. */
export function compensatoryDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null, cash = false, hoursOff: number | null = null): string {
  if (decision === 'reject') return 'Request rejected. The employee sees your comment.';
  if (leaveStatusAfterApproval(stage) === 'with_hr') return `Approved: the request goes to ${hrStageName(confidential)}.`;
  if (hoursOff !== null) {
    return cash
      ? `Approved as cash instead: the addition for ${hoursPay(hoursOff)} is on the month’s draft payroll, and there are no hours off.`
      : `Approved as ${hoursText(hoursOff)} off: they count as worked hours on the day off.`;
  }
  return cash ? 'Approved as cash instead: the addition is on the month’s draft payroll, and there is no day off.' : 'Approved as a day off: it counts as a full paid day.';
}

/** Said when a decision is refused as the request moved on since the page was opened (the API's 409). */
export const COMPENSATORY_MOVED_ON = 'This request has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

/** What a request's page says after `?done=`, and in which tone; null for anything else. */
export function compensatoryDoneText(
  query: Query,
  status: LeaveStatus,
  manager?: Pick<RequestApprover, 'role'> | null,
  confidential?: boolean | null,
  outcome: CompensatoryOutcome | null = null,
  hoursOff: number | null = null,
): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent' || done === 'recorded') return { text: compensatorySentText(status, manager, confidential, hoursOff, outcome), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Compensatory day cancelled. It stays on the list, cancelled; the day off is a working day again.', tone: 'ok' };
  if (done === 'moved') return { text: COMPENSATORY_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: compensatoryDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential, outcome === 'cash', hoursOff), tone: 'ok' };
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

/** The decision form's button: approving as a day off (hours off for part of a day) or as cash, or rejecting. */
export function compensatoryDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, outcome: CompensatoryOutcome, confidential?: boolean | null, hours = false): { label: string; busy: string } {
  if (decision === 'reject') return { label: 'Reject the request', busy: 'Rejecting…' };
  if (decision === 'approve' && stage === 'hr') {
    if (outcome === 'cash') return { label: 'Approve as cash instead', busy: 'Approving…' };
    return { label: hours ? 'Approve as hours off' : 'Approve as a day off', busy: 'Approving…' };
  }
  if (decision === 'approve') return { label: `Approve and send to ${hrStageName(confidential)}`, busy: 'Approving…' };
  return { label: 'Choose your decision', busy: 'Saving…' };
}

/**
 * Under HR's choice when approving, what it gives: a day off, hours off on the day ("4 hours off on Tuesday
 * 10/11/2026"), or cash instead: a whole day at the rate in days' pay, hours as their pay at the rate ("Cash instead: 4
 * hours' pay at 1.5×"). `rate`: the request's `cashDays`, the Setup's rate.
 */
export function compensatoryOutcomeHint(outcome: CompensatoryOutcome, r: { dayOff: string | null; hoursOff?: number | null }, rate: number): string {
  const hours = r.hoursOff ?? null;
  if (outcome === 'cash') {
    return hours !== null
      ? `Cash instead: ${hoursPay(hours)} at ${rate}×, an addition on the draft payroll of the month, and no hours off. ${COMPENSATORY_CASH_HINT}`
      : `Cash instead (rarely): an addition of ${daysPay(rate)} on the draft payroll of the month, and no day off. ${COMPENSATORY_CASH_HINT}`;
  }
  if (hours !== null) return `${hoursText(hours)} off${r.dayOff ? ` on ${compensatoryDateText(r.dayOff)}` : ''}: counted as worked hours that day, and nothing is paid for the hours worked.`;
  return 'A day off (the default): a full paid day, and nothing is paid for the day worked.';
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

/** The whole day worked (the default), or part of it with its hours (owner, 27 October 2026: "Hours off for hours worked"). */
export type WorkedPart = 'whole' | 'part';

/**
 * The employee's form as typed: the day worked and the day off (DD/MM/YYYY), and why (optional); the whole day worked
 * unless `part` says part of it, its hours as typed in `hours` (e.g. "4", "3.5").
 */
export interface TypedCompensatory {
  dayWorked: string;
  dayOff: string;
  reason: string;
  part?: WorkedPart;
  hours?: string;
}

/** What POST /me/compensatory takes: `hoursWorked` only for part of the day. */
export interface CompensatoryBody {
  dayWorked: string;
  dayOff: string;
  hoursWorked?: number;
  reason?: string;
}

/** HR's record (POST /compensatory). */
export interface CompensatoryRecordBody {
  employeeId: string;
  dayWorked: string;
  dayOff?: string;
  hoursWorked?: number;
  outcome: CompensatoryOutcome;
  reason: string;
}

const weekdayNumber = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function readDays(t: TypedCompensatory, needOff: boolean): { dayWorked: string | null; dayOff: string | null; errors: string[] } {
  const errors: string[] = [];
  const dayWorked = parseDate(t.dayWorked);
  if (t.dayWorked.trim() === '') errors.push('Enter the day you worked.');
  else if (!dayWorked) errors.push('Enter the day worked as DD/MM/YYYY, e.g. 06/11/2026.');
  // part of the day: its hours, read where the form asks them, after the day worked
  const hours = readHoursWorked(t.part, t.hours);
  if (hours.error) errors.push(hours.error);
  const dayOff = parseDate(t.dayOff);
  if (t.dayOff.trim() === '') {
    if (needOff) errors.push('Enter the day off you ask for.');
  } else if (!dayOff) errors.push('Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.');
  const reason = t.reason.trim();
  if (reason.length > COMPENSATORY_REASON_MAX) errors.push(`Keep the reason to ${COMPENSATORY_REASON_MAX} characters; it has ${reason.length}.`);
  return { dayWorked: dayWorked || null, dayOff: dayOff || null, errors };
}

/** Hours as typed: a number of up to two digits and two decimals, a comma or a point ("4", "3.5", "3,25"). */
const HOURS_TYPED = /^\d{1,2}(?:[.,]\d{1,2})?$/;

/**
 * The hours worked as typed (27 October 2026): null for the whole day (`part` not 'part'); for part of the day its
 * hours, or why they can't be read. Whether they earn anything is the Setup's to say (hoursWorkedProblems).
 */
export function readHoursWorked(part: WorkedPart | undefined, typed: string | undefined): { hoursWorked: number | null; error: string | null } {
  if (part !== 'part') return { hoursWorked: null, error: null };
  const raw = (typed ?? '').trim();
  if (raw === '') return { hoursWorked: null, error: 'Enter the hours worked, e.g. 4 or 3.5.' };
  const hours = HOURS_TYPED.test(raw) ? Number(raw.replace(',', '.')) : Number.NaN;
  if (!(hours > 0 && hours <= 24)) return { hoursWorked: null, error: 'Enter the hours worked as a number above 0, up to 24, e.g. 4 or 3.5.' };
  return { hoursWorked: hours, error: null };
}

/** The Compensatory Setup's rules as the API sent them, the owner's numbers for any left out (an API from before them). */
export function compensatoryRulesOf(sent: Partial<CompensatoryRules> | null | undefined): CompensatoryRules {
  const d = COMPENSATORY_RULE_DEFAULTS;
  const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    cashRate: n(sent?.cashRate, d.cashRate),
    minHours: n(sent?.minHours, d.minHours),
    hoursCap: n(sent?.hoursCap, d.hoursCap),
    fullDayHours: n(sent?.fullDayHours, d.fullDayHours),
    offWithinDays: typeof sent?.offWithinDays === 'number' ? sent.offWithinDays : d.offWithinDays,
  };
}

/**
 * What the hours worked earn, said live under the field (owner, 27 October 2026: "up to 4 hours to be compensated by
 * hours - minimum 6 hours can be compensated by a day", between them "Capped at 4 hours"): "Earns a whole day off",
 * "Earns 3 hours off", "Earns 4 hours off (capped at 4)", "Earns nothing: fewer than 2 hours worked". `hoursWorked` null:
 * the whole day.
 */
export function compensatoryEarnsText(hoursWorked: number | null, rules: Pick<CompensatoryRules, 'minHours' | 'hoursCap' | 'fullDayHours'>): string {
  const earned = compensationEarned(hoursWorked, rules);
  if (earned.kind === 'day') return hoursWorked === null ? 'Earns a whole day off' : `Earns a whole day off (${hoursText(rules.fullDayHours)} or more)`;
  if (earned.kind === 'hours') return `Earns ${hoursText(earned.hours)} off${hoursWorked !== null && hoursWorked > rules.hoursCap ? ` (capped at ${num(rules.hoursCap)})` : ''}`;
  return `Earns ${compensationEarnedText(earned, rules)}`;
}

/**
 * The Setup's hours rules in a line, under the hours field: "Under 2 hours earn nothing; from 2 hours, the same hours off,
 * at most 4; 6 hours or more, a whole day (Compensatory Setup)." A range the rules leave empty is left out.
 */
export function compensatoryRulesText(r: Pick<CompensatoryRules, 'minHours' | 'hoursCap' | 'fullDayHours'>): string {
  const parts = [`Under ${hoursText(r.minHours)} earn nothing`];
  if (r.minHours < r.fullDayHours) parts.push(`from ${hoursText(r.minHours)}, the same hours off${r.hoursCap < r.fullDayHours ? `, at most ${num(r.hoursCap)}` : ''}`);
  parts.push(`${hoursText(r.fullDayHours)} or more, a whole day`);
  return `${parts.join('; ')} (Compensatory Setup).`;
}

/** When the day off is taken, by the Setup: "in the same month as the day worked", "within 10 days after the day worked". */
export function compensatoryWindowText(offWithinDays: number | null): string {
  return offWithinDays === null ? 'in the same month as the day worked' : `within ${offWithinDays} ${offWithinDays === 1 ? 'day' : 'days'} after the day worked`;
}

/**
 * The day off's field, by what is earned: "Day off", or for hours off "Day for the hours off", explaining they are counted
 * as worked that day; its window the Setup's. `by`: the employee asking, or HR recording.
 */
export function compensatoryDayOffField(earned: CompensationEarned | null, rules: Pick<CompensatoryRules, 'offWithinDays'>, by: 'employee' | 'hr'): { label: string; hint: string } {
  const window = compensatoryWindowText(rules.offWithinDays);
  const when = by === 'employee' ? `A working day ${window}, tomorrow or later: not leave, work from home or an official holiday.` : `A working day ${window}; a day gone by is recorded with a warning.`;
  if (earned?.kind !== 'hours') return { label: 'Day off', hint: when };
  const are = earned.hours === 1 ? 'is' : 'are';
  return { label: 'Day for the hours off', hint: `${when} The ${hoursText(earned.hours)} off ${are} counted as worked that day, with no deduction; ${by === 'employee' ? 'you work' : 'they work'} the rest of it.` };
}

/**
 * Why the employee's request can't be sent yet, in the order to fix them (none: it can): the days and the hours typed,
 * then the shared checks against what the API gave the form (`form`; null while it couldn't be read: the API checks them):
 * the hours enough to earn something (the Setup's minimum); the day worked a rest day or an official holiday, not claimed,
 * not to come; the day off a working day free of leave and other days off, in the Setup's window, a day ahead.
 */
export function compensatoryFormProblems(
  typed: TypedCompensatory,
  form: Pick<CompensatoryForm, 'today' | 'workingDays' | 'holidays' | 'leave' | 'other' | 'claimed' | 'checkedIn' | 'refusal' | 'rules'> | null,
): string[] {
  const { dayWorked, dayOff, errors } = readDays(typed, true);
  if (errors.length || !dayWorked || !dayOff) return errors;
  if (!form) return [];
  if (form.refusal) return [form.refusal];
  const rules = compensatoryRulesOf(form.rules);
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
  const { hoursWorked } = readHoursWorked(typed.part, typed.hours);
  return [...hoursWorkedProblems(hoursWorked, rules), ...compensatoryRequestProblems(dayWorked, dayOff, worked, off, form.today, rules)].map(shownMessage);
}

/** A warning (not a refusal) under the form: no check-in is kept on the day worked, so HR will confirm it. */
export function compensatoryFormWarning(typed: TypedCompensatory, form: Pick<CompensatoryForm, 'checkedIn'> | null): string | null {
  const dayWorked = parseDate(typed.dayWorked);
  if (!form || !dayWorked || form.checkedIn.includes(dayWorked)) return null;
  return `No check-in is kept on ${formatDate(dayWorked)}: HR will ask to confirm you worked that day.`;
}

/**
 * What the form says once it can be sent: the days (and the hours, for part of a day) and where it goes (`toCeo`: a
 * C-level person's goes to the CEO, not HR).
 */
export function compensatoryReadyText(typed: TypedCompensatory, toCeo = false, rules: Pick<CompensatoryRules, 'minHours' | 'hoursCap' | 'fullDayHours'> = COMPENSATORY_RULE_DEFAULTS): string {
  const worked = parseDate(typed.dayWorked);
  const off = parseDate(typed.dayOff);
  const { hoursWorked } = readHoursWorked(typed.part, typed.hours);
  const earned = compensationEarned(hoursWorked, rules);
  let days = '';
  if (worked && off) {
    days =
      earned.kind === 'hours' && hoursWorked !== null
        ? ` for ${hoursText(hoursWorked)} worked on ${compensatoryDateText(worked)}, with ${hoursText(earned.hours)} off on ${compensatoryDateText(off)}`
        : ` for ${compensatoryDateText(worked)}, with a day off on ${compensatoryDateText(off)}`;
  }
  return `Ready to send: a compensatory day${days}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}

/** The employee's request sent, or what can't be read: the API checks the rest and answers what is wrong. */
export function compensatoryForm(fd: FormData): { body: CompensatoryBody | null; errors: string[] } {
  const t = typedCompensatory(fd);
  const { dayWorked, dayOff, errors } = readDays(t, true);
  if (errors.length || !dayWorked || !dayOff) return { body: null, errors };
  const { hoursWorked } = readHoursWorked(t.part, t.hours);
  const reason = t.reason.trim();
  return { body: { dayWorked, dayOff, ...(hoursWorked !== null ? { hoursWorked } : {}), ...(reason ? { reason } : {}) }, errors: [] };
}

/** HR's record: the employee, the days, the hours of part of a day, the outcome and the reason (required). A cash one has no day off. */
export function compensatoryRecordForm(fd: FormData): { body: CompensatoryRecordBody | null; errors: string[] } {
  const employeeId = String(fd.get('employeeId') ?? '').trim();
  const outcome: CompensatoryOutcome = String(fd.get('outcome') ?? '') === 'cash' ? 'cash' : 'day_off';
  const t = typedCompensatory(fd);
  const { dayWorked, dayOff, errors } = readDays(t, outcome === 'day_off');
  const reason = t.reason.trim();
  if (!reason) errors.push('Write why HR records this compensatory day.');
  if (!employeeId) errors.unshift('Choose the employee whose day it is.');
  if (errors.length || !dayWorked) return { body: null, errors };
  const { hoursWorked } = readHoursWorked(t.part, t.hours);
  return { body: { employeeId, dayWorked, ...(outcome === 'day_off' && dayOff ? { dayOff } : {}), ...(hoursWorked !== null ? { hoursWorked } : {}), outcome, reason }, errors: [] };
}

/**
 * HR's record, cash instead in words (27 October 2026): a whole day "an addition of 1.5 days' pay"; hours "0.75 days' pay
 * (4 hours at 1.5×)", `cashDays` the check's (by their shift's hours a day), or before it is read, the hours' pay at the
 * rate; nothing earned, nothing paid.
 */
export function compensatoryRecordCashText(earned: CompensationEarned, rules: Pick<CompensatoryRules, 'cashRate' | 'minHours'>, cashDays: number | null): string {
  if (earned.kind === 'none') return `Nothing to pay: fewer than ${hoursText(rules.minHours)} worked earn nothing.`;
  if (earned.kind === 'day') return `Cash instead: an addition of ${daysPay(cashDays ?? rules.cashRate)} on the month's draft payroll, and no day off. ${COMPENSATORY_CASH_HINT}`;
  const pay = cashDays !== null ? `${daysPay(cashDays)} (${hoursText(earned.hours)} at ${rules.cashRate}×)` : `${hoursPay(earned.hours)} at ${rules.cashRate}× (in days' pay by their shift's hours a day)`;
  return `Cash instead: ${pay} on the month's draft payroll, and no hours off.`;
}

/** The fields as typed, from the form. */
export const typedCompensatory = (fd: FormData): TypedCompensatory => ({
  dayWorked: String(fd.get('dayWorked') ?? ''),
  dayOff: String(fd.get('dayOff') ?? ''),
  reason: String(fd.get('reason') ?? ''),
  part: fd.get('part') === 'part' ? 'part' : 'whole',
  hours: String(fd.get('hoursWorked') ?? ''),
});

/** The fields as the form shows them again after a refusal. */
export const typedCompensatoryValues = (fd: FormData): Record<string, string> =>
  Object.fromEntries(['dayWorked', 'dayOff', 'reason', 'employeeId', 'outcome', 'part', 'hoursWorked'].map((k) => [k, String(fd.get(k) ?? '')]));

// ---------- the Compensatory Setup (owner, 27 October 2026: "i need a setup dashboard for the compensatory leaves") ----------
// Asked which settings, he chose all four: the minimum hours to qualify, the hours for a whole day, the cash rate (moved
// here from the Leave Setup) and when the day off is taken; "up to 4 hours to be compensated by hours - minimum 6 hours can
// be compensated by a day", between them "Capped at 4 hours". Its own page under Compensatory Days.

/** The Compensatory Setup's page. */
export const COMPENSATORY_SETUP_PATH = `${COMPENSATORY_PATH}/setup`;

/** Who changes it: HR, as the Leave Setup (editsLeaveSetup) and the API (PATCH /compensatory/settings); the other staff read it. */
export const editsCompensatorySetup = (user: WithRoles) => hasRole(user, 'hr');

/** When the day off is taken: in the same calendar month, or within some days after the day worked. */
export type CompensatoryWindow = 'month' | 'days';

/** The Setup's form as typed. */
export interface TypedCompensatorySetup {
  cashRate: string;
  minHours: string;
  hoursCap: string;
  fullDayHours: string;
  window: CompensatoryWindow;
  offWithinDays: string;
}

/** The Setup's form as the saved rules fill it. */
export const typedSetupOf = (r: CompensatoryRules): TypedCompensatorySetup => ({
  cashRate: num(r.cashRate),
  minHours: num(r.minHours),
  hoursCap: num(r.hoursCap),
  fullDayHours: num(r.fullDayHours),
  window: r.offWithinDays === null ? 'month' : 'days',
  offWithinDays: r.offWithinDays === null ? '' : String(r.offWithinDays),
});

/** The Setup's fields as sent. */
export const typedCompensatorySetup = (fd: FormData): TypedCompensatorySetup => ({
  cashRate: String(fd.get('cashRate') ?? ''),
  minHours: String(fd.get('minHours') ?? ''),
  hoursCap: String(fd.get('hoursCap') ?? ''),
  fullDayHours: String(fd.get('fullDayHours') ?? ''),
  window: fd.get('window') === 'days' ? 'days' : 'month',
  offWithinDays: String(fd.get('offWithinDays') ?? ''),
});

/** A number typed in the Setup, a comma for the point too; NaN for none or anything else (the shared checks say why). */
function setupNumber(raw: string): number {
  const s = raw.trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

/** The rules typed, or why they can't be saved (none: they can), in the shared checks' words (the API's). */
export function readCompensatorySetup(t: TypedCompensatorySetup): { rules: CompensatoryRules | null; errors: string[] } {
  const rules: CompensatoryRules = {
    cashRate: setupNumber(t.cashRate),
    minHours: setupNumber(t.minHours),
    hoursCap: setupNumber(t.hoursCap),
    fullDayHours: setupNumber(t.fullDayHours),
    offWithinDays: t.window === 'days' ? setupNumber(t.offWithinDays) : null,
  };
  const errors = compensatoryRulesProblems(rules);
  return errors.length ? { rules: null, errors } : { rules, errors: [] };
}

/** A row of the Setup's table: hours worked on a rest day or an official holiday, what they earn, an example, cash instead. */
export interface CompensatorySetupRow {
  worked: string;
  earns: string;
  example: string;
  cash: string;
}

/** Hours as the table shows them: "1.5 h". */
const hrs = (n: number) => `${num(n)} h`;

/** A half hour within (from, to) for an example, the middle when there is none. */
function between(from: number, to: number): number {
  const half = Math.floor(((from + to) / 2) * 2) / 2;
  return half > from && half < to ? half : (from + to) / 2;
}

/**
 * What the rules give, a row each, with the current numbers (owner, 27 October 2026): under the minimum nothing; from it
 * the same hours off, at most the cap; over the cap and under a whole day's hours the cap; from those hours (or the whole
 * day) a whole day. Cash instead: a whole day the rate in days' pay, hours their share on a shift of `hoursADay` hours.
 * A range the rules leave empty (the cap at a whole day's hours, the minimum at them) has no row.
 */
export function compensatorySetupRows(r: CompensatoryRules, hoursADay = 8): CompensatorySetupRow[] {
  const rows: CompensatorySetupRow[] = [];
  const cashFor = (hours: number) => `${daysPay(compensatoryCashDays({ kind: 'hours', hours }, r, hoursADay))} (${hrs(hours)} at ${r.cashRate}×, a shift of ${hrs(hoursADay)} a day)`;
  const under = r.minHours > 0.5 ? r.minHours - 0.5 : r.minHours / 2;
  rows.push({ worked: `Under ${hrs(r.minHours)}`, earns: 'Nothing', example: `${hrs(under)} → nothing`, cash: '—' });
  if (r.minHours < r.fullDayHours) {
    // the same hours off: from the minimum to the cap, or to under a whole day's hours when the cap is at them
    const top = Math.min(r.hoursCap, r.fullDayHours);
    const capped = r.hoursCap < r.fullDayHours;
    const worked = capped ? (r.minHours === r.hoursCap ? hrs(r.minHours) : `${hrs(r.minHours)} to ${hrs(r.hoursCap)}`) : `${hrs(r.minHours)} to under ${hrs(r.fullDayHours)}`;
    const example = r.minHours === top ? r.minHours : between(r.minHours, top);
    rows.push({ worked, earns: 'The same hours off', example: `${hrs(example)} → ${hrs(example)} off`, cash: cashFor(example) });
    if (capped) {
      const over = between(r.hoursCap, r.fullDayHours);
      rows.push({ worked: `Over ${hrs(r.hoursCap)}, under ${hrs(r.fullDayHours)}`, earns: `${hrs(r.hoursCap)} off, the most`, example: `${hrs(over)} → ${hrs(r.hoursCap)} off`, cash: cashFor(r.hoursCap) });
    }
  }
  rows.push({ worked: `${hrs(r.fullDayHours)} or more, or the whole day`, earns: 'A whole day off', example: `${hrs(r.fullDayHours)}+ → a whole day`, cash: daysPay(r.cashRate) });
  return rows;
}

// ---------- the attendance pages ----------

/** The label of a compensatory day off on the attendance pages. */
export { COMPENSATORY_DAY_OFF_LABEL as COMPENSATORY_DAY_BADGE } from '@trendlix/shared';
