import {
  isMeetingConnectProblem,
  isMeetingProvider,
  MEETING_ACCOUNT_LABELS,
  MEETING_PAGES,
  meetingConnectProblemText,
  type MeetingConnectProblem,
  type MeetingConnectResult,
  type MeetingConnectionView,
  type MeetingProvider,
  type MeetingTestView,
  type Role,
} from '@trendlix/shared';

// Online interview meetings on the website (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links? line teams - gogole meet - zoom - etc.."; asked, "Google Meet, Microsoft Teams,
// Zoom", and "make it both": a company account a Super Admin connects once on Organization → Meetings, and each HR
// person's own on Your Meetings). Who sees the two pages, what the return from a provider's sign-in says, and how a
// connection and its test read. Pure code (no server-only), so client components, the return route and the tests use it.

/** Organization → Meetings (the company's) and Your Meetings (one's own). */
export const MEETING_SETTINGS_PATH = MEETING_PAGES.company;
export const MY_MEETINGS_PATH = MEETING_PAGES.personal;

type Viewer = { roles: readonly Role[]; developer?: boolean; viewAs?: unknown };

/** The company's meeting settings: a Super Admin's, never a developer's (they hold the apps and the host accounts). */
export const seesMeetingSettings = (user: Viewer): boolean => user.roles.includes('super_admin') && !user.developer;

/** Who connects their own meetings account: those who schedule interviews, HR and a Super Admin; never a developer. */
export const connectsOwnMeetings = (user: Viewer): boolean => (user.roles.includes('hr') || user.roles.includes('super_admin')) && !user.developer;

/** The user menu's "Meetings": for those who connect their own, in their own session. */
export const meetingsInMenu = (user: Viewer): boolean => connectsOwnMeetings(user) && !user.viewAs;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

/** A provider's error code as the return address may carry it: letters, digits, _ . - only, else nothing. */
const saidOf = (v: string | null | undefined): string | null => (v && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v : null);

/** What the page says on coming back from a provider's sign-in: connected, or why not; null otherwise. */
export type MeetingBanner = { tone: 'ok' | 'danger'; text: string } | null;

/**
 * The banner of `?connected=google` or `?connect=zoom&problem=refused&said=invalid_client`: only known providers and
 * problems, in the system's own words (a provider's code beside, letters only), never anything else from the address.
 */
export function meetingBanner(query: Record<string, string | string[] | undefined>): MeetingBanner {
  const connected = one(query.connected);
  if (isMeetingProvider(connected)) return { tone: 'ok', text: `The ${MEETING_ACCOUNT_LABELS[connected]} is connected.` };
  const provider = one(query.connect);
  const problem = one(query.problem);
  if (isMeetingProvider(provider) && isMeetingConnectProblem(problem)) {
    return { tone: 'danger', text: meetingConnectProblemText(problem, provider, saidOf(one(query.said))) };
  }
  return null;
}

/** "Connected as hr@trendlix.com since 24/10/2026, 10:30 AM." or "Needs reconnecting: …". `when`: how the page writes a moment. */
export function connectionText(c: Pick<MeetingConnectionView, 'status' | 'accountEmail' | 'connectedAt' | 'problem'>, when: (iso: string) => string): string {
  if (c.status === 'needs_reconnecting') return `Needs reconnecting: ${c.problem ?? 'connect it again.'}`;
  return `Connected as ${c.accountEmail} since ${when(c.connectedAt)}.`;
}

/** "Last test 24/10/2026, 10:30 AM: …". */
export const meetingTestText = (t: MeetingTestView, when: (iso: string) => string): string => `Last test ${when(t.at)}: ${t.message}`;

const PAGES = Object.values(MEETING_PAGES);

/**
 * Where the return from a provider's sign-in sends the person: the page it was started from (one of the two, else Your
 * Meetings), saying connected or why not. `fallback`: the problem when the API gave no answer.
 */
export function callbackTarget(result: Pick<MeetingConnectResult, 'back' | 'ok' | 'problem' | 'said'> | null, provider: MeetingProvider, fallback: MeetingConnectProblem = 'unreachable'): string {
  const back = result && PAGES.includes(result.back) ? result.back : MY_MEETINGS_PATH;
  if (result?.ok) return `${back}?connected=${provider}`;
  const problem = result?.problem && isMeetingConnectProblem(result.problem) ? result.problem : fallback;
  const said = saidOf(result?.said);
  return `${back}?connect=${provider}&problem=${problem}${said ? `&said=${encodeURIComponent(said)}` : ''}`;
}

/** What the return address carries for the API: the code, the state and the provider's error, each on its own line and short. */
export function callbackInput(params: URLSearchParams): { code?: string; state?: string; error?: string } {
  const field = (name: string) => {
    const v = params.get(name);
    return v && v.length <= 4000 && !/[\r\n]/.test(v) ? v : undefined;
  };
  const out: { code?: string; state?: string; error?: string } = {};
  const code = field('code');
  const state = field('state');
  const error = field('error');
  if (code) out.code = code;
  if (state) out.state = state;
  if (error) out.error = error.slice(0, 100);
  return out;
}
