import type { INestApplication } from '@nestjs/common';
import {
  CALENDARS_EMPLOYEES_ONLY,
  CALENDARS_OWN_ACCOUNT,
  CALENDARS_SUPER_ADMIN_ONLY,
  DEVELOPER_NO_FILES,
  DEVELOPER_READ_ONLY,
  type CalendarConnectResult,
  type CalendarSettingsView,
  type CalendarTestView,
  type MyCalendarsView,
  type MyMeetingsView,
  type Role,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CalendarHttp } from '../src/calendars/calendar-http.js';
import { CalendarsService } from '../src/calendars/calendars.service.js';
import { MeetingHttp } from '../src/meetings/meeting-http.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { fakeCalendars, type FakeCalendars } from './fake-calendars.js';
import { fakeMeetingProviders, type FakeApps, type FakeProviders } from './fake-meetings.js';
import { createApp, createUser, signIn } from './helpers.js';

// Calendars read for interviewers' busy times (owner, 25 October 2026: "Hours + calendar"; then "its zoho mails": Zoho
// Calendar first, Google and Microsoft beside it). Zoho, Google and Microsoft are one fake in CalendarHttp's and
// MeetingHttp's place (fake-calendars.ts wrapping fake-meetings.ts): nothing is ever sent to them. A Super Admin saves
// the Zoho app and connects the company's Zoho account (at the data centre the sign-in comes back from), tests it; the
// company's connection reads colleagues' busy times by their work email, live, within 5 seconds, a refusal or a slow
// calendar "failed"; a plain employee connects their own Google and Zoho calendars; HR's own meetings connections share
// busy times (Microsoft's always, Google's once its free/busy scope is allowed: else "Reconnect"); the company's
// Microsoft 365 reads them through its host mailbox; a revoked sign-in needs connecting again; disconnecting revokes.
// Nobody else opens the company's settings, nor a developer, nor a Super Admin viewing as someone; no token or secret is
// in any answer or audit entry, and no event's title or place in any busy time. Every name is invented; this file
// deletes what it made.

const RUN = `ct${Date.now().toString(36)}`;
const ORIGIN = 'https://people.trendlix.test';
const ZOHO = { clientId: `1000.${RUN.toUpperCase()}ZOHOAPP`, clientSecret: `zoho-${RUN}-secret` };
const APPS: FakeApps = {
  google: { clientId: `5678-${RUN}.apps.googleusercontent.com`, clientSecret: `GOCSPX-${RUN}-cal-secret` },
  microsoft: { tenantId: '0b1c2d3e-0000-4000-8000-00000000cc01', clientId: '0b1c2d3e-0000-4000-8000-00000000cc02', clientSecret: `ms~${RUN}-cal-secret` },
  zoom: { accountId: `Acc_${RUN}`, clientId: `S2s_${RUN}`, clientSecret: `zoom-${RUN}-unused`, userClientId: `Gen_${RUN}`, userClientSecret: `zoom-general-${RUN}-unused` },
};
const COMPANY_ZOHO = `hr.zoho.${RUN}@trendlix.test`;
const HOST_MAILBOX = `hr.mailbox.${RUN}@trendlix.test`;
const EU = 'https://accounts.zoho.eu';
const DAY = 86_400_000;

