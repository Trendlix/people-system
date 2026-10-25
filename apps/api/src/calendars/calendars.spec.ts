import {
  accountIsTheirs,
  calendarAppProblems,
  calendarRedirectUri,
  CALENDAR_CALLBACK_PATHS,
  GOOGLE_FREEBUSY_SCOPE,
  isMaskedEmail,
  maskedEmail,
  otherAccountText,
  uncheckedAccountText,
  zohoAppReady,
  zohoDataCentre,
  zohoDataCentreOfAccounts,
  ZOHO_CALENDAR_SCOPES,
} from '@trendlix/shared';
import { randomBytes } from 'node:crypto';
import { grantsScope, type HttpAnswer } from '../meetings/meeting-providers.js';
import {
  calendarAuthorizeUrl,
  calendarCodeRequest,
  calendarGrantOf,
  calendarProblemOf,
  CalendarProviderError,
  calendarRefreshRequest,
  googleBusyOf,
  googleFreeBusyRequest,
  graphBusyOf,
  graphScheduleRequest,
  zohoBusyOf,
  zohoEmailOf,
  zohoFreeBusyRequest,
  zohoHosts,
  zohoMoment,
  zohoRevokeRequest,
  zohoStamp,
} from './calendar-providers.js';
import { calendarKeyIdOf, calendarKeyOf, openCalendarSecret, sameCalendarKey, sealCalendarSecret } from './calendar-secret.js';

// Calendars read for interviewers' busy times (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"): the
// sealing, Zoho's sign-in at each data centre, the free/busy requests and their answers read (busy and free only: an
// event's title and place never read), and the refusals in plain words. Pure: no calendar is called.

const ok = (body: unknown, status = 200): HttpAnswer => ({ status, body });
const formOf = (body: string | undefined) => Object.fromEntries(new URLSearchParams(body ?? ''));
const SECRET = 'zoho-secret-0123456789';
const app = { clientId: '1000.ABCDEFGHIJ1234567890', clientSecret: SECRET };

describe('Calendar secrets', () => {
  const key = calendarKeyOf('jwt-secret-for-tests');

  it('seal and open a value for its purpose only, with a new IV each time', () => {
    const a = sealCalendarSecret('refresh-1', key, 'refresh_token');
    const b = sealCalendarSecret('refresh-1', key, 'refresh_token');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(openCalendarSecret(a, key, 'refresh_token')).toBe('refresh-1');
    // another purpose, another key, a changed value: never opened
    expect(openCalendarSecret(a, key, 'client_secret')).toBeNull();
    expect(openCalendarSecret(a, calendarKeyOf('another-secret'), 'refresh_token')).toBeNull();
    expect(openCalendarSecret(`${a.slice(0, -2)}xx`, key, 'refresh_token')).toBeNull();
    expect(openCalendarSecret('not sealed', key, 'refresh_token')).toBeNull();
  });

  it('keep the key apart from the meetings’ and fingerprint it without showing it', () => {
    const id = calendarKeyIdOf(key);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(sameCalendarKey(id, key)).toBe(true);
    expect(sameCalendarKey(id, calendarKeyOf(randomBytes(16).toString('hex')))).toBe(false);
    expect(sameCalendarKey(null, key)).toBe(false);
  });
});

