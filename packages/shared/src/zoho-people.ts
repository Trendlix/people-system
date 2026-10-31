// Zoho People's check-ins and check-outs pulled into the system (owner, 25 October 2026: "can i fetch checkin and out
// transactions from zoho people through api?"; asked, "Yes, daily + backfill": every night yesterday's for everyone, a
// "Fetch from Zoho" for any range, a Super Admin connecting Zoho once; then "but can it fetch historical data?": a run
// covers up to 12 months, everyone employed in it, former employees too, and a month whose payroll is with the CEO,
// approved or paid gets the days it is missing added for the record, its payroll unchanged). Zoho People's own API (its
// docs, read 25 October 2026): GET {people}/people/api/attendance/getAttendanceEntries?date=&dateFormat=&emailId=, one
// employee's day a call (its first check-in, last check-out, status and each check-in → check-out entry), 100 calls a
// minute at most, a 10-minute lock past it; the scope ZOHOPEOPLE.attendance.READ. The days go the Zoho import's way
// (attendance-import.ts): kept as Zoho People's days, by the system's rules, their hours by their pairs. Pure: the API
// fetches and keeps them, and the web shows the same words. Who: a Super Admin connects (Organization → Zoho People);
// HR and a Super Admin fetch and see the runs; never a developer.

import type { CalendarAppView, ZohoDataCentre } from './calendars.js';
import type { MeetingConnectProblem } from './meetings.js';

// ---------- the pages and the sign-in ----------

/** Organization → Zoho People. */
export const ZOHO_PEOPLE_PAGE = '/organization/zoho-people';

/** The website's return from Zoho's sign-in: the second redirect URI on the shared Zoho app. */
export const ZOHO_PEOPLE_CALLBACK_PATH = '/zoho-people/oauth';

/** The redirect URI on a website: "https://people.trendlix.com/zoho-people/oauth". */
export const zohoPeopleRedirectUri = (origin: string): string => `${origin.replace(/\/+$/, '')}${ZOHO_PEOPLE_CALLBACK_PATH}`;

/**
 * What the connected Zoho account is asked for: reading attendance (ZOHOPEOPLE.attendance.READ: Zoho lists READ beside
 * ALL for its attendance reads, and the system never writes to Zoho), reading the organization's time zone and date
 * format (ZOHOPEOPLE.organization.READ, so the times are read in Zoho's own zone), and who signed in (OpenID Connect's
 * `email`). Comma-separated, offline access (a refresh token).
 */
export const ZOHO_PEOPLE_SCOPES = ['ZOHOPEOPLE.attendance.READ', 'ZOHOPEOPLE.organization.READ', 'email'] as const;

// ---------- Zoho's limits ----------

/**
 * The calls a minute the system makes at most: Zoho allows 100 a minute to getAttendanceEntries and locks the API for 10
 * minutes past it (its docs); the brief: "throttle well under it, e.g. 60 a minute". One call a second.
 */
export const ZOHO_PEOPLE_CALLS_PER_MINUTE = 60;

/** Zoho's lock past its limit, in minutes: a lock answer waits this long, then tries again. */
export const ZOHO_PEOPLE_LOCK_MINUTES = 10;

/** The longest range a run fetches (owner, 25 October 2026: "but can it fetch historical data?"): 12 months. */
export const ZOHO_PEOPLE_MAX_MONTHS = 12;

/** When the nightly run fetches yesterday, Cairo's time. */
export const ZOHO_PEOPLE_NIGHTLY_TIME = '02:00';

/** The zone Zoho's times are read in when its organization doesn't say (it gives them without one): Cairo's. */
export const ZOHO_PEOPLE_DEFAULT_TIME_ZONE = 'Africa/Cairo';

/** Zoho People's own date format to start with, as its organizations have it unless changed. */
export const ZOHO_PEOPLE_DEFAULT_DATE_FORMAT = 'dd-MMM-yyyy';

// ---------- the refusals ----------

export const ZOHO_PEOPLE_SUPER_ADMIN_ONLY = 'Only a Super Admin connects Zoho People or changes its connection.';
export const ZOHO_PEOPLE_HR_ONLY = 'Only HR and a Super Admin fetch attendance from Zoho People.';
export const ZOHO_PEOPLE_OWN_ACCOUNT = 'Switch back to your own account to connect Zoho People.';
export const ZOHO_PEOPLE_NOT_CONNECTED = 'Zoho People isn’t connected yet: a Super Admin connects it on Organization → Zoho People.';
export const ZOHO_PEOPLE_RUN_GOING = 'A fetch from Zoho People is going already: wait for it to finish, or cancel it.';

