import {
  LEAVE_DECISIONS,
  LEAVE_STAGES,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUSES,
  leaveDecisionNeedsComment,
  leaveStatusAfterApproval,
  seesConfidential,
  type LeaveDecision,
  type LeaveStage,
  type LeaveStatus,
  type Role,
} from '@trendlix/shared';
import { LEAVE_PATH, MY_TEAM } from '../../../components/nav';
import { requestStatusLabel } from '../../../lib/confidential';
import { approverLabel, approverPhrase, approverSubject, withApproverText, yourApprover } from '../../../lib/department-leads';
import { formatDate, titleCase } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';
import type { LeaveRequestStep, LeaveRequestView, RequestApprover } from '../../../lib/types';
import { weekdayOf } from '../organization/holidays/holidays';
import { myRequestsHref } from '../my-requests/requests';

// Leave requests (owner, 18 October 2026: "if we will work on the attendance and leaves, how will we build it?", leaves
// first, then "can you apply the leaves according to the law?"): an employee asks for leave of a type HR set up on
// Organization → Leave, from My Requests; it goes to their direct manager, then HR (no manager: straight to HR), each
// approving it or rejecting it with a comment, every step logged on the request. HR records leave on someone's behalf
// (e.g. sick leave reported afterwards), approved at once. HR decides and the CEO views them on Requests → Leave
// Requests, with the month's calendar of who is off; a direct manager decides their team's from My Team. The rules are
// @trendlix/shared's (leaves.ts), which the API enforces; these helpers only word what it sent, and read the decision
// form. Someone without a direct manager has their request decided first by their team lead, else their department's
// head (owner, 19 October 2026: "i want to add department lead person, the person in charge"): the manager stage says
// which, by the request's `manager.role`. A C-level person's request (owner, 19 October 2026: "make C level Employees
// details not visible to HR"; `confidential`, from the API) has HR's stage decided by the CEO, or HR with Super Admin:
// HR without it doesn't get the request at all; what is still to come names the CEO ("With the CEO", "Approve and send
// to the CEO"), and what was done names the stage ("Approved at HR's stage"), as HR may have decided it before then and
// the log says who. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };

/** Who sees everyone's leave, on Requests → Leave Requests (the sidebar shows them the link): HR decides, the CEO views. */
export const LEAVE_ROLES: readonly Role[] = ['hr', 'ceo'];

export const canSeeLeaveRequests = (user: WithRoles) => hasRole(user, ...LEAVE_ROLES);

/** HR records leave on an employee's behalf (POST /leave/requests), cancels an approved one and adjusts a balance. */
export const recordsLeave = (user: WithRoles) => hasRole(user, 'hr');

// ---------- the addresses ----------

/** The new leave form, for anyone with an employee profile, for themself (from My Requests, or from the list for HR and the CEO). */
export const NEW_LEAVE_PATH = `${LEAVE_PATH}/new`;

/** HR's form to record leave on an employee's behalf. */
export const RECORD_LEAVE_PATH = `${LEAVE_PATH}/record`;

/** HR's form with an employee chosen already (from their profile): "/leave/record?employee=<id>". */
export const recordLeaveHref = (employeeId?: string | null) => (employeeId ? `${RECORD_LEAVE_PATH}?employee=${encodeURIComponent(employeeId)}` : RECORD_LEAVE_PATH);

/** A request's page, where it is decided and cancelled: "/leave/<id>". */
export const leaveHref = (id: string) => `${LEAVE_PATH}/${encodeURIComponent(id)}`;

/** A document of a request, from the API under the web domain (./[id]/documents/[docId]/route.ts). */
export const leaveDocumentHref = (requestId: string, docId: string) => `${leaveHref(requestId)}/documents/${encodeURIComponent(docId)}`;

/**
 * What was just done on a request, said on its page by `?done=`: sent, recorded by HR, cancelled, a stage's decision
 * ("hr_approve"), or a decision refused because the request had moved on meanwhile (`moved`).
 */
export type LeaveDone = 'sent' | 'recorded' | 'cancelled' | 'moved' | `${LeaveStage}_${LeaveDecision}`;

/** A request's page after something was done on it: "/leave/<id>?done=sent". */
export const leaveDoneHref = (id: string, done: LeaveDone) => `${leaveHref(id)}?done=${done}`;

/** Where the employee's own leave is listed: the Leave section of My Requests. */
export const MY_LEAVE_HREF = `${myRequestsHref({ kind: '', status: '' })}#my-leave`;

