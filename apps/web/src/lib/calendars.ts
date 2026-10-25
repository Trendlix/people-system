import {
  CALENDAR_ACCOUNT_LABELS,
  CALENDAR_COMPANY_NAMES,
  CALENDAR_PAGES,
  isCalendarProvider,
  isMaskedEmail,
  isMeetingConnectProblem,
  otherAccountText,
  uncheckedAccountText,
  type ConnectAbout,
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

/**
 * The user menu's "Interview hours": for those with hours of their own; while a Super Admin views as them too (owner, 25
 * October 2026: "i need to be able to set it up on behalf of the employee, by acting as them"), the page read only until
 * Act as them is on.
 */
export const interviewHoursInMenu = (user: Viewer): boolean => hasInterviewHours(user);

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** A provider's error code as the return address may carry it: letters, digits, _ . - only, else nothing. */
const saidOf = (v: string | null | undefined): string | null => (v && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v : null);

/** Where a calendar's app is set up: Zoho's on Organization → Calendars; Google's and Microsoft's are the Meetings apps. */
const appPage = (provider: CalendarProvider): string => (provider === 'zoho' ? 'Organization → Calendars' : 'Organization → Meetings');

/**
 * The words of a connect problem for a calendar; `said`: the provider's error code (e.g. redirect_uri_mismatch); `about`:
 * whose account it was (the masked email, the person acted as), for `other_account` and `unchecked_account`.
 */
export function calendarConnectProblemText(problem: MeetingConnectProblem, provider: CalendarProvider, said?: string | null, about?: ConnectAbout): string {
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
      return 'Calendars are connected by the people who interview, in their own session or by a Super Admin acting as them with Act as them on; the company’s by a Super Admin in their own session.';
    case 'no_account':
      return `${who} didn’t say which account signed in. Try again.`;
    case 'other_account':
      return otherAccountText(who, about);
    case 'unchecked_account':
      return uncheckedAccountText(who, about);
  }
}

/** What the page says on coming back from a calendar's sign-in: connected, or why not; null otherwise. */
export type CalendarBanner = { tone: 'ok' | 'danger'; text: string } | null;

/**
 * The banner of `?connected=zoho` or `?connect=google&problem=refused&said=invalid_client`: only known providers and
 * problems, in the system's own words (a provider's code beside, letters only; an account refused as not the person's,
 * its masked email only), never anything else from the address. `actingFor`: the name of whom a Super Admin acts as, or
 * null in one's own session. One's own Zoho connected without its email said (`said=no_email`): connected, and said so.
 */
export function calendarBanner(query: Record<string, string | string[] | undefined>, actingFor: string | null = null): CalendarBanner {
  const connected = one(query.connected);
  if (isCalendarProvider(connected)) {
    if (one(query.said) === 'no_email') {
      return {
        tone: 'ok',
        text: `The ${CALENDAR_ACCOUNT_LABELS[connected]} is connected, but ${CALENDAR_COMPANY_NAMES[connected]} didn’t say which account signed in: its busy times are read for the email shown below. Check the busy times to be sure it’s your calendar.`,
      };
    }
    return { tone: 'ok', text: `The ${CALENDAR_ACCOUNT_LABELS[connected]} is connected: its busy times are read from now on.` };
  }
  const provider = one(query.connect);
  const problem = one(query.problem);
  if (isCalendarProvider(provider) && isMeetingConnectProblem(problem)) {
    const account = one(query.account);
    return { tone: 'danger', text: calendarConnectProblemText(problem, provider, saidOf(one(query.said)), { account: isMaskedEmail(account) ? account : null, person: actingFor }) };
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
 * Interview Hours), saying connected or why not (an account refused as not theirs with its masked email, the only email
 * the address ever carries). `fallback`: the problem when the API gave no answer.
 */
export function calendarCallbackTarget(
  result: Pick<CalendarConnectResult, 'back' | 'ok' | 'problem' | 'said' | 'account'> | null,
  provider: CalendarProvider,
  fallback: MeetingConnectProblem = 'unreachable',
): string {
  const back = result && PAGES.includes(result.back) ? result.back : MY_INTERVIEW_HOURS_PATH;
  if (result?.ok) return `${back}?connected=${provider}${result.said === 'no_email' ? '&said=no_email' : ''}`;
  const problem = result?.problem && isMeetingConnectProblem(result.problem) ? result.problem : fallback;
  const said = saidOf(result?.said);
  const account = problem === 'other_account' && result && isMaskedEmail(result.account) ? result.account : null;
  return `${back}?connect=${provider}&problem=${problem}${said ? `&said=${encodeURIComponent(said)}` : ''}${account ? `&account=${encodeURIComponent(account)}` : ''}`;
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