// ---------- the runs ----------

/** A run: the nightly one (yesterday, everyone), or HR's "Fetch from Zoho" for a range. */
export const ZOHO_RUN_KINDS = ['nightly', 'fetch'] as const;
export type ZohoRunKind = (typeof ZOHO_RUN_KINDS)[number];

export const ZOHO_RUN_KIND_LABELS: Record<ZohoRunKind, string> = { nightly: 'Nightly', fetch: 'Fetch from Zoho' };

export const ZOHO_RUN_STATUSES = ['running', 'finished', 'failed', 'cancelled'] as const;
export type ZohoRunStatus = (typeof ZOHO_RUN_STATUSES)[number];

export const ZOHO_RUN_STATUS_LABELS: Record<ZohoRunStatus, string> = { running: 'Fetching', finished: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };

/** Why days of a run were left as they were, or not fetched. */
export const ZOHO_SKIP_REASONS = [
  'excluded',
  'payroll_approved',
  'before_join',
  'after_end',
  'between_employments',
  'no_work_email',
  'not_found',
  'not_permitted',
  'nothing_in_zoho',
  'unreadable',
] as const;
export type ZohoSkipReason = (typeof ZOHO_SKIP_REASONS)[number];

export const ZOHO_SKIP_LABELS: Record<ZohoSkipReason, string> = {
  // owner, 31 October 2026: "can i exclude users from the zoho api?"; "Add an exclusion list"
  excluded: 'Left out of the Zoho fetch',
  // the brief: 'skip it with the reason "payroll approved"'; since 25 October 2026 only the days Zoho changed there
  payroll_approved: 'Payroll approved: the day kept as it was',
  before_join: 'Before their join date',
  after_end: 'After their employment ended',
  between_employments: 'Between their employments',
  no_work_email: 'No work email',
  not_found: 'Not found in Zoho People',
  not_permitted: 'Zoho People refused to share it',
  nothing_in_zoho: 'Nothing in Zoho People that day',
  unreadable: 'Zoho People’s answer couldn’t be read',
};

/** The days added to a month whose payroll is with the CEO, approved or paid (25 October 2026). */
export const ZOHO_RECORDED_LABEL = 'Added for the record, payroll unchanged';

// ---------- left out of the fetch (owner, 31 October 2026) ----------

/**
 * People left out of Zoho People's fetch (owner, 31 October 2026: "can i exclude users from the zoho api?"; he chose "Add
 * an exclusion list": "On Organization → Zoho People, HR or a Super Admin picks people to leave out. The nightly and
 * manual fetches skip them, and each run says how many were left out. Zoho days already fetched stay as history."):
 * every run skips them (the nightly one and Fetch from Zoho, even when chosen by hand), their days counted under
 * "Left out of the Zoho fetch".
 */
export const ZOHO_EXCLUSION_REASON_MAX = 500;
export const ZOHO_EXCLUSION_ENTITY = 'zoho_people_exclusion';

/** What a fetch of only people left out is refused with. */
export const ZOHO_ONLY_EXCLUDED = 'Everyone chosen is left out of the Zoho fetch: take them off that list first, or choose others.';

/** Someone left out of the fetch, as the page lists them. */
export interface ZohoExclusionView {
  employeeId: string;
  name: string;
  employeeCode: string;
  former: boolean;
  reason: string | null;
  addedAt: string;
  addedBy: { id: string; name: string } | null;
}

/** GET /zoho-people/exclusions (and the page's): the list, the C-level people hidden from the caller counted apart. */
export interface ZohoExclusionsView {
  exclusions: ZohoExclusionView[];
  hidden: number;
}

/** Why an exclusion's reason can't be kept, or null: at most 500 characters. */
export function zohoExclusionReasonProblem(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  return r.length > ZOHO_EXCLUSION_REASON_MAX ? `Keep the reason to ${ZOHO_EXCLUSION_REASON_MAX} characters; it has ${r.length}.` : null;
}

/** Someone of a run, as the page lists them (former: no employment now). */
export interface ZohoPersonRef {
  employeeId: string;
  name: string;
  employeeCode: string;
  email: string | null;
  former: boolean;
}