/**
 * Where a request's page goes back to: Leave Requests for those who see it; My Requests for the employee's own; My Team
 * for the direct manager deciding a report's.
 */
export function leaveBack(user: WithRoles & { employeeId?: string | null }, r: Pick<LeaveRequestView, 'employee'>): { href: string; label: string } {
  if (canSeeLeaveRequests(user)) return { href: LEAVE_PATH, label: 'Leave Requests' };
  if (user.employeeId && r.employee.id === user.employeeId) return { href: MY_LEAVE_HREF, label: 'My Requests' };
  return { href: MY_TEAM, label: 'My Team' };
}

/** Where the new leave form's back link and Cancel go: Leave Requests for those who see it, else My Requests. */
export const newLeaveBack = (user: WithRoles): { href: string; label: string } =>
  canSeeLeaveRequests(user) ? { href: LEAVE_PATH, label: 'Leave Requests' } : { href: MY_LEAVE_HREF, label: 'My Requests' };

// ---------- the list's filters and views ----------

/** Waiting for you (the requests the caller decides now), All, or one status. */
export type LeaveFilter = 'waiting' | 'all' | LeaveStatus;

/** Waiting for you, All, then each status in the order a request goes through them. */
export const LEAVE_FILTERS: readonly { value: LeaveFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting for you' },
  { value: 'all', label: 'All' },
  ...LEAVE_STATUSES.map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] })),
];

/** What the list shows when the address names no status: what waits for HR, who decides; every request for the CEO. */
export const defaultLeaveFilter = (user: WithRoles): LeaveFilter => (hasRole(user, 'hr') ? 'waiting' : 'all');

type Query = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** The status in the page's address; none, or anything it doesn't know, is the user's default. */
export function readLeaveFilter(query: Query, user: WithRoles): LeaveFilter {
  const v = one(query.status);
  return LEAVE_FILTERS.some((f) => f.value === v) ? (v as LeaveFilter) : defaultLeaveFilter(user);
}

/** The list of requests, or the month's calendar of who is off (?view=calendar). */
export type LeaveView = 'list' | 'calendar';

export const readLeaveView = (query: Query): LeaveView => (one(query.view) === 'calendar' ? 'calendar' : 'list');

/** The list's address for a filter: "/leave?status=waiting"; each names its status, so a link keeps it. */
export const leaveListHref = (filter: LeaveFilter) => `${LEAVE_PATH}?status=${filter}`;

/** The calendar's address for a month ("YYYY-MM") and a department (none: everyone). */
export function leaveCalendarHref(month: string, departmentId?: string | null, base: string = LEAVE_PATH): string {
  const params = new URLSearchParams();
  if (base === LEAVE_PATH) params.set('view', 'calendar');
  params.set('month', month);
  if (departmentId) params.set('department', departmentId);
  return `${base}?${params.toString()}`;
}

/** The API's list for a filter: GET /leave/requests?status=waiting|<status>, without one for All; `employeeId` for one person's. */
export function leaveRequestsPath(filter: LeaveFilter, employeeId?: string | null): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (employeeId) params.set('employeeId', employeeId);
  const qs = params.toString();
  return qs ? `/leave/requests?${qs}` : '/leave/requests';
}

/** The requests waiting for the caller: My Team's and the dashboard's Leave to Approve. */
export const WAITING_LEAVE = leaveRequestsPath('waiting');

/** How many requests wait for the caller, beside Leave Requests (or My Team) in the sidebar. */
export const LEAVE_COUNTS = '/leave/requests/counts';

const EMPTY: Record<LeaveFilter, string> = {
  waiting: 'No leave requests are waiting for you.',
  all: 'No leave requests yet. Employees ask for leave from My Requests; HR records leave on their behalf with Record leave.',
  with_manager: 'No leave requests are with a direct manager.',
  with_hr: 'No leave requests are with HR.',
  approved: 'No leave approved.',
  rejected: 'No leave requests rejected.',
  cancelled: 'No leave cancelled.',
};

/** What the list says when no request has the filter chosen. */
export const emptyLeaveText = (filter: LeaveFilter) => EMPTY[filter];

/** "1 request", "12 requests". */
export const requestsLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

/** How many different employees asked, for the group headings ("3 employees · 5 requests"). */
export const askerCount = (list: readonly Pick<LeaveRequestView, 'employee'>[]) => new Set(list.map((r) => r.employee.id)).size;

/**
 * Where the employee works, as the lists group them (lib/place-groups.ts): "Department › Team", the department alone, or
 * null. The API may send the team with the department or apart from it.
 */
