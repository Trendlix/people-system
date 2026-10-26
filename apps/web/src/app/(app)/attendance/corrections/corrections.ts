import {
  CORRECTION_KIND_LABELS,
  CORRECTION_KIND_NAMES,
  CORRECTION_KINDS,
  CORRECTION_REASON_MAX,
  correctionProblems,
  correctionTimesText,
  isCorrectionKind,
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  leaveStatusAfterApproval,
  type CorrectableDay,
  type CorrectionKind,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS, MY_TEAM } from '../../../../components/nav';
import type { AttendanceCorrectionView, CorrectionDayBefore, MonthCorrectable, MonthCorrection } from '../../../../lib/correction-types';
import { formatDate, parseDate, parseTime } from '../../../../lib/format';
import { hasRole } from '../../../../lib/roles';
import type { LeaveRequestStep, RequestApprover } from '../../../../lib/types';
import { hrStageName, leaveDecisionButton, leaveStepText } from '../../leave/list';
import { shownMessage } from '../../leave/permissions';
import { weekdayOf } from '../../organization/holidays/holidays';
import { cairoTime } from '../../payroll/[id]/attendance/attendance';

// Attendance corrections (owner, 19 October 2026, "Proceed with those": "Attendance corrections with approval ("I forgot
// to check out")"): an employee asks to correct a day from My Attendance → the day → Ask for a correction (what was
// wrong, the right times in 12-hour time, why), decided as leave is (the direct manager, else the team lead, else the
// department's head, then HR; a C-level person's HR stage by the CEO), cancelled while it is being decided; approved,
// the day is changed, shown "corrected from …". HR corrects a day directly from the person's month, approved at once.
// Listed under Attendance → Corrections for HR and the CEO, on My Team for a manager, on My Requests for the employee.
// The rules are @trendlix/shared's (attendance-corrections.ts), which the API enforces; these helpers word what it sent,
// read the form and show the same checks live. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// ---------- the addresses ----------

/** HR's and the CEO's list, under Attendance. */
export const CORRECTIONS_PATH = '/attendance/corrections';

/** A correction's page, where it is decided and cancelled: "/attendance/corrections/<id>". */
export const correctionHref = (id: string) => `${CORRECTIONS_PATH}/${encodeURIComponent(id)}`;

/** What was just done on a correction, said on its page by `?done=`. */
export type CorrectionDone = 'sent' | 'recorded' | 'cancelled' | 'moved' | `${LeaveStage}_${LeaveDecision}`;

/** A correction's page after something was done on it: "/attendance/corrections/<id>?done=sent". */
export const correctionDoneHref = (id: string, done: CorrectionDone) => `${correctionHref(id)}?done=${done}`;

/** The employee's form: "/my-attendance/correct?date=2026-10-12" (the day chosen already, from My Attendance). */
export const ASK_CORRECTION_PATH = '/my-attendance/correct';
export const askCorrectionHref = (date?: string | null) => (date && DATE.test(date) ? `${ASK_CORRECTION_PATH}?date=${date}` : ASK_CORRECTION_PATH);

/** HR's form to correct a person's day directly: "/attendance/<employeeId>/correct?date=2026-10-12". */
export const hrCorrectionHref = (employeeId: string, date?: string | null) =>
  `/attendance/${encodeURIComponent(employeeId)}/correct${date && DATE.test(date) ? `?date=${date}` : ''}`;

/** Where the employee's own corrections are listed: their part of My Requests. */
export const MY_CORRECTIONS_HREF = `${MY_REQUESTS}#my-corrections`;

/** Who sees everyone's corrections (Attendance → Corrections): HR and the CEO, who decide their HR stage. */
export const seesCorrections = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

/** Who corrects a day directly: HR. */
export const correctsDays = (user: WithRoles) => hasRole(user, 'hr');

/** Where a correction's page goes back to: Corrections for HR and the CEO, My Requests for its employee, else My Team. */
export function correctionBack(user: WithRoles & { employeeId?: string | null }, r: Pick<AttendanceCorrectionView, 'employee'>): { href: string; label: string } {
  if (seesCorrections(user)) return { href: CORRECTIONS_PATH, label: 'Corrections' };
  if (user.employeeId && r.employee.id === user.employeeId) return { href: MY_CORRECTIONS_HREF, label: 'My Requests' };
  return { href: MY_TEAM, label: 'My Team' };
}

// ---------- the list ----------

/** Which corrections the list shows: those waiting for the caller, by status, or all. */
export type CorrectionFilter = 'waiting' | 'all' | LeaveStatus;

export const CORRECTION_FILTERS: readonly { value: CorrectionFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'with_manager', label: LEAVE_STATUS_LABELS.with_manager },
  { value: 'with_hr', label: LEAVE_STATUS_LABELS.with_hr },
  { value: 'approved', label: LEAVE_STATUS_LABELS.approved },
  { value: 'rejected', label: LEAVE_STATUS_LABELS.rejected },
  { value: 'cancelled', label: LEAVE_STATUS_LABELS.cancelled },
  { value: 'all', label: 'All' },
];