/** What a run counted. */
export interface ZohoRunCounts {
  /** The people it fetches, and those done. */
  people: number;
  peopleDone: number;
  /** The calls it makes (a person's day each), and those made. */
  calls: number;
  callsDone: number;
  /** Days kept that weren't there, and the check-ins and check-outs in them. */
  daysAdded: number;
  punchesAdded: number;
  /** Zoho's days changed in Zoho since (e.g. a regularisation): only that day's Zoho day replaced. */
  daysReplaced: number;
  daysUnchanged: number;
  /** Added to a month whose payroll is with the CEO, approved or paid: for the record, the payroll unchanged. */
  daysRecorded: number;
  /** Draft payroll lines refilled. */
  linesRefilled: number;
}

/** A run as the page shows it. */
export interface ZohoRunView {
  id: string;
  kind: ZohoRunKind;
  /** The days it covers, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Everyone employed in the range, or the people HR chose (how many). */
  everyone: boolean;
  chosen: number;
  status: ZohoRunStatus;
  startedAt: string;
  finishedAt: string | null;
  startedBy: { id: string; name: string } | null;
  cancelRequested: boolean;
  /** Zoho asked to wait (its lock past its limit, or its daily calls used up): it goes on by itself then. */
  waitingUntil: string | null;
  /** While it runs: about how many minutes are left at the rate the system calls Zoho. */
  minutesLeft: number | null;
  counts: ZohoRunCounts;
  /** The days left as they were, or not fetched, by why. */
  skipped: { reason: ZohoSkipReason; days: number }[];
  /** The people Zoho People doesn't know by their work email (the C-level people HR may not see counted apart). */
  notFound: ZohoPersonRef[];
  noWorkEmail: ZohoPersonRef[];
  /** Left out of the fetch (owner, 31 October 2026), as they were when it started. */
  excluded: ZohoPersonRef[];
  hidden: number;
  /** What went wrong on the way, short (at most 20). */
  errors: string[];
  /** Why it failed, in words. */
  problem: string | null;
}

/** Zoho People's connection, never its token. */
export interface ZohoPeopleConnectionView {
  accountEmail: string;
  status: 'connected' | 'needs_reconnecting';
  problem: string | null;
  dataCentre: ZohoDataCentre | null;
  /** Zoho People's own time zone and date format, as its organization says (null: not read yet). */
  timeZone: string | null;
  dateFormat: string | null;
  connectedAt: string;
  connectedBy: { id: string; name: string } | null;
  lastTest: ZohoPeopleTestView | null;
}

/** A test: today's attendance read for the connected account and a colleague, in counts. */
export interface ZohoPeopleTestView {
  at: string;
  ok: boolean;
  message: string;
}

/** GET /zoho-people: the page. */
export interface ZohoPeopleView {
  /** The Zoho app, shared with Organization → Calendars (a Super Admin's: null for HR). */
  app: CalendarAppView | null;
  connection: ZohoPeopleConnectionView | null;
  /** A Super Admin in their own session: connects, tests, disconnects. */
  canManage: boolean;
  /** HR and a Super Admin: Fetch from Zoho, cancel. */
  canFetch: boolean;
  /** The run going now. */
  current: ZohoRunView | null;
  /** The last runs, the latest first. */
  runs: ZohoRunView[];
  /** Not found in Zoho People by the latest run that fetched them. */
  notFound: ZohoPersonRef[];
  hiddenNotFound: number;
  /** Left out of the fetch (owner, 31 October 2026). */
  exclusions: ZohoExclusionsView;
  /** The nightly run: its time, and the last one. */
  nightly: { time: string; last: { day: string; status: ZohoRunStatus; finishedAt: string | null; problem: string | null } | null };
  /** Those with a current employment, for the estimate. */
  people: number;
  /** The zone Zoho's times are read in. */
  timeZone: string;
}

/** POST /zoho-people/oauth/finish: where to return the person, and how it went. */
export interface ZohoPeopleConnectResult {
  back: string;
  ok: boolean;
  problem: MeetingConnectProblem | null;
  said: string | null;
}

/** GET /zoho-people/note: what the dashboard says to HR and a Super Admin when the nightly fetch failed (null: nothing). */
export type ZohoPeopleNote = { tone: 'warn' | 'danger'; text: string } | null;

