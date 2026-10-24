import {
  companyAppReady,
  GOOGLE_SCOPES,
  interviewProblems,
  isMeetingChoiceValue,
  MEETING_CALLBACK_PATHS,
  meetingAppProblems,
  meetingChoicesFor,
  meetingConnectProblemText,
  meetingRedirectUri,
  MICROSOFT_SCOPES,
  parseMeetingChoice,
  personalAppReady,
  providerOfLink,
  type ChoiceConnection,
  type MeetingProvider,
} from '@trendlix/shared';
import {
  appTokenRequest,
  authorizeUrl,
  codeTokenRequest,
  createRequest,
  deleteRequest,
  doneAnswer,
  emailOfIdToken,
  getRequest,
  goneAnswer,
  grantsGoogleCalendar,
  hostKept,
  madeOf,
  MeetingProviderError,
  pkcePair,
  problemOf,
  refreshRequest,
  targetOf,
  teamsNotAllowed,
  tokenGrantOf,
  updateRequest,
  zoomEmailOf,
  type HttpAnswer,
  type MeetingDetails,
} from './meeting-providers.js';
import { meetingKeyIdOf, meetingKeyOf, openMeetingSecret, sameMeetingKey, sealMeetingSecret } from './meeting-secret.js';

// Online interview meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; "Google Meet, Microsoft Teams, Zoom"; "make it both"): the secrets sealed, the choices a
// scheduler has, each provider's requests built and answers read (made, moved, deleted), and every refusal in plain
// words. Pure code: no provider is called (the requests are only built and the answers invented).

const SECRET = 'app-secret-Zq9!-never-shown';
const TOKEN = 'access-token-Xy7-never-shown';
const START = new Date('2026-11-05T08:30:00.000Z'); // 10:30 in Cairo
const DETAILS: MeetingDetails = { title: 'Interview: Sara Applicant · Video Editor', description: 'Online interview for Video Editor (VAC-0007).', start: START, minutes: 45, requestId: 'req-1' };
const ok = (body: unknown, status = 200): HttpAnswer => ({ status, body });
const bodyOf = (b: string | undefined) => JSON.parse(b ?? '{}') as Record<string, unknown>;
const formOf = (b: string | undefined) => Object.fromEntries(new URLSearchParams(b ?? ''));
const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('the meetings’ secrets', () => {
  const key = meetingKeyOf('a-jwt-secret-for-the-tests-only');

  it('seals and opens a secret for its purpose, a new IV each time', () => {
    const a = sealMeetingSecret(SECRET, key, 'client_secret');
    const b = sealMeetingSecret(SECRET, key, 'client_secret');
    expect(a).not.toBe(b);
    expect(a).not.toContain(SECRET);
    expect(a.split(':')).toHaveLength(4);
    expect(openMeetingSecret(a, key, 'client_secret')).toBe(SECRET);
    expect(openMeetingSecret(b, key, 'client_secret')).toBe(SECRET);
  });

  it('opens nothing sealed for another purpose, with another key, or changed', () => {
    const sealed = sealMeetingSecret(TOKEN, key, 'refresh_token');
    expect(openMeetingSecret(sealed, key, 'oauth_state')).toBeNull();
    expect(openMeetingSecret(sealed, meetingKeyOf('another-jwt-secret'), 'refresh_token')).toBeNull();
    const [v, iv, tag, data] = sealed.split(':');
    const flipped = `${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}`;
    expect(openMeetingSecret([v, iv, tag, flipped].join(':'), key, 'refresh_token')).toBeNull();
    expect(openMeetingSecret('not sealed', key, 'refresh_token')).toBeNull();
    expect(openMeetingSecret(null, key, 'refresh_token')).toBeNull();
  });

  it('keeps its key apart from the email password’s, and tells its key by a fingerprint', () => {
    expect(meetingKeyOf('s').equals(meetingKeyOf('s'))).toBe(true);
    expect(meetingKeyIdOf(key)).toMatch(/^[0-9a-f]{12}$/);
    expect(sameMeetingKey(meetingKeyIdOf(key), key)).toBe(true);
    expect(sameMeetingKey(meetingKeyIdOf(meetingKeyOf('other')), key)).toBe(false);
    expect(sameMeetingKey(null, key)).toBe(false);
    expect(() => meetingKeyOf('')).toThrow();
  });
});

