// Calendars read for interviewers' busy times (owner, 25 October 2026: "is it better for each interviewer to add his
// available interviews timeslots?"; asked, "Hours + calendar": weekly interview hours, with leave, booked interviews and,
// when connected, calendar busy times taken away; then "its zoho mails": the company's mail and calendars are Zoho's, so
// Zoho Calendar is the main source, Google and Microsoft stay as secondary ones). What this file holds:
// - the providers and their words; Zoho's data centres (each one's sign-in and calendar addresses);
// - the website's return addresses (the OAuth redirect URIs) and the exact scopes asked for, so the setup page shows the
//   same ones the API asks for;
// - the answers the pages read: the company's Zoho app and connection (Organization → Calendars, a Super Admin's), each
//   person's own connections (their Interview Hours page), never a token or a secret.
// Only busy and free is ever read: never an event's title, place or attendees. Pure code: the API enforces it, the web
// shows it. Tested in apps/api/src/calendars/calendars.spec.ts.

import type { MeetingConnectProblem, MeetingConnectionStatus, MeetingOwner } from './meetings.js';

/** The calendars busy times are read from, Zoho first (the company's). */
export const CALENDAR_PROVIDERS = ['zoho', 'google', 'microsoft'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

export const isCalendarProvider = (v: unknown): v is CalendarProvider => typeof v === 'string' && (CALENDAR_PROVIDERS as readonly string[]).includes(v);

export const CALENDAR_PROVIDER_LABELS: Readonly<Record<CalendarProvider, string>> = { zoho: 'Zoho Calendar', google: 'Google Calendar', microsoft: 'Outlook Calendar' };

/** Whose service it is, for "Zoho refused: …". */
export const CALENDAR_COMPANY_NAMES: Readonly<Record<CalendarProvider, string>> = { zoho: 'Zoho', google: 'Google', microsoft: 'Microsoft' };

/** The account kind each connects ("Connect my Zoho account"). */
export const CALENDAR_ACCOUNT_LABELS: Readonly<Record<CalendarProvider, string>> = { zoho: 'Zoho account', google: 'Google account', microsoft: 'Microsoft account' };

// ---------- Zoho's data centres ----------

/**
 * Zoho's data centres (Zoho Accounts' multi-DC list, 25 October 2026: https://www.zoho.com/accounts/protocol/oauth/multi-dc.html),
 * each with its sign-in address and its Zoho Calendar address (the sign-in's "accounts." becomes "calendar."; Canada's
 * is zohocloud.ca). An account lives in one: the sign-in comes back saying which (`accounts-server`), and every call for
 * it goes there.
 */
export const ZOHO_DATA_CENTRES = [
  { key: 'com', label: 'United States (zoho.com)', accounts: 'https://accounts.zoho.com', calendar: 'https://calendar.zoho.com' },
  { key: 'eu', label: 'Europe (zoho.eu)', accounts: 'https://accounts.zoho.eu', calendar: 'https://calendar.zoho.eu' },
  { key: 'in', label: 'India (zoho.in)', accounts: 'https://accounts.zoho.in', calendar: 'https://calendar.zoho.in' },
  { key: 'com.au', label: 'Australia (zoho.com.au)', accounts: 'https://accounts.zoho.com.au', calendar: 'https://calendar.zoho.com.au' },
  { key: 'jp', label: 'Japan (zoho.jp)', accounts: 'https://accounts.zoho.jp', calendar: 'https://calendar.zoho.jp' },
  { key: 'ca', label: 'Canada (zohocloud.ca)', accounts: 'https://accounts.zohocloud.ca', calendar: 'https://calendar.zohocloud.ca' },
  { key: 'sa', label: 'Saudi Arabia (zoho.sa)', accounts: 'https://accounts.zoho.sa', calendar: 'https://calendar.zoho.sa' },
  { key: 'uk', label: 'United Kingdom (zoho.uk)', accounts: 'https://accounts.zoho.uk', calendar: 'https://calendar.zoho.uk' },
  { key: 'ae', label: 'United Arab Emirates (zoho.ae)', accounts: 'https://accounts.zoho.ae', calendar: 'https://calendar.zoho.ae' },
  { key: 'sg', label: 'Singapore (zoho.sg)', accounts: 'https://accounts.zoho.sg', calendar: 'https://calendar.zoho.sg' },
] as const;

export type ZohoDataCentre = (typeof ZOHO_DATA_CENTRES)[number]['key'];

export const isZohoDataCentre = (v: unknown): v is ZohoDataCentre => typeof v === 'string' && ZOHO_DATA_CENTRES.some((d) => d.key === v);

/** A data centre's addresses (the US one for anything unknown). */
export const zohoDataCentre = (key: string | null | undefined) => ZOHO_DATA_CENTRES.find((d) => d.key === key) ?? ZOHO_DATA_CENTRES[0];

/** The data centre a sign-in address is (Zoho's `accounts-server` on the return); null for one that isn't Zoho's. */
export const zohoDataCentreOfAccounts = (server: string | null | undefined): ZohoDataCentre | null => {
  const s = (server ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return ZOHO_DATA_CENTRES.find((d) => d.accounts === s)?.key ?? null;
};

// ---------- the providers' consoles ----------

/** The website's return address for each provider's sign-in (the OAuth redirect URI each console is given). */
export const CALENDAR_CALLBACK_PATHS: Readonly<Record<CalendarProvider, string>> = {
  zoho: '/calendars/oauth/zoho',
  google: '/calendars/oauth/google',
  microsoft: '/calendars/oauth/microsoft',
};

/** The redirect URI on a website: "https://people.trendlix.com/calendars/oauth/zoho". */
export const calendarRedirectUri = (origin: string, provider: CalendarProvider): string => `${origin.replace(/\/+$/, '')}${CALENDAR_CALLBACK_PATHS[provider]}`;

/**
 * What a Zoho account is asked for: its free/busy only (Zoho Calendar's `ZohoCalendar.freebusy.READ`, the least the
 * free/busy API takes), and who it is (OpenID Connect's `email`: the address the page says it is connected as). Zoho
 * separates scopes with commas. Offline access, so the system keeps a refresh token.
 */
export const ZOHO_CALENDAR_SCOPES = ['ZohoCalendar.freebusy.READ', 'email'] as const;

/**
 * Google's free/busy scope for a calendar connected for busy times only (Google's freebusy.query accepts
 * calendar.freebusy, "View your availability in your calendars"), and who it is. Also asked by HR's own Google Meet
 * connection since 25 October 2026 (meetings.ts GOOGLE_SCOPES), so it shares their busy times too.
 */
export const GOOGLE_FREEBUSY_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
export const GOOGLE_BUSY_SCOPES = ['openid', 'email', GOOGLE_FREEBUSY_SCOPE] as const;

/**
 * Microsoft Graph's delegated permission for a calendar connected for busy times only: Calendars.ReadBasic, the least
 * getSchedule takes (no subjects or bodies read), and who it is, with a refresh token.
 */
export const MICROSOFT_BUSY_PERMISSIONS = ['Calendars.ReadBasic', 'offline_access', 'openid', 'email', 'profile'] as const;
export const MICROSOFT_BUSY_SCOPES = ['openid', 'email', 'profile', 'offline_access', 'https://graph.microsoft.com/Calendars.ReadBasic'] as const;

// ---------- the pages ----------

/** Organization → Calendars (the company's Zoho), and each person's own (their Interview Hours page). */
export const CALENDAR_PAGES: Readonly<Record<MeetingOwner, string>> = { company: '/organization/calendars', personal: '/account/interview-hours' };

export const CALENDARS_SUPER_ADMIN_ONLY = 'Only a Super Admin can see or change the company’s calendar settings.';
export const CALENDARS_OWN_ACCOUNT = 'Switch back to your own account to see or change calendar connections.';
export const CALENDARS_EMPLOYEES_ONLY = 'Calendars are connected by the people who interview: an account with an employee profile.';

export const CALENDAR_LIMITS = { id: 200, secret: 500, email: 254 } as const;

/** What is wrong with the Zoho app's credentials, in words; empty when fine (empty fields may be saved unfinished). */
export function calendarAppProblems(input: { clientId?: string | null; clientSecret?: string | null; dataCentre?: string | null }): string[] {
  const out: string[] = [];
  const clientId = typeof input.clientId === 'string' ? input.clientId.trim() : '';
  const secret = input.clientSecret ?? '';
  if (clientId && (clientId.length > CALENDAR_LIMITS.id || !/^1000\.[A-Z0-9]{10,60}$/i.test(clientId))) out.push('A Zoho client ID looks like 1000.ABC123…: copy it from api-console.zoho.com → your app → Client Secret.');
  if (secret && (secret.length > CALENDAR_LIMITS.secret || /[\r\n\s]/.test(secret))) out.push('Paste the client secret on one line, without spaces.');
  if (input.dataCentre !== undefined && input.dataCentre !== null && !isZohoDataCentre(input.dataCentre)) out.push('Choose the data centre the company’s Zoho account is in.');
  return out;
}

/** Whether the Zoho app can sign in: its client ID, its secret and the data centre. */
export const zohoAppReady = (app: { clientId: string | null; clientSecretSet: boolean; dataCentre: string | null } | null): boolean => !!app?.clientId && !!app.clientSecretSet && isZohoDataCentre(app.dataCentre);

/** The Zoho app as the settings page shows it: never the secret, only whether one is saved (and readable). */
export interface CalendarAppView {
  provider: 'zoho';
  clientId: string | null;
  clientSecretSet: boolean;
  /** Saved, but sealed with a key the server no longer has (its JWT_SECRET changed): enter it again. */
  clientSecretUnreadable: boolean;
  dataCentre: ZohoDataCentre | null;
  ready: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** A calendar's last test: busy times read (never what they are), or why not, in plain words. */
export interface CalendarTestView {
  at: string;
  ok: boolean;
  message: string;
}

/** A calendar connection: whose, as which account, since when, and whether it works. Never a token. */
export interface CalendarConnectionView {
  id: string;
  provider: CalendarProvider;
  owner: MeetingOwner;
  accountEmail: string;
  status: MeetingConnectionStatus;
  problem: string | null;
  connectedAt: string;
  connectedBy: { id: string; name: string } | null;
  lastTest: CalendarTestView | null;
}

/** GET /calendars/settings: the Zoho app and the company's Zoho connection. */
export interface CalendarSettingsView {
  zoho: CalendarAppView;
  company: CalendarConnectionView | null;
}

/** GET /calendars/mine: the person's own connections, and what reads their busy times without one. */
export interface MyCalendarsView {
  providers: { provider: CalendarProvider; available: boolean; connection: CalendarConnectionView | null }[];
  /** The company's Zoho connection reads their busy times by their work email: nobody needs to connect anything. */
  companyZoho: boolean;
  /** The company's Microsoft 365 meetings app reads them too (its application permission), by their work email. */
  companyMicrosoft: boolean;
  workEmail: string | null;
  /** HR's own meetings connections (Your Meetings): whether each shares their busy times (Google: reconnect to). */
  meetings: { provider: 'google' | 'microsoft'; busyTimes: boolean }[];
}

/** POST /calendars/oauth/start. */
export interface CalendarConnectStart {
  url: string;
}

/** POST /calendars/oauth/finish: where to return the person, and how it went (meetings.ts's problems' codes). */
export interface CalendarConnectResult {
  provider: CalendarProvider;
  back: string;
  ok: boolean;
  problem: MeetingConnectProblem | null;
  said: string | null;
}
