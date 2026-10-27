import {
  compensatoryCashDays,
  compensatoryForOdCheck,
  hoursText,
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  leaveStatusAfterApproval,
  OD_AFTER_DAYS,
  OD_DAY_LABEL,
  OD_PLACE_MAX,
  OD_REASON_MAX,
  odDates,
  odDaysProblems,
  odEarned,
  odHoursProblems,
  odInputProblems,
  odNeedsCompensation,
  odTimingProblem,
  odWhenProblems,
  type CompensationAsked,
  type CompensatoryOutcome,
  type CompensatoryRules,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type LeaveStepKind,
  type OdDayFacts,
  type Role,
} from '@trendlix/shared';
import { MY_REQUESTS, MY_TEAM } from '../../../../components/nav';
import { formatDate, formatTime, parseDate, parseTime } from '../../../../lib/format';
import type { OdCheck, OdCompensation, OdCompensationView, OdDayView, OdForm, OdRequestStep, OdRequestView } from '../../../../lib/od-types';
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
// request under Attendance → Official Duty. HR records one for someone there (owner, 26 October 2026: "HR records it"),
// approved at once, past the 3-day limit too with a warning; the CEO a C-level person's. A leave import brings them over
// too ("Import (template + Zoho)"). A single rest day or official holiday is asked or recorded with its compensation
// (owner, 27 October 2026: "it should count in the compensatories"; "One step"): see "On a day off" below. The rules
// are @trendlix/shared's (official-duty.ts, compensatory.ts), which the API enforces; these helpers word what it sent,
// read the forms and show the same checks live. Pure code, tested; relative imports, as vitest doesn't know the @/
// paths.

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

/** HR's form to record official duty for someone: "/attendance/official-duty/record?employee=<id>". */
export const RECORD_OD_PATH = `${OD_PATH}/record`;
export const recordOdHref = (employeeId?: string | null) => (employeeId ? `${RECORD_OD_PATH}?employee=${encodeURIComponent(employeeId)}` : RECORD_OD_PATH);

/** Who records official duty for someone (26 October 2026: "HR records it"): HR, and the CEO a C-level person's (the API checks whose). */
export const recordsOd = (user: WithRoles) => hasRole(user, 'hr', 'ceo');

/** What was just done on a request, said on its page by `?done=`. */
export type OdDone = 'sent' | 'recorded' | 'cancelled' | 'moved' | `${LeaveStage}_${LeaveDecision}`;

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

/**
 * Its compensation in words, on a rest day or an official holiday (owner, 27 October 2026: "it should count in the
 * compensatories"): "A day off on Tuesday 27/10/2026", "4 hours off on Tuesday 27/10/2026", "Cash instead of a day
 * off", "Cash instead of 4 hours off".
 */
export function odCompensationText(c: Pick<OdCompensation, 'outcome' | 'dayOff' | 'hoursOff'>): string {
  const off = c.hoursOff ? `${hoursText(c.hoursOff)} off` : 'a day off';
  if (c.outcome === 'cash') return `Cash instead of ${off}`;
  const what = off.charAt(0).toUpperCase() + off.slice(1);
  return c.dayOff ? `${what} on ${dayWords(c.dayOff)}` : what;
}

/** The short note of its compensation where its days show in a list: "+ day off 27/10", "+ 4 hours off 27/10", "+ cash"; null without one. */
export function odCompensationNote(r: Pick<OdRequestView, 'compensation'>): string | null {
  const c = r.compensation;
  if (!c) return null;
  if (c.outcome === 'cash') return '+ cash';
  const off = c.hoursOff ? `${hoursText(c.hoursOff)} off` : 'day off';
  return c.dayOff ? `+ ${off} ${formatDate(c.dayOff).slice(0, 5)}` : `+ ${off}`;
}

/** Its days with its compensation's note, in a line (the phone pages' lists): "Friday 23/10/2026 + day off 27/10". */
export function odWhenLine(r: Pick<OdRequestView, 'startDate' | 'endDate' | 'fullDay' | 'fromTime' | 'toTime' | 'compensation'>): string {
  const note = odCompensationNote(r);
  return note ? `${odWhenWords(r)} ${note}` : odWhenWords(r);
}