describe('“Create the meeting with”: the choices', () => {
  const conn = (provider: MeetingProvider, owner: 'company' | 'personal', status: 'connected' | 'needs_reconnecting' = 'connected'): ChoiceConnection => ({ provider, owner, status });
  const all = () => true;
  const keys = (r: { choices: { key: string }[] }) => r.choices.map((c) => c.key);

  it('puts the company’s default first, then the scheduler’s own, then the company’s others', () => {
    const r = meetingChoicesFor({
      company: [conn('zoom', 'company'), conn('google', 'company'), conn('microsoft', 'company')],
      mine: [conn('zoom', 'personal'), conn('google', 'personal')],
      companyReady: all,
      personalReady: all,
      defaultChoice: 'company:zoom',
    });
    expect(keys(r)).toEqual(['company:zoom', 'personal:google', 'personal:zoom', 'company:google', 'company:microsoft']);
    expect(r.start).toBe('company:zoom');
    expect(r.choices.map((c) => c.label)).toEqual(['Company Zoom', 'My Google Meet', 'My Zoom', 'Company Google Meet', 'Company Microsoft Teams']);
  });

  it('starts on their own without a company default, and on "Paste a link" with nothing connected', () => {
    const r = meetingChoicesFor({ company: [conn('google', 'company')], mine: [conn('microsoft', 'personal')], companyReady: all, personalReady: all, defaultChoice: null });
    expect(keys(r)).toEqual(['personal:microsoft', 'company:google']);
    expect(r.start).toBe('personal:microsoft');
    expect(meetingChoicesFor({ company: [], mine: [], companyReady: all, personalReady: all, defaultChoice: null })).toEqual({ choices: [], start: 'link' });
  });

  it('leaves out a connection whose app credentials are missing, or that needs connecting again', () => {
    const r = meetingChoicesFor({
      company: [conn('google', 'company'), conn('microsoft', 'company'), conn('zoom', 'company', 'needs_reconnecting')],
      mine: [conn('zoom', 'personal'), conn('google', 'personal', 'needs_reconnecting')],
      // the company's Microsoft app has lost its secret; Zoom's General app isn't set up
      companyReady: (p) => p !== 'microsoft',
      personalReady: (p) => p !== 'zoom',
      defaultChoice: 'company:microsoft',
    });
    expect(keys(r)).toEqual(['company:google']);
    expect(r.start).toBe('company:google');
  });

  it('gives a Super Admin acting as someone the company’s only', () => {
    const r = meetingChoicesFor({ company: [conn('google', 'company')], mine: [conn('zoom', 'personal')], companyReady: all, personalReady: all, defaultChoice: null, viewingAs: true });
    expect(keys(r)).toEqual(['company:google']);
  });

  it('knows when each app can host the company’s meetings and each HR person’s own', () => {
    const app = { clientId: 'id', clientSecretSet: true, tenantId: null, accountId: null, userClientId: null, userClientSecretSet: false };
    expect(companyAppReady('google', app)).toBe(true);
    expect(personalAppReady('google', app)).toBe(true);
    expect(companyAppReady('google', { ...app, clientSecretSet: false })).toBe(false);
    // Microsoft needs its tenant; Zoom's company app its account, its personal ones the General app
    expect(companyAppReady('microsoft', app)).toBe(false);
    expect(companyAppReady('microsoft', { ...app, tenantId: 't' })).toBe(true);
    expect(personalAppReady('microsoft', { ...app, tenantId: 't' })).toBe(true);
    const zoomServerToServer = { ...app, accountId: 'acc' };
    expect(companyAppReady('zoom', zoomServerToServer)).toBe(true);
    expect(personalAppReady('zoom', zoomServerToServer)).toBe(false);
    expect(personalAppReady('zoom', { ...app, userClientId: 'u', userClientSecretSet: true })).toBe(true);
    expect(companyAppReady('zoom', null)).toBe(false);
  });

  it('reads a choice, and lets an interview without one keep its pasted link', () => {
    expect(parseMeetingChoice('company:google')).toEqual({ owner: 'company', provider: 'google' });
    expect(parseMeetingChoice('personal:zoom')).toEqual({ owner: 'personal', provider: 'zoom' });
    for (const bad of ['link', 'keep', 'company:skype', 'team:zoom', 'company:zoom:x', '', null, 3]) expect(parseMeetingChoice(bad)).toBeNull();
    for (const fine of [undefined, null, '', 'link', 'keep', 'company:microsoft']) expect(isMeetingChoiceValue(fine)).toBe(true);
    expect(isMeetingChoiceValue('company:skype')).toBe(false);
    const now = Date.UTC(2026, 9, 24);
    const base = { date: '2026-11-05', time: '10:30', minutes: 45, kind: 'online' as const, interviewerIds: ['a'] };
    expect(interviewProblems({ ...base, location: null }, START.getTime(), now)).toEqual(['Give the meeting’s link in full, starting with https://.']);
    expect(interviewProblems({ ...base, location: null, meeting: 'link' }, START.getTime(), now)).toEqual(['Give the meeting’s link in full, starting with https://.']);
    expect(interviewProblems({ ...base, location: null, meeting: 'company:google' }, START.getTime(), now)).toEqual([]);
    expect(interviewProblems({ ...base, location: null, meeting: 'keep' }, START.getTime(), now)).toEqual([]);
    expect(interviewProblems({ ...base, location: 'https://meet.google.com/abc-defg-hij' }, START.getTime(), now)).toEqual([]);
    expect(interviewProblems({ ...base, location: null, meeting: 'company:skype' }, START.getTime(), now)).toEqual(['Choose what creates the meeting, or paste its link.']);
  });

  it('names the service of a link pasted or made, and makes each redirect URI from the website’s address', () => {
    expect(providerOfLink('https://meet.google.com/abc-defg-hij')).toBe('google');
    expect(providerOfLink('https://teams.microsoft.com/l/meetup-join/19%3a…')).toBe('microsoft');
    expect(providerOfLink('https://us06web.zoom.us/j/8123456789?pwd=abc')).toBe('zoom');
    expect(providerOfLink('https://example.com/meet')).toBeNull();
    expect(providerOfLink('not a link')).toBeNull();
    expect(meetingRedirectUri('https://people.trendlix.com/', 'google')).toBe('https://people.trendlix.com/meetings/oauth/google');
    expect(Object.values(MEETING_CALLBACK_PATHS)).toEqual(['/meetings/oauth/google', '/meetings/oauth/microsoft', '/meetings/oauth/zoom']);
  });
});

