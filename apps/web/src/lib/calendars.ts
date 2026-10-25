import {
  CALENDAR_ACCOUNT_LABELS,
  CALENDAR_COMPANY_NAMES,
  CALENDAR_PAGES,
  isCalendarProvider,
  isMeetingConnectProblem,
  type CalendarConnectResult,
  type CalendarConnectionView,
  type CalendarProvider,
  type CalendarTestView,
  type MeetingConnectProblem,
  type Role,
} from '@trendlix/shared';

// Calendars read for interviewers' busy times on the website (owner, 25 October 2026: "is it better for each interviewer
// to add his available interviews timeslots?"; asked, "Hours + calendar"; then "its zoho mails": Zoho Calendar first,
// Google and Microsoft beside it). Who sees Organization → Calendars (the company's Zoho app and account) and each
// person's own Interview Hours page, what the return from a calendar's sign-in says, and how a connection and its test
// read. Only busy and free is ever read: never an event's title. Pure code (no server-only), so client components, the
// return route and the tests use it.

/** Organization → Calendars (the company's) and one's own calendars, on Your Interview Hours. */
export const CALENDAR_SETTINGS_PATH = CALENDAR_PAGES.company;
export const MY_INTERVIEW_HOURS_PATH = CALENDAR_PAGES.personal;

type Viewer = { roles: readonly Role[]; developer?: boolean; viewAs?: unknown; employeeId?: string | null };

/** The company's calendar settings: a Super Admin's, never a developer's (they hold the company's Zoho app and account). */
export const seesCalendarSettings = (user: Viewer): boolean => user.roles.includes('super_admin') && !user.developer;

/**
 * Who has interview hours of their own (the brief: "anyone HR can put on a panel, and hiring managers"): an account
 * with an employee profile, never a developer's.
 */
export const hasInterviewHours = (user: Viewer): boolean => !!user.employeeId && !user.developer;

/** The user menu's "Interview hours": for those with hours of their own, in their own session. */
export const interviewHoursInMenu = (user: Viewer): boolean => hasInterviewHours(user) && !user.viewAs;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** A provider's error code as the return address may carry it: letters, digits, _ . - only, else nothing. */
const saidOf = (v: string | null | undefined): string | null => (v && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v : null);

/** Where a calendar's app is set up: Zoho's on Organization → Calendars; Google's and Microsoft's are the Meetings apps. */
const appPage = (provider: CalendarProvider): string => (provider === 'zoho' ? 'Organization → Calendars' : 'Organization → Meetings');

/** The words of a connect problem for a calendar; `said`: the provider's error code (e.g. redirect_uri_mismatch). */
export function calendarConnectProblemText(problem: MeetingConnectProblem, provider: CalendarProvider, said?: string | null): string {
  const who = CALENDAR_COMPANY_NAMES[provider];
  const code = saidOf(said);
  switch (problem) {
    case 'denied':
      return `${who} wasn’t allowed to share the busy times, so nothing was connected. Try again and allow it.`;
    case 'expired':
      return 'The connection took too long or was started elsewhere. Start it again from this page.';
    case 'other_user':
      return 'The connection was started by someone else. Start it again from your own account.';
    case 'no_app':
      return `The company’s ${who} app isn’t set up yet: a Super Admin sets it up on ${appPage(provider)}.`;
    case 'refused':
      return code === 'redirect_uri_mismatch'
        ? `${who} refused the return address: add the redirect URI shown on Organization → Calendars to the app in ${who}’s console.`
        : `${who} refused the sign-in${code ? ` (${code})` : ''}. Check the app’s settings on ${appPage(provider)}, then try again.`;
    case 'unreachable':
      return `${who} couldn’t be reached. Try again in a moment.`;
    case 'not_allowed':
      return 'Calendars are connected by the people who interview, each in their own session; the company’s by a Super Admin.';
    case 'no_account':
      return `${who} didn’t say which account signed in. Try again.`;
  }
}

/** What the page says on coming back from a calendar's sign-in: connected, or why not; null otherwise. */
export type CalendarBanner = { tone: 'ok' | 'danger'; text: string } | null;

/**
 * The banner of `?connected=zoho` or `?connect=google&problem=refused&said=invalid_client`: only known providers and
 * problems, in the system's own words (a provider's code beside, letters only), never anything else from the address.
 */
export function calendarBanner(query: Record<string, string | string[] | undefined>): CalendarBanner {
  const connected = one(query.connected);
  if (isCalendarProvider(connected)) return { tone: 'ok', text: `The ${CALENDAR_ACCOUNT_LABELS[connected]} is connected: its busy times are read from now on.` };
  const provider = one(query.connect);
  const problem = one(query.problem);
  if (isCalendarProvider(provider) && isMeetingConnectProblem(problem)) {
    return { tone: 'danger', text: calendarConnectProblemText(problem, provider, saidOf(one(query.said))) };
  }
  return null;
}

/** "Connected as hr@trendlix.com since 25/10/2026, 10:30 AM." or "Needs reconnecting: …". `when`: how the page writes a moment. */
export function calendarConnectionText(c: Pick<CalendarConnectionView, 'status' | 'accountEmail' | 'connectedAt' | 'problem'>, when: (iso: string) => string): string {
  if (c.status === 'needs_reconnecting') return `Needs reconnecting: ${c.problem ?? 'connect it again.'}`;
  return `Connected as ${c.accountEmail} since ${when(c.connectedAt)}.`;
}

/** "Last check 25/10/2026, 10:30 AM: …". */
export const calendarTestText = (t: CalendarTestView, when: (iso: string) => string): string => `Last check ${when(t.at)}: ${t.message}`;

const PAGES: string[] = Object.values(CALENDAR_PAGES);

/**
 * Where the return from a calendar's sign-in sends the person: the page it was started from (one of the two, else their
 * Interview Hours), saying connected or why not. `fallback`: the problem when the API gave no answer.
 */
export function calendarCallbackTarget(
  result: Pick<CalendarConnectResult, 'back' | 'ok' | 'problem' | 'said'> | null,
  provider: CalendarProvider,
  fallback: MeetingConnectProblem = 'unreachable',
): string {
  const back = result && PAGES.includes(result.back) ? result.back : MY_INTERVIEW_HOURS_PATH;
  if (result?.ok) return `${back}?connected=${provider}`;
  const problem = result?.problem && isMeetingConnectProblem(result.problem) ? result.problem : fallback;
  const said = saidOf(result?.said);
  return `${back}?connect=${provider}&problem=${problem}${said ? `&said=${encodeURIComponent(said)}` : ''}`;
}

/**
 * What the return address carries for the API: the code, the state, the provider's error and, for Zoho, the sign-in
 * address of the account's data centre (its `accounts-server`), each on its own line and short.
 */
export function calendarCallbackInput(params: URLSearchParams): { code?: string; state?: string; error?: string; accountsServer?: string } {
  const field = (name: string) => {
    const v = params.get(name);
    return v && v.length <= 4000 && !/[\r\n]/.test(v) ? v : undefined;
  };
  const out: { code?: string; state?: string; error?: string; accountsServer?: string } = {};
  const code = field('code');
  const state = field('state');
  const error = field('error');
  const server = field('accounts-server');
  if (code) out.code = code;
  if (state) out.state = state;
  if (error) out.error = error.slice(0, 100);
  // only an https address of Zoho's sign-in, e.g. https://accounts.zoho.eu (the API checks it against the data centres)
  if (server && /^https:\/\/accounts\.[a-z0-9.-]{3,60}$/i.test(server)) out.accountsServer = server;
  return out;
}
