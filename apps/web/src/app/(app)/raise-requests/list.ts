import {
  effectiveFromChoices,
  nextFirstOfMonth,
  RAISE_DECISION_DONE_LABELS,
  RAISE_REASON_LABELS,
  RAISE_REQUEST_STATUS_LABELS,
  RAISE_REQUEST_STATUSES,
  RAISE_REQUEST_STEP_LABELS,
  RAISE_REQUESTER_LABELS,
  RAISE_WAY_LABELS,
  payDifference,
  type RaiseRequester,
  type RaiseRequestStatus,
  type Role,
} from '@trendlix/shared';
import { formatDate, formatDateTime } from '../../../lib/format';
import type { RaiseRequest, RaiseRequestStep, RaiseSuggestion } from '../../../lib/raise-types';
import { hasRole } from '../../../lib/roles';
import type { EmployeeSummary } from '../../../lib/types';
import { defaultEffectiveDate } from '../employees/[id]/contracts/raise';
import { changeText } from '../employees/[id]/salary-history/salary-history';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { myRequestsHref } from '../my-requests/requests';

// Raise requests (owner's decisions, 16 October 2026: "a place to request raise by employee, or his manager or the HR,
// with a reason and to be going through an approval cycle"; reworked 17 October 2026: "requesting a raise should have a
// drop list reason first ( Annual Raise - Performance Raise - Counter Offer Raise - etc..) then add requester comment,
// suggest raise amount or percentage, then the approver to Approve - Approve with another raise amount or percentge -
// Reject, and add a comment, all the request steps to be logged in the request"): the employee asks for themself, their
// direct manager for a direct report, or HR for anyone, with a reason from the list, a comment and a suggested raise (an
// amount, or a percent: a manager a percent only); one open per person. HR approves it as suggested or with another
// raise, which prepares the raise and sends it to the CEO, or rejects it; the CEO approves that raise as it reached
// them or with another raise, rejects it or returns it to HR, each with a comment; it is done once the raise is signed.
// Every step is logged on the request. The manager is told, not asked. Amounts stay private: the API leaves out what
// the caller may not see, and these helpers only word what it sent. Asked for under Requests → Raise Requests since 17
// October 2026 ("i think raising a request should be moved from the Employee tab to the raise requests tab"; the owner
// chose "Under Requests"): the form is its own page (/raise-requests/new), for HR, the CEO and Finance from the list,
// for the employee from My Requests and for a manager from My Team, each picking only the people they may ask for; the
// profile lists a person's requests and their logs, read only. A request also says the month the raise is asked from
// (Effective from, 17 October 2026). Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

type WithRoles = { roles: readonly Role[] };

/** Who sees the Raise Requests page (the sidebar shows them the link): HR and the CEO, and Finance to view. */
export const RAISE_REQUESTS_ROLES: readonly Role[] = ['hr', 'ceo', 'finance'];

export function canSeeRaiseRequests(user: WithRoles): boolean {
  return hasRole(user, ...RAISE_REQUESTS_ROLES);
}

/** HR declines a request, or prepares the raise from it. The API checks this again. */
export function handlesRaiseRequests(user: WithRoles): boolean {
  return hasRole(user, 'hr');
}

/**
 * Whether a profile shows its Raise Requests (and so, to the employee or their manager, the Salary sub-tab): when there
 * are requests the caller may see, or they may ask for one now; also when they could not be loaded, to say so. Nothing
 * when the caller may not see them, or the server doesn't have them yet. `load`: GET /employees/:id/raise-requests as
 * read (data.ts).
 */
export function showsRaiseRequests(
  load: { kind: 'ok'; value: { requests: readonly unknown[]; canRequest: boolean } } | { kind: 'unavailable' | 'forbidden' | 'failed' },
): boolean {
  if (load.kind === 'ok') return load.value.requests.length > 0 || load.value.canRequest;
  return load.kind === 'failed';
}

/** The requests waiting for HR, for the count beside Raise Requests in the sidebar. */
export const WITH_HR_REQUESTS = '/raise-requests?status=with_hr';

// ---------- the status filter ----------

export type StatusFilter = RaiseRequestStatus | '';

/** All, then each status in the order a request goes through them. */
export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All' },
  ...RAISE_REQUEST_STATUSES.map((s) => ({ value: s, label: RAISE_REQUEST_STATUS_LABELS[s] })),
];

type Query = Record<string, string | string[] | undefined>;

