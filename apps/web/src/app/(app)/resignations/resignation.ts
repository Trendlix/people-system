import { RESIGNATION_REQUEST_STATUSES, resignationProblems, type ResignationRequestStatus, type Role } from '@trendlix/shared';
import { MY_REQUESTS } from '../../../components/nav';
import { parseDate } from '../../../lib/format';
import { hasRole } from '../../../lib/roles';
import type { ResignationRequestView } from '../../../lib/resignation-types';

// An employee's resignation request (owner, 26 October 2026: "but the employee has to request resignation and then the HR
// generates the document"): the employee sends Resign from My Requests; HR (the CEO for a C-level person) finds it under
// People → Resignations, beside Offboarding, and presses "Record the resignation", which opens the End employment form
// with the resignation, the day it was sent, the reason and the preferred day filled in. The direct manager sees it on My
// Team. Pure code, tested; relative imports, as vitest doesn't know the @/ paths. The letter (owner, 31 October 2026: "on the
// resignation, the letter is auto generated, viewed by the employee but uploaded by the HR"): People's, opened from the
// request's page, and the signed copy HR uploads there.

type WithRoles = { roles: readonly Role[] };
type Query = Record<string, string | string[] | undefined>;

// ---------- the addresses ----------

/** HR's and the CEO's list, under People beside Offboarding. */
export const RESIGNATIONS_PATH = '/resignations';

/** A request's page, for its employee, HR, the CEO and the direct manager: "/resignations/<id>". */
export const resignationHref = (id: string, done?: ResignationDone) => `${RESIGNATIONS_PATH}/${encodeURIComponent(id)}${done ? `?done=${done}` : ''}`;

/** The letter People prepares from the request, as a protected PDF: opened in the browser, or saved with `download`. */
export const generatedLetterHref = (id: string, download = false) => `${RESIGNATIONS_PATH}/${encodeURIComponent(id)}/generated-letter${download ? '?download=1' : ''}`;

/** The signed letter HR uploaded, shown in the browser. */
export const signedLetterHref = (id: string) => `${RESIGNATIONS_PATH}/${encodeURIComponent(id)}/letter`;

/** The employee's form, from My Requests. */
export const RESIGN_PATH = `${MY_REQUESTS}/resign`;

/** Where the employee's own requests are listed: their part of My Requests. */
export const MY_RESIGNATION_HREF = `${MY_REQUESTS}#my-resignation`;

/** What was just done on a request, said on its page by `?done=`. */
export type ResignationDone = 'sent' | 'withdrawn' | 'returned' | 'moved';

/** The End employment form, opened for the employee's resignation from a request: "/employees/<id>/ending/new?rule=resignation&resignation=<request>". */
export const recordResignationHref = (employeeId: string, requestId: string) =>
  `/employees/${encodeURIComponent(employeeId)}/ending/new?rule=resignation&resignation=${encodeURIComponent(requestId)}`;

/** Who sees everyone's requests (People → Resignations): HR, the CEO and a Super Admin. */
export const seesResignations = (user: WithRoles) => hasRole(user, 'hr', 'ceo', 'super_admin');

// ---------- the list ----------

export const RESIGNATION_FILTERS = [
  { value: 'sent', label: 'Waiting' },
  { value: 'recorded', label: 'Recorded' },
  { value: 'returned', label: 'Returned' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: '', label: 'All' },
] as const;

export type ResignationFilter = (typeof RESIGNATION_FILTERS)[number]['value'];

/** The filter in the address (?status=): Waiting unless another is asked for. */
export function readResignationFilter(query: Query): ResignationFilter {
  const v = typeof query.status === 'string' ? query.status : undefined;
  if (v === 'all') return '';
  return (RESIGNATION_REQUEST_STATUSES as readonly string[]).includes(v ?? '') ? (v as ResignationRequestStatus) : 'sent';
}

export const resignationsHref = (filter: ResignationFilter) => (filter === 'sent' ? RESIGNATIONS_PATH : `${RESIGNATIONS_PATH}?status=${filter || 'all'}`);

/** The API's path for a filter. */
export const resignationsApiPath = (filter: ResignationFilter) => (filter ? `/resignation-requests?status=${filter}` : '/resignation-requests');

export const RESIGNATION_STATUS_STYLE: Record<ResignationRequestStatus, string> = {
  sent: 'bg-warn-soft text-warn',
  recorded: 'bg-ok-soft text-ok',
  withdrawn: 'bg-line-soft text-muted',
  returned: 'bg-line-soft text-muted',
};

// ---------- the form ----------

/** The form as typed: the reason, the preferred day (DD/MM/YYYY), the box ticked. */
export interface TypedResignation {
  reason: string;
  preferredLastDay: string;
  confirmed: boolean;
}

/** The preferred day as YYYY-MM-DD, "" while empty, null while not a date. */
export const preferredDayOf = (typed: Pick<TypedResignation, 'preferredLastDay'>): string | null => parseDate(typed.preferredLastDay);

/** Why the request can't be sent yet, in the order to fix them (none: it can). `today`: YYYY-MM-DD, Cairo. */
export function formProblems(typed: TypedResignation, today: string): string[] {
  const day = preferredDayOf(typed);
  return resignationProblems({ reason: typed.reason, preferredLastDay: day === null ? 'not-a-date' : day, confirmed: typed.confirmed }, today);
}

/** The form's hint under the preferred day: the notice, and the day it would end if sent today. */
export function noticeHint(notice: string | null, lastDay: string | null, show: (ymd: string) => string): string {
  if (!notice) return 'Leave it empty to leave it to the notice.';
  return `The notice is ${notice} by the resignation rule${lastDay ? `: sent today, it would end on ${show(lastDay)}` : ''}. A shorter time is for HR to agree.`;
}

// ---------- recording it ----------

/**
 * What the End employment form starts with for a resignation request (owner, 26 October 2026): the day it was sent as the
 * notice received on, the reason, and the preferred last working day as the agreed last working day (HR may change it).
 * Dates as the form types them (DD/MM/YYYY) come from `show`.
 */
export function endingDefaults(r: Pick<ResignationRequestView, 'sentOn' | 'reason' | 'preferredLastDay'>, show: (ymd: string) => string) {
  return {
    ruleKey: 'resignation',
    noticeGivenOn: show(r.sentOn),
    reason: (r.reason ?? '').slice(0, 200),
    preferredLastDay: r.preferredLastDay,
    note: '',
    agreedLastWorkingDay: r.preferredLastDay ? show(r.preferredLastDay) : '',
  };
}
