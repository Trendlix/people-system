import type { MeetingFetch } from '../src/meetings/meeting-http.js';

// Zoho Calendar, Google Calendar and Microsoft Graph's busy times as the tests see them (owner, 25 October 2026: "Hours +
// calendar"; "its zoho mails"): one fake, put in CalendarHttp's place (and in MeetingHttp's, wrapping the meetings' fake),
// answering Zoho Accounts at each data centre, Zoho Calendar's free/busy, Google's token endpoint and freeBusy, and
// Microsoft's token endpoint and getSchedule, as the real ones do (their shapes and their errors). No request leaves the
// machine. Every token and secret it gives is distinctive and kept in `secrets`, so the tests can search every answer
// and audit entry for them.
//
// How to use it (calendars.e2e-spec.ts, interview-availability.e2e-spec.ts):
//   const meetings = fakeMeetingProviders(RUN, MEETING_APPS);           // only if meetings are used too
//   const cal = fakeCalendars(RUN, { zoho: ZOHO_APP, google: MEETING_APPS.google, microsoft: MEETING_APPS.microsoft });
//   const f = cal.wrap(meetings.fetch);                                  // or cal.fetch alone, without meetings
//   app.get(MeetingHttp).fetch = f; app.get(CalendarHttp).fetch = f;
//   // the company's Zoho: a Super Admin saves the Zoho app (PUT /calendars/apps/zoho), then
//   const start = await post('/calendars/oauth/start', { provider: 'zoho', owner: 'company', origin });
//   cal.code('zoho', 'code-1', 'hr@trendlix.test', 'https://accounts.zoho.eu');   // signs in as this account, there
//   await post('/calendars/oauth/finish', { provider: 'zoho', code: 'code-1', state, accountsServer: 'https://accounts.zoho.eu' });
//   cal.busy('sara@trendlix.test', [{ start, end, title: 'Never shown' }]);         // her calendar's busy times
//   cal.fail('omar@trendlix.test');                                                  // his calendar refuses
//   cal.slow('nour@trendlix.test', 6000);                                            // hers answers after 6 seconds
// Everyone in the fake's Zoho organization is read by any of its tokens ("only with organization users"); Google's and
// Microsoft's /me read the token's own account; Microsoft's /users/{host} needs the app's own token (client credentials).
// The meetings' fake's tokens (made through `wrap`) are learned as they pass, so HR's own meetings connections read too.

export interface FakeCalendarApps {
  zoho: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  microsoft?: { tenantId: string; clientId: string; clientSecret: string };
}

export interface FakeCalendarCall {
  method: string;
  url: string;
  body: string | null;
}

export interface FakeBusy {
  start: Date;
  end: Date;
  tentative?: boolean;
  /** An event's title: answered by the fake (Graph's subject, Google's summary) to prove it is never read. */
  title?: string;
}

type Provider = 'zoho' | 'google' | 'microsoft';

export interface FakeCalendars {
  /** CalendarHttp's fetch alone. */
  fetch: MeetingFetch;
  /** A fetch answering the calendars and passing everything else to `next` (the meetings' fake), learning its tokens. */
  wrap(next: MeetingFetch): MeetingFetch;
  calls: FakeCalendarCall[];
  /** Every token and secret given or taken: none may reach an answer or the audit log. */
  secrets: Set<string>;
  /**
   * A sign-in code that becomes a sign-in as this account, once (Zoho's at `accountsServer`, else the US one); `noEmail`:
   * Zoho says nothing of the account's email, neither in the ID token nor in its userinfo.
   */
  code(provider: Provider, code: string, email: string, accountsServer?: string, options?: { scope?: string; noEmail?: boolean }): void;
  /** Someone's busy times, replacing any given before. */
  busy(email: string, blocks: FakeBusy[]): void;
  /** Someone's calendar refuses (Zoho and Google with this status, Graph with an error for the mailbox). */
  fail(email: string, status?: number): void;
  /** Someone's calendar answers again. */
  heal(email: string): void;
  /** Someone's calendar answers after `ms`. */
  slow(email: string, ms: number): void;
  /** Every access and refresh token given for an account stops working (revoked at the provider). */
  revoke(email: string): void;
}

