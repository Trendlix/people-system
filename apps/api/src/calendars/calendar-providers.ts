import {
  CALENDAR_COMPANY_NAMES,
  GOOGLE_BUSY_SCOPES,
  MICROSOFT_BUSY_SCOPES,
  ZOHO_CALENDAR_SCOPES,
  ZOHO_DATA_CENTRES,
  type CalendarProvider,
} from '@trendlix/shared';
import { MEETING_ENDPOINTS, type AppCredentials, type HttpAnswer, type HttpRequest } from '../meetings/meeting-providers.js';

// The calendars as the system talks to them (owner, 25 October 2026: "Hours + calendar"; then "its zoho mails": Zoho
// Calendar first, Google and Microsoft beside it; packages/shared calendars.ts): each one's sign-in (OAuth 2.0 with
// PKCE), its tokens, and someone's busy times between two moments. Pure code: the requests are built here and the
// answers read here; CalendarHttp sends them (and the tests fake it: never a real call). Tested in calendars.spec.ts.
// - Zoho Calendar (Zoho's docs, read 25 October 2026): the sign-in at the data centre's Zoho Accounts
//   ({accounts}/oauth/v2/auth, the scopes comma-separated, access_type=offline, prompt=consent), which comes back
//   naming the account's own data centre (`accounts-server`), where its tokens are made and refreshed; the free/busy of
//   anyone in the organization by their email: GET {calendar}/api/v1/calendars/freebusy?uemail=&sdate=&edate=, the
//   dates as yyyyMMdd'T'HHmmss with no zone said (so the range asked is a day wider each side, and the answer, in UTC,
//   cut back to it), with "Authorization: Zoho-oauthtoken …".
// - Google Calendar: freeBusy.query on the account's primary calendar (calendar.freebusy).
// - Microsoft Graph: getSchedule, for oneself (/me, delegated) or for the company's mailboxes by work email (/users/{the
//   meetings' host}, the app's own token: Calendars.ReadWrite application permission allows it). Its answer may carry an
//   event's subject and place: never read, only each item's status and times.
// Only busy and free is ever read: never a title, a place or the attendees. Tokens and secrets go in requests only:
// never in an error's words, which come from the providers' own error codes.

/** Zoho's sign-in and calendar addresses for a data centre's accounts server (the US one for anything unknown). */
export function zohoHosts(accountsServer: string | null | undefined): { accounts: string; calendar: string } {
  const s = (accountsServer ?? '').trim().replace(/\/+$/, '').toLowerCase();
  const dc = ZOHO_DATA_CENTRES.find((d) => d.accounts === s) ?? ZOHO_DATA_CENTRES[0];
  return { accounts: dc.accounts, calendar: dc.calendar };
}