/** The status in the page's address; anything it doesn't know is All. */
export function readStatus(query: Query): StatusFilter {
  const v = typeof query.status === 'string' ? query.status : '';
  return (RAISE_REQUEST_STATUSES as readonly string[]).includes(v) ? (v as RaiseRequestStatus) : '';
}

/**
 * The page's address for a status: "/raise-requests?status=with_hr", or "/raise-requests" for All. The API's list is at
 * the same path (under /api), with the same ?status=.
 */
export const raiseRequestsHref = (status: StatusFilter) => (status ? `/raise-requests?status=${status}` : '/raise-requests');

/** "1 request", "12 requests". */
export const requestsLabel = (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`;

/** A request's row on the Raise Requests page (and its card on My Requests), to link to: "raise-request-<id>". */
export const raiseRequestAnchor = (id: string) => `raise-request-${id}`;

/** A request on the Raise Requests page: its status's list, at its row ("/raise-requests?status=with_hr#raise-request-q1"). */
export const raiseRequestOnListHref = (r: Pick<RaiseRequest, 'id' | 'status'>) => `${raiseRequestsHref(r.status)}#${raiseRequestAnchor(r.id)}`;

// ---------- asking for a raise ----------

/** The request form, under Requests → Raise Requests (owner's choice, 17 October 2026: "Under Requests"). */
export const NEW_RAISE_REQUEST_PATH = '/raise-requests/new';

/** The request form, for that person when given: "/raise-requests/new?employee=<id>". */
export const newRaiseRequestHref = (employeeId?: string | null) =>
  employeeId ? `${NEW_RAISE_REQUEST_PATH}?employee=${encodeURIComponent(employeeId)}` : NEW_RAISE_REQUEST_PATH;

/** The signed-in user as the request form needs them: their roles, sign-in email and own profile (GET /auth/me). */
type Asker = WithRoles & { email: string; employeeId?: string | null };

/** Someone the form may offer, as GET /employees lists them: the current employment with its direct manager. */
type Candidate = Pick<EmployeeSummary, 'id' | 'workEmail'> & { employment: { manager: { id: string } | null } | null };

/** Whether the person is the signed-in user: their own profile, or, from an API that doesn't name it, their work email. */
function isMe(user: Asker, p: Pick<Candidate, 'id' | 'workEmail'>): boolean {
  if (user.employeeId) return p.id === user.employeeId;
  return user.employeeId === undefined && !!p.workEmail && p.workEmail.toLowerCase() === user.email.trim().toLowerCase();
}

/**
 * The people the user may ask for a raise for, as the API lets them (RaiseRequestsService: "HR for anyone, a manager
 * for a direct report, an employee for themself"): HR, everyone currently employed; anyone else, themself and the
 * people whose current employment reports to them. Only those currently employed (a raise is asked for under an
 * employment), in the order given. `people`: GET /employees (everyone for HR, the CEO and Finance; themself and their
 * direct reports for a manager; themself for anyone else).
 */
export function requestablePeople<P extends Candidate>(user: Asker, people: readonly P[]): P[] {
  const employed = people.filter((p) => p.employment);
  if (handlesRaiseRequests(user)) return employed;
  const me = people.find((p) => isMe(user, p))?.id ?? null;
  return employed.filter((p) => p.id === me || (me !== null && p.employment?.manager?.id === me));
}

/** Whether the person is the user themself, among those requestablePeople offers (so the form says "you"). */
export const isRequestForSelf = (user: Asker, p: Pick<Candidate, 'id' | 'workEmail'>) => isMe(user, p);

/**
 * The picker's choices, by name: "Nour Adel · EMP-0012", the user themself marked "(you)". `people`: requestablePeople's.
 */
export function pickerOptions(user: Asker, people: readonly (Candidate & Pick<EmployeeSummary, 'fullNameEn' | 'employeeCode'>)[]): { id: string; label: string }[] {
  return [...people]
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en') || a.employeeCode.localeCompare(b.employeeCode))
    .map((p) => ({ id: p.id, label: `${p.fullNameEn} · ${p.employeeCode}${isMe(user, p) ? ' (you)' : ''}` }));
}

/**
 * Who the form is for when it opens: the one asked for in the address (?employee=) when the user may ask for them, else
 * the only one they may (an employee: themself); null to pick.
 */
export function preselectedPerson(people: readonly Pick<Candidate, 'id'>[], asked: string | null | undefined): string | null {
  if (asked && people.some((p) => p.id === asked)) return asked;
  return people.length === 1 ? people[0].id : null;
}

/** "?employee=" in the form's address, if one was sent. */
export function readEmployee(query: Query): string | null {
  return typeof query.employee === 'string' && query.employee ? query.employee : null;
}

/**
 * Where the requester carries on, and where Cancel on the form goes: the Raise Requests page for those who see it (HR,
 * the CEO, Finance); My Requests for the employee asking for themself; My Team for a manager asking for a report.
 */
export function requestBackHref(user: WithRoles, forSelf: boolean): string {
  if (canSeeRaiseRequests(user)) return raiseRequestsHref('');
  return forSelf ? myRequestsHref({ kind: '', status: '' }) : '/my-team';
}

/** The answer to "?sent=1": the request just sent, said on the page it lands on. */
export const SENT_PARAM = 'sent';

/**
 * Where the requester lands once a request is sent, with it listed (newest first) and said so (?sent=1): the Raise
 * Requests page for those who see it; else My Requests, at their raises (the employee) or those for their team (a
 * manager).
 */
export function requestSentHref(user: WithRoles, forSelf: boolean): string {
  const place = canSeeRaiseRequests(user) ? raiseRequestsHref('') : myRequestsHref({ kind: forSelf ? 'raise' : 'team', status: '' });
  return `${place}${place.includes('?') ? '&' : '?'}${SENT_PARAM}=1`;
}

/** Whether the page was landed on with a request just sent. */
export const justSent = (query: Query) => query[SENT_PARAM] === '1';

/**
 * Where a request listed on a profile opens under Requests, with its label: the Raise Requests page for those who see
 * it; My Requests for the employee's own and for one a manager asked for themself. Null for the others (a manager
 * reading one the employee or HR asked for): the profile is its place.
 */
export function requestPlace(user: Asker, r: Pick<RaiseRequest, 'id' | 'status' | 'requester' | 'requestedBy'>, forSelf: boolean): { href: string; label: string } | null {
  if (canSeeRaiseRequests(user)) return { href: raiseRequestOnListHref(r), label: 'Open in Raise Requests' };
  const mine = r.requester === 'manager' && !!r.requestedBy && r.requestedBy.email.toLowerCase() === user.email.trim().toLowerCase();
  if (forSelf || mine) {
    return { href: `${myRequestsHref({ kind: forSelf ? 'raise' : 'team', status: '' })}#${raiseRequestAnchor(r.id)}`, label: 'Open in My Requests' };
  }
  return null;
}

// ---------- Effective from ----------

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A month by its 1st (or any day in it): "2026-11-01" → "November 2026". */
export const monthText = (ymd: string) => MONTH.format(new Date(`${ymd.slice(0, 10)}T00:00:00.000Z`));

/** The month a request is asked from (owner, 17 October 2026: "Effective from"): "November 2026"; "Not given" on one from before. */
export const effectiveFromText = (r: Pick<RaiseRequest, 'effectiveFrom'>) => (r.effectiveFrom ? monthText(r.effectiveFrom) : 'Not given');

/** The months the form offers, this month (today in Cairo) first, each as its 1st and its name. */
export const effectiveFromOptions = (today: string) => effectiveFromChoices(today).map((value) => ({ value, label: monthText(value) }));

/**
 * The date HR's decision form starts with (owner, 17 October 2026: HR's approval takes the request's Effective from
 * unless HR sets another): the month the request is asked from; on one from before, the next 1st of a month after
 * today and after the contract in force started.
 */
export function decisionEffectiveDate(r: Pick<RaiseRequest, 'effectiveFrom' | 'inForce'>, today: string): string {
  if (r.effectiveFrom) return r.effectiveFrom;
  return r.inForce ? defaultEffectiveDate(today, r.inForce) : nextFirstOfMonth(today);
}

// ---------- a request, in words ----------

/** The status pill's colours, as the change requests and the payroll show theirs: waiting, approved, declined, done. */
export const STATUS_BADGE: Record<RaiseRequestStatus, string> = {
  with_hr: 'bg-warn-soft text-warn',
  with_ceo: 'bg-warn-soft text-warn',
  approved: '', // the badge's own accent colours
  declined: 'bg-danger-soft text-danger',
  done: 'bg-ok-soft text-ok',
};

export const statusLabel = (status: RaiseRequestStatus) => RAISE_REQUEST_STATUS_LABELS[status] ?? status;

/** Who asked: "The direct manager", with their sign-in email when the API sends it. */
export function requesterText(r: Pick<RaiseRequest, 'requester' | 'requestedBy'>): { who: string; email: string | null } {
  return { who: RAISE_REQUESTER_LABELS[r.requester] ?? r.requester, email: r.requestedBy?.email ?? null };
}

/** Who asked, inside a sentence: "Asked for by the employee", "… by their direct manager", "… by HR". */
export const REQUESTER_PHRASES: Record<RaiseRequest['requester'], string> = { self: 'the employee', manager: 'their direct manager', hr: 'HR' };

/**
 * The raise HR prepared from a request, as far as the caller may see it: "CON-2026-0001-A1 · Amendment", then when it
 * takes effect, the gross from → to and the change ("From 01/11/2026 · EGP 10,000.00 → EGP 12,500.00 · +EGP 2,500.00
 * (+25%)"), each only when sent. Null without one.
 */
export function preparedRaiseText(raise: RaiseRequest['raise']): { title: string; detail: string | null } | null {
  if (!raise) return null;
  const parts: string[] = [];
  if (raise.effectiveDate) parts.push(`From ${formatDate(raise.effectiveDate)}`);
  if (raise.newGross !== null && raise.previousGross !== null) {
    parts.push(`${formatEgp(raise.previousGross)} → ${formatEgp(raise.newGross)}`);
    parts.push(changeText(payDifference(raise.previousGross, raise.newGross))!);
  } else if (raise.newGross !== null) {
    parts.push(`New gross ${formatEgp(raise.newGross)}`);
  }
  return { title: `${raise.number} · ${RAISE_WAY_LABELS[raise.way] ?? raise.way}`, detail: parts.length ? parts.join(' · ') : null };
}

/**
 * Where a request stands, for its Decision column and card: what happened last, and the comment given with it (HR's or
 * the CEO's rejection, the CEO's return to HR, which only HR, Finance and the CEO are sent).
 */
export function progressText(r: RaiseRequest): { text: string; reason: string | null } {
  const at = (iso: string | null) => (iso ? ` on ${formatDate(iso)}` : '');
  switch (r.status) {
    case 'declined': {
      const d = r.decision;
      const by = d?.stage === 'ceo' ? 'the CEO' : 'HR';
      return { text: `Rejected by ${by}${at(d?.at ?? null)}`, reason: d?.reason ?? null };
    }
    case 'done': {
      // the new gross for HR, Finance, the CEO and the employee themself; never for the manager (the API leaves it out)
      const gross = r.raise?.newGross ?? null;
      const from = r.raise?.effectiveDate ?? null;
      const pay = gross !== null && from ? `, ${formatEgp(gross)} from ${formatDate(from)}` : '';
      return { text: `Done${at(r.doneAt)}: the raise is signed${pay}`, reason: null };
    }
    case 'approved':
      return { text: `Approved by the CEO${at(r.raise?.approvedAt ?? null)}: the raise is to be signed`, reason: null };
    case 'with_ceo':
      return { text: 'HR approved it and sent the raise to the CEO', reason: null };
    case 'with_hr':
    default:
      if (r.raise?.returnedReason) return { text: 'Returned by the CEO to HR', reason: r.raise.returnedReason };
      if (r.raise) return { text: 'HR is preparing the raise', reason: null };
      return { text: 'Waiting for HR', reason: null };
  }
}

/** When it was asked: "16/10/2026, 5:42 PM". */
export const askedAt = (r: Pick<RaiseRequest, 'createdAt'>) => formatDateTime(r.createdAt);

/** The raise form, prepared from a request (the Contract section's raise page). */
export const prepareRaiseHref = (employeeId: string, requestId: string) =>
  `/employees/${encodeURIComponent(employeeId)}/contracts/raise?request=${encodeURIComponent(requestId)}`;

/**
 * What HR may do with a request while it is with HR: decide it (approve it as suggested or with another raise, which
 * prepares the raise and sends it to the CEO, or reject it), or approve it in the whole raise form (`prepare`, for a
 * promotion or other allowances with it); once a raise is prepared from it (returned by the CEO, or prepared before 17
 * October 2026), carry on with that raise in the Contract section, or reject the request (the raise goes with it).
 */
export function requestActions(
  user: WithRoles,
  r: Pick<RaiseRequest, 'status' | 'raise'>,
): { decide: boolean; prepare: boolean; continueRaise: boolean; decline: boolean } {
  const hr = handlesRaiseRequests(user) && r.status === 'with_hr';
  return { decide: hr && !r.raise, prepare: hr && !r.raise, continueRaise: hr && !!r.raise, decline: hr && !!r.raise };
}

/** How many are waiting for HR. */
export const withHrCount = (requests: readonly Pick<RaiseRequest, 'status'>[]) => requests.filter((r) => r.status === 'with_hr').length;

// ---------- the reason, the comment, the figures ----------

/** The reason from the list ("Performance raise"); null on a request from before 17 October 2026. */
export const reasonText = (r: Pick<RaiseRequest, 'raiseReason'>): string | null => (r.raiseReason ? (RAISE_REASON_LABELS[r.raiseReason] ?? r.raiseReason) : null);

/** The requester's comment: what a request from before 17 October 2026 was asked with, too. */
export const commentText = (r: Pick<RaiseRequest, 'comment' | 'reason'>): string => r.comment ?? r.reason;

const sign = (n: number) => (n < 0 ? '−' : '+');
const amountText = (n: number) => `${sign(n)}${formatEgp(Math.abs(n))}`;
const percentText = (n: number) => `${sign(n)}${Math.abs(n)}%`;

/**
 * A raise's figures as far as the caller is sent them: the one typed first, the other in brackets, and the gross it
 * comes to: "+10% (+EGP 1,000.00) → EGP 11,000.00", "+EGP 1,500.00", "+8%"; worked out from the pay (none typed), the
 * amount first; a gross alone, "Gross EGP 12,000.00". Null with none.
 */
export function figureText(f: Pick<RaiseRequestStep, 'figure' | 'increaseAmount' | 'increasePercent' | 'gross'>): string | null {
  const amount = f.increaseAmount !== null ? amountText(f.increaseAmount) : null;
  const percent = f.increasePercent !== null ? percentText(f.increasePercent) : null;
  const [first, second] = f.figure === 'percent' ? [percent, amount] : [amount, percent];
  const change = first ? `${first}${second ? ` (${second})` : ''}` : second;
  if (change) return `${change}${f.gross !== null ? ` → ${formatEgp(f.gross)}` : ''}`;
  return f.gross !== null ? `Gross ${formatEgp(f.gross)}` : null;
}

/**
 * The raise suggested on a request, as far as the caller is sent it: "+EGP 1,500.00 → EGP 11,500.00", "+8%", or a
 * gross typed before 17 October 2026, "Gross EGP 12,000.00". Null without one, or none the caller may see.
 */
export function suggestionText(s: RaiseSuggestion | null | undefined): string | null {
  if (!s) return null;
  if (s.kind === 'gross') return s.gross !== null ? `Gross ${formatEgp(s.gross)}` : null;
  return figureText({ figure: s.kind, increaseAmount: s.amount, increasePercent: s.percent, gross: s.gross });
}

// ---------- the log ----------

/** How the log says who asked: "Asked for by the employee", "… by their direct manager", "… by HR". */
const ASKED_BY: Record<RaiseRequester, string> = { self: 'Asked for by the employee', manager: 'Asked for by their direct manager', hr: 'Asked for by HR' };

/**
 * A step of a request as its log shows it: what happened ("HR approved it with another raise", "The CEO rejected it"),
 * and what goes with it as far as the caller is sent it (the reason, the month asked from and the raise suggested, the
 * figures and the date decided, the raise prepared and from when, the new pay once signed).
 */
export function stepText(s: RaiseRequestStep, requester: RaiseRequester): { title: string; detail: string | null } {
  const figures = figureText(s);
  // the month asked from (submitted) or HR chose (HR's approval), 17 October 2026
  const effective = s.effectiveDate ? `Effective from ${monthText(s.effectiveDate)}` : null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || null;
  switch (s.kind) {
    case 'submitted':
      return {
        title: ASKED_BY[requester] ?? RAISE_REQUEST_STEP_LABELS.submitted,
        detail: join(s.raiseReason ? (RAISE_REASON_LABELS[s.raiseReason] ?? s.raiseReason) : null, effective, figures && `Suggested ${figures}`),
      };
    case 'hr_decision':
    case 'ceo_decision': {
      const who = s.kind === 'hr_decision' ? 'HR' : 'The CEO';
      const what =
        s.decision === 'approve' ? (s.kind === 'hr_decision' ? 'approved it as suggested' : 'approved it') : s.decision === 'approve_other' ? 'approved it with another raise' : 'rejected it';
      // HR's approval: the date chosen too, once the caller is sent it (17 October 2026)
      return { title: `${who} ${what}`, detail: s.decision === 'reject' ? null : join(figures, effective) };
    }
    case 'prepared': {
      const way = s.way ? RAISE_WAY_LABELS[s.way] : null;
      return { title: 'HR prepared the raise', detail: join(s.contractNumber, way && (s.effectiveDate ? `${way} from ${formatDate(s.effectiveDate)}` : way)) };
    }
    case 'sent':
      return { title: 'Sent to the CEO', detail: figures };
    case 'returned':
      return { title: 'The CEO returned it to HR', detail: null };
    case 'changed':
      return { title: 'HR changed the approved raise: it goes to the CEO again', detail: figures };
    case 'signed':
      return { title: 'Signed: the request is done', detail: join(s.effectiveDate && `In force from ${formatDate(s.effectiveDate)}`, s.gross !== null ? `New gross ${formatEgp(s.gross)}` : null) };
    case 'unsigned':
      return { title: 'Signing undone: the raise is to be signed again', detail: s.contractNumber };
    case 'raise_deleted':
      return { title: 'The raise was deleted: the request is with HR again', detail: s.contractNumber };
    default:
      return { title: RAISE_REQUEST_STEP_LABELS[s.kind] ?? s.kind, detail: figures };
  }
}

/** Whether a step is a decision, and which way, for its mark on the timeline. */
export function stepTone(s: Pick<RaiseRequestStep, 'kind' | 'decision'>): 'ok' | 'danger' | 'warn' | null {
  if (s.decision === 'reject') return 'danger';
  if (s.decision) return 'ok';
  if (s.kind === 'signed') return 'ok';
  if (s.kind === 'returned' || s.kind === 'raise_deleted' || s.kind === 'unsigned') return 'warn';
  return null;
}

/** "Rejected", "Approved with another raise": a decision as the log calls it. */
export const decisionLabel = (s: Pick<RaiseRequestStep, 'decision'>) => (s.decision ? RAISE_DECISION_DONE_LABELS[s.decision] : null);

/** "3 steps", "1 step". */
export const stepsLabel = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

// ---------- who sees the figures ----------

/**
 * Who sees the figures panel's figures, under it (owner, 17 October 2026: "HR, Finance and the CEO only", then "allow
 * the requestor raiser to see figures too"; a manager "No, only percent"): `forSelf`, the employee asking for themself,
 * their own pay; else HR, Finance and the CEO.
 */
export function figuresNote(forSelf: boolean): string {
  return forSelf
    ? 'Your own pay, which only you, HR, Finance and the CEO see: your direct manager doesn’t. The net is approximate.'
    : 'HR, Finance and the CEO see these figures; a direct manager sees no salary figures, a percent only. The net is approximate.';
}

// ---------- who reads a comment ----------

/**
 * Who reads a comment, for the hint under its box (owner, 17 October 2026: the comment boxes say who will read the
 * comment). The requester's: HR, Finance, the CEO and the direct manager (the employee doesn't see a request they didn't
 * make), and who sees the figures of the raise asked for: the employee's own, theirs and HR, Finance and the CEO's,
 * never the manager's ("allow the requestor raiser to see figures too"; for a manager "No, only percent"). HR's or the
 * CEO's decision: the employee too when they asked themself. A return, or HR's note on sending: HR and the CEO only.
 * `requester` null: a raise without a request, whose decision stays with HR.
 */
export function commentReaders(step: 'request' | 'decision' | 'return' | 'send', requester: RaiseRequester | null, forSelf = false): string {
  if (step === 'return') return 'HR sees this comment, with the raise returned to them; the employee and their manager don’t.';
  if (step === 'send') return 'The CEO sees this note; the employee and their manager don’t.';
  if (step === 'request') {
    if (forSelf) return 'HR, Finance, the CEO and your direct manager see this comment; the figures of the raise you suggest, only you, HR, Finance and the CEO.';
    return requester === 'manager'
      ? 'HR, Finance and the CEO see this comment; the employee doesn’t see a request you make.'
      : 'Finance, the CEO and the employee’s direct manager see this comment, the manager no figures; the employee doesn’t see a request HR makes.';
  }
  if (requester === null) return 'HR, Finance and the CEO see this comment, with the raise.';
  return requester === 'self'
    ? 'The employee and their manager see this comment.'
    : 'The employee’s manager sees this comment; the employee doesn’t see this request.';
}
