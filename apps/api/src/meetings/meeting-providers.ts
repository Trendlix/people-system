import { createHash, randomBytes } from 'node:crypto';
import { GOOGLE_SCOPES, MEETING_COMPANY_NAMES, MICROSOFT_SCOPES, type MeetingProvider } from '@trendlix/shared';

// The three meeting services as the system talks to them (owner, 24 October 2026: "Google Meet, Microsoft Teams, Zoom";
// packages/shared meetings.ts): each one's sign-in (OAuth 2.0 with PKCE), its tokens, and a meeting made, moved and
// deleted. Pure code: the requests are built here and the answers read here; MeetingHttp sends them (and the tests fake
// it: never a real call). Tested in meetings.spec.ts.
// - Google Meet: a Google Calendar event on the account's primary calendar with a Meet conference (conferenceData
//   createRequest, conferenceDataVersion=1), sendUpdates=none.
// - Microsoft Teams: an event in the host's calendar with isOnlineMeeting (teamsForBusiness), by Microsoft Graph: the
//   company's mailbox with the app's own token (client credentials, application permission Calendars.ReadWrite: no Teams
//   application access policy needed, which /onlineMeetings would), each HR person's own by their sign-in (delegated).
// - Zoom: a scheduled meeting of the host user: the company's with the Server-to-Server OAuth app's token (account
//   credentials), each HR person's own by their sign-in to the General app. Join before host on and no waiting room, so
//   the interviewers and the candidate get in without the host; the passcode is in the link.
// No attendees at the provider (the system's own invitation and .ics are the only ones: nobody is invited twice). Tokens
// and secrets go in requests only: never in an error's words, which come from the provider's own error codes.

/** A request to a provider, as MeetingHttp sends it. Its headers and body may hold a secret: never logged. */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** A provider's answer: its status and its JSON (null when none or not JSON). */
export interface HttpAnswer {
  status: number;
  body: unknown;
}

/** The providers' addresses. */
export const MEETING_ENDPOINTS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    calendar: 'https://www.googleapis.com/calendar/v3',
  },
  microsoft: { login: 'https://login.microsoftonline.com', graph: 'https://graph.microsoft.com/v1.0' },
  zoom: { oauth: 'https://zoom.us/oauth', api: 'https://api.zoom.us/v2' },
} as const;