describe('the app credentials', () => {
  it('checks each provider’s in words, letting them be saved unfinished', () => {
    expect(meetingAppProblems('google', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: SECRET })).toEqual([]);
    expect(meetingAppProblems('google', {})).toEqual([]);
    expect(meetingAppProblems('google', { clientId: '123-abc' })).toEqual(['A Google client ID ends with .apps.googleusercontent.com: copy it from Google Cloud → APIs & Services → Credentials.']);
    expect(meetingAppProblems('microsoft', { clientId: '1b2c3d4e-0000-4000-8000-000000000001', tenantId: 'trendlix.onmicrosoft.com' })).toEqual([]);
    expect(meetingAppProblems('microsoft', { clientId: 'not-a-guid', tenantId: 'not a tenant' })).toEqual([
      'The tenant ID is the directory (tenant) ID Microsoft Entra shows, e.g. 1b2c3d4e-…, or the company’s domain.',
      'The Microsoft client ID is the app registration’s application (client) ID, e.g. 1b2c3d4e-….',
    ]);
    expect(meetingAppProblems('zoom', { clientId: 'AbCdEfGhIjK', accountId: 'Zx_12345678', userClientId: 'UsEr_1234567', userClientSecret: SECRET })).toEqual([]);
    expect(meetingAppProblems('zoom', { clientId: 'has space here' })).toEqual(['Paste the client ID on its own, without spaces.', 'Paste the Zoom client ID as the app’s App Credentials show it.']);
    expect(meetingAppProblems('google', { clientSecret: 'two\nlines' })).toEqual(['Paste the client secret on one line.']);
    expect(meetingAppProblems('google', { tenantId: 'x', accountId: 'y' })).toEqual(['Only Microsoft takes a tenant ID.', 'Only Zoom takes an account ID and a General app.']);
  });

  it('says why connecting didn’t work, showing only the provider’s own code', () => {
    expect(meetingConnectProblemText('denied', 'google')).toBe('Google wasn’t allowed access, so nothing was connected. Try again and allow it.');
    expect(meetingConnectProblemText('refused', 'microsoft', 'redirect_uri_mismatch')).toContain('add the redirect URI shown on Organization → Meetings');
    expect(meetingConnectProblemText('refused', 'zoom', 'invalid_client')).toBe('Zoom refused the sign-in (invalid_client). Check the app’s settings on Organization → Meetings, then try again.');
    // anything that isn't a code is never shown
    expect(meetingConnectProblemText('refused', 'zoom', 'Call +20 100 to verify')).toBe('Zoom refused the sign-in. Check the app’s settings on Organization → Meetings, then try again.');
    expect(meetingConnectProblemText('no_app', 'zoom')).toBe('The company’s Zoom app isn’t set up yet: a Super Admin sets it up on Organization → Meetings.');
  });
});