/** How it came: asked by the employee, recorded by HR (26 October 2026), or imported by a leave import. */
export function odSourceText(r: Pick<OdRequestView, 'recordedByHr' | 'imported'>): string {
  if (r.imported) return 'Imported';
  return r.recordedByHr ? 'Recorded by HR' : 'Asked by the employee';
}

/**
 * Where a request stands, for its list row and its page, as a leave request's (who has it now, or how it ended);
 * recorded by HR and imported said so.
 */
export function odProgressText(r: Pick<OdRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'confidential' | 'steps' | 'recordedByHr' | 'imported'>): {
  text: string;
  reason: string | null;
} {
  if (r.status === 'approved' && r.imported) return { text: 'Imported', reason: null };
  return leaveProgressText({ ...r, recordedByHr: r.recordedByHr === true, steps: r.steps.filter((s) => s.kind !== 'imported') as unknown as LeaveRequestStep[] });
}

/** Once sent: where it goes, or, recorded by HR, that it is approved at once. */
export function odSentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (status === 'approved') return 'Official duty recorded, approved at once; the employee is told. On its days they check in from where they are, and the days count as attended for its hours.';
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
  if (done === 'sent' || done === 'recorded') return { text: odSentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Official duty cancelled. It stays on the list, cancelled; its days are free again.', tone: 'ok' };
  if (done === 'moved') return { text: OD_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: odDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential), tone: 'ok' };
}

/** A step as its timeline shows it: as a leave request's, HR's recording, an import and a cancelling in their words. */
export function odStepText(s: Pick<OdRequestStep | LeaveRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (s.kind === 'imported') return 'Imported, approved';
  if (s.kind === 'recorded_by_hr') return 'Recorded by HR, approved at once';
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
  /**
   * On a single rest day or official holiday (27 October 2026): the compensation chosen, "day_off", "cash" or "" (none),
   * and the day off typed (DD/MM/YYYY). Left out: none. Sent only while the form asks for one (odSent).
   */
  compensation?: string;
  dayOff?: string;
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
  /** One day on a rest day or an official holiday (27 October 2026): its compensation, and the day off for a day off. */
  compensation?: CompensatoryOutcome;
  dayOff?: string;
}

/** The days and times of a request: what HR's live check reads (GET /official-duty/check). */
export type OdWhen = Pick<OdBody, 'startDate' | 'endDate' | 'fullDay' | 'fromTime' | 'toTime'>;

/** The compensation as the form sends it, and HR's live check reads it: a day off with its date, or cash instead. */
export type OdCompensationBody = Pick<OdBody, 'compensation' | 'dayOff'>;

/** What was typed, read: the API's values, and why it can't be read here. */
function read(t: TypedOd): { body: OdBody | null; errors: string[] } {
  const { when, errors } = readWhen(t);
  if (!when) return { body: null, errors };
  const compensation = readCompensation(t);
  const body: OdBody = { ...when, place: t.place.trim(), reason: t.reason.trim(), ...compensation.asked };
  // the shared checks of what can be read: the order of the days, at most 31, part of a day's times, the place, the
  // reason; then the day off typed
  const shared = [...odInputProblems({ ...body, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null }).map(shownMessage), ...compensation.errors];
  return shared.length ? { body: null, errors: shared } : { body, errors: [] };
}

/** The days and times typed, read: what the API takes of them, and why they can't be read here. */
function readWhen(t: Pick<TypedOd, 'startDate' | 'endDate' | 'span' | 'fromTime' | 'toTime'>): { when: OdWhen | null; errors: string[] } {
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
  if (errors.length || !startDate || !endDate) return { when: null, errors };
  const when: OdWhen = { startDate, endDate, fullDay: !part };
  if (part && fromTime && toTime) {
    when.fromTime = fromTime;
    when.toTime = toTime;
  }
  // the shared checks of the days and times: their order, at most 31, part of a day's times
  const shared = odWhenProblems({ ...when, fromTime: when.fromTime ?? null, toTime: when.toTime ?? null }).map(shownMessage);
  return shared.length ? { when: null, errors: shared } : { when, errors: [] };
}

/**
 * The compensation typed, read: a day off with its date (left out while none is typed: the shared check asks for it),
 * or cash instead (no day off); none when neither is chosen.
 */