describe('Calendars for busy times (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let calendars: CalendarsService;
  let cal: FakeCalendars;
  let meetings: FakeProviders;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  const work: Record<string, string> = {};
  const employeeIds: string[] = [];
  let departmentId: string;
  /** Every answer this file received, to search for the tokens and secrets. */
  const answers: unknown[] = [];

  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  const as = (who: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', sessions[who])),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', sessions[who]).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', sessions[who]).send(body)),
  });
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** An account with an employee profile (its work email `work[key]`). */
  async function person(key: string, name: string, roles: Role[] = ['employee']) {
    await account(key, roles);
    work[key] = `${key.toLowerCase()}.${RUN}@trendlix.test`;
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: work[key],
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId } },
      },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: e.id } });
    people[key] = e.id;
    employeeIds.push(e.id);
    // the session again, so it knows its employee profile
    sessions[key] = await signIn(app, emails[key]);
  }

  /** A calendar's sign-in and its return: start, then the provider's code back through the website. */
  async function connect(who: string, provider: 'zoho' | 'google' | 'microsoft', owner: 'company' | 'personal', code: string, email: string, accountsServer?: string, options?: { scope?: string }): Promise<CalendarConnectResult> {
    const started = (await as(who).post('/calendars/oauth/start', { provider, owner, origin: ORIGIN }).expect(200)).body as { url: string };
    const url = new URL(started.url);
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/calendars/oauth/${provider}`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    cal.code(provider, code, email, accountsServer, options);
    return (await as(who).post('/calendars/oauth/finish', { provider, code, state: url.searchParams.get('state'), ...(accountsServer && { accountsServer }) }).expect(200)).body as CalendarConnectResult;
  }

  const range = () => {
    const from = new Date();
    return { from, to: new Date(from.getTime() + 3 * DAY) };
  };
  const at = (hoursFromNow: number) => new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + hoursFromNow * 3_600_000);
  const busyOf = (key: string) => ({ employeeId: people[key], userId: users[key] ?? null, workEmail: work[key] ?? null });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    calendars = app.get(CalendarsService);
    meetings = fakeMeetingProviders(RUN, APPS);
    meetings.mailboxes.add(HOST_MAILBOX);
    cal = fakeCalendars(RUN, { zoho: ZOHO, google: APPS.google, microsoft: APPS.microsoft });
    const f = cal.wrap(meetings.fetch);
    app.get(MeetingHttp).fetch = f;
    app.get(CalendarHttp).fetch = f;
    // a test run before this one left nothing; this file's own rows are deleted at the end
    await prisma.calendarConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.meetingConnection.deleteMany({});
    await prisma.meetingApp.deleteMany({});
    departmentId = (await prisma.department.create({ data: { nameEn: `Calendars ${RUN}` }, select: { id: true } })).id;
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await account('developer', ['developer']);
    await person('sara', 'Sara Planner');
    await person('omar', 'Omar Reviewer');
    await person('nour', 'Nour Designer');
    await person('hrPerson', 'Hana Recruiter', ['hr']);
  });

  afterAll(async () => {
    await prisma.calendarConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.meetingConnection.deleteMany({});
    await prisma.meetingApp.deleteMany({});
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('the company’s settings', () => {
    it('are a Super Admin’s: refused to HR, the CEO, an employee and a developer', async () => {
      for (const who of ['hr', 'ceo', 'sara']) {
        expect((await as(who).get('/calendars/settings').expect(403)).body.message, who).toBe(CALENDARS_SUPER_ADMIN_ONLY);
        expect((await as(who).put('/calendars/apps/zoho', { clientId: ZOHO.clientId })).status, who).toBe(403);
        expect((await as(who).post('/calendars/company/zoho/test')).status, who).toBe(403);
        expect((await as(who).post('/calendars/company/zoho/disconnect')).status, who).toBe(403);
      }
      expect((await as('hr').post('/calendars/oauth/start', { provider: 'zoho', owner: 'company', origin: ORIGIN }).expect(403)).body.message).toBe(CALENDARS_SUPER_ADMIN_ONLY);
      // a developer: every calendars page refused, every change too
      for (const path of ['/calendars/settings', '/calendars/mine']) expect((await as('developer').get(path).expect(403)).body.message, path).toBe(DEVELOPER_NO_FILES);
      for (const res of [await as('developer').put('/calendars/apps/zoho', { clientId: ZOHO.clientId }), await as('developer').post('/calendars/oauth/start', { provider: 'zoho', owner: 'personal', origin: ORIGIN })]) {
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(DEVELOPER_READ_ONLY);
      }
      // one's own calendars: someone with an employee profile
      expect((await as('hr').get('/calendars/mine').expect(403)).body.message).toBe(CALENDARS_EMPLOYEES_ONLY);
      const empty = (await as('superAdmin').get('/calendars/settings').expect(200)).body as CalendarSettingsView;
      expect(empty).toMatchObject({ zoho: { clientId: null, clientSecretSet: false, dataCentre: null, ready: false }, company: null });
    });

    it('save the Zoho app: its secret sealed, never returned, its values audited only as changed', async () => {
      const bad = await as('superAdmin').put('/calendars/apps/zoho', { clientId: 'zoho-app', clientSecret: 'two words', dataCentre: 'com' }).expect(400);
      expect(said(bad)).toEqual(['A Zoho client ID looks like 1000.ABC123…: copy it from api-console.zoho.com → your app → Client Secret.', 'Paste the client secret on one line, without spaces.']);
      expect((await as('superAdmin').put('/calendars/apps/zoho', { dataCentre: 'mars' }).expect(400)).body.message).toEqual(['Choose the data centre the company’s Zoho account is in.']);
      const saved = (await as('superAdmin').put('/calendars/apps/zoho', { clientId: ZOHO.clientId, clientSecret: ZOHO.clientSecret, dataCentre: 'com' }).expect(200)).body as CalendarSettingsView;
      expect(saved.zoho).toMatchObject({ clientId: ZOHO.clientId, clientSecretSet: true, clientSecretUnreadable: false, dataCentre: 'com', ready: true });
      expect(saved.zoho.updatedBy).not.toBeNull();
      expect(JSON.stringify(saved)).not.toContain(ZOHO.clientSecret);
      const row = await prisma.calendarApp.findUniqueOrThrow({ where: { provider: 'zoho' } });
      expect(row.clientSecretEnc).toMatch(/^v1:/);
      expect(row.clientSecretEnc).not.toContain(ZOHO.clientSecret);
      // the secret left empty keeps the saved one; nothing changed: no new audit entry
      const again = (await as('superAdmin').put('/calendars/apps/zoho', { clientId: ZOHO.clientId, clientSecret: '', dataCentre: 'com' }).expect(200)).body as CalendarSettingsView;
      expect(again.zoho.clientSecretSet).toBe(true);
      const audits = await prisma.auditLog.findMany({ where: { entityType: 'calendar_settings', userId: users.superAdmin } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: 'update', userId: users.superAdmin, diff: { provider: 'zoho', clientId: 'changed', clientSecret: 'changed', dataCentre: 'changed' } });
    });

    it('connect the company’s Zoho at the data centre its account is in, and test it in counts only', async () => {
      // the sign-in starts at the app's data centre, asking for the free/busy and the email only, offline
      const started = (await as('superAdmin').post('/calendars/oauth/start', { provider: 'zoho', owner: 'company', origin: ORIGIN }).expect(200)).body as { url: string };
      const url = new URL(started.url);
      expect(url.origin + url.pathname).toBe('https://accounts.zoho.com/oauth/v2/auth');
      expect(url.searchParams.get('scope')).toBe('ZohoCalendar.freebusy.READ,email');
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(started.url).not.toContain(ZOHO.clientSecret);
      // Google and Microsoft calendars are each person's own
      expect(said(await as('superAdmin').post('/calendars/oauth/start', { provider: 'google', owner: 'company', origin: ORIGIN }).expect(400))).toEqual([
        'The company’s calendar is Zoho’s: Google and Microsoft calendars are each person’s own.',
      ]);
      // a return naming a sign-in address that isn't Zoho's is refused
      const evil = await connect('superAdmin', 'zoho', 'company', `evil-${RUN}`, COMPANY_ZOHO, 'https://accounts.zoho.evil.test');
      expect(evil).toMatchObject({ ok: false, problem: 'refused', said: 'unknown_data_centre', back: '/organization/calendars' });
      // someone else's return
      const other = (await as('superAdmin').post('/calendars/oauth/start', { provider: 'zoho', owner: 'company', origin: ORIGIN }).expect(200)).body as { url: string };
      const state = new URL(other.url).searchParams.get('state');
      expect(((await as('sara').post('/calendars/oauth/finish', { provider: 'zoho', code: 'x', state }).expect(200)).body as CalendarConnectResult).problem).toBe('other_user');

      const done = await connect('superAdmin', 'zoho', 'company', `zc-${RUN}`, COMPANY_ZOHO, EU);
      expect(done).toEqual({ provider: 'zoho', back: '/organization/calendars', ok: true, problem: null, said: null });
      // the code traded at the EU data centre, where the account is
      expect(cal.calls.some((c) => c.url === 'https://accounts.zoho.eu/oauth/v2/token')).toBe(true);
      const settings = (await as('superAdmin').get('/calendars/settings').expect(200)).body as CalendarSettingsView;
      expect(settings.company).toMatchObject({ provider: 'zoho', owner: 'company', accountEmail: COMPANY_ZOHO, status: 'connected' });
      const row = await prisma.calendarConnection.findFirstOrThrow({ where: { provider: 'zoho', userId: null } });
      expect(row.accountsServer).toBe(EU);
      expect(row.refreshTokenEnc).toMatch(/^v1:/);

      // the test: its own account and a colleague's, for the next 7 days, in counts; never what they are
      cal.busy(COMPANY_ZOHO, [
        { start: at(24), end: at(25), title: 'Board meeting' },
        { start: at(48), end: at(49) },
      ]);
      cal.busy(work.sara, [{ start: at(30), end: at(31), title: 'Dentist' }]);
      const test = (await as('superAdmin').post('/calendars/company/zoho/test', { email: work.sara }).expect(200)).body as CalendarTestView;
      expect(test.ok).toBe(true);
      expect(test.message).toBe(`Zoho answered: 2 busy times in the next 7 days for ${COMPANY_ZOHO}; 1 busy time in the next 7 days for ${work.sara}.`);
      expect(test.message).not.toMatch(/Board|Dentist/);
      // read at the EU calendar, with Zoho's own token prefix
      const read = cal.calls.filter((c) => c.url.startsWith('https://calendar.zoho.eu/api/v1/calendars/freebusy'));
      expect(read.length).toBeGreaterThanOrEqual(2);
      cal.fail(work.omar);
      const refused = (await as('superAdmin').post('/calendars/company/zoho/test', { email: work.omar }).expect(200)).body as CalendarTestView;
      expect(refused.ok).toBe(false);
      expect(refused.message).toContain(`${work.omar}: Zoho refused: Free/busy of the user is not shared.`);
      expect(said(await as('superAdmin').post('/calendars/company/zoho/test', { email: 'not an email' }).expect(400))).toEqual(['Write the colleague’s work email in full, e.g. sara@trendlix.com.']);
      cal.heal(work.omar);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'calendar_connection', action: 'connect', entityId: row.id } });
      expect(audit?.diff).toMatchObject({ provider: 'zoho', owner: 'company', accountEmail: COMPANY_ZOHO, dataCentre: 'eu' });
    });
  });

  describe('busy times', () => {
    it('read colleagues by their work email through the company’s Zoho, live; a refusal or a slow calendar is “failed”', async () => {
      cal.busy(work.sara, [{ start: at(5), end: at(6), title: 'Dentist' }, { start: at(8), end: at(9), tentative: true }]);
      cal.fail(work.omar);
      cal.slow(work.nour, 6500);
      const { from, to } = range();
      const started = Date.now();
      const read = await calendars.busyTimes([busyOf('sara'), busyOf('omar'), busyOf('nour'), { employeeId: '00000000-0000-4000-8000-0000000000aa', userId: null, workEmail: null }], from, to);
      const took = Date.now() - started;
      // the 5-second limit: the slow one isn't waited for
      expect(took).toBeLessThan(6000);
      expect(read.get(people.sara)).toEqual({
        calendar: 'checked',
        sources: ['Zoho Calendar'],
        reconnect: false,
        blocks: [
          { start: at(5).getTime(), end: at(6).getTime(), tentative: false },
          { start: at(8).getTime(), end: at(9).getTime(), tentative: true },
        ],
      });
      expect(JSON.stringify([...read.values()])).not.toContain('Dentist');
      expect(read.get(people.omar)).toMatchObject({ calendar: 'failed', blocks: [] });
      expect(read.get(people.nour)).toMatchObject({ calendar: 'failed', blocks: [] });
      // nobody reads a calendar without a work email or a connection
      expect(read.get('00000000-0000-4000-8000-0000000000aa')).toEqual({ calendar: 'none', sources: [], reconnect: false, blocks: [] });
      cal.heal(work.omar);
      cal.heal(work.nour);
    }, 20_000);

    it('read the company’s Microsoft 365 through its host mailbox, never a subject or a place', async () => {
      await as('superAdmin').put('/meetings/apps/microsoft', { tenantId: APPS.microsoft.tenantId, clientId: APPS.microsoft.clientId, clientSecret: APPS.microsoft.clientSecret }).expect(200);
      await as('superAdmin').post('/meetings/company/microsoft/host', { hostEmail: HOST_MAILBOX }).expect(200);
      cal.busy(work.omar, [{ start: at(10), end: at(11), title: 'Salary talk' }]);
      const { from, to } = range();
      const read = await calendars.busyTimes([busyOf('omar')], from, to);
      expect(read.get(people.omar)).toMatchObject({ calendar: 'checked', sources: ['Zoho Calendar', 'Outlook Calendar'] });
      // Zoho's and Microsoft's both carry it (the fake keeps one calendar a person): joined
      expect(read.get(people.omar)!.blocks).toContainEqual({ start: at(10).getTime(), end: at(11).getTime(), tentative: false });
      expect(JSON.stringify(read.get(people.omar))).not.toMatch(/Salary|Room/);
      expect(cal.calls.some((c) => c.url === `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(HOST_MAILBOX)}/calendar/getSchedule`)).toBe(true);
      // the company's Microsoft is disconnected again for the next tests
      await as('superAdmin').post('/meetings/company/microsoft/disconnect').expect(200);
    });
  });

  describe('one’s own calendars', () => {
    it('a plain employee connects their own Google calendar for busy times only, and tests it', async () => {
      await as('superAdmin').put('/meetings/apps/google', { clientId: APPS.google.clientId, clientSecret: APPS.google.clientSecret }).expect(200);
      const mine = (await as('sara').get('/calendars/mine').expect(200)).body as MyCalendarsView;
      expect(mine.providers.map((p) => [p.provider, p.available, p.connection])).toEqual([
        ['zoho', true, null],
        ['google', true, null],
        ['microsoft', true, null],
      ]);
      expect(mine).toMatchObject({ companyZoho: true, workEmail: work.sara, meetings: [] });
      const started = (await as('sara').post('/calendars/oauth/start', { provider: 'google', owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
      expect(new URL(started.url).searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.freebusy');
      // the free/busy unticked on Google's page: nothing connected
      const unticked = await connect('sara', 'google', 'personal', `gn-${RUN}`, `sara.home.${RUN}@gmail.test`, undefined, { scope: 'openid email' });
      expect(unticked).toMatchObject({ ok: false, problem: 'denied', said: 'freebusy_not_allowed', back: '/account/interview-hours' });
      const done = await connect('sara', 'google', 'personal', `g-${RUN}`, `sara.home.${RUN}@gmail.test`);
      expect(done).toEqual({ provider: 'google', back: '/account/interview-hours', ok: true, problem: null, said: null });
      cal.busy(`sara.home.${RUN}@gmail.test`, [{ start: at(12), end: at(13), title: 'Gym' }]);
      const test = (await as('sara').post('/calendars/mine/google/test').expect(200)).body as CalendarTestView;
      expect(test).toMatchObject({ ok: true, message: `Google answered: 1 busy time in the next 7 days for sara.home.${RUN}@gmail.test.` });
      const { from, to } = range();
      const read = (await calendars.busyTimes([busyOf('sara')], from, to)).get(people.sara)!;
      expect(read.calendar).toBe('checked');
      expect(read.sources.sort()).toEqual(['Google Calendar', 'Zoho Calendar']);
      expect(read.blocks).toContainEqual({ start: at(12).getTime(), end: at(13).getTime(), tentative: false });
      expect(JSON.stringify(read)).not.toContain('Gym');
      // a Super Admin viewing as her: not theirs to see
      const viewing = await api().post('/api/auth/view-as').set('Cookie', sessions.superAdmin).send({ userId: users.sara }).expect(200);
      const cookie = ([] as string[]).concat(viewing.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
      expect((await api().get('/api/calendars/mine').set('Cookie', cookie).expect(403)).body.message).toBe(CALENDARS_OWN_ACCOUNT);
      await api().post('/api/auth/view-as/stop').set('Cookie', cookie).expect(200);
      sessions.superAdmin = await signIn(app, emails.superAdmin);
    });

    it('connects their own Zoho at its data centre; a revoked sign-in needs connecting again, written to the audit log', async () => {
      const done = await connect('nour', 'zoho', 'personal', `zn-${RUN}`, work.nour, 'https://accounts.zoho.com');
      expect(done.ok).toBe(true);
      const mine = (await as('nour').get('/calendars/mine').expect(200)).body as MyCalendarsView;
      expect(mine.providers.find((p) => p.provider === 'zoho')?.connection).toMatchObject({ owner: 'personal', accountEmail: work.nour, status: 'connected' });
      cal.busy(work.nour, [{ start: at(14), end: at(15) }]);
      const { from, to } = range();
      // her own Zoho reads her: the company's isn't asked again for the same calendar
      expect((await calendars.busyTimes([busyOf('nour')], from, to)).get(people.nour)).toMatchObject({ calendar: 'checked', sources: ['Zoho Calendar'] });
      // revoked at Zoho: the token refused, its refresh refused for good
      cal.revoke(work.nour);
      const after = (await calendars.busyTimes([busyOf('nour')], from, to)).get(people.nour)!;
      expect(after.calendar).toBe('failed');
      const row = await prisma.calendarConnection.findFirstOrThrow({ where: { provider: 'zoho', userId: users.nour } });
      expect(row).toMatchObject({ status: 'needs_reconnecting', problem: 'Zoho says the connection was revoked or has expired: connect the account again.' });
      expect(await prisma.auditLog.findFirst({ where: { entityType: 'calendar_connection', entityId: row.id, action: 'needs_reconnecting', userId: null } })).not.toBeNull();
      const shown = (await as('nour').get('/calendars/mine').expect(200)).body as MyCalendarsView;
      expect(shown.providers.find((p) => p.provider === 'zoho')?.connection?.status).toBe('needs_reconnecting');
    });

    it('HR’s own meetings connections share busy times: Microsoft’s always, Google’s only once allowed', async () => {
      // a Google Meet connection made before the free/busy scope: "Reconnect to share your busy times"
      const startG = (await as('hrPerson').post('/meetings/oauth/start', { provider: 'google', owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
      expect(new URL(startG.url).searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.freebusy');
      meetings.code('google', `mg-${RUN}`, work.hrPerson);
      await as('hrPerson').post('/meetings/oauth/finish', { provider: 'google', code: `mg-${RUN}`, state: new URL(startG.url).searchParams.get('state') }).expect(200);
      const startM = (await as('hrPerson').post('/meetings/oauth/start', { provider: 'microsoft', owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
      meetings.code('microsoft', `mm-${RUN}`, work.hrPerson);
      await as('hrPerson').post('/meetings/oauth/finish', { provider: 'microsoft', code: `mm-${RUN}`, state: new URL(startM.url).searchParams.get('state') }).expect(200);
      const myMeetings = (await as('hrPerson').get('/meetings/mine').expect(200)).body as MyMeetingsView;
      // the meetings' fake grants calendar.events only: Google's shares nothing yet; Microsoft's does
      expect(myMeetings.providers.filter((p) => p.connection).map((p) => [p.provider, p.connection!.busyTimes])).toEqual([
        ['google', false],
        ['microsoft', true],
      ]);
      cal.busy(work.hrPerson, [{ start: at(20), end: at(21), title: 'Interview prep' }]);
      const { from, to } = range();
      const read = (await calendars.busyTimes([busyOf('hrPerson')], from, to)).get(people.hrPerson)!;
      expect(read).toMatchObject({ calendar: 'checked', reconnect: true });
      expect(read.sources.sort()).toEqual(['Outlook Calendar', 'Zoho Calendar']);
      expect(read.blocks).toContainEqual({ start: at(20).getTime(), end: at(21).getTime(), tentative: false });
      expect(cal.calls.some((c) => c.url === 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule')).toBe(true);
      const mine = (await as('hrPerson').get('/calendars/mine').expect(200)).body as MyCalendarsView;
      expect(mine.meetings).toEqual(expect.arrayContaining([{ provider: 'google', busyTimes: false }, { provider: 'microsoft', busyTimes: true }]));
    });

    it('disconnecting revokes the sign-in and forgets it; the company’s too', async () => {
      const mine = (await as('sara').post('/calendars/mine/google/disconnect').expect(200)).body as MyCalendarsView;
      expect(mine.providers.find((p) => p.provider === 'google')?.connection).toBeNull();
      expect(cal.calls.some((c) => c.url === 'https://oauth2.googleapis.com/revoke')).toBe(true);
      expect(said(await as('sara').post('/calendars/mine/google/test').expect(400))).toEqual(['Your Google Calendar isn’t connected: connect it first.']);
      expect((await as('sara').post('/calendars/mine/outlook/disconnect').expect(404)).body.message).toBe('There is no such calendar.');
      const settings = (await as('superAdmin').post('/calendars/company/zoho/disconnect').expect(200)).body as CalendarSettingsView;
      expect(settings.company).toBeNull();
      expect(cal.calls.some((c) => c.url === 'https://accounts.zoho.eu/oauth/v2/revoke/token')).toBe(true);
      const { from, to } = range();
      // nothing reads Sara's calendar any more
      expect((await calendars.busyTimes([busyOf('sara')], from, to)).get(people.sara)).toMatchObject({ calendar: 'none' });
      const audits = await prisma.auditLog.findMany({ where: { entityType: 'calendar_connection', action: 'disconnect', userId: { in: [users.sara, users.superAdmin] } } });
      expect(audits.map((a) => (a.diff as { provider: string; owner: string }).owner).sort()).toEqual(['company', 'personal']);
    });
  });

  it('never puts a token or a secret in an answer or the audit log', async () => {
    const audits = await prisma.auditLog.findMany({ where: { entityType: { in: ['calendar_settings', 'calendar_connection', 'meeting_settings', 'meeting_connection'] } } });
    const all = JSON.stringify([answers, audits], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
    for (const secret of [...cal.secrets, ...meetings.secrets]) expect(all, 'a token or a secret').not.toContain(secret);
    expect(all).not.toContain('refresh_token_enc');
  });
});