export function placeOfEmployee(e: { department: string | null; team?: string | null }): string | null {
  const department = e.department?.trim() || null;
  const team = e.team?.trim() || null;
  if (department && team && !department.includes(' › ')) return `${department} › ${team}`;
  return department ?? team;
}

// ---------- a request, in words ----------

/** The status pill's colours, as the other requests show theirs: waiting, approved, rejected, cancelled. */
export const STATUS_BADGE: Record<LeaveStatus, string> = {
  with_manager: 'bg-warn-soft text-warn',
  with_hr: 'bg-warn-soft text-warn',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
  cancelled: 'bg-line-soft text-muted',
};

/** "With HR", …; "With the CEO" for a C-level person's request with HR (19 October 2026: the CEO decides HR's stage). */
export const leaveStatusLabel = (status: LeaveStatus, confidential?: boolean | null) => requestStatusLabel(status, LEAVE_STATUS_LABELS[status] ?? status, confidential);

/** Who decides HR's stage, inside a sentence: HR, or the CEO for a C-level person's request (19 October 2026). */
export const hrStageName = (confidential?: boolean | null) => (confidential === true ? 'the CEO' : 'HR');

/** A C-level person's HR stage once decided, which the CEO (or HR with Super Admin) decides: "at HR's stage". */
const AT_HR_STAGE = 'at HR’s stage';

const daysFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** "1 day", "2.5 days", "Half a day", "0 days": days as the screens say them (half days allowed). */
export function daysText(days: number): string {
  if (days === 0.5) return 'Half a day';
  return `${daysFormat.format(days)} ${days === 1 ? 'day' : 'days'}`;
}

/** A number of days alone, as a balance shows it: "21", "10.5". */
export const daysNumber = (days: number) => daysFormat.format(days);

/**
 * When the leave is, as its row says it: one day with its weekday ("Sunday 05/10/2026", "… · half a day"), or from the
 * first to the last day ("05/10/2026 – 08/10/2026").
 */
export function periodText(r: Pick<LeaveRequestView, 'startDate' | 'endDate' | 'halfDay'>): string {
  if (r.startDate === r.endDate) return `${weekdayOf(r.startDate)} ${formatDate(r.startDate)}${r.halfDay ? ' · half a day' : ''}`;
  return `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`;
}

/**
 * Each stage inside a sentence, and starting one: the manager stage by who decides it (`manager`: the direct manager,
 * the team lead or the head of department), HR.
 */
const stagePhrase = (stage: LeaveStage, manager?: Pick<RequestApprover, 'role'> | null) => (stage === 'manager' ? approverPhrase(manager) : 'HR');
const stageSubject = (stage: LeaveStage, manager?: Pick<RequestApprover, 'role'> | null) => (stage === 'manager' ? approverSubject(manager) : 'HR');

/** Who the stage is, in the decision section's heading: "the Direct Manager", "the Team Lead", "the Head of Department", "HR". */
export const stageTitle = (stage: LeaveStage, manager?: Pick<RequestApprover, 'role'> | null) =>
  stage === 'manager' ? `the ${titleCase(approverLabel(manager))}` : 'HR';

/**
 * Who the user decides the stage as, in the decision section's heading ("Your Decision as …"): stageTitle; the HR stage
 * of a C-level person's request (`confidential`), the CEO's (19 October 2026), "the CEO, at HR's Stage", unless the user
 * is HR with Super Admin, who decides it as HR.
 */
export function decidingAsTitle(user: WithRoles, stage: LeaveStage, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (stage !== 'hr' || confidential !== true || (hasRole(user, 'hr') && seesConfidential(user))) return stageTitle(stage, manager);
  return 'the CEO, at HR’s Stage';
}

/**
 * Where a request stands, for its list row and its page: who has it now, or how it ended (recorded by HR, cancelled), and
 * the comment given with a rejection.
 */