function readCompensation(t: Pick<TypedOd, 'compensation' | 'dayOff'>): { asked: OdCompensationBody | null; errors: string[] } {
  if (t.compensation === 'cash') return { asked: { compensation: 'cash' }, errors: [] };
  if (t.compensation !== 'day_off') return { asked: null, errors: [] };
  const typed = (t.dayOff ?? '').trim();
  const dayOff = parseDate(typed);
  if (typed !== '' && !dayOff) return { asked: null, errors: ['Enter the day off as DD/MM/YYYY, e.g. 10/11/2026.'] };
  return { asked: dayOff ? { compensation: 'day_off', dayOff } : { compensation: 'day_off' }, errors: [] };
}

/** The compensation chosen as the shared checks take it; null for none. */
const askedOf = (b: OdCompensationBody): CompensationAsked | null =>
  b.compensation ? { outcome: b.compensation, dayOff: b.compensation === 'cash' ? null : (b.dayOff ?? null) } : null;

// ---------- on a day off (owner, 27 October 2026) ----------
// A screenshot showed HR's form refusing official duty on a rest day of the employee's shift: "why cant i record this
// for an employee? it should count in the compensatories". He chose "One step": "The duty form allows a rest
// day/holiday and, right there, asks for the compensation: a day off in the same month, or cash instead (1.5 days).
// Saving records the duty and the compensatory day together, approved the same way. The rest day itself adds no hours
// or overtime." Then by the hour: part of a rest day earns hours off on a working day by the Compensatory Setup (fewer
// than its minimum nothing, up to its cap, from its hours for a whole day a day), or cash for those hours at its rate.
// HR's form reads what the day earns from the API's check; the employee's works it out from what its form read first
// (their working days, the holidays, the Setup) and the API checks the rest.

/** The form as it is sent: its compensation only while one is asked for (`needed`), else none. */
export const odSent = (typed: TypedOd, needed: boolean): TypedOd => (needed ? typed : { ...typed, compensation: '', dayOff: '' });

/** The compensation chosen so far, for HR's live check (odCheckPath): a day off without its date while it can't be read; null for none. */
export const odAskedOf = (typed: Pick<TypedOd, 'compensation' | 'dayOff'>): OdCompensationBody | null =>
  readCompensation(typed).asked ?? (typed.compensation === 'day_off' ? { compensation: 'day_off' } : null);

/** A day a compensatory day compensates already, as the API's refusal of the employee's request named it. */
export interface OdCompensated {
  date: string;
  /** Its status's words: "approved", "with HR". */
  status: string;
}

const COMPENSATED_ALREADY = /^(\d{2})\/(\d{2})\/(\d{4}) is .*, compensated already by a compensatory day \(([^()]+)\)/;

/**
 * The day the API said is compensated already (by a compensatory day asked apart, before the duty), from the refusal
 * shown on the employee's form: their form can't know it beforehand, so once refused it stops asking for a compensation
 * for that day; null for none.
 */
export function odCompensatedAlready(errors: readonly string[] | undefined): OdCompensated | null {
  for (const e of errors ?? []) {
    const m = COMPENSATED_ALREADY.exec(e);
    if (m) return { date: `${m[3]}-${m[2]}-${m[1]}`, status: m[4] };
  }
  return null;
}

/** What the employee's form read first that tells a rest day and a holiday apart (an API from before it: nothing). */
type OdFormDays = Pick<OdForm, 'workingDays' | 'holidays' | 'compensated'>;

/**
 * The days asked, as far as the employee's form knows them: a working day of their shift or not, the official holiday on
 * it, and the day compensated already (the form's `compensated`; else `done`, as the API's refusal named it); their
 * leave, work from home days and other official duties aren't known here (the API checks them). Null without the working
 * days (an API from before 27 October 2026).
 */
export function odFormDays(when: Pick<OdWhen, 'startDate' | 'endDate'>, form: OdFormDays, done: OdCompensated | null = null): OdDayFacts[] | null {
  if (!form.workingDays) return null;
  const working = new Set(form.workingDays);
  const holidays = new Map((form.holidays ?? []).map((h) => [h.date, h.nameEn]));
  const compensated = new Map((form.compensated ?? []).map((c) => [c.date, c.status]));
  if (done) compensated.set(done.date, compensated.get(done.date) ?? done.status);
  return odDates(when.startDate, when.endDate).map((date) => ({
    date,
    workingDay: working.has(new Date(`${date}T00:00:00Z`).getUTCDay()),
    holiday: holidays.get(date) ?? null,
    leave: null,
    wfh: null,
    od: [],
    compensatory: null,
    compensated: compensated.has(date) ? { status: compensated.get(date)! } : null,
  }));
}