describe('Zoho’s app and data centres', () => {
  it('check the client ID’s shape, the secret on one line and the data centre', () => {
    expect(calendarAppProblems({ clientId: app.clientId, clientSecret: SECRET, dataCentre: 'eu' })).toEqual([]);
    expect(calendarAppProblems({ clientId: 'abc', clientSecret: 'two words', dataCentre: 'mars' })).toHaveLength(3);
    expect(zohoAppReady({ clientId: app.clientId, clientSecretSet: true, dataCentre: 'com' })).toBe(true);
    expect(zohoAppReady({ clientId: app.clientId, clientSecretSet: false, dataCentre: 'com' })).toBe(false);
  });

  it('know each data centre’s sign-in and calendar addresses, Canada’s zohocloud.ca too', () => {
    expect(zohoDataCentreOfAccounts('https://accounts.zoho.eu/')).toBe('eu');
    expect(zohoDataCentreOfAccounts('https://accounts.zohocloud.ca')).toBe('ca');
    expect(zohoDataCentreOfAccounts('https://evil.example')).toBeNull();
    expect(zohoHosts('https://accounts.zoho.in')).toEqual({ accounts: 'https://accounts.zoho.in', calendar: 'https://calendar.zoho.in' });
    expect(zohoHosts('https://accounts.zohocloud.ca').calendar).toBe('https://calendar.zohocloud.ca');
    // anything unknown: the US one
    expect(zohoHosts(null)).toEqual({ accounts: 'https://accounts.zoho.com', calendar: 'https://calendar.zoho.com' });
    expect(zohoDataCentre('sa').accounts).toBe('https://accounts.zoho.sa');
    expect(calendarRedirectUri('https://people.trendlix.com/', 'zoho')).toBe(`https://people.trendlix.com${CALENDAR_CALLBACK_PATHS.zoho}`);
  });
});