// ---------- a range, and how long it takes ----------

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const realDay = (s: string): boolean => {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const nextDays = (ymd: string, n: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** The day 12 months after `from` less one: the last day a run from it may reach (2025-11-01 → 2026-10-31). */
export function zohoRangeEnd(from: string): string {
  const [y, m, d] = from.split('-').map(Number);
  const month = m - 1 + ZOHO_PEOPLE_MAX_MONTHS;
  const lastOfTarget = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(y, month, Math.min(d, lastOfTarget)));
  return nextDays(end.toISOString().slice(0, 10), -1);
}

/** The days from `from` to `to`, both counted. */
export const zohoRangeDays = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * Why a Fetch from Zoho's range can't be fetched (none: it can): real days, the first on or before the last, up to
 * yesterday (today's is fetched tonight), and 12 months at most (owner, 25 October 2026).
 */
export function zohoFetchProblems(input: { from?: string | null; to?: string | null }, today: string): string[] {
  const from = (input.from ?? '').trim();
  const to = (input.to ?? '').trim();
  if (!realDay(from) || !realDay(to)) return ['Choose the first and the last day to fetch.'];
  const out: string[] = [];
  if (from > to) out.push('The first day must be on or before the last day.');
  const yesterday = nextDays(today, -1);
  if (to > yesterday) out.push('Fetch up to yesterday: today’s check-ins are fetched tonight.');
  if (from <= to && to > zohoRangeEnd(from)) out.push(`Fetch ${ZOHO_PEOPLE_MAX_MONTHS} months at most at a time: up to ${zohoRangeEnd(from)} from ${from}.`);
  return out;
}

/** About how many minutes `calls` take at the rate the system calls Zoho (60 a minute). */
export const zohoMinutesFor = (calls: number): number => (calls > 0 ? Math.ceil(calls / ZOHO_PEOPLE_CALLS_PER_MINUTE) : 0);

/** "about 4 h 4 min", "about 12 min", "under a minute". */
export function zohoDurationText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 1) return 'under a minute';
  const m = Math.ceil(minutes);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  return `about ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/**
 * The estimate a Fetch from Zoho shows (owner, 25 October 2026: "people × days ÷ about 60 a minute; a year for 40 people
 * is about 4 hours"): "40 people × 365 days = 14,600 calls to Zoho: about 4 h 4 min".
 */
export function zohoEstimateText(people: number, days: number): string {
  const calls = Math.max(0, people) * Math.max(0, days);
  const n = (x: number) => x.toLocaleString('en-US');
  return `${n(people)} ${people === 1 ? 'person' : 'people'} × ${n(days)} ${days === 1 ? 'day' : 'days'} = ${n(calls)} ${calls === 1 ? 'call' : 'calls'} to Zoho: ${zohoDurationText(zohoMinutesFor(calls))}`;
}

/** The words of a connect problem for Zoho People; `said`: Zoho's error code (e.g. invalid_redirect_uri). */
export function zohoPeopleConnectProblemText(problem: MeetingConnectProblem, said?: string | null): string {
  const code = said && /^[a-z0-9_.-]{1,60}$/i.test(said) ? said : null;
  switch (problem) {
    case 'denied':
      return 'Zoho People wasn’t allowed to share the attendance, so nothing was connected. Try again and allow it.';
    case 'expired':
      return 'The connection took too long or was started elsewhere. Start it again from this page.';
    case 'other_user':
      return 'The connection was started by someone else. Start it again from your own account.';
    case 'no_app':
      return 'The company’s Zoho app isn’t set up yet: save its client ID, secret and data centre first.';
    case 'refused':
      return code === 'invalid_redirect_uri' || code === 'redirect_uri_mismatch'
        ? 'Zoho refused the return address: add the redirect URI shown on this page to the Zoho app’s Authorized Redirect URIs.'
        : `Zoho refused the sign-in${code ? ` (${code})` : ''}. Check the app’s settings on this page, then try again.`;
    case 'unreachable':
      return 'Zoho couldn’t be reached. Try again in a moment.';
    case 'not_allowed':
      return 'Zoho People is connected by a Super Admin, in their own session.';
    case 'no_account':
      return 'Zoho didn’t say which account signed in. Try again.';
    // a person's own connections' (25 October 2026), never the company's Zoho People: said all the same
    case 'other_account':
    case 'unchecked_account':
      return 'Zoho People is the company’s connection: sign in with the Zoho People administrator account, in your own session.';
  }
}
