// Online interview meetings made by the system (owner, 24 October 2026: "can i link an online meeting service provider
// to automatically generate meeting links? line teams - gogole meet - zoom - etc.."; asked, "Google Meet, Microsoft
// Teams, Zoom", and who hosts them, "make it both": a company account a Super Admin connects once, and each HR person's
// own account, connected by them). What this file holds:
// - the providers and their words; who hosts a meeting (the company's account, or the scheduler's own);
// - the website's return addresses (the OAuth redirect URIs the providers' consoles are given), and the exact scopes and
//   permissions asked for, so the setup page shows the same ones the API asks for;
// - "Create the meeting with": the choices a scheduler has, the company's default first, else their own;
// - the app credentials' checks, the connection problems' words, the answers the pages read.
// How it works: Google Meet is a Google Calendar event with a Meet conference on the account's primary calendar; Microsoft
// Teams a calendar event with isOnlineMeeting in the host mailbox (Calendars.ReadWrite, no Teams access policy needed);
// Zoom a scheduled meeting of the host user (a Server-to-Server OAuth app for the company's, a General app for each HR
// person's own). The meeting has no attendees at the provider: the system's own invitation (the email and its .ics) is the
// only one anybody gets, so nobody is invited twice. Pure code: the API enforces it, the web shows it. Tested in
// apps/api/src/meetings/meetings.spec.ts.

/** The providers, in the order the pages list them. */
export const MEETING_PROVIDERS = ['google', 'microsoft', 'zoom'] as const;
export type MeetingProvider = (typeof MEETING_PROVIDERS)[number];

export const isMeetingProvider = (v: unknown): v is MeetingProvider => typeof v === 'string' && (MEETING_PROVIDERS as readonly string[]).includes(v);

/** The meeting service's name, as the interview shows it. */
export const MEETING_PROVIDER_LABELS: Readonly<Record<MeetingProvider, string>> = { google: 'Google Meet', microsoft: 'Microsoft Teams', zoom: 'Zoom' };

/** Whose service it is, for "Google refused: …". */
export const MEETING_COMPANY_NAMES: Readonly<Record<MeetingProvider, string>> = { google: 'Google', microsoft: 'Microsoft', zoom: 'Zoom' };

/** The account kind each connects ("Connect a Google account"). */
export const MEETING_ACCOUNT_LABELS: Readonly<Record<MeetingProvider, string>> = { google: 'Google account', microsoft: 'Microsoft account', zoom: 'Zoom account' };

/** Who hosts a meeting: the company's account, or the scheduler's own. */
export const MEETING_OWNERS = ['company', 'personal'] as const;
export type MeetingOwner = (typeof MEETING_OWNERS)[number];

export const isMeetingOwner = (v: unknown): v is MeetingOwner => typeof v === 'string' && (MEETING_OWNERS as readonly string[]).includes(v);

/** A choice of "Create the meeting with": "company:google", "personal:zoom". */
export type MeetingChoiceKey = `${MeetingOwner}:${MeetingProvider}`;

/** "Paste a link", as before (the default when nothing is connected). */
export const MEETING_PASTE = 'link';
/** On moving an interview: keep the meeting it has (moved to the new time). */
export const MEETING_KEEP = 'keep';

export const meetingChoiceKey = (owner: MeetingOwner, provider: MeetingProvider): MeetingChoiceKey => `${owner}:${provider}`;

/** A choice's owner and provider; null for "link", "keep" or anything else. */
export function parseMeetingChoice(value: unknown): { owner: MeetingOwner; provider: MeetingProvider } | null {
  if (typeof value !== 'string') return null;
  const [owner, provider, more] = value.split(':');
  if (more !== undefined || !isMeetingOwner(owner) || !isMeetingProvider(provider)) return null;
  return { owner, provider };
}

/** Whether a value is something "Create the meeting with" may send: a choice, "link" or "keep" (or nothing). */
export const isMeetingChoiceValue = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || value === MEETING_PASTE || value === MEETING_KEEP || parseMeetingChoice(value) !== null;