/** A provider's app, its secret opened: only to call the provider. */
export interface AppCredentials {
  clientId: string;
  clientSecret: string;
  /** Microsoft. */
  tenantId?: string | null;
  /** Zoom's Server-to-Server OAuth app. */
  accountId?: string | null;
}

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } as const;
const JSON_HEADERS = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' });
const basic = (app: AppCredentials) => `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`, 'utf8').toString('base64')}`;
const tenantOf = (app: { tenantId?: string | null }) => encodeURIComponent(app.tenantId ?? 'organizations');

// ---------- signing in (OAuth 2.0, PKCE S256) ----------

/** A PKCE pair: the verifier kept (sealed in the state), its S256 challenge sent. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** The provider's sign-in page for a person: offline access (a refresh token), the scopes the page lists, PKCE. */
export function authorizeUrl(provider: MeetingProvider, app: { clientId: string; tenantId?: string | null }, p: { redirectUri: string; state: string; challenge: string }): string {
  const common = { client_id: app.clientId, redirect_uri: p.redirectUri, response_type: 'code', state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256' };
  if (provider === 'google') {
    // consent every time, so Google gives a refresh token again when an account is connected again
    const q = new URLSearchParams({ ...common, scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent' });
    return `${MEETING_ENDPOINTS.google.authorize}?${q.toString()}`;
  }
  if (provider === 'microsoft') {
    const q = new URLSearchParams({ ...common, scope: MICROSOFT_SCOPES.join(' '), response_mode: 'query', prompt: 'select_account' });
    return `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/authorize?${q.toString()}`;
  }
  // Zoom: the General app's scopes are set on the app itself
  return `${MEETING_ENDPOINTS.zoom.oauth}/authorize?${new URLSearchParams(common).toString()}`;
}

/** The sign-in's code traded for tokens. */
export function codeTokenRequest(provider: MeetingProvider, app: AppCredentials, p: { code: string; redirectUri: string; verifier: string }): HttpRequest {
  if (provider === 'google') {
    return {
      method: 'POST',
      url: MEETING_ENDPOINTS.google.token,
      headers: { ...FORM },
      body: form({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: app.clientId, client_secret: app.clientSecret, code_verifier: p.verifier }),
    };
  }
  if (provider === 'microsoft') {
    return {
      method: 'POST',
      url: `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/token`,
      headers: { ...FORM },
      body: form({
        grant_type: 'authorization_code',
        code: p.code,
        redirect_uri: p.redirectUri,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code_verifier: p.verifier,
        scope: MICROSOFT_SCOPES.join(' '),
      }),
    };
  }
  return {
    method: 'POST',
    url: `${MEETING_ENDPOINTS.zoom.oauth}/token`,
    headers: { ...FORM, authorization: basic(app) },
    body: form({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier }),
  };
}

/** A refresh token traded for a new access token (Microsoft and Zoom may give a new refresh token too: kept). */
export function refreshRequest(provider: MeetingProvider, app: AppCredentials, refreshToken: string): HttpRequest {
  if (provider === 'google') {
    return { method: 'POST', url: MEETING_ENDPOINTS.google.token, headers: { ...FORM }, body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret }) };
  }
  if (provider === 'microsoft') {
    return {
      method: 'POST',
      url: `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/token`,
      headers: { ...FORM },
      body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret, scope: MICROSOFT_SCOPES.join(' ') }),
    };
  }
  return { method: 'POST', url: `${MEETING_ENDPOINTS.zoom.oauth}/token`, headers: { ...FORM, authorization: basic(app) }, body: form({ grant_type: 'refresh_token', refresh_token: refreshToken }) };
}

/** The app's own token, for the company's host: Microsoft's client credentials, Zoom's account credentials. */
export function appTokenRequest(provider: 'microsoft' | 'zoom', app: AppCredentials): HttpRequest {
  if (provider === 'microsoft') {
    return {
      method: 'POST',
      url: `${MEETING_ENDPOINTS.microsoft.login}/${tenantOf(app)}/oauth2/v2.0/token`,
      headers: { ...FORM },
      body: form({ grant_type: 'client_credentials', client_id: app.clientId, client_secret: app.clientSecret, scope: 'https://graph.microsoft.com/.default' }),
    };
  }
  const q = new URLSearchParams({ grant_type: 'account_credentials', account_id: app.accountId ?? '' });
  return { method: 'POST', url: `${MEETING_ENDPOINTS.zoom.oauth}/token?${q.toString()}`, headers: { ...FORM, authorization: basic(app) } };
}

/** Tokens as a token endpoint gives them. */
export interface TokenGrant {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds. */
  expiresIn: number;
  idToken: string | null;
  /** The scopes granted, as the provider lists them (Google: the person may untick one). */
  scope: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** A token endpoint's answer read; a refusal thrown as the provider's problem. */
export function tokenGrantOf(provider: MeetingProvider, answer: HttpAnswer | null): TokenGrant {
  if (!answer || answer.status < 200 || answer.status >= 300 || !isObject(answer.body) || !text(answer.body.access_token)) throw problemOf(provider, answer, 'token');
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

/**
 * The address an ID token names (Google's email; Microsoft's email, else its preferred_username), in lower case; null
 * when it names none. Read without checking its signature: it came straight from the provider's token endpoint over TLS
 * (OpenID Connect Core §3.1.3.7), never from the browser.
 */
export function emailOfIdToken(idToken: string | null | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const email = text(claims.email) ?? text(claims.preferred_username) ?? text(claims.upn);
    return email && email.includes('@') ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Whether Google's granted scopes include the calendar's events (the person may untick it on Google's page). */
export const grantsGoogleCalendar = (scope: string | null): boolean => !!scope && scope.split(/\s+/).includes('https://www.googleapis.com/auth/calendar.events');

/** Whether granted scopes (space- or comma-separated) include one (25 October 2026: Google's free/busy, for busy times). */
export const grantsScope = (scope: string | null, wanted: string): boolean => !!scope && scope.split(/[\s,]+/).includes(wanted);

/** Who signed in to Zoom: GET /users/me. */
export const zoomMeRequest = (token: string): HttpRequest => ({ method: 'GET', url: `${MEETING_ENDPOINTS.zoom.api}/users/me`, headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });

export function zoomEmailOf(answer: HttpAnswer | null): string | null {
  if (!answer || answer.status !== 200 || !isObject(answer.body)) return null;
  const email = text(answer.body.email);
  return email && email.includes('@') ? email.trim().toLowerCase() : null;
}

/** Google's revocation of a refresh token on disconnecting (best effort). */
export const googleRevokeRequest = (token: string): HttpRequest => ({ method: 'POST', url: MEETING_ENDPOINTS.google.revoke, headers: { ...FORM }, body: form({ token }) });

/** Zoom's revocation of a refresh token on disconnecting (best effort). */
export const zoomRevokeRequest = (app: AppCredentials, token: string): HttpRequest => ({
  method: 'POST',
  url: `${MEETING_ENDPOINTS.zoom.oauth}/revoke`,
  headers: { ...FORM, authorization: basic(app) },
  body: form({ token }),
});

/** Microsoft: the host mailbox's calendar, read when the company's host is named (it exists, and the app may reach it). */
export const microsoftCalendarRequest = (token: string, host: string): HttpRequest => ({
  method: 'GET',
  url: `${MEETING_ENDPOINTS.microsoft.graph}/users/${encodeURIComponent(host)}/calendar?$select=id,allowedOnlineMeetingProviders`,
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
});

/** Whether Microsoft's answer says the host's calendar can't have a Teams meeting. */
export function teamsNotAllowed(answer: HttpAnswer | null): boolean {
  if (!answer || answer.status !== 200 || !isObject(answer.body)) return false;
  const allowed = answer.body.allowedOnlineMeetingProviders;
  return Array.isArray(allowed) && !allowed.includes('teamsForBusiness');
}

// ---------- the meetings ----------

/** What a meeting is made with: the interview's title, start, length; a request id (Google's, kept per attempt). */
export interface MeetingDetails {
  title: string;
  description: string;
  start: Date;
  minutes: number;
  requestId: string;
}

/**
 * Where a meeting lives: the provider, and the host for the company's Microsoft and Zoom (the mailbox or user, with the
 * app's token); null for one's own (Graph's /me, Zoom's users/me) and for Google (the signed-in account's primary).
 */
export interface MeetingTarget {
  provider: MeetingProvider;
  host: string | null;
}

/** The host as the interview keeps it: Google's calendar ("primary"), the company's mailbox or user, or "me". */
export const hostKept = (t: MeetingTarget): string => (t.provider === 'google' ? 'primary' : (t.host ?? 'me'));

/** The target again from what the interview kept. */
export const targetOf = (provider: MeetingProvider, kept: string | null | undefined): MeetingTarget => ({ provider, host: !kept || kept === 'me' || kept === 'primary' ? null : kept });

const end = (d: MeetingDetails) => new Date(d.start.getTime() + d.minutes * 60_000);
/** Graph's dateTime in UTC, without the zone (given apart): 2026-11-05T08:30:00. */
const graphTime = (d: Date) => d.toISOString().slice(0, 19);
/** Zoom's start, UTC: 2026-11-05T08:30:00Z. */
const zoomTime = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
const clip = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

const graphBase = (host: string | null) => (host ? `${MEETING_ENDPOINTS.microsoft.graph}/users/${encodeURIComponent(host)}` : `${MEETING_ENDPOINTS.microsoft.graph}/me`);
const googleEvents = `${MEETING_ENDPOINTS.google.calendar}/calendars/primary/events`;

function googleTimes(d: MeetingDetails) {
  return { start: { dateTime: d.start.toISOString(), timeZone: 'Africa/Cairo' }, end: { dateTime: end(d).toISOString(), timeZone: 'Africa/Cairo' } };
}

function graphTimes(d: MeetingDetails) {
  return { start: { dateTime: graphTime(d.start), timeZone: 'UTC' }, end: { dateTime: graphTime(end(d)), timeZone: 'UTC' } };
}

function zoomTimes(d: MeetingDetails) {
  return { topic: clip(d.title, 200), start_time: zoomTime(d.start), duration: d.minutes, timezone: 'Africa/Cairo', agenda: clip(d.description, 2000) };
}

/** A new meeting. */
export function createRequest(t: MeetingTarget, token: string, d: MeetingDetails): HttpRequest {
  if (t.provider === 'google') {
    return {
      method: 'POST',
      url: `${googleEvents}?conferenceDataVersion=1&sendUpdates=none`,
      headers: JSON_HEADERS(token),
      body: JSON.stringify({
        summary: d.title,
        description: d.description,
        ...googleTimes(d),
        conferenceData: { createRequest: { requestId: d.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
      }),
    };
  }
  if (t.provider === 'microsoft') {
    return {
      method: 'POST',
      url: `${graphBase(t.host)}/events`,
      headers: JSON_HEADERS(token),
      body: JSON.stringify({
        subject: d.title,
        body: { contentType: 'text', content: d.description },
        ...graphTimes(d),
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
        allowNewTimeProposals: false,
        responseRequested: false,
        showAs: 'busy',
      }),
    };
  }
  return {
    method: 'POST',
    url: `${MEETING_ENDPOINTS.zoom.api}/users/${t.host ? encodeURIComponent(t.host) : 'me'}/meetings`,
    headers: JSON_HEADERS(token),
    body: JSON.stringify({
      ...zoomTimes(d),
      type: 2,
      settings: {
        join_before_host: true,
        jbh_time: 0,
        waiting_room: false,
        approval_type: 2,
        meeting_authentication: false,
        host_video: true,
        participant_video: true,
        mute_upon_entry: false,
        registrants_email_notification: false,
        email_notification: false,
      },
    }),
  };
}

/** A meeting read again: Google's conference or Microsoft's Teams link when it wasn't ready on making it. */
export function getRequest(t: MeetingTarget, token: string, meetingId: string): HttpRequest {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (t.provider === 'google') return { method: 'GET', url: `${googleEvents}/${encodeURIComponent(meetingId)}`, headers };
  if (t.provider === 'microsoft') return { method: 'GET', url: `${graphBase(t.host)}/events/${encodeURIComponent(meetingId)}?$select=id,onlineMeeting`, headers };
  return { method: 'GET', url: `${MEETING_ENDPOINTS.zoom.api}/meetings/${encodeURIComponent(meetingId)}`, headers };
}

/** A meeting moved to the interview's new time, length and title. */
export function updateRequest(t: MeetingTarget, token: string, meetingId: string, d: MeetingDetails): HttpRequest {
  if (t.provider === 'google') {
    return { method: 'PATCH', url: `${googleEvents}/${encodeURIComponent(meetingId)}?sendUpdates=none`, headers: JSON_HEADERS(token), body: JSON.stringify({ summary: d.title, description: d.description, ...googleTimes(d) }) };
  }
  if (t.provider === 'microsoft') {
    return {
      method: 'PATCH',
      url: `${graphBase(t.host)}/events/${encodeURIComponent(meetingId)}`,
      headers: JSON_HEADERS(token),
      body: JSON.stringify({ subject: d.title, body: { contentType: 'text', content: d.description }, ...graphTimes(d) }),
    };
  }
  return { method: 'PATCH', url: `${MEETING_ENDPOINTS.zoom.api}/meetings/${encodeURIComponent(meetingId)}`, headers: JSON_HEADERS(token), body: JSON.stringify(zoomTimes(d)) };
}

/** A meeting deleted (an interview cancelled, or its meeting replaced). */
export function deleteRequest(t: MeetingTarget, token: string, meetingId: string): HttpRequest {
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (t.provider === 'google') return { method: 'DELETE', url: `${googleEvents}/${encodeURIComponent(meetingId)}?sendUpdates=none`, headers };
  if (t.provider === 'microsoft') return { method: 'DELETE', url: `${graphBase(t.host)}/events/${encodeURIComponent(meetingId)}`, headers };
  return { method: 'DELETE', url: `${MEETING_ENDPOINTS.zoom.api}/meetings/${encodeURIComponent(meetingId)}?schedule_for_reminder=false&cancel_meeting_reminder=false`, headers };
}

/** A meeting as made (or read again): its id there, and its join link; null while the provider still makes it. */
export interface MeetingMade {
  meetingId: string;
  joinUrl: string | null;
}

const httpsLink = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) ? v : null);

/** A made (or read) meeting's id and join link; a refusal thrown as the provider's problem. */
export function madeOf(provider: MeetingProvider, answer: HttpAnswer | null, doing: 'create' | 'read' = 'create'): MeetingMade {
  if (!answer || answer.status < 200 || answer.status >= 300 || !isObject(answer.body)) throw problemOf(provider, answer, doing === 'read' ? 'update' : 'create');
  const b = answer.body;
  if (provider === 'google') {
    const id = text(b.id);
    if (!id) throw problemOf(provider, answer, 'create');
    const conference = isObject(b.conferenceData) ? b.conferenceData : {};
    const status = isObject(conference.createRequest) && isObject(conference.createRequest.status) ? conference.createRequest.status.statusCode : null;
    if (status === 'failure') throw new MeetingProviderError('refused', 'Google refused: it couldn’t add a Google Meet to the event. Check that Google Meet is turned on for the account.', 'conference_failure');
    const video = Array.isArray(conference.entryPoints) ? conference.entryPoints.find((e) => isObject(e) && e.entryPointType === 'video') : null;
    return { meetingId: id, joinUrl: httpsLink(b.hangoutLink) ?? httpsLink(isObject(video) ? video.uri : null) };
  }
  if (provider === 'microsoft') {
    const id = text(b.id);
    if (!id) throw problemOf(provider, answer, 'create');
    return { meetingId: id, joinUrl: httpsLink(isObject(b.onlineMeeting) ? b.onlineMeeting.joinUrl : null) };
  }
  const id = typeof b.id === 'number' || typeof b.id === 'string' ? String(b.id) : null;
  if (!id) throw problemOf(provider, answer, 'create');
  return { meetingId: id, joinUrl: httpsLink(b.join_url) };
}

/** Whether a move or a delete found the meeting gone already (deleted at the provider): a delete is then done. */
export const goneAnswer = (answer: HttpAnswer | null): boolean => !!answer && (answer.status === 404 || answer.status === 410);

/** Whether a move or a delete went through. */
export const doneAnswer = (answer: HttpAnswer | null): boolean => !!answer && answer.status >= 200 && answer.status < 300;

// ---------- what went wrong, in words ----------

/**
 * Why a provider refused, as a kind and plain words:
 * - reconnect: the connection's sign-in is gone (revoked, expired, a scope taken away): its owner connects it again;
 * - app: the company's app or its setup (the client ID or secret, a permission, the host): a Super Admin fixes it;
 * - token: the access token was refused (401): refreshed and tried once more;
 * - gone: the meeting isn't there any more;
 * - busy, unreachable: try again later; refused: anything else, with the provider's own words.
 */
export type MeetingProblemKind = 'reconnect' | 'app' | 'token' | 'gone' | 'busy' | 'unreachable' | 'refused';

export class MeetingProviderError extends Error {
  constructor(
    readonly kind: MeetingProblemKind,
    message: string,
    /** The provider's own error code, letters only (e.g. invalid_grant, redirect_uri_mismatch), for the page and the log. */
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** What the system was doing: a token, signing in, or a meeting made, moved or deleted. */
export type MeetingDoing = 'token' | 'connect' | 'create' | 'update' | 'delete' | 'host';

/** The provider's words on one line, short, without Microsoft's trace and correlation ids. */
function said(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const line = v
    .replace(/\s*Trace ID:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return line ? clip(line, 200) : null;
}

const CODE = /^[A-Za-z0-9_.:-]{1,60}$/;
const codeOf = (v: unknown): string | null => (typeof v === 'string' && CODE.test(v) ? v : typeof v === 'number' ? String(v) : null);

/**
 * A provider's refusal (or no answer: `answer` null) in plain words, "Google refused: …", with its kind. Built from the
 * provider's error codes and descriptions, never from the request (so never a token or a secret).
 */
export function problemOf(provider: MeetingProvider, answer: HttpAnswer | null, doing: MeetingDoing): MeetingProviderError {
  const who = MEETING_COMPANY_NAMES[provider];
  if (!answer) return new MeetingProviderError('unreachable', `${who} couldn’t be reached. Try again in a moment.`);
  const status = answer.status;
  const b = isObject(answer.body) ? answer.body : {};
  const nested = isObject(b.error) ? b.error : null;
  // OAuth's { error, error_description } (Zoom: { reason, error }); Google's API { error: { code, message, status,
  // errors: [{ reason }] } }; Graph's { error: { code, message } }; Zoom's API { code, message }
  const oauth = typeof b.error === 'string' ? b.error : null;
  const description = said(b.error_description) ?? said(b.reason) ?? said(nested?.message) ?? said(b.message);
  const apiCode = codeOf(nested?.code) ?? codeOf(b.code);
  const reasons = Array.isArray(nested?.errors) ? nested.errors.map((e) => (isObject(e) ? e.reason : null)).filter((r): r is string => typeof r === 'string') : [];
  const status_ = typeof nested?.status === 'string' ? nested.status : null;
  const words = `${description ?? ''} ${reasons.join(' ')} ${status_ ?? ''}`;
  const aadsts = /AADSTS(\d+)/.exec(description ?? '')?.[1] ?? null;
  const err = (kind: MeetingProblemKind, message: string, code: string | null = oauth ?? apiCode) => new MeetingProviderError(kind, message, code && CODE.test(code) ? code : null);

  // the sign-in and the tokens (OAuth's own errors)
  if (oauth === 'invalid_grant') {
    if (aadsts === '65001') return err('app', 'Microsoft refused: admin consent hasn’t been given for the app’s permissions. Grant it in Microsoft Entra → App registrations → API permissions.');
    if (doing === 'connect') return err('refused', `${who} refused the sign-in: it took too long or was used already. Connect again.`);
    return err('reconnect', `${who} says the connection was revoked or has expired: connect the account again.`);
  }
  if (oauth === 'invalid_client' || oauth === 'unauthorized_client' || aadsts === '7000215' || aadsts === '7000222') {
    return err('app', `${who} refused the app’s client ID or secret: a Super Admin checks them on Organization → Meetings.`);
  }
  if (aadsts === '700016' || aadsts === '90002' || aadsts === '900023') return err('app', 'Microsoft can’t find the app or the tenant: a Super Admin checks the tenant ID and client ID on Organization → Meetings.');
  if (oauth === 'redirect_uri_mismatch' || aadsts === '50011' || aadsts === '500113') {
    return err('app', `${who} refused the return address: add the redirect URI shown on Organization → Meetings to the app.`, oauth ?? 'redirect_uri_mismatch');
  }
  if (oauth === 'invalid_scope' || aadsts === '70011') return err('app', `${who} refused the permissions asked for: check the app’s scopes on Organization → Meetings.`);
  if (oauth) return err('refused', `${who} refused: ${description ?? oauth}.`.replace(/\.\.$/, '.'));

  // the API: Zoom's missing scope (code 4711, answered 400 or 403)
  if (provider === 'zoom' && (apiCode === '4711' || /does not contain scopes/i.test(words))) {
    const scopes = /scopes:\s*\[([^\]]+)\]/i.exec(words)?.[1];
    return err('app', `Zoom refused: the app lacks a scope${scopes ? ` (${clip(scopes, 120)})` : ''}. Add it on the app’s Scopes page in the Zoom App Marketplace.`);
  }
  if (status === 401) return err('token', `${who} refused the connection’s sign-in: connect the account again.`);
  if (status === 403) {
    if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(words)) {
      return err('reconnect', `${who} refused: the account didn’t allow access to its calendar. Connect it again and allow it.`);
    }
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(words)) {
      return err('app', 'Google refused: the Google Calendar API isn’t turned on in the Google Cloud project. Turn it on in APIs & Services → Library.');
    }
    if (provider === 'microsoft' && /ErrorAccessDenied|Authorization_RequestDenied|AccessDenied/i.test(`${apiCode ?? ''} ${words}`)) {
      return err('app', 'Microsoft refused access to the calendar: grant the Calendars.ReadWrite permission with admin consent, and include the host mailbox in the app’s access policy if it has one.');
    }
    return err('refused', `${who} refused: ${description ?? 'access denied'}.`.replace(/\.\.$/, '.'));
  }
  if (status === 404 || status === 410) {
    if (doing === 'update' || doing === 'delete') return err('gone', `${who} no longer has the meeting: it was deleted there.`);
    if (provider === 'microsoft' && /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound|not found/i.test(`${apiCode ?? ''} ${words}`)) {
      return err('app', 'Microsoft can’t find the host mailbox: a Super Admin checks it on Organization → Meetings (it needs an Exchange Online mailbox).');
    }
    if (provider === 'zoom' && (apiCode === '1001' || /user does not exist/i.test(words))) {
      return err('app', 'Zoom has no such user: the host must be a user of the company’s Zoom account.');
    }
  }
  if (provider === 'microsoft' && /MailboxNotEnabledForRESTAPI/i.test(`${apiCode ?? ''} ${words}`)) {
    return err('app', 'Microsoft refused: the host mailbox isn’t an Exchange Online mailbox. Choose one that is.');
  }
  if (status === 429 || status >= 500) return err('busy', `${who} is busy right now${description ? ` (${description})` : ''}: try again in a moment.`);
  return err('refused', `${who} refused: ${description ?? `the request (${status})`}.`.replace(/\.\.$/, '.'));
}