describe('Signing in', () => {
  const redirectUri = 'https://people.trendlix.com/calendars/oauth/zoho';

  it('asks Zoho for the free/busy only and the email, comma-separated, offline, with PKCE, at the app’s data centre', () => {
    const url = new URL(calendarAuthorizeUrl('zoho', app, { redirectUri, state: 'st', challenge: 'ch', accounts: 'https://accounts.zoho.eu' }));
    expect(url.origin + url.pathname).toBe('https://accounts.zoho.eu/oauth/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      scope: 'ZohoCalendar.freebusy.READ,email',
      access_type: 'offline',
      prompt: 'consent',
    });
    expect(ZOHO_CALENDAR_SCOPES).toEqual(['ZohoCalendar.freebusy.READ', 'email']);
    expect(url.toString()).not.toContain(SECRET);
  });

  it('asks Google for the free/busy scope and Microsoft for Calendars.ReadBasic', () => {
    const g = new URL(calendarAuthorizeUrl('google', { clientId: 'g.apps.googleusercontent.com' }, { redirectUri, state: 'st', challenge: 'ch' }));
    expect(g.searchParams.get('scope')).toBe(`openid email ${GOOGLE_FREEBUSY_SCOPE}`);
    expect(g.searchParams.get('access_type')).toBe('offline');
    const m = new URL(calendarAuthorizeUrl('microsoft', { clientId: 'c', tenantId: 'tenant-1' }, { redirectUri, state: 'st', challenge: 'ch' }));
    expect(m.pathname).toBe('/tenant-1/oauth2/v2.0/authorize');
    expect(m.searchParams.get('scope')).toBe('openid email profile offline_access https://graph.microsoft.com/Calendars.ReadBasic');
  });

  it('trades Zoho’s code and refreshes at the account’s own data centre', () => {
    const code = calendarCodeRequest('zoho', app, { code: 'c1', redirectUri, verifier: 'v1', accounts: 'https://accounts.zoho.eu' });
    expect(code.url).toBe('https://accounts.zoho.eu/oauth/v2/token');
    expect(formOf(code.body)).toEqual({ grant_type: 'authorization_code', code: 'c1', redirect_uri: redirectUri, client_id: app.clientId, client_secret: SECRET, code_verifier: 'v1' });
    const refresh = calendarRefreshRequest('zoho', app, 'r1', 'https://accounts.zoho.in');
    expect(refresh.url).toBe('https://accounts.zoho.in/oauth/v2/token');
    expect(formOf(refresh.body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' });
    const revoke = zohoRevokeRequest(app, 'https://accounts.zoho.eu', 'r1');
    expect(revoke.url).toBe('https://accounts.zoho.eu/oauth/v2/revoke/token');
    expect(revoke.headers.authorization).toMatch(/^Basic /);
    expect(formOf(revoke.body)).toEqual({ token: 'r1', token_type: 'refresh_token' });
  });

  it('reads the tokens, Zoho’s refusals answered with 200 too, and the account’s email', () => {
    expect(calendarGrantOf('zoho', ok({ access_token: 'a', refresh_token: 'r', expires_in: 3600, api_domain: 'https://www.zohoapis.eu', token_type: 'Bearer' }))).toMatchObject({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 });
    expect(() => calendarGrantOf('zoho', ok({ error: 'invalid_code' }), 'connect')).toThrow('Zoho refused the sign-in: it took too long or was used already. Connect again.');
    const refused = (() => {
      try {
        calendarGrantOf('zoho', ok({ error: 'invalid_code' }));
      } catch (err) {
        return err as CalendarProviderError;
      }
    })();
    expect(refused?.kind).toBe('reconnect');
    expect(zohoEmailOf(ok({ email: 'HR@Trendlix.test', sub: '1' }))).toBe('hr@trendlix.test');
    expect(zohoEmailOf(ok({}, 401))).toBeNull();
    expect(grantsScope(`openid ${GOOGLE_FREEBUSY_SCOPE} email`, GOOGLE_FREEBUSY_SCOPE)).toBe(true);
    expect(grantsScope('openid email', GOOGLE_FREEBUSY_SCOPE)).toBe(false);
  });
});

describe('Busy times', () => {
  const from = new Date('2026-11-01T06:00:00Z');
  const to = new Date('2026-11-03T06:00:00Z');

  it('asks Zoho for someone’s free/busy by email, a day wider each side, with Zoho’s own token prefix', () => {
    const r = zohoFreeBusyRequest('https://accounts.zoho.eu', 'tok', 'sara@trendlix.test', from, to);
    const url = new URL(r.url);
    expect(url.origin + url.pathname).toBe('https://calendar.zoho.eu/api/v1/calendars/freebusy');
    expect(Object.fromEntries(url.searchParams)).toEqual({ uemail: 'sara@trendlix.test', sdate: '20261031T060000', edate: '20261104T060000', ftype: 'eventbased' });
    expect(r.headers.authorization).toBe('Zoho-oauthtoken tok');
    expect(zohoStamp(from)).toBe('20261101T060000');
    expect(zohoMoment('20261101T083000Z')).toBe(Date.parse('2026-11-01T08:30:00Z'));
    expect(zohoMoment('bad')).toBeNaN();
  });

  it('reads Zoho’s answer: busy and tentative kept, free left out, cut to the range', () => {
    const busy = zohoBusyOf(
      ok({
        freebusy: [
          { startTime: '20261101T080000Z', endTime: '20261101T090000Z', fbtype: 'busy' },
          { startTime: '20261101T100000Z', endTime: '20261101T103000Z', fbtype: 'tentative' },
          { startTime: '20261101T120000Z', endTime: '20261101T130000Z', fbtype: 'free' },
          // the day before the range (asked a day wider): left out; across its end: cut
          { startTime: '20261030T080000Z', endTime: '20261030T090000Z', fbtype: 'busy' },
          { startTime: '20261103T050000Z', endTime: '20261103T070000Z', fbtype: 'busy' },
        ],
      }),
      from,
      to,
    );
    expect(busy).toEqual([
      { start: Date.parse('2026-11-01T08:00:00Z'), end: Date.parse('2026-11-01T09:00:00Z'), tentative: false },
      { start: Date.parse('2026-11-01T10:00:00Z'), end: Date.parse('2026-11-01T10:30:00Z'), tentative: true },
      { start: Date.parse('2026-11-03T05:00:00Z'), end: to.getTime(), tentative: false },
    ]);
    expect(() => zohoBusyOf(ok({ error: [{ error_code: 'INVALID_OAUTHTOKEN', description: 'Invalid OAuth token.' }] }), from, to)).toThrow(CalendarProviderError);
    expect(() => zohoBusyOf(null, from, to)).toThrow('Zoho couldn’t be reached in time. Try again in a moment.');
  });

  it('reads Google’s freeBusy on the primary calendar', () => {
    const r = googleFreeBusyRequest('tok', from, to);
    expect(r.url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
    expect(JSON.parse(r.body!)).toEqual({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] });
    const busy = googleBusyOf(ok({ kind: 'calendar#freeBusy', calendars: { primary: { busy: [{ start: '2026-11-01T08:00:00Z', end: '2026-11-01T09:00:00Z', summary: 'Secret plan' }] } } }), from, to);
    expect(busy).toEqual([{ start: Date.parse('2026-11-01T08:00:00Z'), end: Date.parse('2026-11-01T09:00:00Z'), tentative: false }]);
    expect(JSON.stringify(busy)).not.toContain('Secret');
    expect(() => googleBusyOf(ok({ calendars: { primary: { errors: [{ domain: 'global', reason: 'notFound' }] } } }), from, to)).toThrow('Google couldn’t read the calendar (notFound).');
  });

  it('reads Graph’s getSchedule per mailbox, never its subjects or places', () => {
    const r = graphScheduleRequest('tok', 'hr@trendlix.test', ['sara@trendlix.test'], from, to);
    expect(r.url).toBe('https://graph.microsoft.com/v1.0/users/hr%40trendlix.test/calendar/getSchedule');
    expect(JSON.parse(r.body!)).toMatchObject({ schedules: ['sara@trendlix.test'], startTime: { dateTime: '2026-11-01T06:00:00', timeZone: 'UTC' } });
    expect(graphScheduleRequest('tok', null, ['me@trendlix.test'], from, to).url).toBe('https://graph.microsoft.com/v1.0/me/calendar/getSchedule');
    const all = graphBusyOf(
      ok({
        value: [
          {
            scheduleId: 'Sara@Trendlix.test',
            scheduleItems: [
              { status: 'busy', subject: 'Salary talk', location: 'Room 4', isPrivate: false, start: { dateTime: '2026-11-01T08:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T09:00:00.0000000', timeZone: 'UTC' } },
              { status: 'tentative', start: { dateTime: '2026-11-01T10:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T10:30:00.0000000', timeZone: 'UTC' } },
              { status: 'free', start: { dateTime: '2026-11-01T11:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-01T12:00:00.0000000', timeZone: 'UTC' } },
            ],
          },
          { scheduleId: 'omar@trendlix.test', error: { message: 'The user is not found.', responseCode: 'ErrorMailRecipientNotFound' } },
        ],
      }),
      from,
      to,
    );
    expect(all.get('sara@trendlix.test')).toEqual([
      { start: Date.parse('2026-11-01T08:00:00Z'), end: Date.parse('2026-11-01T09:00:00Z'), tentative: false },
      { start: Date.parse('2026-11-01T10:00:00Z'), end: Date.parse('2026-11-01T10:30:00Z'), tentative: true },
    ]);
    expect(JSON.stringify(all.get('sara@trendlix.test'))).not.toMatch(/Salary|Room/);
    expect(all.get('omar@trendlix.test')).toBeInstanceOf(CalendarProviderError);
  });
});

describe('Refusals in plain words', () => {
  const words = (provider: 'zoho' | 'google' | 'microsoft', answer: HttpAnswer | null, doing: 'connect' | 'token' | 'busy' = 'busy') => {
    const e = calendarProblemOf(provider, answer, doing);
    return [e.kind, e.message, e.code];
  };

  it('point a Super Admin at the app, the person at reconnecting, everyone at trying again', () => {
    expect(words('zoho', ok({ error: 'invalid_client' }), 'connect')).toEqual(['app', 'Zoho refused the app’s client ID or secret: a Super Admin checks them on Organization → Calendars.', 'invalid_client']);
    expect(words('zoho', ok({ error: 'invalid_redirect_uri' }), 'connect')[0]).toBe('app');
    expect(words('zoho', ok({ error: 'Access Denied', error_description: 'You have made too many requests continuously.' }), 'token')[0]).toBe('busy');
    expect(words('zoho', ok({ error: [{ error_code: 'INVALID_OAUTHTOKEN', description: 'Invalid OAuth token.' }] }, 401))).toEqual(['token', 'Zoho refused the connection’s sign-in: connect the account again.', 'INVALID_OAUTHTOKEN']);
    expect(words('google', ok({ error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }, 403))[0]).toBe('reconnect');
    expect(words('microsoft', ok({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }, 403))[1]).toBe('Microsoft refused access to the calendars: grant Calendars.ReadBasic (or Calendars.ReadWrite) with admin consent.');
    expect(words('google', ok({}, 503))[0]).toBe('busy');
    expect(words('zoho', null)).toEqual(['unreachable', 'Zoho couldn’t be reached in time. Try again in a moment.', null]);
  });

  it('never put a token or a secret in its words', () => {
    const e = calendarProblemOf('zoho', ok({ error: 'invalid_client', error_description: 'Bad client' }), 'connect');
    expect(e.message).not.toContain(SECRET);
  });
});

describe('Whose account it is (25 October 2026: "by acting as them")', () => {
  const MONA = ['mona@trendlix.com', 'user17-1@test.local', 'Mona.Home@Gmail.com'];

  it('is the person’s when its email is any of theirs, in any case: work, sign-in or personal', () => {
    expect(accountIsTheirs('mona@trendlix.com', MONA)).toBe(true);
    expect(accountIsTheirs('MONA@TRENDLIX.COM', MONA)).toBe(true);
    expect(accountIsTheirs(' User17-1@Test.Local ', MONA)).toBe(true);
    expect(accountIsTheirs('mona.home@gmail.com', MONA)).toBe(true);
    // the Super Admin's own, or anyone else's
    expect(accountIsTheirs('hazem@trendlix.com', MONA)).toBe(false);
    expect(accountIsTheirs('mona@trendlix.co', MONA)).toBe(false);
    // nothing to compare: never theirs
    expect(accountIsTheirs(null, MONA)).toBe(false);
    expect(accountIsTheirs('', MONA)).toBe(false);
    expect(accountIsTheirs('not an email', ['not an email'])).toBe(false);
    expect(accountIsTheirs('mona@trendlix.com', [null, undefined, ''])).toBe(false);
  });

  it('shows the account’s email masked, and only that shape from a return address', () => {
    expect(maskedEmail('Hazem.Magdy@Trendlix.com')).toBe('ha***@trendlix.com');
    expect(maskedEmail('ali@trendlix.com')).toBe('a***@trendlix.com');
    expect(maskedEmail('a@b.co')).toBe('a***@b.co');
    expect(maskedEmail('nobody')).toBeNull();
    expect(maskedEmail('@trendlix.com')).toBeNull();
    expect(maskedEmail(null)).toBeNull();
    expect(isMaskedEmail('ha***@trendlix.com')).toBe(true);
    expect(isMaskedEmail('hazem@trendlix.com')).toBe(false);
    expect(isMaskedEmail('ha***@trendlix.com. Click here')).toBe(false);
    expect(isMaskedEmail('<b>***@x.com')).toBe(false);
  });

  it('says whose it should have been, in the brief’s words', () => {
    expect(otherAccountText('Zoho', { account: 'ha***@trendlix.com', person: 'Mona Hassan' })).toBe(
      'This Zoho account is ha***@trendlix.com, not Mona Hassan’s. Sign out of Zoho in this browser, then sign in as Mona Hassan.',
    );
    expect(otherAccountText('Google', { account: null, person: 'Mona Hassan' })).toBe('This Google account isn’t Mona Hassan’s. Sign out of Google in this browser, then sign in as Mona Hassan.');
    expect(otherAccountText('Zoho', { account: 'so***@gmail.com' })).toBe(
      'This Zoho account is so***@gmail.com, not one of your emails (work, sign-in or personal). Sign out of Zoho in this browser, then sign in with your own.',
    );
    // anything but a masked email is left out
    expect(otherAccountText('Zoho', { account: 'evil text', person: null })).toBe(
      'This Zoho account isn’t one of your emails (work, sign-in or personal). Sign out of Zoho in this browser, then sign in with your own.',
    );
    expect(uncheckedAccountText('Zoho', { person: 'Mona Hassan' })).toBe(
      'Zoho didn’t say which account signed in, so it couldn’t be checked as Mona Hassan’s and nothing was connected. Try again, or Mona Hassan connects it in their own session.',
    );
  });
});