export function leaveProgressText(
  r: Pick<LeaveRequestView, 'status' | 'manager' | 'rejectedStage' | 'rejectReason' | 'recordedByHr' | 'confidential'> & { steps?: LeaveRequestView['steps'] },
): {
  text: string;
  reason: string | null;
} {
  switch (r.status) {
    case 'with_manager':
      // "With the team lead (Sara Ali)": who decides it now
      return { text: withApproverText(r.manager), reason: null };
    case 'with_hr':
      // a C-level person's: the CEO decides HR's stage (19 October 2026)
      return { text: `Waiting for ${hrStageName(r.confidential)}`, reason: null };
    case 'rejected': {
      const reason = r.rejectReason?.trim() || null;
      if (r.rejectedStage === 'hr' && r.confidential === true) return { text: `Rejected ${AT_HR_STAGE}`, reason };
      return { text: r.rejectedStage ? `Rejected by ${stagePhrase(r.rejectedStage, r.manager)}` : 'Rejected', reason };
    }
    case 'cancelled': {
      // by the employee, or by HR once approved, with the comment HR gives
      const step = [...(r.steps ?? [])].reverse().find((s) => s.kind === 'cancelled');
      return { text: step?.actor ? `Cancelled by ${step.actor}` : 'Cancelled', reason: step?.comment?.trim() || null };
    }
    case 'approved':
    default:
      return { text: r.recordedByHr ? 'Recorded by HR' : 'Approved', reason: null };
  }
}

/**
 * What the page says once a request is sent: where it goes, by where it starts (with the manager, or straight to HR);
 * `manager`, who decides it first: the direct manager, or the team lead or head of department of someone without one;
 * a C-level person's (`confidential`) goes to the CEO instead of HR (19 October 2026).
 */
export function leaveSentText(status: LeaveStatus, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  if (status === 'approved') return 'Leave recorded, approved at once. It counts in the balance and in the month’s payroll.';
  const hr = hrStageName(confidential);
  return status === 'with_manager'
    ? `Request sent. It goes to ${yourApprover(manager)}, then ${hr}; each step shows on the request.`
    : `Request sent. It goes to ${hr}; each step shows on the request.`;
}

/** Said when a decision is refused as the request moved on since the page was opened (the API's 409). */
export const LEAVE_MOVED_ON = 'This request has moved on since you opened it: someone else decided it, or it was cancelled. It shows where it stands now.';

/** What the page says once a decision went through; a C-level person's request goes on to the CEO, not HR (`confidential`). */
export function leaveDecidedText(decision: LeaveDecision, stage: LeaveStage, confidential?: boolean | null): string {
  if (decision === 'reject') return 'Request rejected. The employee sees your comment.';
  return leaveStatusAfterApproval(stage) === 'with_hr'
    ? `Approved: the request goes to ${hrStageName(confidential)}.`
    : 'Approved: the leave counts in the balance and in the month’s payroll.';
}

/**
 * What the request's page says after `?done=`, and in which tone (a decision refused as the request had moved on: a
 * warning); null for anything else. `status`: the request's now, for where a sent one goes, and `manager` to whom;
 * `confidential`: a C-level person's, which goes to the CEO instead of HR.
 */
export function leaveDoneText(
  query: Query,
  status: LeaveStatus,
  manager?: Pick<RequestApprover, 'role'> | null,
  confidential?: boolean | null,
): { text: string; tone: 'ok' | 'warn' } | null {
  const done = one(query.done);
  if (done === 'sent' || done === 'recorded') return { text: leaveSentText(status, manager, confidential), tone: 'ok' };
  if (done === 'cancelled') return { text: 'Leave cancelled. Its days are back in the balance; it stays on the list, cancelled.', tone: 'ok' };
  if (done === 'moved') return { text: LEAVE_MOVED_ON, tone: 'warn' };
  const [stage, decision] = done.split('_');
  if (!(LEAVE_STAGES as readonly string[]).includes(stage) || !(LEAVE_DECISIONS as readonly string[]).includes(decision)) return null;
  return { text: leaveDecidedText(decision as LeaveDecision, stage as LeaveStage, confidential), tone: 'ok' };
}

// ---------- the log ----------

/**
 * A step of a request as its timeline shows it: what happened ("HR approved it", "The team lead approved it": the
 * manager stage by who decides it, the request's `manager`). A C-level person's (`confidential`) HR stage by the stage
 * ("Approved at HR's stage"): the CEO decides it since 19 October 2026, and the step says who.
 */
export function leaveStepText(s: Pick<LeaveRequestStep, 'kind' | 'decision' | 'comment'>, manager?: Pick<RequestApprover, 'role'> | null, confidential?: boolean | null): string {
  switch (s.kind) {
    case 'submitted':
      return 'Asked for by the employee';
    case 'no_manager':
      // nobody in charge: no direct manager, and no team lead or head of department other than the employee
      return confidential === true ? 'No direct manager or lead: sent straight to HR’s stage' : 'No direct manager or lead: sent straight to HR';
    case 'recorded_by_hr':
      return 'Recorded by HR, approved at once';
    case 'manager_decision':
    case 'hr_decision': {
      if (s.kind === 'hr_decision' && confidential === true) return s.decision === 'reject' ? `Rejected ${AT_HR_STAGE}` : `Approved ${AT_HR_STAGE}`;
      const who = stageSubject(s.kind === 'manager_decision' ? 'manager' : 'hr', manager);
      return s.decision === 'reject' ? `${who} rejected it` : `${who} approved it`;
    }
    case 'cancelled':
      return 'Cancelled, the days given back';
    default:
      return String(s.kind);
  }
}