describe('signing in at each provider', () => {
  const app = { clientId: 'client-1', clientSecret: SECRET, tenantId: 'tenant-1', accountId: 'acc-1' };
  const redirectUri = 'https://people.trendlix.com/meetings/oauth/google';

  it('asks Google for its calendar’s events only, offline, with PKCE', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
    const url = new URL(authorizeUrl('google', app, { redirectUri, state: 'st', challenge }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      redirect_uri: redirectUri,
      response_type: 'code',
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
    });
    expect(GOOGLE_SCOPES).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/calendar.events']);
    // the secret is never in the address the browser goes to
    expect(url.toString()).not.toContain(SECRET);
  });

  it('signs in to Microsoft on the company’s tenant with the delegated scopes, and to Zoom’s General app', () => {
    const ms = new URL(authorizeUrl('microsoft', app, { redirectUri, state: 'st', challenge: 'ch' }));
    expect(ms.origin + ms.pathname).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
    expect(ms.searchParams.get('scope')).toBe(MICROSOFT_SCOPES.join(' '));
    expect(ms.searchParams.get('scope')).toContain('offline_access');
    const zoom = new URL(authorizeUrl('zoom', { clientId: 'general-1' }, { redirectUri, state: 'st', challenge: 'ch' }));
    expect(zoom.origin + zoom.pathname).toBe('https://zoom.us/oauth/authorize');
    expect(zoom.searchParams.get('client_id')).toBe('general-1');
    expect(zoom.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('trades the code for tokens: Google and Microsoft with the secret in the form, Zoom with Basic', () => {
    const g = codeTokenRequest('google', app, { code: 'c1', redirectUri, verifier: 'v1' });
    expect(g).toMatchObject({ method: 'POST', url: 'https://oauth2.googleapis.com/token' });
    expect(formOf(g.body)).toEqual({ grant_type: 'authorization_code', code: 'c1', redirect_uri: redirectUri, client_id: 'client-1', client_secret: SECRET, code_verifier: 'v1' });
    const m = codeTokenRequest('microsoft', app, { code: 'c1', redirectUri, verifier: 'v1' });
    expect(m.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(formOf(m.body).scope).toBe(MICROSOFT_SCOPES.join(' '));
    const z = codeTokenRequest('zoom', app, { code: 'c1', redirectUri, verifier: 'v1' });
    expect(z.url).toBe('https://zoom.us/oauth/token');
    expect(z.headers.authorization).toBe(`Basic ${Buffer.from(`client-1:${SECRET}`).toString('base64')}`);
    expect(formOf(z.body)).toEqual({ grant_type: 'authorization_code', code: 'c1', redirect_uri: redirectUri, code_verifier: 'v1' });
    expect(formOf(refreshRequest('google', app, 'r1').body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' });
    expect(formOf(refreshRequest('zoom', app, 'r1').body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' });
  });

  it('gets the app’s own token for the company’s Microsoft and Zoom hosts', () => {
    const m = appTokenRequest('microsoft', app);
    expect(m.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(formOf(m.body)).toEqual({ grant_type: 'client_credentials', client_id: 'client-1', client_secret: SECRET, scope: 'https://graph.microsoft.com/.default' });
    const z = appTokenRequest('zoom', app);
    expect(z.url).toBe('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=acc-1');
    expect(z.headers.authorization).toMatch(/^Basic /);
  });

  it('reads the tokens and who signed in', () => {
    expect(tokenGrantOf('google', ok({ access_token: 'a', refresh_token: 'r', expires_in: 3599, id_token: 'i', scope: 'openid email' }))).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3599,
      idToken: 'i',
      scope: 'openid email',
    });
    expect(tokenGrantOf('zoom', ok({ access_token: 'a' })).expiresIn).toBe(3600);
    expect(() => tokenGrantOf('google', ok({ error: 'invalid_grant' }, 400))).toThrow(MeetingProviderError);
    expect(emailOfIdToken(jwt({ email: 'HR@Trendlix.com' }))).toBe('hr@trendlix.com');
    expect(emailOfIdToken(jwt({ preferred_username: 'hazem@trendlix.com' }))).toBe('hazem@trendlix.com');
    expect(emailOfIdToken(jwt({ sub: '1' }))).toBeNull();
    expect(emailOfIdToken('garbage')).toBeNull();
    expect(zoomEmailOf(ok({ email: 'Zoom.User@trendlix.com' }))).toBe('zoom.user@trendlix.com');
    expect(zoomEmailOf(ok({}, 401))).toBeNull();
    expect(grantsGoogleCalendar('openid https://www.googleapis.com/auth/calendar.events email')).toBe(true);
    expect(grantsGoogleCalendar('openid email')).toBe(false);
    expect(teamsNotAllowed(ok({ allowedOnlineMeetingProviders: ['teamsForBusiness'] }))).toBe(false);
    expect(teamsNotAllowed(ok({ allowedOnlineMeetingProviders: ['unknown'] }))).toBe(true);
  });
});

describe('a meeting made, moved and deleted', () => {
  it('makes a Google Calendar event with a Meet conference on the primary calendar, nobody invited', () => {
    const r = createRequest({ provider: 'google', host: null }, TOKEN, DETAILS);
    expect(r).toMatchObject({ method: 'POST', url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none' });
    expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const b = bodyOf(r.body);
    expect(b).toMatchObject({
      summary: DETAILS.title,
      start: { dateTime: '2026-11-05T08:30:00.000Z', timeZone: 'Africa/Cairo' },
      end: { dateTime: '2026-11-05T09:15:00.000Z', timeZone: 'Africa/Cairo' },
      conferenceData: { createRequest: { requestId: 'req-1', conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    });
    expect(b.attendees).toBeUndefined();
    expect(madeOf('google', ok({ id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { createRequest: { status: { statusCode: 'success' } } } }))).toEqual({
      meetingId: 'ev1',
      joinUrl: 'https://meet.google.com/abc-defg-hij',
    });
    // the link from the conference's video entry point, or none yet while Google still makes it
    expect(madeOf('google', ok({ id: 'ev1', conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.google.com/x' }] } })).joinUrl).toBe('https://meet.google.com/x');
    expect(madeOf('google', ok({ id: 'ev1', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })).joinUrl).toBeNull();
    expect(() => madeOf('google', ok({ id: 'ev1', conferenceData: { createRequest: { status: { statusCode: 'failure' } } } }))).toThrow(/couldn’t add a Google Meet/);
    expect(getRequest({ provider: 'google', host: null }, TOKEN, 'ev/1').url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events/ev%2F1');
  });

  it('moves and deletes Google’s event without emailing anybody', () => {
    const u = updateRequest({ provider: 'google', host: null }, TOKEN, 'ev1', { ...DETAILS, minutes: 60 });
    expect(u).toMatchObject({ method: 'PATCH', url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1?sendUpdates=none' });
    expect(bodyOf(u.body).end).toEqual({ dateTime: '2026-11-05T09:30:00.000Z', timeZone: 'Africa/Cairo' });
    expect(bodyOf(u.body).conferenceData).toBeUndefined();
    expect(deleteRequest({ provider: 'google', host: null }, TOKEN, 'ev1')).toMatchObject({ method: 'DELETE', url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1?sendUpdates=none' });
    expect(goneAnswer(ok(null, 410))).toBe(true);
    expect(goneAnswer(ok(null, 404))).toBe(true);
    expect(doneAnswer(ok(null, 204))).toBe(true);
    expect(doneAnswer(null)).toBe(false);
  });

  it('makes a Teams meeting as an event in the company’s host mailbox, in UTC, or in one’s own calendar', () => {
    const r = createRequest({ provider: 'microsoft', host: 'hr@trendlix.com' }, TOKEN, DETAILS);
    expect(r).toMatchObject({ method: 'POST', url: 'https://graph.microsoft.com/v1.0/users/hr%40trendlix.com/events' });
    const b = bodyOf(r.body);
    expect(b).toMatchObject({
      subject: DETAILS.title,
      start: { dateTime: '2026-11-05T08:30:00', timeZone: 'UTC' },
      end: { dateTime: '2026-11-05T09:15:00', timeZone: 'UTC' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    });
    expect(b.attendees).toBeUndefined();
    expect(createRequest({ provider: 'microsoft', host: null }, TOKEN, DETAILS).url).toBe('https://graph.microsoft.com/v1.0/me/events');
    expect(madeOf('microsoft', ok({ id: 'AAMk1', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3a1' } }))).toEqual({ meetingId: 'AAMk1', joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3a1' });
    expect(madeOf('microsoft', ok({ id: 'AAMk1', onlineMeeting: null })).joinUrl).toBeNull();
    expect(updateRequest({ provider: 'microsoft', host: 'hr@trendlix.com' }, TOKEN, 'AAMk1', DETAILS)).toMatchObject({ method: 'PATCH', url: 'https://graph.microsoft.com/v1.0/users/hr%40trendlix.com/events/AAMk1' });
    expect(deleteRequest({ provider: 'microsoft', host: null }, TOKEN, 'AAMk1')).toMatchObject({ method: 'DELETE', url: 'https://graph.microsoft.com/v1.0/me/events/AAMk1' });
  });

  it('makes a Zoom meeting the interviewers and the candidate join without the host', () => {
    const r = createRequest({ provider: 'zoom', host: 'hr@trendlix.com' }, TOKEN, DETAILS);
    expect(r).toMatchObject({ method: 'POST', url: 'https://api.zoom.us/v2/users/hr%40trendlix.com/meetings' });
    expect(bodyOf(r.body)).toMatchObject({
      topic: DETAILS.title,
      type: 2,
      start_time: '2026-11-05T08:30:00Z',
      duration: 45,
      timezone: 'Africa/Cairo',
      settings: { join_before_host: true, jbh_time: 0, waiting_room: false, meeting_authentication: false },
    });
    expect(createRequest({ provider: 'zoom', host: null }, TOKEN, DETAILS).url).toBe('https://api.zoom.us/v2/users/me/meetings');
    expect(madeOf('zoom', ok({ id: 81234567890, join_url: 'https://us06web.zoom.us/j/81234567890?pwd=abc', start_url: 'https://zoom.us/s/secret' }, 201))).toEqual({
      meetingId: '81234567890',
      joinUrl: 'https://us06web.zoom.us/j/81234567890?pwd=abc',
    });
    const u = updateRequest({ provider: 'zoom', host: 'hr@trendlix.com' }, TOKEN, '81234567890', DETAILS);
    expect(u).toMatchObject({ method: 'PATCH', url: 'https://api.zoom.us/v2/meetings/81234567890' });
    expect(bodyOf(u.body)).toMatchObject({ start_time: '2026-11-05T08:30:00Z', duration: 45 });
    expect(deleteRequest({ provider: 'zoom', host: null }, TOKEN, '81234567890').url).toBe('https://api.zoom.us/v2/meetings/81234567890?schedule_for_reminder=false&cancel_meeting_reminder=false');
  });

  it('keeps where each meeting lives, to move and delete it later', () => {
    expect(hostKept({ provider: 'google', host: null })).toBe('primary');
    expect(hostKept({ provider: 'microsoft', host: 'hr@trendlix.com' })).toBe('hr@trendlix.com');
    expect(hostKept({ provider: 'zoom', host: null })).toBe('me');
    expect(targetOf('microsoft', 'hr@trendlix.com')).toEqual({ provider: 'microsoft', host: 'hr@trendlix.com' });
    expect(targetOf('zoom', 'me')).toEqual({ provider: 'zoom', host: null });
    expect(targetOf('google', 'primary')).toEqual({ provider: 'google', host: null });
  });
});

describe('a refusal in plain words', () => {
  const words = (provider: MeetingProvider, answer: HttpAnswer | null, doing: Parameters<typeof problemOf>[2] = 'create') => {
    const e = problemOf(provider, answer, doing);
    return [e.kind, e.message, e.code];
  };

  it('says a revoked or expired sign-in needs connecting again', () => {
    expect(words('google', ok({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400), 'token')).toEqual([
      'reconnect',
      'Google says the connection was revoked or has expired: connect the account again.',
      'invalid_grant',
    ]);
    expect(words('zoom', ok({ reason: 'Invalid Token!', error: 'invalid_grant' }, 400), 'token')[0]).toBe('reconnect');
    // a code used twice or too late, while connecting: try again
    expect(words('google', ok({ error: 'invalid_grant' }, 400), 'connect')[0]).toBe('refused');
    expect(words('google', ok({ error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }, 403))).toEqual([
      'reconnect',
      'Google refused: the account didn’t allow access to its calendar. Connect it again and allow it.',
      '403',
    ]);
  });

  it('points a Super Admin at the app when its credentials, consent, API or scopes are wrong', () => {
    expect(words('microsoft', ok({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided. Trace ID: abc Correlation ID: def' }, 401), 'token')).toEqual([
      'app',
      'Microsoft refused the app’s client ID or secret: a Super Admin checks them on Organization → Meetings.',
      'invalid_client',
    ]);
    expect(words('microsoft', ok({ error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented to use the application.' }, 400), 'token')[1]).toContain('admin consent');
    expect(words('microsoft', ok({ error: 'unauthorized_client', error_description: 'AADSTS700016: Application not found in the directory' }, 400), 'token')[0]).toBe('app');
    expect(words('google', ok({ error: 'redirect_uri_mismatch' }, 400), 'connect')).toEqual(['app', 'Google refused the return address: add the redirect URI shown on Organization → Meetings to the app.', 'redirect_uri_mismatch']);
    expect(words('google', ok({ error: { code: 403, message: 'Google Calendar API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }, 403))[1]).toBe(
      'Google refused: the Google Calendar API isn’t turned on in the Google Cloud project. Turn it on in APIs & Services → Library.',
    );
    expect(words('microsoft', ok({ error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } }, 403))[1]).toContain('grant the Calendars.ReadWrite permission');
    expect(words('zoom', ok({ code: 4711, message: 'Invalid access token, does not contain scopes:[meeting:write:meeting:admin].' }, 400))[0]).toBe('app');
    expect(words('zoom', ok({ code: 4711, message: 'Invalid access token, does not contain scopes:[meeting:write:meeting:admin].' }, 403))[1]).toBe(
      'Zoom refused: the app lacks a scope (meeting:write:meeting:admin). Add it on the app’s Scopes page in the Zoom App Marketplace.',
    );
    expect(words('zoom', ok({ code: 1001, message: 'User does not exist: hr@trendlix.com.' }, 404))[1]).toBe('Zoom has no such user: the host must be a user of the company’s Zoom account.');
    expect(words('microsoft', ok({ error: { code: 'ErrorInvalidUser', message: 'The requested user is invalid.' } }, 404), 'host')[1]).toContain('can’t find the host mailbox');
  });

  it('tells a refused token, a meeting gone, a busy provider and no answer apart', () => {
    expect(words('google', ok({ error: { code: 401, message: 'Invalid Credentials' } }, 401))[0]).toBe('token');
    expect(words('zoom', ok({ code: 3001, message: 'Meeting does not exist: 812.' }, 404), 'delete')).toEqual(['gone', 'Zoom no longer has the meeting: it was deleted there.', '3001']);
    expect(words('microsoft', ok({ error: { code: 'ErrorItemNotFound' } }, 404), 'update')[0]).toBe('gone');
    expect(words('google', ok({ error: { code: 429, message: 'Rate Limit Exceeded' } }, 429))).toEqual(['busy', 'Google is busy right now (Rate Limit Exceeded): try again in a moment.', '429']);
    expect(words('zoom', null)).toEqual(['unreachable', 'Zoom couldn’t be reached. Try again in a moment.', null]);
    expect(words('google', ok({ error: { code: 400, message: 'Invalid start time.' } }, 400))).toEqual(['refused', 'Google refused: Invalid start time.', '400']);
    expect(words('zoom', ok('<html>', 400))).toEqual(['refused', 'Zoom refused: the request (400).', null]);
  });

  it('never says a secret or a token, only what the provider said', () => {
    // the refusals are built from the answer alone; Microsoft's trace and correlation ids are cut off too
    const e = problemOf('microsoft', ok({ error: 'invalid_request', error_description: 'AADSTS900144: The request body must contain grant_type. Trace ID: 1 Correlation ID: 2 Timestamp: 3' }, 400), 'token');
    expect(e.message).toBe('Microsoft refused: AADSTS900144: The request body must contain grant_type.');
    expect(e.message).not.toContain(SECRET);
    expect(e.message).not.toContain(TOKEN);
    expect(e.code).toBe('invalid_request');
  });
});