export const GOOGLE_FREEBUSY_URL = `${MEETING_ENDPOINTS.google.calendar}/freeBusy`;

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } as const;
const basic = (app: AppCredentials) => `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`, 'utf8').toString('base64')}`;
const tenantOf = (app: { tenantId?: string | null }) => encodeURIComponent(app.tenantId ?? 'organizations');
const zohoAuth = (token: string) => ({ authorization: `Zoho-oauthtoken ${token}`, accept: 'application/json' });
const bearerJson = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' });

// ---------- signing in (OAuth 2.0, PKCE S256) ----------

/**
 * The provider's sign-in page: offline access (a refresh token), the busy-times scopes only, PKCE. `accounts`: Zoho's
 * accounts server to start at (the Zoho app's data centre).
 */
export function calendarAuthorizeUrl(
  provider: CalendarProvider,
  app: { clientId: string; tenantId?: string | null },
  p: { redirectUri: string; state: string; challenge: string; accounts?: string | null },
): string {
  const common = { client_id: app.clientId, redirect_uri: p.redirectUri, response_type: 'code', state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256' };
  if (provider === 'zoho') {
    const q = new URLSearchParams({ ...common, scope: ZOHO_CALENDAR_SCOPES.join(','), access_type: 'offline', prompt: 'consent' });
    return `${zohoHosts(p.accounts).accounts}/oauth/v2/auth?${q.toString()}`;
  }
  if (provider === 'google') {
    const q = new URLSearchParams({ ...common, scope: GOOGLE_BUSY_SCOPES.join(' '), access_type: 'offline', prompt: 'consent' });
    return `${MEETING_ENDPOINTS.google.authorize}?${q.toString()}`;
  }
  const q = new URLSearchParams({ ...common, scope: MICROSOFT_BUSY_SCOPES.join(' '), response_mode: 'query', prompt: 'select_account' });
  return `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/authorize?${q.toString()}`;
}

/** The sign-in's code traded for tokens (Zoho's at the accounts server the return named). */
export function calendarCodeRequest(provider: CalendarProvider, app: AppCredentials, p: { code: string; redirectUri: string; verifier: string; accounts?: string | null }): HttpRequest {
  const grant = { grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: app.clientId, client_secret: app.clientSecret, code_verifier: p.verifier };
  if (provider === 'zoho') return { method: 'POST', url: `${zohoHosts(p.accounts).accounts}/oauth/v2/token`, headers: { ...FORM }, body: form(grant) };
  if (provider === 'google') return { method: 'POST', url: MEETING_ENDPOINTS.google.token, headers: { ...FORM }, body: form(grant) };
  return { method: 'POST', url: `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/token`, headers: { ...FORM }, body: form({ ...grant, scope: MICROSOFT_BUSY_SCOPES.join(' ') }) };
}

/** A refresh token traded for a new access token (Microsoft may give a new refresh token too: kept; Zoho and Google don't). */
export function calendarRefreshRequest(provider: CalendarProvider, app: AppCredentials, refreshToken: string, accounts?: string | null): HttpRequest {
  const grant = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret };
  if (provider === 'zoho') return { method: 'POST', url: `${zohoHosts(accounts).accounts}/oauth/v2/token`, headers: { ...FORM }, body: form(grant) };
  if (provider === 'google') return { method: 'POST', url: MEETING_ENDPOINTS.google.token, headers: { ...FORM }, body: form(grant) };
  return { method: 'POST', url: `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/token`, headers: { ...FORM }, body: form({ ...grant, scope: MICROSOFT_BUSY_SCOPES.join(' ') }) };
}

/** Zoho's revocation of a refresh token on disconnecting (best effort): POST {accounts}/oauth/v2/revoke/token. */
export const zohoRevokeRequest = (app: AppCredentials, accounts: string | null | undefined, token: string): HttpRequest => ({
  method: 'POST',
  url: `${zohoHosts(accounts).accounts}/oauth/v2/revoke/token`,
  headers: { ...FORM, authorization: basic(app) },
  body: form({ token, token_type: 'refresh_token' }),
});

/** Who signed in to Zoho, when the token's ID token doesn't say: OpenID Connect's userinfo. */
export const zohoUserInfoRequest = (accounts: string | null | undefined, token: string): HttpRequest => ({
  method: 'GET',
  url: `${zohoHosts(accounts).accounts}/oauth/v2/userinfo`,
  headers: zohoAuth(token),
});

/** Tokens as a token endpoint gives them. */
export interface CalendarGrant {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds. */
  expiresIn: number;
  idToken: string | null;
  /** The scopes granted, as the provider lists them (Google's: the person may untick one). */
  scope: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** A token endpoint's answer read; a refusal thrown as the provider's problem (Zoho answers 200 with an "error"). */
export function calendarGrantOf(provider: CalendarProvider, answer: HttpAnswer | null, doing: 'connect' | 'token' = 'token'): CalendarGrant {
  if (!answer || answer.status < 200 || answer.status >= 300 || !isObject(answer.body) || !text(answer.body.access_token)) throw calendarProblemOf(provider, answer, doing);
  const b = answer.body;
  const expires = Number(b.expires_in);
  return {
    accessToken: b.access_token as string,
    refreshToken: text(b.refresh_token),
    expiresIn: Number.isFinite(expires) && expires > 0 ? expires : 3600,
    idToken: text(b.id_token),
    scope: text(b.scope),
  };
}

/** The email Zoho's userinfo names (OpenID Connect's `email`), in lower case; null when none. */
export function zohoEmailOf(answer: HttpAnswer | null): string | null {
  if (!answer || answer.status !== 200 || !isObject(answer.body)) return null;
  const email = text(answer.body.email) ?? text(answer.body.Email);
  return email && email.includes('@') ? email.trim().toLowerCase() : null;
}


// ---------- busy times ----------

/** A busy stretch, in milliseconds since 1970 (UTC); tentative: "maybe". Never anything else of the event. */
export interface BusyTime {
  start: number;
  end: number;
  tentative: boolean;
}

const DAY_MS = 86_400_000;

/** Zoho's date: yyyyMMdd'T'HHmmss, in UTC. */
export const zohoStamp = (d: Date): string => d.toISOString().slice(0, 19).replace(/[-:]/g, '');

/** Zoho's answer's time ("20170419T190000Z", or without the Z: read as UTC) as a moment; NaN when it isn't one. */
export function zohoMoment(v: unknown): number {
  const m = typeof v === 'string' ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(v) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : Number.NaN;
}

/**
 * Someone's Zoho free/busy (event based), by their email: the range asked a day wider each side (Zoho doesn't say which
 * zone sdate and edate are read in), the answer cut back to it by busyBetween.
 */
export function zohoFreeBusyRequest(accountsServer: string | null | undefined, token: string, email: string, from: Date, to: Date): HttpRequest {
  const q = new URLSearchParams({ uemail: email, sdate: zohoStamp(new Date(from.getTime() - DAY_MS)), edate: zohoStamp(new Date(to.getTime() + DAY_MS)), ftype: 'eventbased' });
  return { method: 'GET', url: `${zohoHosts(accountsServer).calendar}/api/v1/calendars/freebusy?${q.toString()}`, headers: zohoAuth(token) };
}

/** Busy times cut to [from, to), the empty and the unreadable left out, overlapping ones kept apart (the engine merges). */
function busyBetween(items: BusyTime[], from: Date, to: Date): BusyTime[] {
  const a = from.getTime();
  const b = to.getTime();
  return items
    .filter((t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start && t.start < b && t.end > a)
    .map((t) => ({ start: Math.max(t.start, a), end: Math.min(t.end, b), tentative: t.tentative }))
    .sort((x, y) => x.start - y.start);
}

/** Zoho's free/busy read: each entry's times and whether it is busy or tentative (free ones left out); a refusal thrown. */
export function zohoBusyOf(answer: HttpAnswer | null, from: Date, to: Date): BusyTime[] {
  if (!answer || answer.status !== 200 || !isObject(answer.body) || answer.body.error !== undefined || !Array.isArray(answer.body.freebusy)) throw calendarProblemOf('zoho', answer, 'busy');
  const items: BusyTime[] = [];
  for (const e of answer.body.freebusy) {
    if (!isObject(e)) continue;
    const type = typeof e.fbtype === 'string' ? e.fbtype.toLowerCase() : 'busy';
    if (type === 'free') continue;
    items.push({ start: zohoMoment(e.startTime), end: zohoMoment(e.endTime), tentative: type === 'tentative' });
  }
  return busyBetween(items, from, to);
}

/** Google's freeBusy.query on the signed-in account's primary calendar. */
export const googleFreeBusyRequest = (token: string, from: Date, to: Date): HttpRequest => ({
  method: 'POST',
  url: GOOGLE_FREEBUSY_URL,
  headers: bearerJson(token),
  body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] }),
});

/** Google's freeBusy read: the primary calendar's busy times; its errors (or a refusal) thrown. */
export function googleBusyOf(answer: HttpAnswer | null, from: Date, to: Date): BusyTime[] {
  if (!answer || answer.status !== 200 || !isObject(answer.body) || !isObject(answer.body.calendars)) throw calendarProblemOf('google', answer, 'busy');
  const primary = answer.body.calendars.primary;
  if (!isObject(primary)) throw calendarProblemOf('google', answer, 'busy');
  if (Array.isArray(primary.errors) && primary.errors.length) {
    const reason = primary.errors.map((e) => (isObject(e) ? text(e.reason) : null)).find(Boolean) ?? 'internalError';
    throw new CalendarProviderError(reason === 'notFound' ? 'refused' : 'busy', `Google couldn’t read the calendar (${reason}).`, reason);
  }
  const busy = Array.isArray(primary.busy) ? primary.busy : [];
  return busyBetween(
    busy.filter(isObject).map((b) => ({ start: Date.parse(String(b.start)), end: Date.parse(String(b.end)), tentative: false })),
    from,
    to,
  );
}

/** Graph's dateTime in UTC, without the zone (given apart). */
const graphTime = (d: Date) => d.toISOString().slice(0, 19);

/**
 * Microsoft Graph's getSchedule for up to 20 mailboxes: one's own (`host` null: /me, delegated) or, with the app's own
 * token, through the meetings' host mailbox (/users/{host}). In UTC.
 */
export function graphScheduleRequest(token: string, host: string | null, emails: readonly string[], from: Date, to: Date): HttpRequest {
  const base = host ? `${MEETING_ENDPOINTS.microsoft.graph}/users/${encodeURIComponent(host)}` : `${MEETING_ENDPOINTS.microsoft.graph}/me`;
  return {
    method: 'POST',
    url: `${base}/calendar/getSchedule`,
    headers: { ...bearerJson(token), prefer: 'outlook.timezone="UTC"' },
    body: JSON.stringify({ schedules: [...emails], startTime: { dateTime: graphTime(from), timeZone: 'UTC' }, endTime: { dateTime: graphTime(to), timeZone: 'UTC' }, availabilityViewInterval: 15 }),
  };
}

/** Graph's dateTime ("2026-10-26T08:00:00.0000000", UTC) as a moment. */
const graphMoment = (v: unknown): number => {
  if (!isObject(v) || typeof v.dateTime !== 'string') return Number.NaN;
  const zone = typeof v.timeZone === 'string' ? v.timeZone : 'UTC';
  if (zone !== 'UTC' && zone !== 'Etc/UTC' && zone !== 'Coordinated Universal Time') return Number.NaN;
  return Date.parse(`${v.dateTime.slice(0, 19)}Z`);
};

/**
 * Graph's getSchedule read, for each mailbox asked (lower case): its busy times (busy and away "oof" busy; tentative and
 * working elsewhere "maybe"; free and unknown left out), or its own error in words. Each item's subject, place and
 * privacy are never read. A refusal of the whole request thrown.
 */
export function graphBusyOf(answer: HttpAnswer | null, from: Date, to: Date): Map<string, BusyTime[] | CalendarProviderError> {
  if (!answer || answer.status !== 200 || !isObject(answer.body) || !Array.isArray(answer.body.value)) throw calendarProblemOf('microsoft', answer, 'busy');
  const out = new Map<string, BusyTime[] | CalendarProviderError>();
  for (const v of answer.body.value) {
    if (!isObject(v) || typeof v.scheduleId !== 'string') continue;
    const id = v.scheduleId.trim().toLowerCase();
    if (isObject(v.error)) {
      const code = text(v.error.responseCode);
      out.set(id, new CalendarProviderError('refused', `Microsoft couldn’t read the calendar${code ? ` (${code})` : ''}.`, code && CODE.test(code) ? code : null));
      continue;
    }
    const items = Array.isArray(v.scheduleItems) ? v.scheduleItems : [];
    const busy: BusyTime[] = [];
    for (const item of items) {
      if (!isObject(item)) continue;
      const status = typeof item.status === 'string' ? item.status : 'busy';
      if (status === 'free' || status === 'unknown') continue;
      busy.push({ start: graphMoment(item.start), end: graphMoment(item.end), tentative: status === 'tentative' || status === 'workingElsewhere' });
    }
    out.set(id, busyBetween(busy, from, to));
  }
  return out;
}

// ---------- what went wrong, in words ----------

/**
 * Why a calendar refused, as a kind and plain words:
 * - reconnect: the connection's sign-in is gone (revoked, expired, a scope taken away): its owner connects it again;
 * - app: the app or its setup (the client ID or secret, the return address, a permission): a Super Admin fixes it;
 * - token: the access token was refused (401): refreshed and tried once more;
 * - busy, unreachable: try again later; refused: anything else, with the provider's own words.
 */
export type CalendarProblemKind = 'reconnect' | 'app' | 'token' | 'busy' | 'unreachable' | 'refused';

export class CalendarProviderError extends Error {
  constructor(
    readonly kind: CalendarProblemKind,
    message: string,
    /** The provider's own error code, letters only (e.g. invalid_code, INVALID_OAUTHTOKEN), for the page and the log. */
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

const CODE = /^[A-Za-z0-9_.:-]{1,60}$/;

/** The provider's words on one line, short. */
function said(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const line = v
    .replace(/\s*Trace ID:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return line ? (line.length > 200 ? `${line.slice(0, 199)}…` : line) : null;
}

/**
 * A calendar's refusal (or no answer: `answer` null) in plain words, "Zoho refused: …", with its kind. Built from the
 * provider's error codes and descriptions, never from the request (so never a token or a secret). `doing`: signing in
 * (connect), a token (refresh), or reading busy times.
 */
export function calendarProblemOf(provider: CalendarProvider, answer: HttpAnswer | null, doing: 'connect' | 'token' | 'busy'): CalendarProviderError {
  const who = CALENDAR_COMPANY_NAMES[provider];
  if (!answer) return new CalendarProviderError('unreachable', `${who} couldn’t be reached in time. Try again in a moment.`);
  const status = answer.status;
  const b = isObject(answer.body) ? answer.body : {};
  // OAuth's { error, error_description }; Zoho's API { error: [{ error_code, description }] }; Google's and Graph's
  // { error: { code, message, status, errors: [{ reason }] } }
  const oauth = typeof b.error === 'string' ? b.error : null;
  const zohoApi = Array.isArray(b.error) && isObject(b.error[0]) ? b.error[0] : null;
  const nested = isObject(b.error) ? b.error : null;
  const description = said(b.error_description) ?? said(zohoApi?.description) ?? said(nested?.message) ?? said(b.message);
  const apiCode = text(zohoApi?.error_code) ?? (typeof nested?.code === 'string' ? nested.code : null);
  const reasons = Array.isArray(nested?.errors) ? nested.errors.map((e) => (isObject(e) ? e.reason : null)).filter((r): r is string => typeof r === 'string') : [];
  const words = `${description ?? ''} ${reasons.join(' ')} ${typeof nested?.status === 'string' ? nested.status : ''} ${apiCode ?? ''}`;
  const err = (kind: CalendarProblemKind, message: string, code: string | null = oauth ?? apiCode) => new CalendarProviderError(kind, message, code && CODE.test(code) ? code : null);
  const page = provider === 'zoho' ? 'Organization → Calendars' : 'Organization → Meetings';

  // the sign-in and the tokens (OAuth's own errors; Zoho answers them with 200)
  if (oauth === 'invalid_code' || oauth === 'invalid_grant') {
    if (doing === 'connect') return err('refused', `${who} refused the sign-in: it took too long or was used already. Connect again.`);
    return err('reconnect', `${who} says the connection was revoked or has expired: connect the account again.`);
  }
  if (oauth === 'invalid_client' || oauth === 'invalid_client_secret' || oauth === 'unauthorized_client') return err('app', `${who} refused the app’s client ID or secret: a Super Admin checks them on ${page}.`);
  if (oauth === 'invalid_redirect_uri' || oauth === 'redirect_uri_mismatch') return err('app', `${who} refused the return address: add the redirect URI shown on ${page} to the app.`, oauth);
  if (oauth === 'invalid_scope') return err('app', `${who} refused the permissions asked for: check the app’s scopes.`);
  if (oauth && /access denied/i.test(oauth)) return err('busy', `${who} is busy right now (too many sign-ins in a short time): try again in a few minutes.`, 'access_denied');
  if (oauth) return err('refused', `${who} refused: ${description ?? oauth}.`.replace(/\.\.$/, '.'));

  if (status === 401 || /INVALID_OAUTHTOKEN/i.test(apiCode ?? '')) return err('token', `${who} refused the connection’s sign-in: connect the account again.`);
  if (status === 403) {
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(words)) return err('reconnect', `${who} refused: the account didn’t allow its busy times. Connect it again and allow them.`);
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(words)) return err('app', 'Google refused: the Google Calendar API isn’t turned on in the Google Cloud project. Turn it on in APIs & Services → Library.');
    if (provider === 'microsoft' && /ErrorAccessDenied|Authorization_RequestDenied|AccessDenied/i.test(words)) {
      return err('app', 'Microsoft refused access to the calendars: grant Calendars.ReadBasic (or Calendars.ReadWrite) with admin consent.');
    }
    return err('refused', `${who} refused: ${description ?? 'access denied'}.`.replace(/\.\.$/, '.'));
  }
  if (status === 429 || status >= 500) return err('busy', `${who} is busy right now${description ? ` (${description})` : ''}: try again in a moment.`);
  return err('refused', `${who} refused: ${description ?? `the request (${status})`}.`.replace(/\.\.$/, '.'));
}