/** What the employee's form works out of a single day off: what HR's check says (OdCompensationView), and what the day is. */
export type OdFormCompensation = OdCompensationView & {
  /** "Friday 23/10/2026 is a rest day of your shift", "… is an official holiday (Revolution Day)". */
  what: string;
};

/**
 * What the single day typed earns on the employee's form, as HR's check says it (odEarned, odNeedsCompensation and
 * compensatoryCashDays by the Compensatory Setup the form read); null for a working day, several days, days that can't
 * be read yet, or an API from before it.
 */
export function odFormCompensation(
  typed: Pick<TypedOd, 'startDate' | 'endDate' | 'span' | 'fromTime' | 'toTime'>,
  form: (OdFormDays & Pick<OdForm, 'rules' | 'hoursADay'>) | null,
  done: OdCompensated | null = null,
): OdFormCompensation | null {
  if (!form?.rules) return null;
  const { when } = readWhen(typed);
  if (!when || when.startDate !== when.endDate) return null;
  const days = odFormDays(when, form, done);
  if (!days?.length) return null;
  const input = { ...when, fromTime: when.fromTime ?? null, toTime: when.toTime ?? null };
  const earned = odEarned(input, days, form.rules);
  if (!earned) return null;
  const d = days[0];
  return {
    onDayOff: true,
    needed: odNeedsCompensation(input, days, form.rules),
    earned,
    cashDays: compensatoryCashDays(earned, form.rules, form.hoursADay ?? null),
    already: d.compensated?.status ?? null,
    what: `${dayWords(d.date)} is ${d.holiday ? `an official holiday (${d.holiday})` : 'a rest day of your shift'}`,
  };
}

/** "1.5 days' pay", "1 day's pay". */
const daysPay = (n: number) => `${n} ${n === 1 ? "day's" : "days'"} pay`;

/**
 * Cash instead, in words: a whole day's "1.5 days' pay" (owner: "cash instead (1.5 days)"); hours' "4 hours' pay at
 * 1.5×", the hours' share of a day at the rate; without the rate known, the days' pay ("0.75 days' pay").
 */
export function odCashText(comp: Pick<OdCompensationView, 'earned' | 'cashDays'>, rate: number | null = null): string {
  const e = comp.earned;
  if (e?.kind === 'hours' && rate !== null) return `${hoursText(e.hours)}${e.hours === 1 ? "'s" : "'"} pay at ${rate}×`;
  if (e?.kind === 'day' && rate !== null) return daysPay(rate);
  return daysPay(comp.cashDays);
}

/**
 * What the compensation part of a form says first: what the day earns ("…: official duty on it earns a whole day off,
 * or 1.5 days' pay instead"), that it is compensated already, or that part of it below the Setup's minimum earns nothing.
 * `what`: the day (the employee's form knows it; HR's check doesn't say). `rules`: the Setup, when known.
 */
export function odCompensationLead(
  comp: Pick<OdCompensationView, 'earned' | 'cashDays' | 'already'>,
  what: string | null,
  rules: Pick<CompensatoryRules, 'minHours' | 'cashRate'> | null,
): string {
  const day = what ?? 'A rest day or an official holiday';
  if (comp.already) return `${day}, compensated already by a compensatory day (${comp.already}): there is nothing more to choose.`;
  const e = comp.earned;
  if (!e) return '';
  if (e.kind === 'none') {
    const least = rules ? `the ${hoursText(rules.minHours)} that earn a compensation (Compensatory Setup)` : 'the hours that earn a compensation (Compensatory Setup)';
    return `${day}: ${hoursText(e.hours)} of official duty on it earns nothing, fewer than ${least}, so there is no compensation to choose.`;
  }
  const earns = e.kind === 'day' ? 'a whole day off' : `${hoursText(e.hours)} off`;
  return `${day}: official duty on it earns ${earns}, or ${odCashText(comp, rules?.cashRate ?? null)} instead. The day itself adds no hours or overtime.`;
}

/**
 * The day off's hint: a working day in the window the Setup allows (the same month, or within so many days after), from
 * tomorrow for the employee (a day's notice), a day gone by recorded with a warning by HR (`hr`); the hours off taken
 * that day with no deduction.
 */