/** The filter in the address (?status=), waiting for you without one; the month (?month=YYYY-MM), none for every month. */
export function readCorrectionQuery(query: Query): { filter: CorrectionFilter; month: string | null } {
  const status = one(query.status);
  const filter = CORRECTION_FILTERS.some((f) => f.value === status) ? (status as CorrectionFilter) : 'waiting';
  const month = one(query.month);
  return { filter, month: MONTH.test(month) ? month : null };
}

/** The list's address: "/attendance/corrections?status=approved&month=2026-10". */
export function correctionsListHref(filter: CorrectionFilter, month: string | null = null): string {
  const params = new URLSearchParams();
  if (filter !== 'waiting') params.set('status', filter);
  if (month) params.set('month', month);
  const qs = params.toString();
  return qs ? `${CORRECTIONS_PATH}?${qs}` : CORRECTIONS_PATH;
}

/** The API's corrections for a filter: GET /attendance/corrections?status=waiting|<status>, without one for All. */
export function correctionsPath(filter: CorrectionFilter, month: string | null = null): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (month) params.set('month', month);
  const qs = params.toString();
  return qs ? `/attendance/corrections?${qs}` : '/attendance/corrections';
}

/** Those waiting for the caller: My Team's and the sidebar's. */
export const WAITING_CORRECTIONS = correctionsPath('waiting');

/** GET /attendance/corrections/counts: { waiting }. */
export const CORRECTION_COUNTS = '/attendance/corrections/counts';

/** "1 correction", "3 corrections". */
export const correctionsLabel = (n: number) => `${n} ${n === 1 ? 'correction' : 'corrections'}`;

const EMPTY: Record<CorrectionFilter, string> = {
  waiting: 'No attendance corrections are waiting for you.',
  all: 'No attendance corrections yet. Employees ask for them from My Attendance; HR corrects a day directly from the person’s month.',
  with_manager: 'No corrections are with a manager.',
  with_hr: 'No corrections are with HR.',
  approved: 'No corrections approved.',
  rejected: 'No corrections rejected.',
  cancelled: 'No corrections cancelled.',
};

export const emptyCorrectionsText = (filter: CorrectionFilter) => EMPTY[filter];

// ---------- a correction, in words ----------

/** What was wrong, as the lists say it: "Forgot to check out". */
export const correctionKindName = (kind: CorrectionKind | string) => (isCorrectionKind(kind) ? CORRECTION_KIND_NAMES[kind] : kind);

/** Its day with the weekday: "Monday 12/10/2026". */
export const correctionDayText = (r: { date: string }) => `${weekdayOf(r.date)} ${formatDate(r.date)}`;

/** The right times asked for: "9:05 AM – 6:30 PM", "In at 9:05 AM", "Out at 6:30 PM", or "As on record". */
export function rightTimesText(r: { checkIn: string | null; checkOut: string | null }): string {
  const t = correctionTimesText(r);
  return t ? t[0].toUpperCase() + t.slice(1) : 'As on record';
}

/** The day as it was when asked: "9:05 AM – no check-out", "Absent", "No day on record". */
export function dayBeforeText(d: CorrectionDayBefore | null): string {
  if (!d) return 'No day on record';
  if (!d.checkIn && !d.checkOut) return d.status === 'absent' ? 'Absent' : LEAVE_LIKE[d.status] ?? 'No check-in or check-out';
  return `${d.checkIn ? cairoTime(d.checkIn) : 'no check-in'} – ${d.checkOut ? cairoTime(d.checkOut) : 'no check-out'}`;
}

const LEAVE_LIKE: Partial<Record<string, string>> = { rest: 'Rest day', holiday: 'Official holiday', leave: 'On leave', zoho_leave: 'Leave in Zoho only', no_check_in: 'No check-in' };

/** Once sent: where it goes, or, recorded by HR, that the day is changed. */
export function correctionSentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (status === 'approved') return 'Day corrected, approved at once: its hours are counted again, and the month’s draft payroll takes it.';
  const hr = hrStageName(confidential);
  const first = manager?.role === 'team_lead' ? 'your team lead' : manager?.role === 'department_head' ? 'your head of department' : 'your direct manager';
  return status === 'with_manager' ? `Request sent. It goes to ${first}, then ${hr}; each step shows on the request.` : `Request sent. It goes to ${hr}; each step shows on the request.`;
}

/** Once a decision went through; a C-level person's goes on to the CEO, not HR (`confidential`). */
export function correctionDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null): string {
  if (decision === 'reject') return 'Correction rejected. The employee sees your comment.';
  return leaveStatusAfterApproval(stage) === 'with_hr'
    ? `Approved: the correction goes to ${hrStageName(confidential)}.`
    : 'Approved: the day is corrected, its hours counted again, and the month’s draft payroll takes it.';
}