/** "Company Google Meet", "My Zoom". */
export const meetingChoiceLabel = (owner: MeetingOwner, provider: MeetingProvider): string =>
  `${owner === 'company' ? 'Company' : 'My'} ${MEETING_PROVIDER_LABELS[provider]}`;

// ---------- the providers' consoles ----------

/**
 * The website's return address for each provider (the OAuth redirect URI): the page shows it with the website's own
 * origin, e.g. https://people.trendlix.com/meetings/oauth/google, for the Super Admin to paste in the provider's console.
 */
export const MEETING_CALLBACK_PATHS: Readonly<Record<MeetingProvider, string>> = {
  google: '/meetings/oauth/google',
  microsoft: '/meetings/oauth/microsoft',
  zoom: '/meetings/oauth/zoom',
};

/** The redirect URI on a website: "https://people.trendlix.com/meetings/oauth/zoom". */
export const meetingRedirectUri = (origin: string, provider: MeetingProvider): string => `${origin.replace(/\/+$/, '')}${MEETING_CALLBACK_PATHS[provider]}`;

/** The Google Cloud project the owner's OAuth client lives in (the Firebase project, as the maps key's). */
export const MEETINGS_GOOGLE_PROJECT = 'trendlix-people';

/**
 * What a Google account is asked for (the owner's brief: "the Calendar events scope only"): its calendar's events, and
 * who it is (openid email: the address the page says it is connected as). Offline access, so the system keeps a refresh
 * token. calendar.events is a "sensitive" scope: an "Internal" consent screen (Google Workspace) needs no verification.
 */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'] as const;