export function odDayOffHint(comp: Pick<OdCompensationView, 'earned'>, rules: Pick<CompensatoryRules, 'offWithinDays'> | null, hr: boolean): string {
  const window =
    rules === null ? 'in the window the Compensatory Setup allows' : rules.offWithinDays === null ? 'in the same month' : `within ${rules.offWithinDays} ${rules.offWithinDays === 1 ? 'day' : 'days'} after it`;
  const when = hr ? `A working day of their shift ${window}; a day gone by is recorded with a warning.` : `A working day of your shift ${window}, from tomorrow on.`;
  return comp.earned?.kind === 'hours' ? `${when} The ${hoursText(comp.earned.hours)} off are taken that day, with no deduction.` : when;
}

/** Cash instead's hint: what is added to the payroll, and no day off. */
export const odCashHint = (comp: Pick<OdCompensationView, 'earned' | 'cashDays'>, rate: number | null = null): string =>
  `Cash instead: ${odCashText(comp, rate)} added to the month's payroll once approved, and no day off.`;

/**
 * The compensation chosen, for the ready texts: ", with a day off on Tuesday 27/10/2026", ", with 4 hours off on …",
 * ", paid 1.5 days' pay instead", ", paid 4 hours' pay at 1.5× instead"; empty while none is asked for.
 */
export function odCompensationWords(
  typed: Pick<TypedOd, 'compensation' | 'dayOff'>,
  comp: Pick<OdCompensationView, 'needed' | 'earned' | 'cashDays'> | null,
  rate: number | null = null,
): string {
  if (!comp?.needed || !comp.earned || comp.earned.kind === 'none') return '';
  const asked = readCompensation(typed).asked;
  if (!asked?.compensation) return '';
  if (asked.compensation === 'cash') return `, paid ${odCashText(comp, rate)} instead`;
  const off = comp.earned.kind === 'hours' ? `${hoursText(comp.earned.hours)} off` : 'a day off';
  return asked.dayOff ? `, with ${off} on ${dayWords(asked.dayOff)}` : `, with ${off}`;
}

// ---------- the employee's form ----------

/** What the employee's form read first, as its checks use it (the day off's facts: an API from before 27 October 2026 left them out). */
type OdFormRead = Pick<OdForm, 'today' | 'shift' | 'refusal' | 'workingDays' | 'holidays' | 'rules' | 'hoursADay'>;

/**
 * Why the request can't be sent yet, in the order to fix them (none: it can): what can't be read, then the shared checks
 * against what the form read first (`form`; null while it couldn't be read: the API checks them): the timing (up to 3
 * days after), part of a day inside their shift, and the days as far as the form knows them (27 October 2026): a single
 * rest day or official holiday that earns a compensation without one, its day off not a working day, outside the
 * Setup's window or without a day's notice, several days with none a working day. Leave, a work from home day or
 * another official duty on the same days, and a day compensated already (`done`: once the API said so), aren't known
 * here: the API refuses those when it is sent.
 */
