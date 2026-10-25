import type { MeetingFetch } from '../src/meetings/meeting-http.js';
import type { ZohoClock } from '../src/zoho-people/zoho-people-http.js';

// Zoho Accounts and Zoho People as the tests see them (owner, 25 October 2026: "can i fetch checkin and out transactions
// from zoho people through api?"; the brief: "Mock Zoho's HTTP in e2e, as calendars.e2e mocks Zoho Calendar"): one fake
// in ZohoPeopleHttp's place, answering Zoho Accounts at each data centre (the sign-in's code, the refresh, userinfo,
// revoking) and Zoho People there (getAttendanceEntries, one employee's day by emailId or empId, its date read in the
// format it names; the organization's time zone and date format), as the real ones do (their shapes and their errors:
// 7202 a refused token, 7209 its lock, 7048 no such user). No request leaves the machine. Its clock is the tests' own
// (a sleep moves it on at once), so the throttle's spacing and Zoho's lock are seen in the calls' times without waiting.
// Every token and secret it gives is distinctive and kept in `secrets`, so the tests search every answer and audit
// entry for them.

export interface FakeZohoCall {
  /** On the fake clock, in milliseconds. */
  at: number;
  method: string;
  url: string;
  who: string | null;
  date: string | null;
}

/** A clock whose sleep moves it on at once. */
export function virtualClock(start = Date.UTC(2026, 9, 25, 0, 0, 0)): ZohoClock & { t: number } {
  const c = {
    t: start,
    now: () => c.t,
    sleep: (ms: number) => {
      c.t += Math.max(0, ms);
      return Promise.resolve();
    },
  };
  return c;
}

export interface FakeZohoPeople {
  fetch: MeetingFetch;
  calls: FakeZohoCall[];
  secrets: Set<string>;
  /** A sign-in code that becomes a sign-in as this account, once, at `accountsServer`'s data centre. */
  code(code: string, email: string, accountsServer?: string): void;
  /** Someone Zoho People knows, by their email, and by their employee ID when given. */
  person(email: string, empId?: string): void;
  /** Someone's day as Zoho People answers it (getAttendanceEntries' body), replacing any given before. */
  day(email: string, date: string, body: Record<string, unknown>): void;
  /** The next `n` attendance calls answered with Zoho's lock (7209). */
  lock(n: number): void;
  /** Attendance calls wait until the returned release is called. */
  hold(): () => void;
  /** Zoho People answers 502 (down) until healed. */
  down(on: boolean): void;
  /** Every token given stops working (the sign-in revoked at Zoho). */
  revoke(): void;
  /** The organization's time zone and date format, as its Get Organization Info answers. */
  organization: { TimeZone: string; DateFormat: string };
}

const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (claims: object) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const ZOHO_ACCOUNTS = /^accounts\.(zoho\.(com|eu|in|com\.au|jp|sa|uk|ae|sg)|zohocloud\.ca)$/;
const ZOHO_PEOPLE = /^people\.(zoho\.(com|eu|in|com\.au|jp|sa|uk|ae|sg)|zohocloud\.ca)$/;
const dcOf = (host: string) => host.replace(/^(accounts|people)\./, '');
const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** Zoho's date in its format (the two the fake knows) as YYYY-MM-DD; null when it isn't in it. */
function dayIn(value: string, format: string): string | null {
  if (format === 'dd-MMM-yyyy') {
    const m = /^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/.exec(value);
    return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null;
  }
  if (format === 'yyyy-MM-dd') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  return null;
}