/** Said when a decision is refused as the correction moved on since the page was opened (the API's 409). */
export const CORRECTION_MOVED_ON = 'This correction has moved on since you opened it, or can’t be applied now: it shows where it stands, and why.';

/** What a correction's page says after `?done=`, and in which tone; null for anything else. */
export function correctionDoneText(
  query: Query,
  status: LeaveStatus,
  manager?: Pick<RequestApprover, 'role'> | null,
  confidential?: boolean | null,
): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent' || done === 'recorded') return { text: correctionSentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Correction cancelled. It stays on the list, cancelled; the day is as it was.', tone: 'ok' };
  if (done === 'moved') return { text: CORRECTION_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: correctionDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential), tone: 'ok' };
}

/** A step as its timeline shows it: as a leave request's, HR's own correction and a cancelling in their words. */
export function correctionStepText(s: Pick<LeaveRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (s.kind === 'recorded_by_hr') return 'Corrected by HR directly, approved at once';
  if (s.kind === 'cancelled') return 'Cancelled by the employee';
  return leaveStepText(s, manager, confidential);
}

/** The decision form's button: as a leave request's, the last approval approving the correction. */
export function correctionDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, confidential?: boolean | null): { label: string; busy: string } {
  const b = leaveDecisionButton(decision, stage, confidential);
  return b.label === 'Approve the leave' ? { ...b, label: 'Approve the correction' } : b;
}

// ---------- a day's correction, on the attendance pages ----------

/** What a day's row offers: ask (or correct, for HR), the correction open on it, or nothing. */
export type DayCorrection = { kind: 'ask'; href: string } | { kind: 'open'; id: string; status: LeaveStatus } | null;

/**
 * What a day of a person's month offers (owner's brief, 19 October 2026: "My Attendance → the day → Ask for a
 * correction"): a correction of it being decided (to open), else a way to ask (or, for HR, to correct it) on a day gone
 * by or today, not of leave, in a month whose payroll isn't approved; else nothing.
 */
export function dayCorrection(
  day: { date: string; status: string },
  corrections: readonly MonthCorrection[],
  correctable: MonthCorrectable | null | undefined,
  today: string,
  href: (date: string) => string,
): DayCorrection {
  const open = corrections.find((c) => c.date === day.date && (c.status === 'with_manager' || c.status === 'with_hr'));
  if (open) return { kind: 'open', id: open.id, status: open.status };
  if (!correctable?.allowed || day.date > today || day.status === 'leave') return null;
  return { kind: 'ask', href: href(day.date) };
}

// ---------- the form ----------

/** Which times a kind asks for: required, optional, or not asked. */
export type TimeNeed = 'required' | 'optional' | 'none';

/**
 * The times each kind asks for (the API's rules: correctionProblems): forgot to check in, the time they came in (and
 * when they left, if they know it); forgot to check out, the time they left; a time wrong, either or both; worked
 * remotely or at a client, both, the check-in needed when none is on record.
 */
export function timesNeeded(kind: string, day: Pick<CorrectableDay, 'checkIn'> | null): { checkIn: TimeNeed; checkOut: TimeNeed } {
  switch (kind) {
    case 'forgot_check_in':
      return { checkIn: 'required', checkOut: 'optional' };
    case 'forgot_check_out':
      return { checkIn: 'none', checkOut: 'required' };
    case 'worked_remotely':
      return { checkIn: day?.checkIn ? 'optional' : 'required', checkOut: 'optional' };
    case 'wrong_time':
      return { checkIn: 'optional', checkOut: 'optional' };
    default:
      return { checkIn: 'optional', checkOut: 'optional' };
  }
}

/** The kinds, as the form's choices. */
export const CORRECTION_KIND_OPTIONS: readonly { value: CorrectionKind; label: string }[] = CORRECTION_KINDS.map((k) => ({ value: k, label: CORRECTION_KIND_LABELS[k] }));

/** The form as typed: the day (DD/MM/YYYY), what was wrong, the times (12-hour, optional by kind), why. */
export interface TypedCorrection {
  date: string;
  kind: string;
  checkIn: string;
  checkOut: string;
  reason: string;
}

/** What POST /me/attendance/corrections takes (HR's POST /attendance/corrections with the employee too). */
export interface CorrectionBody {
  date: string;
  kind: CorrectionKind;
  checkIn?: string;
  checkOut?: string;
  reason: string;
}

// the times are chosen in three lists (owner, 20 October 2026: "make AM and PM a selector"), so one that can't be read
// is partly chosen (lib/time-parts.ts)
const TIME_ERRORS = {
  checkIn: 'Choose the hour, minutes and AM or PM of the check-in.',
  checkOut: 'Choose the hour, minutes and AM or PM of the check-out.',
} as const;

