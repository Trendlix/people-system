import type { MeetingFetch } from '../src/meetings/meeting-http.js';

// Google, Microsoft and Zoom as the meetings tests see them (owner, 24 October 2026: "Google Meet, Microsoft Teams,
// Zoom"): one fake, put in MeetingHttp's place, answering the token endpoints, Google Calendar, Microsoft Graph and
// Zoom's API as the real ones do (their shapes and their errors), keeping the meetings made. No request leaves the
// machine. Every token and secret it gives is distinctive and kept in `secrets`, so the tests can search every answer
// and audit entry for them.

export interface FakeApps {
  google: { clientId: string; clientSecret: string };
  microsoft: { tenantId: string; clientId: string; clientSecret: string };
  zoom: { accountId: string; clientId: string; clientSecret: string; userClientId: string; userClientSecret: string };
}

export interface FakeCall {
  method: string;
  url: string;
  body: string | null;
}

export interface FakeMeeting {
  provider: 'google' | 'microsoft' | 'zoom';
  id: string;
  /** Where it lives: the Google account, the mailbox, or the Zoom user. */
  host: string;
  title: string;
  start: string;
  minutes: number;
  joinUrl: string;
  /** Anyone invited at the provider (must stay none: the system's own invitation is the only one). */
  attendees: unknown;
}

export interface FakeProviders {
  fetch: MeetingFetch;
  calls: FakeCall[];
  meetings: Map<string, FakeMeeting>;
  /** Every token and secret given or taken: none may reach an answer or the audit log. */
  secrets: Set<string>;
  /** A sign-in code that becomes a sign-in as this account, once. */
  code(provider: 'google' | 'microsoft' | 'zoom', code: string, email: string): void;
  /** The next meeting made with this provider is refused with this answer. */
  refuseNext(provider: 'google' | 'microsoft' | 'zoom', status: number, body: unknown): void;
  /** Every access and refresh token given for an account stops working (revoked at the provider). */
  revoke(email: string): void;
  /** The mailboxes Microsoft knows. */
  mailboxes: Set<string>;
}