/** Whether a step is a decision, and which way, for its mark on the timeline. */
export function leaveStepTone(s: Pick<LeaveRequestStep, 'kind' | 'decision'>): 'ok' | 'danger' | null {
  if (s.decision === 'reject') return 'danger';
  if (s.decision === 'approve' || s.kind === 'recorded_by_hr') return 'ok';
  return null;
}

// ---------- deciding a request ----------

/** What the decision form sends the API (POST /leave/requests/:id/decide). */
export interface LeaveDecisionBody {
  decision: LeaveDecision;
  comment?: string;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** The decision form as the API takes it, and what is wrong with it: a decision, and a comment to reject (optional to approve). */
export function leaveDecisionBody(fd: FormData): { body: LeaveDecisionBody | null; errors: string[] } {
  const decision = text(fd, 'decision');
  if (!(LEAVE_DECISIONS as readonly string[]).includes(decision)) return { body: null, errors: ['Choose your decision: approve or reject.'] };
  const body: LeaveDecisionBody = { decision: decision as LeaveDecision };
  const comment = text(fd, 'comment');
  if (comment) body.comment = comment;
  else if (leaveDecisionNeedsComment(body.decision)) return { body: null, errors: ['Write your comment: why the request is rejected.'] };
  return { body, errors: [] };
}

/**
 * The decision form's button, by the decision and the stage: where an approved request goes next (a C-level person's,
 * `confidential`: to the CEO, not HR).
 */
export function leaveDecisionButton(decision: LeaveDecision | '', stage: LeaveStage, confidential?: boolean | null): { label: string; busy: string } {
  if (decision === 'reject') return { label: 'Reject the request', busy: 'Rejecting…' };
  if (decision === '') return { label: 'Save the decision', busy: 'Saving…' };
  return { label: leaveStatusAfterApproval(stage) === 'with_hr' ? `Approve and send to ${hrStageName(confidential)}` : 'Approve the leave', busy: 'Approving…' };
}

/** Who reads the decision's comment, for the hint under its box. */
export const LEAVE_COMMENT_READERS = 'The employee sees your comment, and so do the direct manager, HR and the CEO.';

/**
 * Who reads the decision's comment: LEAVE_COMMENT_READERS; a C-level person's request (`confidential`) HR doesn't see,
 * only the CEO and the Super Admin (19 October 2026).
 */
export const leaveCommentReaders = (confidential?: boolean | null) =>
  confidential === true ? 'The employee sees your comment, and so do the direct manager, the CEO and the Super Admin.' : LEAVE_COMMENT_READERS;

/**
 * HR cancelling an approved request: the comment is required (POST /leave/requests/:id/cancel); `what` it is, leave or
 * permission (POST /leave/permissions/:id/cancel, 19 October 2026).
 */
export function hrCancelBody(fd: FormData, what: 'leave' | 'permission' = 'leave'): { body: { comment: string } | null; errors: string[] } {
  const comment = text(fd, 'comment');
  return comment ? { body: { comment }, errors: [] } : { body: null, errors: [`Write why the ${what} is cancelled: the employee sees it.`] };
}

// ---------- the dashboard ----------

/** How many of the employee's leaves the dashboard lists. */
export const UPCOMING_LEAVE = 5;

/**
 * The employee's leave still to come or under way, for their dashboard: approved, or being decided, ending today or
 * later, the soonest first, at most `limit`.
 */
export function upcomingLeave<R extends Pick<LeaveRequestView, 'status' | 'startDate' | 'endDate'>>(requests: readonly R[], today: string, limit = UPCOMING_LEAVE): R[] {
  return requests
    .filter((r) => (r.status === 'approved' || r.status === 'with_manager' || r.status === 'with_hr') && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, limit);
}

/** "Today", "Tomorrow", "In 5 days", or "Until 08/10/2026" for a leave under way. */
export function leaveWhenText(r: Pick<LeaveRequestView, 'startDate' | 'endDate'>, today: string): string {
  if (r.startDate <= today) return r.endDate === today ? 'Ends today' : `Under way, until ${formatDate(r.endDate)}`;
  const days = Math.round((Date.parse(`${r.startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}