/** The typed form read: the day, the kind, the times as HH:MM (only those the kind asks for), the reason; or what can't be read. */
function read(t: TypedCorrection): { body: CorrectionBody | null; date: string | null; errors: string[] } {
  const errors: string[] = [];
  const date = parseDate(t.date);
  if (t.date.trim() === '') errors.push('Enter the day to correct.');
  else if (!date) errors.push('Enter the day as DD/MM/YYYY, e.g. 12/10/2026.');
  if (!isCorrectionKind(t.kind)) errors.push('Choose what was wrong.');
  const needs = timesNeeded(t.kind, null);
  const time = (key: 'checkIn' | 'checkOut') => {
    if (needs[key] === 'none') return null;
    const parsed = parseTime(t[key]);
    if (parsed === null) errors.push(TIME_ERRORS[key]);
    return parsed || null;
  };
  const checkIn = time('checkIn');
  const checkOut = time('checkOut');
  const reason = t.reason.trim();
  if (reason.length > CORRECTION_REASON_MAX) errors.push(`Keep the reason to ${CORRECTION_REASON_MAX} characters; it has ${reason.length}.`);
  if (errors.length || !date || !isCorrectionKind(t.kind)) return { body: null, date: date || null, errors };
  const body: CorrectionBody = { date, kind: t.kind, reason };
  if (checkIn) body.checkIn = checkIn;
  if (checkOut) body.checkOut = checkOut;
  return { body, date, errors };
}

/**
 * Why the correction can't be sent yet, in the order to fix them (none: it can): the day, what was wrong, the times,
 * then the shared checks against the day as on record (`day`, of the day typed; null while it can't be told: the API
 * checks it), whether its month can be corrected and a correction of it already open, and a time not yet come (`now`,
 * the moment now; owner, 26 October 2026: "yes"; none while it isn't known: the API checks it). `name`: the employee's
 * when HR corrects it.
 */
export function correctionFormProblems(
  typed: TypedCorrection,
  ctx: { today: string; now?: number | null; day: CorrectableDay | null; known: boolean; correctable: MonthCorrectable | null; open: boolean; name?: string | null },
): string[] {
  const { body, date, errors } = read(typed);
  if (!body || !date) return errors;
  const problems = correctionProblems(body, {
    today: ctx.today,
    now: ctx.now ?? null,
    // what isn't known here (the month's payroll, the day on record) the API checks when it is sent
    runStatus: ctx.correctable && !ctx.correctable.allowed ? 'approved' : null,
    day: ctx.known ? ctx.day : null,
    shift: null,
    open: ctx.open,
    name: ctx.name ?? null,
  }).filter((p) => ctx.known || !/ already| on record|There is no check-in/.test(p));
  if (ctx.correctable && !ctx.correctable.allowed && ctx.correctable.reason) {
    const i = problems.findIndex((p) => p.includes('payroll is'));
    if (i >= 0) problems[i] = ctx.correctable.reason;
  }
  return problems.map(shownMessage);
}

/** The request sent, or what can't be read: the API checks the rest and answers what is wrong. */
export function correctionForm(fd: FormData): { body: CorrectionBody | null; errors: string[] } {
  const { body, errors } = read(typedCorrection(fd));
  return { body, errors };
}

/** The fields as typed, from the form. */
export const typedCorrection = (fd: FormData): TypedCorrection => ({
  date: String(fd.get('date') ?? ''),
  kind: String(fd.get('kind') ?? ''),
  checkIn: String(fd.get('checkIn') ?? ''),
  checkOut: String(fd.get('checkOut') ?? ''),
  reason: String(fd.get('reason') ?? ''),
});

/** The fields as the form shows them again after a refusal. */
export const typedCorrectionValues = (fd: FormData): Record<string, string> =>
  Object.fromEntries(['date', 'kind', 'checkIn', 'checkOut', 'reason', 'employeeId'].map((k) => [k, String(fd.get(k) ?? '')]));

/**
 * What the form says once it can be sent: the day, what was wrong and where it goes (`byHr`: corrected for `name` at
 * once; `toCeo`: a C-level person's goes to the CEO after the manager, not HR).
 */
export function correctionReadyText(typed: TypedCorrection, byHr: boolean, name: string, toCeo = false): string {
  const date = parseDate(typed.date);
  const what = `${isCorrectionKind(typed.kind) ? CORRECTION_KIND_NAMES[typed.kind].toLowerCase() : 'a correction'}${date ? ` on ${weekdayOf(date)} ${formatDate(date)}` : ''}`;
  return byHr
    ? `Ready to correct: ${what} for ${name}, at once. The day keeps what it was, shown as corrected from it.`
    : `Ready to send: ${what}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}