export function odFormProblems(typed: TypedOd, form: OdFormRead | null, done: OdCompensated | null = null): string[] {
  const comp = odFormCompensation(typed, form, done);
  const { body, errors } = read(odSent(typed, comp?.needed === true));
  if (errors.length || !body) return errors;
  if (!form) return [];
  if (form.refusal) return [form.refusal];
  const input = { ...body, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null };
  const timing = odTimingProblem(body.startDate, form.today);
  const problems = [...(timing ? [timing] : []), ...odHoursProblems(input, form.shift)];
  const days = form.rules ? odFormDays(body, form, done) : null;
  if (days && form.rules) {
    const asked = askedOf(body);
    problems.push(...odDaysProblems(input, days, null, asked, form.rules));
    if (asked && comp?.needed) {
      // the day off as far as the form knows it: a working day of their shift, not an official holiday
      const off = asked.dayOff ? odFormDays({ startDate: asked.dayOff, endDate: asked.dayOff }, form)?.[0] : null;
      const offDay = off ? { workingDay: off.workingDay, holiday: off.holiday, leave: null, other: null } : null;
      problems.push(...compensatoryForOdCheck(body.startDate, asked, { claimed: false }, offDay, form.today, null, form.rules).problems);
    }
  }
  return problems.map(shownMessage);
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

/**
 * What the form says once it can be sent: the days, the compensation chosen on a day off (`comp`; `rate`: the Setup's
 * cash rate) and where it goes (`toCeo`: a C-level person's goes to the CEO, not HR).
 */
export function odReadyText(typed: TypedOd, toCeo = false, comp: Pick<OdCompensationView, 'needed' | 'earned' | 'cashDays'> | null = null, rate: number | null = null): string {
  const { body } = read(odSent(typed, comp?.needed === true));
  const when = body ? ` for ${odWhenWords({ startDate: body.startDate, endDate: body.endDate, fullDay: body.fullDay, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null })}` : '';
  return `Ready to send: official duty${when}${odCompensationWords(typed, comp, rate)}, to your direct manager (without one, your lead), then ${hrStageName(toCeo)}.`;
}

/** The request sent, or what can't be read: the API checks the rest and answers what is wrong. Its compensation goes only while the form shows it. */
export function odForm(fd: FormData): { body: OdBody | null; errors: string[] } {
  return read(typedOd(fd));
}

// ---------- HR records it (owner, 26 October 2026: "HR records it") ----------

/** HR's record (POST /official-duty): the employee (the form's hidden field), then the request's own fields. */
export function odRecordForm(fd: FormData): { body: (OdBody & { employeeId: string }) | null; errors: string[] } {
  const employeeId = String(fd.get('employeeId') ?? '');
  const { body, errors } = read(typedOd(fd));
  if (!UUID.test(employeeId)) return { body: null, errors: ['Choose the employee first.', ...errors] };
  return body ? { body: { ...body, employeeId }, errors: [] } : { body: null, errors };
}

/** The days and times HR's live check reads, once they can be read; null before. */
export function odWhenOf(typed: Pick<TypedOd, 'startDate' | 'endDate' | 'span' | 'fromTime' | 'toTime'>): OdWhen | null {
  return readWhen(typed).when;
}

/**
 * GET /official-duty/check for someone, the days and times, and on a day off the compensation chosen (`asked`: sent
 * while the form asks for one, so the check runs again as it changes): "/official-duty/check?employeeId=…&startDate=…
 * &endDate=…&fullDay=true&compensation=day_off&dayOff=…".
 */
export function odCheckPath(employeeId: string, when: OdWhen, asked: OdCompensationBody | null = null): string {
  const params = new URLSearchParams({ employeeId, startDate: when.startDate, endDate: when.endDate, fullDay: String(when.fullDay) });
  if (!when.fullDay && when.fromTime && when.toTime) {
    params.set('fromTime', when.fromTime);
    params.set('toTime', when.toTime);
  }
  if (asked?.compensation === 'day_off' || asked?.compensation === 'cash') {
    params.set('compensation', asked.compensation);
    if (asked.compensation === 'day_off' && asked.dayOff) params.set('dayOff', asked.dayOff);
  }
  return `/official-duty/check?${params.toString()}`;
}

/**
 * Why HR can't record it yet, in the order to fix them (none: it can): what can't be read here, then what the API's check
 * of the days said (`check`; null while it is read or couldn't be: the API checks them all again when it is recorded).
 */
export function odRecordProblems(typed: TypedOd, check: Pick<OdCheck, 'problems'> | null): string[] {
  const { errors } = read(typed);
  if (errors.length) return errors;
  return check ? check.problems.map(shownMessage) : [];
}

/** What HR's form says once it can be recorded: the days, the compensation chosen on a day off, approved at once for the person, who is told. */
export function odRecordReadyText(typed: TypedOd, name: string, comp: Pick<OdCompensationView, 'needed' | 'earned' | 'cashDays'> | null = null, rate: number | null = null): string {
  const { body } = read(odSent(typed, comp?.needed === true));
  const when = body ? ` for ${odWhenWords({ startDate: body.startDate, endDate: body.endDate, fullDay: body.fullDay, fromTime: body.fromTime ?? null, toTime: body.toTime ?? null })}` : '';
  return `Ready to record: official duty${when}${odCompensationWords(typed, comp, rate)}, approved at once for ${name} and logged as recorded by HR. ${name} is told.`;
}

const FIELDS = ['startDate', 'endDate', 'span', 'fromTime', 'toTime', 'place', 'reason', 'compensation', 'dayOff'] as const;

/** The fields as typed, from the form (the compensation's only while the form shows them). */
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