const json = (status: number, body: unknown) =>
  new Response(body === null || status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const jwt = (claims: object) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

export function fakeMeetingProviders(run: string, apps: FakeApps): FakeProviders {
  const calls: FakeCall[] = [];
  const meetings = new Map<string, FakeMeeting>();
  const secrets = new Set<string>([apps.google.clientSecret, apps.microsoft.clientSecret, apps.zoom.clientSecret, apps.zoom.userClientSecret]);
  const codes = new Map<string, { provider: string; email: string }>();
  /** Valid access tokens: whose. */
  const access = new Map<string, { provider: string; email: string | null; app?: boolean }>();
  /** Valid refresh tokens: whose. */
  const refresh = new Map<string, { provider: string; email: string }>();
  const refusals = new Map<string, { status: number; body: unknown }>();
  const mailboxes = new Set<string>();
  let n = 0;

  const issue = (provider: string, email: string | null, app = false) => {
    const token = `${provider}-at-${run}-${++n}`;
    access.set(token, { provider, email, app });
    secrets.add(token);
    return token;
  };
  const issueRefresh = (provider: string, email: string) => {
    const token = `${provider}-rt-${run}-${++n}`;
    refresh.set(token, { provider, email });
    secrets.add(token);
    return token;
  };
  const bearer = (headers: Record<string, string>) => /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? '';
  const basic = (headers: Record<string, string>) => {
    const raw = /^Basic (.+)$/.exec(headers.authorization ?? '')?.[1];
    const [id, secret] = raw ? Buffer.from(raw, 'base64').toString('utf8').split(':') : [];
    return { id, secret };
  };
  const refused = (provider: string) => {
    const r = refusals.get(provider);
    if (r) refusals.delete(provider);
    return r;
  };

  async function handle(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
    const u = new URL(url);
    const method = init.method;
    const form = new URLSearchParams(init.body ?? '');
    const body = (() => {
      try {
        return init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })();
    calls.push({ method, url, body: init.body ?? null });

    // ---------- Google ----------
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      if (form.get('client_id') !== apps.google.clientId || form.get('client_secret') !== apps.google.clientSecret) {
        return json(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const c = codes.get(form.get('code') ?? '');
        if (!c || c.provider !== 'google' || !form.get('code_verifier') || !form.get('redirect_uri')?.endsWith('/meetings/oauth/google')) return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        codes.delete(form.get('code')!);
        return json(200, {
          access_token: issue('google', c.email),
          refresh_token: issueRefresh('google', c.email),
          expires_in: 3599,
          id_token: jwt({ email: c.email, email_verified: true }),
          scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events',
          token_type: 'Bearer',
        });
      }
      const r = refresh.get(form.get('refresh_token') ?? '');
      if (!r) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: issue('google', r.email), expires_in: 3599, token_type: 'Bearer' });
    }
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
      refresh.delete(form.get('token') ?? '');
      return json(200, {});
    }
    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/calendar/v3/calendars/primary/events')) {
      const who = access.get(bearer(init.headers));
      if (!who || who.provider !== 'google') return json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
      const id = decodeURIComponent(u.pathname.split('/events/')[1] ?? '');
      if (method === 'POST') {
        const r = refused('google');
        if (r) return json(r.status, r.body);
        const eventId = `gev${run}${++n}`;
        const joinUrl = `https://meet.google.com/${run.slice(0, 3)}-${String(n).padStart(4, '0')}-mtg`;
        const start = (body.start as { dateTime: string }).dateTime;
        const end = (body.end as { dateTime: string }).dateTime;
        meetings.set(eventId, { provider: 'google', id: eventId, host: who.email!, title: String(body.summary), start, minutes: (Date.parse(end) - Date.parse(start)) / 60_000, joinUrl, attendees: body.attendees });
        return json(200, {
          id: eventId,
          hangoutLink: joinUrl,
          conferenceData: { createRequest: { requestId: (body.conferenceData as { createRequest: { requestId: string } }).createRequest.requestId, status: { statusCode: 'success' } }, entryPoints: [{ entryPointType: 'video', uri: joinUrl }] },
        });
      }
      const m = meetings.get(id);
      if (!m || m.provider !== 'google') return json(410, { error: { code: 410, message: 'Resource has been deleted' } });
      if (method === 'PATCH') {
        const start = (body.start as { dateTime: string }).dateTime;
        const end = (body.end as { dateTime: string }).dateTime;
        Object.assign(m, { title: String(body.summary), start, minutes: (Date.parse(end) - Date.parse(start)) / 60_000 });
        return json(200, { id: m.id, hangoutLink: m.joinUrl });
      }
      if (method === 'DELETE') {
        meetings.delete(id);
        return json(204, null);
      }
      return json(200, { id: m.id, hangoutLink: m.joinUrl });
    }

    // ---------- Microsoft ----------
    if (u.host === 'login.microsoftonline.com' && u.pathname === `/${apps.microsoft.tenantId}/oauth2/v2.0/token`) {
      if (form.get('client_id') !== apps.microsoft.clientId || form.get('client_secret') !== apps.microsoft.clientSecret) {
        return json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided. Trace ID: t Correlation ID: c Timestamp: 2026-10-24', error_codes: [7000215] });
      }
      const grant = form.get('grant_type');
      if (grant === 'client_credentials') return json(200, { token_type: 'Bearer', expires_in: 3599, access_token: issue('microsoft', null, true) });
      if (grant === 'authorization_code') {
        const c = codes.get(form.get('code') ?? '');
        if (!c || c.provider !== 'microsoft') return json(400, { error: 'invalid_grant', error_description: 'AADSTS70008: The provided authorization code has expired.' });
        codes.delete(form.get('code')!);
        return json(200, { token_type: 'Bearer', expires_in: 3599, access_token: issue('microsoft', c.email), refresh_token: issueRefresh('microsoft', c.email), id_token: jwt({ preferred_username: c.email, tid: apps.microsoft.tenantId }) });
      }
      const r = refresh.get(form.get('refresh_token') ?? '');
      if (!r) return json(400, { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired due to inactivity.' });
      refresh.delete(form.get('refresh_token')!);
      return json(200, { token_type: 'Bearer', expires_in: 3599, access_token: issue('microsoft', r.email), refresh_token: issueRefresh('microsoft', r.email) });
    }
    if (u.host === 'graph.microsoft.com') {
      const who = access.get(bearer(init.headers));
      if (!who || who.provider !== 'microsoft') return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } });
      const path = u.pathname.replace(/^\/v1\.0/, '');
      const mailbox = /^\/users\/([^/]+)/.exec(path)?.[1];
      const host = mailbox ? decodeURIComponent(mailbox).toLowerCase() : who.email;
      if (mailbox && (!who.app || !mailboxes.has(host!))) return json(404, { error: { code: 'ErrorInvalidUser', message: `The requested user '${host}' is invalid.` } });
      if (path.endsWith('/calendar')) return json(200, { id: 'cal-1', allowedOnlineMeetingProviders: ['teamsForBusiness'], defaultOnlineMeetingProvider: 'teamsForBusiness' });
      const id = decodeURIComponent(path.split('/events/')[1] ?? '');
      if (method === 'POST' && path.endsWith('/events')) {
        const r = refused('microsoft');
        if (r) return json(r.status, r.body);
        const eventId = `AAMk${run}${++n}`;
        const joinUrl = `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${run}${n}%40thread.v2/0`;
        const start = (body.start as { dateTime: string }).dateTime;
        const end = (body.end as { dateTime: string }).dateTime;
        meetings.set(eventId, { provider: 'microsoft', id: eventId, host: host!, title: String(body.subject), start: `${start}Z`, minutes: (Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) / 60_000, joinUrl, attendees: body.attendees });
        return json(201, { id: eventId, isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', onlineMeeting: { joinUrl } });
      }
      const m = meetings.get(id);
      if (!m || m.provider !== 'microsoft') return json(404, { error: { code: 'ErrorItemNotFound', message: 'The specified object was not found in the store.' } });
      if (method === 'PATCH') {
        const start = (body.start as { dateTime: string }).dateTime;
        const end = (body.end as { dateTime: string }).dateTime;
        Object.assign(m, { title: String(body.subject), start: `${start}Z`, minutes: (Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) / 60_000 });
        return json(200, { id: m.id, onlineMeeting: { joinUrl: m.joinUrl } });
      }
      if (method === 'DELETE') {
        meetings.delete(id);
        return json(204, null);
      }
      return json(200, { id: m.id, onlineMeeting: { joinUrl: m.joinUrl } });
    }

    // ---------- Zoom ----------
    if (u.host === 'zoom.us' && u.pathname === '/oauth/token') {
      const { id, secret } = basic(init.headers);
      const grant = u.searchParams.get('grant_type') ?? form.get('grant_type');
      if (grant === 'account_credentials') {
        if (id !== apps.zoom.clientId || secret !== apps.zoom.clientSecret) return json(400, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
        if (u.searchParams.get('account_id') !== apps.zoom.accountId) return json(400, { reason: 'Invalid account_id', error: 'invalid_request' });
        return json(200, { access_token: issue('zoom', null, true), token_type: 'bearer', expires_in: 3599, scope: 'meeting:write:meeting:admin meeting:update:meeting:admin meeting:delete:meeting:admin' });
      }
      if (id !== apps.zoom.userClientId || secret !== apps.zoom.userClientSecret) return json(400, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
      if (grant === 'authorization_code') {
        const c = codes.get(form.get('code') ?? '');
        if (!c || c.provider !== 'zoom') return json(400, { reason: 'Invalid authorization code', error: 'invalid_grant' });
        codes.delete(form.get('code')!);
        return json(200, { access_token: issue('zoom', c.email), refresh_token: issueRefresh('zoom', c.email), token_type: 'bearer', expires_in: 3599 });
      }
      // Zoom gives a new refresh token on each refresh, and the old one stops working
      const r = refresh.get(form.get('refresh_token') ?? '');
      if (!r) return json(400, { reason: 'Invalid Token!', error: 'invalid_grant' });
      refresh.delete(form.get('refresh_token')!);
      return json(200, { access_token: issue('zoom', r.email), refresh_token: issueRefresh('zoom', r.email), token_type: 'bearer', expires_in: 3599 });
    }
    if (u.host === 'zoom.us' && u.pathname === '/oauth/revoke') {
      refresh.delete(form.get('token') ?? '');
      return json(200, { status: 'success' });
    }
    if (u.host === 'api.zoom.us') {
      const who = access.get(bearer(init.headers));
      if (!who || who.provider !== 'zoom') return json(401, { code: 124, message: 'Invalid access token.' });
      if (u.pathname === '/v2/users/me' && method === 'GET') return json(200, { id: `zu${n}`, email: who.email, first_name: 'Zoom', last_name: 'User' });
      const user = /^\/v2\/users\/([^/]+)\/meetings$/.exec(u.pathname)?.[1];
      if (user && method === 'POST') {
        const r = refused('zoom');
        if (r) return json(r.status, r.body);
        const host = user === 'me' ? who.email! : decodeURIComponent(user);
        if (user !== 'me' && !who.app) return json(400, { code: 200, message: 'No permission.' });
        const meetingId = 81_000_000_000 + ++n;
        const joinUrl = `https://us06web.zoom.us/j/${meetingId}?pwd=${run}p${n}`;
        const startUrl = `https://us06web.zoom.us/s/${meetingId}?zak=zak-${run}-${n}`;
        secrets.add(`zak-${run}-${n}`);
        meetings.set(String(meetingId), { provider: 'zoom', id: String(meetingId), host, title: String(body.topic), start: String(body.start_time), minutes: Number(body.duration), joinUrl, attendees: (body as { settings?: { meeting_invitees?: unknown } }).settings?.meeting_invitees });
        return json(201, { id: meetingId, host_email: host, topic: body.topic, start_time: body.start_time, duration: body.duration, join_url: joinUrl, start_url: startUrl, password: `${run}p${n}`, settings: body.settings });
      }
      const meetingId = /^\/v2\/meetings\/(\d+)$/.exec(u.pathname)?.[1];
      const m = meetingId ? meetings.get(meetingId) : undefined;
      if (!m || m.provider !== 'zoom') return json(404, { code: 3001, message: `Meeting does not exist: ${meetingId}.` });
      if (method === 'PATCH') {
        Object.assign(m, { title: String(body.topic), start: String(body.start_time), minutes: Number(body.duration) });
        return json(204, null);
      }
      if (method === 'DELETE') {
        meetings.delete(m.id);
        return json(204, null);
      }
      return json(200, { id: Number(m.id), join_url: m.joinUrl });
    }

    return json(599, { error: `The fake has no ${method} ${u.host}${u.pathname}` });
  }

  return {
    fetch: (url, init) => handle(url, init),
    calls,
    meetings,
    secrets,
    mailboxes,
    code(provider, code, email) {
      codes.set(code, { provider, email });
    },
    refuseNext(provider, status, body) {
      refusals.set(provider, { status, body });
    },
    revoke(email) {
      for (const [t, w] of access) if (w.email === email) access.delete(t);
      for (const [t, w] of refresh) if (w.email === email) refresh.delete(t);
    },
  };
}