const json = (status: number, body: unknown) =>
  new Response(body === null || status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const jwt = (claims: object) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

const ZOHO_ACCOUNTS = /^accounts\.(zoho\.(com|eu|in|com\.au|jp|sa|uk|ae|sg)|zohocloud\.ca)$/;
const ZOHO_CALENDAR = /^calendar\.(zoho\.(com|eu|in|com\.au|jp|sa|uk|ae|sg)|zohocloud\.ca)$/;
const dcOf = (host: string) => host.replace(/^(accounts|calendar)\./, '');

/** Zoho's yyyyMMdd'T'HHmmss(Z) as a moment, read as UTC. */
const zohoTime = (v: string | null) => {
  const m = v ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(v) : null;
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Number.NaN;
};
const zohoStamp = (d: Date) => `${d.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;

/** Waits `ms`, or rejects as fetch does when the request's signal aborts first. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    });
  });
}

export function fakeCalendars(run: string, apps: FakeCalendarApps): FakeCalendars {
  const calls: FakeCalendarCall[] = [];
  const secrets = new Set<string>([apps.zoho.clientSecret, ...(apps.google ? [apps.google.clientSecret] : []), ...(apps.microsoft ? [apps.microsoft.clientSecret] : [])]);
  const codes = new Map<string, { provider: Provider; email: string; dc: string; scope?: string; noEmail?: boolean }>();
  /** Valid access tokens: whose (`app`: Microsoft's client credentials), and Zoho's data centre. */
  const access = new Map<string, { provider: Provider; email: string | null; app?: boolean; dc?: string; noEmail?: boolean }>();
  const refresh = new Map<string, { provider: Provider; email: string; dc?: string }>();
  const busy = new Map<string, FakeBusy[]>();
  const failing = new Map<string, number>();
  const slow = new Map<string, number>();
  let n = 0;

  const issue = (provider: Provider, email: string | null, extra: { app?: boolean; dc?: string; noEmail?: boolean } = {}) => {
    const token = `${provider}-cal-at-${run}-${++n}`;
    access.set(token, { provider, email, ...extra });
    secrets.add(token);
    return token;
  };
  const issueRefresh = (provider: Provider, email: string, dc?: string) => {
    const token = `${provider}-cal-rt-${run}-${++n}`;
    refresh.set(token, { provider, email, dc });
    secrets.add(token);
    return token;
  };
  const bearer = (headers: Record<string, string>) => /^(?:Bearer|Zoho-oauthtoken) (.+)$/.exec(headers.authorization ?? '')?.[1] ?? '';
  const lower = (e: string) => e.trim().toLowerCase();
  const blocksOf = (email: string | null, from: number, to: number) =>
    email ? (busy.get(lower(email)) ?? []).filter((b) => b.start.getTime() < to && b.end.getTime() > from) : [];
  const delay = async (email: string | null, signal?: AbortSignal) => {
    const ms = email ? slow.get(lower(email)) : undefined;
    if (ms) await wait(ms, signal);
  };

  /** Learns the meetings' fake's tokens from its token answers, so their owners' busy times read. */
  async function learn(url: string, form: URLSearchParams, res: Response): Promise<void> {
    const u = new URL(url);
    const google = u.host === 'oauth2.googleapis.com' && u.pathname === '/token';
    const microsoft = u.host === 'login.microsoftonline.com' && u.pathname.endsWith('/oauth2/v2.0/token');
    if (!google && !microsoft) return;
    const provider: Provider = google ? 'google' : 'microsoft';
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.clone().json()) as Record<string, unknown>;
    } catch {
      return;
    }
    const token = typeof body?.access_token === 'string' ? body.access_token : null;
    if (!token) return;
    const grant = form.get('grant_type');
    if (grant === 'client_credentials') {
      access.set(token, { provider, email: null, app: true });
      return;
    }
    let email: string | null = null;
    if (grant === 'authorization_code' && typeof body?.id_token === 'string') {
      try {
        const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8')) as Record<string, string>;
        email = lower(claims.email ?? claims.preferred_username ?? '');
      } catch {
        email = null;
      }
    } else if (grant === 'refresh_token') {
      email = refresh.get(form.get('refresh_token') ?? '')?.email ?? null;
    }
    if (!email) return;
    access.set(token, { provider, email });
    if (typeof body?.refresh_token === 'string') refresh.set(body.refresh_token, { provider, email });
  }

  async function handle(url: string, init: Parameters<MeetingFetch>[1], next?: MeetingFetch): Promise<Response> {
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
    const pass = async () => {
      if (!next) return json(599, { error: `The fake has no ${method} ${u.host}${u.pathname}` });
      const res = await next(url, init);
      await learn(url, form, res);
      return res;
    };

    // ---------- Zoho Accounts ----------
    if (ZOHO_ACCOUNTS.test(u.host)) {
      calls.push({ method, url, body: init.body ?? null });
      const dc = dcOf(u.host);
      if (u.pathname === '/oauth/v2/token' && method === 'POST') {
        // Zoho answers its refusals with 200 and an "error"
        if (form.get('client_id') !== apps.zoho.clientId) return json(200, { error: 'invalid_client' });
        if (form.get('client_secret') !== apps.zoho.clientSecret) return json(200, { error: 'invalid_client_secret' });
        if (form.get('grant_type') === 'authorization_code') {
          const c = codes.get(form.get('code') ?? '');
          if (!c || c.provider !== 'zoho' || c.dc !== dc || !form.get('code_verifier')) return json(200, { error: 'invalid_code' });
          if (!form.get('redirect_uri')?.endsWith('/calendars/oauth/zoho')) return json(200, { error: 'invalid_redirect_uri' });
          codes.delete(form.get('code')!);
          return json(200, {
            access_token: issue('zoho', c.email, { dc, ...(c.noEmail && { noEmail: true }) }),
            refresh_token: issueRefresh('zoho', c.email, dc),
            ...(c.noEmail ? {} : { id_token: jwt({ sub: `${run}.${n}`, email: c.email, email_verified: true, iss: `https://${u.host}` }) }),
            api_domain: `https://www.zohoapis.${dc.replace(/^zoho\./, '')}`,
            token_type: 'Bearer',
            expires_in: 3600,
          });
        }
        const r = refresh.get(form.get('refresh_token') ?? '');
        if (!r || r.provider !== 'zoho' || r.dc !== dc) return json(200, { error: 'invalid_code' });
        return json(200, { access_token: issue('zoho', r.email, { dc }), api_domain: `https://www.zohoapis.${dc}`, token_type: 'Bearer', expires_in: 3600 });
      }
      if (u.pathname === '/oauth/v2/revoke/token' && method === 'POST') {
        refresh.delete(form.get('token') ?? '');
        return json(200, { status: 'success' });
      }
      if (u.pathname === '/oauth/v2/userinfo') {
        const who = access.get(bearer(init.headers));
        if (!who || who.provider !== 'zoho') return json(401, { response: 'error', cause: 'INVALID_OAUTHTOKEN' });
        return json(200, { sub: `${run}`, ...(!who.noEmail && { email: who.email }), name: 'Zoho User' });
      }
      return json(404, { error: 'not_found' });
    }

    // ---------- Zoho Calendar ----------
    if (ZOHO_CALENDAR.test(u.host)) {
      calls.push({ method, url, body: init.body ?? null });
      const who = access.get(bearer(init.headers));
      // a token works only at its own data centre
      if (!who || who.provider !== 'zoho' || who.dc !== dcOf(u.host)) return json(401, { error: [{ description: 'Invalid OAuth token.', error_code: 'INVALID_OAUTHTOKEN', message: 'INVALID_OAUTHTOKEN' }] });
      if (u.pathname !== '/api/v1/calendars/freebusy' || method !== 'GET') return json(404, { error: [{ error_code: 'URL_NOT_FOUND', description: 'Not found.' }] });
      const email = u.searchParams.get('uemail');
      await delay(email, init.signal);
      const status = email ? failing.get(lower(email)) : undefined;
      if (status) return json(status, { error: [{ description: 'Free/busy of the user is not shared.', error_code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED' }] });
      const from = zohoTime(u.searchParams.get('sdate'));
      const to = zohoTime(u.searchParams.get('edate'));
      if (!email || !Number.isFinite(from) || !Number.isFinite(to)) return json(400, { error: [{ description: 'Invalid input.', error_code: 'INVALID_DATA' }] });
      return json(200, {
        freebusy: blocksOf(email, from, to).map((b) => ({ startTime: zohoStamp(b.start), endTime: zohoStamp(b.end), fbtype: b.tentative ? 'tentative' : 'busy', ...(b.title && { title: b.title }) })),
      });
    }

    // ---------- Google ----------
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const c = codes.get(form.get('code') ?? '');
      const r = refresh.get(form.get('refresh_token') ?? '');
      const mine = (form.get('grant_type') === 'authorization_code' && c?.provider === 'google') || (form.get('grant_type') === 'refresh_token' && r?.provider === 'google' && !!r && r.dc === 'google');
      if (!mine || !apps.google) return pass();
      calls.push({ method, url, body: init.body ?? null });
      if (form.get('client_id') !== apps.google.clientId || form.get('client_secret') !== apps.google.clientSecret) return json(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
      if (form.get('grant_type') === 'authorization_code') {
        if (!form.get('code_verifier') || !form.get('redirect_uri')?.endsWith('/calendars/oauth/google')) return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        codes.delete(form.get('code')!);
        return json(200, {
          access_token: issue('google', c!.email),
          refresh_token: issueRefresh('google', c!.email, 'google'),
          expires_in: 3599,
          id_token: jwt({ email: c!.email, email_verified: true }),
          scope: c!.scope ?? 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.freebusy',
          token_type: 'Bearer',
        });
      }
      return json(200, { access_token: issue('google', r!.email), expires_in: 3599, token_type: 'Bearer' });
    }
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
      const token = form.get('token') ?? '';
      if (!refresh.get(token) || refresh.get(token)!.dc !== 'google') return pass();
      calls.push({ method, url, body: init.body ?? null });
      refresh.delete(token);
      return json(200, {});
    }
    if (u.host === 'www.googleapis.com' && u.pathname === '/calendar/v3/freeBusy') {
      calls.push({ method, url, body: init.body ?? null });
      const who = access.get(bearer(init.headers));
      if (!who || who.provider !== 'google' || !who.email) return json(401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
      await delay(who.email, init.signal);
      const status = failing.get(lower(who.email));
      if (status) return json(status, { error: { code: status, message: 'Backend Error', errors: [{ reason: 'backendError' }] } });
      const from = Date.parse(String(body.timeMin));
      const to = Date.parse(String(body.timeMax));
      return json(200, {
        kind: 'calendar#freeBusy',
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        calendars: { primary: { busy: blocksOf(who.email, from, to).map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), ...(b.title && { summary: b.title }) })) } },
      });
    }

    // ---------- Microsoft ----------
    if (apps.microsoft && u.host === 'login.microsoftonline.com' && u.pathname === `/${apps.microsoft.tenantId}/oauth2/v2.0/token`) {
      const c = codes.get(form.get('code') ?? '');
      const r = refresh.get(form.get('refresh_token') ?? '');
      const mine = (form.get('grant_type') === 'authorization_code' && c?.provider === 'microsoft') || (form.get('grant_type') === 'refresh_token' && r?.provider === 'microsoft' && r.dc === 'microsoft');
      if (!mine) return pass();
      calls.push({ method, url, body: init.body ?? null });
      if (form.get('client_id') !== apps.microsoft.clientId || form.get('client_secret') !== apps.microsoft.clientSecret) {
        return json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.', error_codes: [7000215] });
      }
      if (form.get('grant_type') === 'authorization_code') {
        codes.delete(form.get('code')!);
        return json(200, { token_type: 'Bearer', expires_in: 3599, access_token: issue('microsoft', c!.email), refresh_token: issueRefresh('microsoft', c!.email, 'microsoft'), id_token: jwt({ preferred_username: c!.email }) });
      }
      refresh.delete(form.get('refresh_token')!);
      return json(200, { token_type: 'Bearer', expires_in: 3599, access_token: issue('microsoft', r!.email), refresh_token: issueRefresh('microsoft', r!.email, 'microsoft') });
    }
    if (u.host === 'graph.microsoft.com' && u.pathname.endsWith('/calendar/getSchedule') && method === 'POST') {
      calls.push({ method, url, body: init.body ?? null });
      const who = access.get(bearer(init.headers));
      if (!who || who.provider !== 'microsoft') return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } });
      const mailbox = /^\/v1\.0\/users\/([^/]+)\/calendar\/getSchedule$/.exec(u.pathname)?.[1];
      if (mailbox && !who.app) return json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } });
      const schedules = Array.isArray(body.schedules) ? (body.schedules as string[]) : [];
      for (const s of schedules) await delay(s, init.signal);
      const time = (v: unknown) => Date.parse(`${String((v as { dateTime?: string })?.dateTime ?? '').slice(0, 19)}Z`);
      const from = time(body.startTime);
      const to = time(body.endTime);
      const at = (d: Date) => ({ dateTime: `${d.toISOString().slice(0, 19)}.0000000`, timeZone: 'UTC' });
      return json(200, {
        value: schedules.map((s) =>
          failing.has(lower(s))
            ? { scheduleId: s, error: { message: 'The free/busy of the mailbox is not shared.', responseCode: 'ErrorAccessDenied' } }
            : {
                scheduleId: s,
                availabilityView: '',
                scheduleItems: blocksOf(s, from, to).map((b) => ({
                  isPrivate: false,
                  status: b.tentative ? 'tentative' : 'busy',
                  subject: b.title ?? 'Busy',
                  location: 'Room 4',
                  start: at(b.start),
                  end: at(b.end),
                })),
                workingHours: {},
              },
        ),
      });
    }

    return pass();
  }

  return {
    fetch: (url, init) => handle(url, init),
    wrap: (next) => (url, init) => handle(url, init, next),
    calls,
    secrets,
    code(provider, code, email, accountsServer, options = {}) {
      const dc = provider === 'zoho' ? dcOf(new URL(accountsServer ?? 'https://accounts.zoho.com').host) : provider;
      codes.set(code, { provider, email: lower(email), dc, ...options });
    },
    busy(email, blocks) {
      busy.set(lower(email), blocks);
    },
    fail(email, status = 403) {
      failing.set(lower(email), status);
    },
    heal(email) {
      failing.delete(lower(email));
      slow.delete(lower(email));
    },
    slow(email, ms) {
      slow.set(lower(email), ms);
    },
    revoke(email) {
      for (const [t, w] of access) if (w.email === lower(email)) access.delete(t);
      for (const [t, w] of refresh) if (w.email === lower(email)) refresh.delete(t);
    },
  };
}