/** Microsoft Graph's application permission for company meetings, granted with admin consent. */
export const MICROSOFT_APPLICATION_PERMISSIONS = ['Calendars.ReadWrite'] as const;
/** Microsoft Graph's delegated permissions for each HR person's own: their calendar, who they are, a refresh token. */
export const MICROSOFT_DELEGATED_PERMISSIONS = ['Calendars.ReadWrite', 'offline_access', 'openid', 'email', 'profile'] as const;
/** The scopes a personal Microsoft sign-in asks for (the delegated permissions as OAuth scopes). */
export const MICROSOFT_SCOPES = ['openid', 'email', 'profile', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadWrite'] as const;

/** The company's Zoom Server-to-Server OAuth app's scopes (granular): make, move and delete the host's meetings. */
export const ZOOM_COMPANY_SCOPES = ['meeting:write:meeting:admin', 'meeting:update:meeting:admin', 'meeting:delete:meeting:admin'] as const;
/** The Zoom General app's (user-managed) scopes, for each HR person's own: their meetings, and who they are. */
export const ZOOM_PERSONAL_SCOPES = ['meeting:write:meeting', 'meeting:update:meeting', 'meeting:delete:meeting', 'user:read:user'] as const;

// ---------- the app credentials ----------

export const MEETING_LIMITS = { id: 200, secret: 500, email: 254 } as const;

/** What a Super Admin saves for a provider's app: empty secrets keep the saved ones. */
export interface MeetingAppInput {
  clientId: string | null;
  clientSecret?: string | null;
  /** Microsoft: the directory (tenant) ID. */
  tenantId?: string | null;
  /** Zoom: the Server-to-Server OAuth app's account ID. */
  accountId?: string | null;
  /** Zoom: the General app's client ID and secret, for each HR person's own. */
  userClientId?: string | null;
  userClientSecret?: string | null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const ZOOM_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ONE_LINE_TOKEN = /^[^\s]+$/;

const trimmed = (v: string | null | undefined): string => (typeof v === 'string' ? v.trim() : '');

/** What is wrong with a provider's app credentials, in words; empty when fine. Empty fields may be saved unfinished. */
export function meetingAppProblems(provider: MeetingProvider, input: Partial<MeetingAppInput>): string[] {
  const out: string[] = [];
  const clientId = trimmed(input.clientId);
  const secret = input.clientSecret ?? '';
  const tooLong = (v: string, max: number) => v.length > max;
  if (clientId && (tooLong(clientId, MEETING_LIMITS.id) || !ONE_LINE_TOKEN.test(clientId))) out.push('Paste the client ID on its own, without spaces.');
  if (secret && (tooLong(secret, MEETING_LIMITS.secret) || /[\r\n]/.test(secret) || !secret.trim())) out.push('Paste the client secret on one line.');
  if (provider === 'google' && clientId && !clientId.endsWith('.apps.googleusercontent.com')) {
    out.push('A Google client ID ends with .apps.googleusercontent.com: copy it from Google Cloud → APIs & Services → Credentials.');
  }
  if (provider === 'microsoft') {
    const tenant = trimmed(input.tenantId);
    if (tenant && !GUID.test(tenant) && !DOMAIN.test(tenant)) out.push('The tenant ID is the directory (tenant) ID Microsoft Entra shows, e.g. 1b2c3d4e-…, or the company’s domain.');
    if (clientId && !GUID.test(clientId)) out.push('The Microsoft client ID is the app registration’s application (client) ID, e.g. 1b2c3d4e-….');
  }
  if (provider === 'zoom') {
    const account = trimmed(input.accountId);
    if (account && !ZOOM_ID.test(account)) out.push('Paste the Zoom account ID as the Server-to-Server OAuth app’s App Credentials show it.');
    if (clientId && !ZOOM_ID.test(clientId)) out.push('Paste the Zoom client ID as the app’s App Credentials show it.');
    const userId = trimmed(input.userClientId);
    if (userId && !ZOOM_ID.test(userId)) out.push('Paste the General app’s client ID as its App Credentials show it.');
    const userSecret = input.userClientSecret ?? '';
    if (userSecret && (tooLong(userSecret, MEETING_LIMITS.secret) || /[\r\n]/.test(userSecret) || !userSecret.trim())) out.push('Paste the General app’s client secret on one line.');
  }
  if (provider !== 'microsoft' && trimmed(input.tenantId)) out.push('Only Microsoft takes a tenant ID.');
  if (provider !== 'zoom' && (trimmed(input.accountId) || trimmed(input.userClientId) || input.userClientSecret)) out.push('Only Zoom takes an account ID and a General app.');
  return out;
}

/** Whether a provider's app can host the company's meetings: Google's client; Microsoft's tenant, client and secret; Zoom's S2S app. */
export function companyAppReady(provider: MeetingProvider, app: { clientId: string | null; clientSecretSet: boolean; tenantId?: string | null; accountId?: string | null } | null): boolean {
  if (!app?.clientId || !app.clientSecretSet) return false;
  if (provider === 'microsoft') return !!app.tenantId;
  if (provider === 'zoom') return !!app.accountId;
  return true;
}

/** Whether each HR person can connect their own: Google's and Microsoft's app as for the company; Zoom's General app. */
export function personalAppReady(provider: MeetingProvider, app: { clientId: string | null; clientSecretSet: boolean; tenantId?: string | null; userClientId?: string | null; userClientSecretSet?: boolean } | null): boolean {
  if (!app) return false;
  if (provider === 'zoom') return !!app.userClientId && !!app.userClientSecretSet;
  if (!app.clientId || !app.clientSecretSet) return false;
  return provider === 'microsoft' ? !!app.tenantId : true;
}

/** How the company's account is connected: Google by signing in to it; Microsoft and Zoom by naming the host. */
export const companyConnectsBy = (provider: MeetingProvider): 'oauth' | 'host' => (provider === 'google' ? 'oauth' : 'host');

// ---------- connecting ----------

/**
 * Why connecting didn't work, as the website's return address says it (a code, never words from the address: the page
 * says these). `refused`: the provider refused the sign-in (its own error code shown beside, letters only).
 */
export const MEETING_CONNECT_PROBLEMS = ['denied', 'expired', 'other_user', 'no_app', 'refused', 'unreachable', 'not_allowed', 'no_account'] as const;
export type MeetingConnectProblem = (typeof MEETING_CONNECT_PROBLEMS)[number];

export const isMeetingConnectProblem = (v: unknown): v is MeetingConnectProblem => typeof v === 'string' && (MEETING_CONNECT_PROBLEMS as readonly string[]).includes(v);

/** The words of a connect problem; `said`: the provider's error code (e.g. redirect_uri_mismatch), letters and _ only. */
export function meetingConnectProblemText(problem: MeetingConnectProblem, provider: MeetingProvider, said?: string | null): string {
  const who = MEETING_COMPANY_NAMES[provider];
  const code = said && /^[a-z0-9_.-]{1,60}$/i.test(said) ? said : null;
  switch (problem) {
    case 'denied':
      return `${who} wasn’t allowed access, so nothing was connected. Try again and allow it.`;
    case 'expired':
      return 'The connection took too long or was started elsewhere. Start it again from this page.';
    case 'other_user':
      return 'The connection was started by someone else. Start it again from your own account.';
    case 'no_app':
      return `The company’s ${who} app isn’t set up yet: a Super Admin sets it up on Organization → Meetings.`;
    case 'refused':
      return code === 'redirect_uri_mismatch'
        ? `${who} refused the return address: add the redirect URI shown on Organization → Meetings to the app in ${who}’s console.`
        : `${who} refused the sign-in${code ? ` (${code})` : ''}. Check the app’s settings on Organization → Meetings, then try again.`;
    case 'unreachable':
      return `${who} couldn’t be reached. Try again in a moment.`;
    case 'not_allowed':
      return 'Only HR and a Super Admin connect a meetings account, each in their own session.';
    case 'no_account':
      return `${who} didn’t say which account signed in. Try again.`;
  }
}

/** How long a sign-in at the provider may take before its return is refused. */
export const MEETING_CONNECT_MINUTES = 10;

/** The pages a connection is made from, and returned to: the company's (Organization → Meetings), and one's own. */
export const MEETING_PAGES: Readonly<Record<MeetingOwner, string>> = { company: '/organization/meetings', personal: '/account/meetings' };

/** POST /meetings/oauth/start: the provider's sign-in page to send the browser to. */
export interface MeetingConnectStart {
  url: string;
}

/**
 * POST /meetings/oauth/finish: where the website returns the person (the page the connection was started from) and how
 * it went: connected, or a problem (MEETING_CONNECT_PROBLEMS) with the provider's own error code, letters only.
 */
export interface MeetingConnectResult {
  provider: MeetingProvider;
  back: string;
  ok: boolean;
  problem: MeetingConnectProblem | null;
  said: string | null;
}

// ---------- the refusals ----------

export const MEETINGS_SUPER_ADMIN_ONLY = 'Only a Super Admin can see or change the company’s meeting settings.';
export const MEETINGS_OWN_ACCOUNT = 'Switch back to your own account to see or change meeting connections.';
export const MEETINGS_SCHEDULERS_ONLY = 'Only HR and a Super Admin, who schedule interviews, connect their own meetings account.';

// ---------- the pages' answers ----------

/** A provider's app as the settings page shows it: never a secret, only whether one is saved (and readable). */
export interface MeetingAppView {
  provider: MeetingProvider;
  clientId: string | null;
  clientSecretSet: boolean;
  /** Saved, but sealed with a key the server no longer has (its JWT_SECRET changed): enter it again. */
  clientSecretUnreadable: boolean;
  tenantId: string | null;
  accountId: string | null;
  userClientId: string | null;
  userClientSecretSet: boolean;
  userClientSecretUnreadable: boolean;
  /** The company's account can be connected (or hosts): companyAppReady. */
  companyReady: boolean;
  /** HR can connect their own: personalAppReady. */
  personalReady: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export const MEETING_CONNECTION_STATUSES = ['connected', 'needs_reconnecting'] as const;
export type MeetingConnectionStatus = (typeof MEETING_CONNECTION_STATUSES)[number];

/** A test meeting's result: made and deleted, or why not, in plain words. */
export interface MeetingTestView {
  at: string;
  ok: boolean;
  message: string;
}

/** A connection: whose, as which account, since when, and whether it works. Never a token. */
export interface MeetingConnectionView {
  id: string;
  provider: MeetingProvider;
  owner: MeetingOwner;
  /** The account it is connected as (a Google account, a host mailbox, a Zoom user). */
  accountEmail: string;
  status: MeetingConnectionStatus;
  /** Why it needs reconnecting, in words. */
  problem: string | null;
  connectedAt: string;
  connectedBy: { id: string; name: string } | null;
  lastUsedAt: string | null;
  lastTest: MeetingTestView | null;
}

/** GET /meetings/settings: the three apps, the company's connections, and the default for new online interviews. */
export interface MeetingSettingsView {
  apps: MeetingAppView[];
  company: MeetingConnectionView[];
  /** The company connection new online interviews start with, or null (each scheduler's own, else a pasted link). */
  defaultChoice: MeetingChoiceKey | null;
}

/** GET /meetings/mine: for each provider, whether its app lets HR connect their own, and their connection. */
export interface MyMeetingsView {
  providers: { provider: MeetingProvider; available: boolean; connection: MeetingConnectionView | null }[];
}

/** A choice of "Create the meeting with". */
export interface MeetingChoice {
  key: MeetingChoiceKey;
  owner: MeetingOwner;
  provider: MeetingProvider;
  label: string;
}

/** GET /meetings/choices: what the scheduler may create meetings with, and which one the form starts on. */
export interface MeetingChoices {
  choices: MeetingChoice[];
  /** A choice's key, or "link" (Paste a link) when none is connected. */
  start: MeetingChoiceKey | typeof MEETING_PASTE;
}

/** A connection as the choice list weighs it. */
export interface ChoiceConnection {
  provider: MeetingProvider;
  owner: MeetingOwner;
  status: MeetingConnectionStatus;
}

/**
 * The choices a scheduler has (the brief: "the connections available to them … the company default first, else their
 * own; or Paste a link"): the company's working connections whose app can host, and their own working ones whose app
 * lets them; the company's default first, then their own, then the company's others. `viewingAs`: a Super Admin acting
 * as someone gets the company's only (their own accounts aren't the viewer's to use).
 */
export function meetingChoicesFor(input: {
  company: readonly ChoiceConnection[];
  mine: readonly ChoiceConnection[];
  companyReady: (provider: MeetingProvider) => boolean;
  personalReady: (provider: MeetingProvider) => boolean;
  defaultChoice: MeetingChoiceKey | null;
  viewingAs?: boolean;
}): MeetingChoices {
  const order = (p: MeetingProvider) => MEETING_PROVIDERS.indexOf(p);
  const company = input.company.filter((c) => c.owner === 'company' && c.status === 'connected' && input.companyReady(c.provider)).sort((a, b) => order(a.provider) - order(b.provider));
  const mine = input.viewingAs ? [] : input.mine.filter((c) => c.owner === 'personal' && c.status === 'connected' && input.personalReady(c.provider)).sort((a, b) => order(a.provider) - order(b.provider));
  const choice = (c: ChoiceConnection): MeetingChoice => ({ key: meetingChoiceKey(c.owner, c.provider), owner: c.owner, provider: c.provider, label: meetingChoiceLabel(c.owner, c.provider) });
  const defaulted = company.find((c) => meetingChoiceKey('company', c.provider) === input.defaultChoice);
  const choices = [...(defaulted ? [defaulted] : []), ...mine, ...company.filter((c) => c !== defaulted)].map(choice);
  return { choices, start: choices[0]?.key ?? MEETING_PASTE };
}

// ---------- on the interview ----------

/** The meeting an interview has (made by the system), as its pages show it. Its link is the interview's location. */
export interface InterviewMeetingView {
  provider: MeetingProvider;
  /** The company's account, or the scheduler's own; null once its connection was removed. */
  owner: MeetingOwner | null;
  /** The link to join it (hidden from developers: they could join an interview). */
  joinUrl: string | null;
}

/** What happened to an interview's meeting on a save. */
export type MeetingOutcome = 'none' | 'created' | 'updated' | 'deleted' | 'failed';

/** "Google Meet" for a link made there or pasted from there; null for a link that is none of the three. */
export function providerOfLink(link: string | null | undefined): MeetingProvider | null {
  if (!link) return null;
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === 'meet.google.com') return 'google';
  if (host === 'teams.microsoft.com' || host === 'teams.live.com' || host.endsWith('.teams.microsoft.com')) return 'microsoft';
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return 'zoom';
  return null;
}