export function fakeZohoPeople(run: string, app: { clientId: string; clientSecret: string }, clock: ZohoClock): FakeZohoPeople {
  const calls: FakeZohoCall[] = [];
  const secrets = new Set<string>([app.clientSecret]);
  const codes = new Map<string, { email: string; dc: string }>();
  const access = new Map<string, { email: string; dc: string }>();
  const refresh = new Map<string, { email: string; dc: string }>();
  const known = new Map<string, string>(); // email or empId → email
  const days = new Map<string, Record<string, unknown>>();
  let locks = 0;
  let gate: Promise<void> | null = null;
  let isDown = false;
  let n = 0;
  const organization = { TimeZone: 'Africa/Cairo', DateFormat: 'dd-MMM-yyyy' };

  const issue = (email: string, dc: string) => {
    const token = `1000.zp-at-${run}-${++n}`;
    access.set(token, { email, dc });
    secrets.add(token);
    return token;
  };
  const bearer = (headers: Record<string, string>) => /^Zoho-oauthtoken (.+)$/.exec(headers.authorization ?? '')?.[1] ?? '';

  async function handle(url: string, init: Parameters<MeetingFetch>[1]): Promise<Response> {
    const u = new URL(url);
    const method = init.method;
    const form = new URLSearchParams(init.body ?? '');

    if (ZOHO_ACCOUNTS.test(u.host)) {
      calls.push({ at: clock.now(), method, url, who: null, date: null });
      const dc = dcOf(u.host);
      if (u.pathname === '/oauth/v2/token' && method === 'POST') {
        // Zoho answers its refusals with 200 and an "error"
        if (form.get('client_id') !== app.clientId) return json(200, { error: 'invalid_client' });
        if (form.get('client_secret') !== app.clientSecret) return json(200, { error: 'invalid_client_secret' });
        if (form.get('grant_type') === 'authorization_code') {
          const c = codes.get(form.get('code') ?? '');
          if (!c || c.dc !== dc || !form.get('code_verifier')) return json(200, { error: 'invalid_code' });
          if (!form.get('redirect_uri')?.endsWith('/zoho-people/oauth')) return json(200, { error: 'invalid_redirect_uri' });
          codes.delete(form.get('code')!);
          const rt = `1000.zp-rt-${run}-${++n}`;
          refresh.set(rt, { email: c.email, dc });
          secrets.add(rt);
          return json(200, {
            access_token: issue(c.email, dc),
            refresh_token: rt,
            id_token: jwt({ sub: `${run}.${n}`, email: c.email, email_verified: true }),
            api_domain: 'https://www.zohoapis.com',
            token_type: 'Bearer',
            expires_in: 3600,
          });
        }
        const r = refresh.get(form.get('refresh_token') ?? '');
        if (!r || r.dc !== dc) return json(200, { error: 'invalid_code' });
        return json(200, { access_token: issue(r.email, dc), api_domain: 'https://www.zohoapis.com', token_type: 'Bearer', expires_in: 3600 });
      }
      if (u.pathname === '/oauth/v2/revoke/token' && method === 'POST') {
        refresh.delete(form.get('token') ?? '');
        return json(200, { status: 'success' });
      }
      if (u.pathname === '/oauth/v2/userinfo') {
        const who = access.get(bearer(init.headers));
        return who ? json(200, { email: who.email }) : json(401, { response: 'error', cause: 'INVALID_OAUTHTOKEN' });
      }
      return json(404, { error: 'not_found' });
    }

    if (ZOHO_PEOPLE.test(u.host)) {
      const token = access.get(bearer(init.headers));
      const params = method === 'POST' ? form : u.searchParams;
      const who = params.get('emailId') ?? (params.get('empId') ? `emp:${params.get('empId')}` : null);
      const call: FakeZohoCall = { at: clock.now(), method, url: `${u.origin}${u.pathname}`, who, date: params.get('date') };
      calls.push(call);
      // a token works only at its own data centre
      if (!token || token.dc !== dcOf(u.host)) return json(200, { response: { message: 'Error occurred', errors: { code: 7202, message: 'Provided authentication token is invalid.' }, status: 1 } });
      if (u.pathname === '/api/v3/organization' && method === 'GET') return json(200, { ...organization, Company: run, TimeFormat: 'hh:mm a' });
      if (u.pathname !== '/people/api/attendance/getAttendanceEntries') return json(404, { response: { errors: { code: 7201, message: 'Invalid URL' }, status: 1 } });
      if (gate) await gate;
      if (isDown) return json(502, null);
      if (locks > 0) {
        locks--;
        return json(200, { response: { errors: { code: 7209, message: 'API access blocked since threshold limit exceeded. Please try after some time' }, status: 1 } });
      }
      const format = params.get('dateFormat') ?? organization.DateFormat;
      const date = dayIn(params.get('date') ?? '', format);
      if (!date) return json(200, { response: { errors: { code: 7055, message: 'Invalid date format' }, status: 1 } });
      const email = who ? known.get(who.toLowerCase()) : null;
      if (!email) return json(200, { response: { errors: { code: 7048, message: 'Invalid user / No such user found' }, status: 1 } });
      return json(200, days.get(`${email}|${date}`) ?? {});
    }
    return json(599, { error: `The fake has no ${method} ${u.host}${u.pathname}` });
  }

  return {
    fetch: (url, init) => handle(url, init),
    calls,
    secrets,
    organization,
    code(code, email, accountsServer = 'https://accounts.zoho.com') {
      codes.set(code, { email: email.toLowerCase(), dc: dcOf(new URL(accountsServer).host) });
    },
    person(email, empId) {
      known.set(email.toLowerCase(), email.toLowerCase());
      if (empId) known.set(`emp:${empId}`.toLowerCase(), email.toLowerCase());
    },
    day(email, date, body) {
      days.set(`${email.toLowerCase()}|${date}`, body);
    },
    lock(count) {
      locks = count;
    },
    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = () => {
          gate = null;
          resolve();
        };
      });
      return release;
    },
    down(on) {
      isDown = on;
    },
    revoke() {
      access.clear();
      refresh.clear();
    },
  };
}
