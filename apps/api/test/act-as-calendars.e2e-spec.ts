import type { INestApplication } from '@nestjs/common';
import {
  DEVELOPER_READ_ONLY,
  maskedEmail,
  type CalendarConnectResult,
  type MeetingConnectResult,
  type MyCalendarsView,
  type MyInterviewHoursView,
  type MyMeetingsView,
  type Role,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CalendarHttp } from '../src/calendars/calendar-http.js';
import { todayInCairo } from '../src/common/date-only.js';
import { MeetingHttp } from '../src/meetings/meeting-http.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { fakeCalendars, type FakeCalendars } from './fake-calendars.js';
import { fakeMeetingProviders, type FakeApps, type FakeProviders } from './fake-meetings.js';
import { createApp, createUser, signIn } from './helpers.js';

// A Super Admin sets up someone's interview hours and calendars while viewing as them (owner, 25 October 2026: "i need
// to be able to set it up on behalf of the employee, by acting as them"). View only (Act as them off): the pages read,
// every change refused. With Act as them on: the person's hours saved, their calendars and meetings connected and
// disconnected, each sign-in tied to the acting session; the account signed in to must be one of the person's emails
// (work, sign-in or personal, in any case), else refused and nothing kept, so the Super Admin's own Zoho isn't linked by
// mistake; a Zoho that doesn't say which account signed in is refused while acting, connected (and said so) in one's own
// session. One's own calendar of someone else's email is refused too. Every change is audited as the person's, with the
// Super Admin "acting as" them. Zoho, Google and Microsoft are fakes (fake-calendars.ts, fake-meetings.ts): nothing is
// ever sent to them. Every name is invented; this file deletes what it made.

const RUN = `aa${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const ORIGIN = 'https://people.trendlix.test';
const ZOHO = { clientId: `1000.${RUN.toUpperCase()}ACTASAPP`, clientSecret: `zoho-${RUN}-actas-secret` };
const APPS: FakeApps = {
  google: { clientId: `9012-${RUN}.apps.googleusercontent.com`, clientSecret: `GOCSPX-${RUN}-actas-secret` },
  microsoft: { tenantId: '0b1c2d3e-0000-4000-8000-00000000aa01', clientId: '0b1c2d3e-0000-4000-8000-00000000aa02', clientSecret: `ms~${RUN}-actas-secret` },
  zoom: { accountId: `Acc_${RUN}`, clientId: `S2s_${RUN}`, clientSecret: `zoom-${RUN}-unused`, userClientId: `Gen_${RUN}`, userClientSecret: `zoom-general-${RUN}-unused` },
};
const EU = 'https://accounts.zoho.eu';
/** The Super Admin's own Zoho account, still signed in in their browser: never to be linked as someone else's. */
const ADMIN_ZOHO = `hazem.owner.${RUN}@trendlix.test`;

describe('Acting as someone: their interview hours and calendars (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cal: FakeCalendars;
  let meetings: FakeProviders;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  const names: Record<string, string> = {};
  const work: Record<string, string> = {};
  const personal: Record<string, string> = {};
  const employeeIds: string[] = [];
  let departmentId: string;
  /** Every answer this file received, to search for the tokens and secrets. */
  const answers: unknown[] = [];

  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  /** Requests with a session cookie: someone's own (`sessions[key]`) or a Super Admin's switched one. */
  const withCookie = (cookie: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', cookie)),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', cookie).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', cookie).send(body)),
  });
  const as = (who: string) => withCookie(sessions[who]);
  const cookieOf = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ps_session='))!
      .split(';')[0];
  const sunday = (from: string, to: string) => ({ windows: [{ day: 0, from, to }], changes: [], effectiveFrom: TODAY, noticeHours: null, bufferMinutes: null });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** An account with an employee profile: its work email `work[key]`, its personal email `personal[key]`. */
  async function person(key: string, name: string, roles: Role[]) {
    await account(key, roles);
    work[key] = `${key.toLowerCase()}.${RUN}@trendlix.test`;
    personal[key] = `${key.toLowerCase()}.home.${RUN}@gmail.test`;
    names[key] = `${name} ${RUN}`;
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: names[key],
        fullNameAr: 'اسم',
        workEmail: work[key],
        personalEmail: personal[key],
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

  /** The Super Admin viewing as `key`: view only, or acting (Act as them on). */
  async function viewAs(key: string, act: boolean): Promise<string> {
    const viewing = cookieOf(await api().post('/api/auth/view-as').set('Cookie', sessions.superAdmin).send({ userId: users[key] }).expect(200));
    if (!act) return viewing;
    return cookieOf(await api().post('/api/auth/view-as/act').set('Cookie', viewing).send({ act: true }).expect(200));
  }

  /** A calendar's sign-in started with `cookie`; the provider's return then finished with `finishWith` (the same by default). */
  async function connectCalendar(
    cookie: string,
    provider: 'zoho' | 'google' | 'microsoft',
    code: string,
    email: string,
    options: { accountsServer?: string; noEmail?: boolean; finishWith?: string } = {},
  ): Promise<CalendarConnectResult> {
    const started = (await withCookie(cookie).post('/calendars/oauth/start', { provider, owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
    cal.code(provider, code, email, options.accountsServer, options.noEmail ? { noEmail: true } : undefined);
    const state = new URL(started.url).searchParams.get('state');
    return (await withCookie(options.finishWith ?? cookie).post('/calendars/oauth/finish', { provider, code, state, ...(options.accountsServer && { accountsServer: options.accountsServer }) }).expect(200))
      .body as CalendarConnectResult;
  }

  async function connectMeetings(cookie: string, provider: 'google' | 'microsoft' | 'zoom', code: string, email: string): Promise<MeetingConnectResult> {
    const started = (await withCookie(cookie).post('/meetings/oauth/start', { provider, owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
    meetings.code(provider, code, email);
    return (await withCookie(cookie).post('/meetings/oauth/finish', { provider, code, state: new URL(started.url).searchParams.get('state') }).expect(200)).body as MeetingConnectResult;
  }

  /** The Audit Log's entries of a kind, as the CEO reads them. */
  async function auditOf(entityType: string, userId: string) {
    const page = (await as('ceo').get(`/audit?${new URLSearchParams({ entityType, userId })}`).expect(200)).body as { entries: { action: string; who: { text: string; by: { id: string } | null; user: { id: string } | null } }[] };
    return page.entries;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    meetings = fakeMeetingProviders(RUN, APPS);
    cal = fakeCalendars(RUN, { zoho: ZOHO, google: APPS.google, microsoft: APPS.microsoft });
    const f = cal.wrap(meetings.fetch);
    app.get(MeetingHttp).fetch = f;
    app.get(CalendarHttp).fetch = f;
    // a test run before this one left nothing; this file's own rows are deleted at the end
    await prisma.calendarConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.meetingConnection.deleteMany({});
    await prisma.meetingApp.deleteMany({});
    departmentId = (await prisma.department.create({ data: { nameEn: `Acting ${RUN}` }, select: { id: true } })).id;
    await account('superAdmin', ['super_admin']);
    await account('ceo', ['ceo']);
    await account('developer', ['developer']);
    await person('mona', 'Mona Recruiter', ['hr']);
    await person('sara', 'Sara Planner', ['employee']);
    // the company's Zoho app (no company connection: each person's own Zoho is offered) and the Google app
    await as('superAdmin').put('/calendars/apps/zoho', { clientId: ZOHO.clientId, clientSecret: ZOHO.clientSecret, dataCentre: 'com' }).expect(200);
    await as('superAdmin').put('/meetings/apps/google', { clientId: APPS.google.clientId, clientSecret: APPS.google.clientSecret }).expect(200);
  });

  afterAll(async () => {
    await prisma.calendarConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.meetingConnection.deleteMany({});
    await prisma.meetingApp.deleteMany({});
    await prisma.interviewHours.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  it('view only: the pages read as the person’s, every change refused, nothing saved', async () => {
    const viewing = await viewAs('mona', false);
    const v = withCookie(viewing);
    const hours = (await v.get('/me/interview-hours').expect(200)).body as MyInterviewHoursView;
    expect(hours).toMatchObject({ employeeId: people.mona, name: names.mona, hours: null });
    const mine = (await v.get('/calendars/mine').expect(200)).body as MyCalendarsView;
    expect(mine.workEmail).toBe(work.mona);
    expect(mine.providers.map((p) => [p.provider, p.available, p.connection])).toEqual([
      ['zoho', true, null],
      ['google', true, null],
      ['microsoft', false, null],
    ]);
    expect(((await v.get('/meetings/mine').expect(200)).body as MyMeetingsView).providers.every((p) => !p.connection)).toBe(true);

    const viewOnly = `Viewing as ${names.mona}: view only. Switch on Act as them to make changes.`;
    for (const res of [
      await v.put('/me/interview-hours', sunday('10:00', '12:00')),
      await v.post('/calendars/oauth/start', { provider: 'zoho', owner: 'personal', origin: ORIGIN }),
      await v.post('/calendars/mine/zoho/disconnect'),
      await v.post('/calendars/mine/zoho/test'),
      await v.post('/meetings/oauth/start', { provider: 'google', owner: 'personal', origin: ORIGIN }),
      await v.post('/meetings/mine/google/disconnect'),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(viewOnly);
    }
    expect(await prisma.interviewHours.count({ where: { employeeId: people.mona } })).toBe(0);
    // the company's settings stay the Super Admin's own, even acting
    const acting = await viewAs('mona', true);
    expect((await withCookie(acting).get('/calendars/settings')).status).toBe(403);
  });

  it('acting: the person’s hours saved, audited as the Super Admin acting as them', async () => {
    const acting = withCookie(await viewAs('mona', true));
    const saved = (await acting.put('/me/interview-hours', sunday('10:00', '12:00')).expect(200)).body as MyInterviewHoursView;
    expect(saved).toMatchObject({ employeeId: people.mona, hours: { windows: [{ day: 0, from: '10:00', to: '12:00' }], effectiveFrom: TODAY } });
    const row = await prisma.interviewHours.findUniqueOrThrow({ where: { employeeId: people.mona } });
    expect(row.updatedById).toBe(users.mona);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'interview_hours', entityId: people.mona }, orderBy: { id: 'desc' } });
    expect(entry).toMatchObject({ action: 'create', userId: users.mona, onBehalfById: users.superAdmin });
    const shown = await auditOf('interview_hours', users.mona);
    expect(shown[0]).toMatchObject({ action: 'create', who: { text: `Super Admin ${emails.superAdmin} acting as ${names.mona}`, by: { id: users.superAdmin }, user: { id: users.mona } } });
  });

  it('acting: the Super Admin’s own Zoho is refused and nothing kept; the person’s connects', async () => {
    const acting = await viewAs('mona', true);
    // the browser still signed in to the Super Admin's own Zoho
    const revokes = () => cal.calls.filter((c) => c.url === 'https://accounts.zoho.eu/oauth/v2/revoke/token').length;
    const before = revokes();
    const refused = await connectCalendar(acting, 'zoho', `za-${RUN}`, ADMIN_ZOHO, { accountsServer: EU });
    expect(refused).toEqual({ provider: 'zoho', back: '/account/interview-hours', ok: false, problem: 'other_account', said: null, account: maskedEmail(ADMIN_ZOHO) });
    expect(refused.account).toBe('ha***@trendlix.test');
    expect(await prisma.calendarConnection.count({ where: { userId: users.mona } })).toBe(0);
    // its sign-in revoked at Zoho, at the account's data centre
    expect(revokes()).toBe(before + 1);
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'calendar_connection', action: 'connect_failed', userId: users.mona }, orderBy: { id: 'desc' } });
    expect(failed).toMatchObject({ onBehalfById: users.superAdmin, diff: { provider: 'zoho', owner: 'personal', problem: 'other_account', accountEmail: ADMIN_ZOHO } });

    // the person's work email
    const done = await connectCalendar(acting, 'zoho', `zm-${RUN}`, work.mona, { accountsServer: EU });
    expect(done).toEqual({ provider: 'zoho', back: '/account/interview-hours', ok: true, problem: null, said: null });
    const row = await prisma.calendarConnection.findFirstOrThrow({ where: { provider: 'zoho', userId: users.mona } });
    expect(row).toMatchObject({ accountEmail: work.mona, accountsServer: EU, connectedById: users.mona, status: 'connected' });
    // her personal email is hers too (Google's calendar)
    expect((await connectCalendar(acting, 'google', `gm-${RUN}`, personal.mona)).ok).toBe(true);
    const mine = (await withCookie(acting).get('/calendars/mine').expect(200)).body as MyCalendarsView;
    expect(mine.providers.filter((p) => p.connection).map((p) => [p.provider, p.connection!.accountEmail])).toEqual([
      ['zoho', work.mona],
      ['google', personal.mona],
    ]);
    const shown = await auditOf('calendar_connection', users.mona);
    expect(shown.map((e) => [e.action, e.who.text])).toEqual([
      ['connect', `Super Admin ${emails.superAdmin} acting as ${names.mona}`],
      ['connect', `Super Admin ${emails.superAdmin} acting as ${names.mona}`],
      ['connect_failed', `Super Admin ${emails.superAdmin} acting as ${names.mona}`],
    ]);
  });

  it('acting: the sign-in is the acting session’s own, and refused once Act as them is off', async () => {
    // started in the person's own session, finished in the Super Admin's acting one, and the other way round
    const acting = await viewAs('mona', true);
    const fromHer = await connectCalendar(sessions.mona, 'google', `gx-${RUN}`, work.mona, { finishWith: acting });
    expect(fromHer).toMatchObject({ ok: false, problem: 'other_user' });
    const fromActing = await connectCalendar(acting, 'zoho', `zx-${RUN}`, work.mona, { finishWith: sessions.mona });
    expect(fromActing).toMatchObject({ ok: false, problem: 'other_user' });
    // Act as them switched off before the return: view only, refused
    const started = (await withCookie(acting).post('/calendars/oauth/start', { provider: 'zoho', owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
    const off = cookieOf(await api().post('/api/auth/view-as/act').set('Cookie', acting).send({ act: false }).expect(200));
    cal.code('zoho', `zo-${RUN}`, work.mona);
    expect((await withCookie(off).post('/calendars/oauth/finish', { provider: 'zoho', code: `zo-${RUN}`, state: new URL(started.url).searchParams.get('state') })).status).toBe(403);
  });

  it('acting: disconnecting the person’s calendar; a Zoho without the account’s email is refused, as it can’t be checked', async () => {
    const acting = withCookie(await viewAs('mona', true));
    const after = (await acting.post('/calendars/mine/zoho/disconnect').expect(200)).body as MyCalendarsView;
    expect(after.providers.find((p) => p.provider === 'zoho')?.connection).toBeNull();
    const removed = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'calendar_connection', action: 'disconnect', userId: users.mona }, orderBy: { id: 'desc' } });
    expect(removed.onBehalfById).toBe(users.superAdmin);

    const unchecked = await connectCalendar(await viewAs('mona', true), 'zoho', `zn-${RUN}`, work.mona, { noEmail: true });
    expect(unchecked).toMatchObject({ ok: false, problem: 'unchecked_account' });
    expect(unchecked.account).toBeUndefined();
    expect(await prisma.calendarConnection.count({ where: { provider: 'zoho', userId: users.mona } })).toBe(0);
  });

  it('one’s own: a calendar of someone else’s email is refused too; Zoho without the email connects as the work email, said so', async () => {
    const other = await connectCalendar(sessions.sara, 'google', `gs-${RUN}`, `someone.else.${RUN}@gmail.test`);
    expect(other).toEqual({ provider: 'google', back: '/account/interview-hours', ok: false, problem: 'other_account', said: null, account: 'so***@gmail.test' });
    expect(await prisma.calendarConnection.count({ where: { userId: users.sara } })).toBe(0);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'calendar_connection', action: 'connect_failed', userId: users.sara }, orderBy: { id: 'desc' } });
    expect(entry.onBehalfById).toBeNull();
    // her sign-in email is hers as well
    expect((await connectCalendar(sessions.sara, 'google', `gs2-${RUN}`, emails.sara)).ok).toBe(true);

    const zoho = await connectCalendar(sessions.sara, 'zoho', `zs-${RUN}`, work.sara, { noEmail: true });
    expect(zoho).toEqual({ provider: 'zoho', back: '/account/interview-hours', ok: true, problem: null, said: 'no_email' });
    const row = await prisma.calendarConnection.findFirstOrThrow({ where: { provider: 'zoho', userId: users.sara } });
    expect(row.accountEmail).toBe(work.sara);
    const connected = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'calendar_connection', action: 'connect', entityId: row.id } });
    expect(connected.diff).toMatchObject({ provider: 'zoho', owner: 'personal', accountEmail: work.sara, accountChecked: false });
  });

  it('acting: the person’s own meetings account connects; another is refused and nothing kept', async () => {
    const acting = await viewAs('mona', true);
    const revokes = () => meetings.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/revoke').length;
    const before = revokes();
    const refused = await connectMeetings(acting, 'google', `mga-${RUN}`, ADMIN_ZOHO);
    expect(refused).toEqual({ provider: 'google', back: '/account/meetings', ok: false, problem: 'other_account', said: null, account: maskedEmail(ADMIN_ZOHO) });
    expect(await prisma.meetingConnection.count({ where: { userId: users.mona } })).toBe(0);
    expect(revokes()).toBe(before + 1);
    const done = await connectMeetings(acting, 'google', `mgm-${RUN}`, work.mona);
    expect(done).toEqual({ provider: 'google', back: '/account/meetings', ok: true, problem: null, said: null });
    const mine = (await withCookie(acting).get('/meetings/mine').expect(200)).body as MyMeetingsView;
    expect(mine.providers.find((p) => p.provider === 'google')?.connection).toMatchObject({ owner: 'personal', accountEmail: work.mona, status: 'connected' });
    const shown = await auditOf('meeting_connection', users.mona);
    expect(shown.map((e) => [e.action, e.who.text])).toEqual([
      ['connect', `Super Admin ${emails.superAdmin} acting as ${names.mona}`],
      ['connect_failed', `Super Admin ${emails.superAdmin} acting as ${names.mona}`],
    ]);
    await withCookie(acting).post('/meetings/mine/google/disconnect').expect(200);
    expect(await prisma.meetingConnection.count({ where: { userId: users.mona } })).toBe(0);
    // in her own session, the meetings account is hers to choose, as before (a Zoom or Google of another email)
    expect((await connectMeetings(sessions.mona, 'google', `mgo-${RUN}`, `mona.zoom.${RUN}@gmail.test`)).ok).toBe(true);
  });

  it('a developer never acts: no viewing as anyone, no sign-in', async () => {
    const res = await api().post('/api/auth/view-as').set('Cookie', sessions.developer).send({ userId: users.mona });
    expect(res.status).toBe(403);
    const start = await as('developer').post('/calendars/oauth/start', { provider: 'zoho', owner: 'personal', origin: ORIGIN });
    expect(start.status).toBe(403);
    expect(start.body.message).toBe(DEVELOPER_READ_ONLY);
  });

  it('a sign-in started in an earlier session of the Super Admin’s is refused in a newer one', async () => {
    const acting = await viewAs('mona', true);
    const started = (await withCookie(acting).post('/calendars/oauth/start', { provider: 'zoho', owner: 'personal', origin: ORIGIN }).expect(200)).body as { url: string };
    // signing in again replaces the session; acting as her again in the new one
    sessions.superAdmin = await signIn(app, emails.superAdmin);
    const again = await viewAs('mona', true);
    cal.code('zoho', `zl-${RUN}`, work.mona);
    const late = (await withCookie(again).post('/calendars/oauth/finish', { provider: 'zoho', code: `zl-${RUN}`, state: new URL(started.url).searchParams.get('state') }).expect(200)).body as CalendarConnectResult;
    expect(late).toMatchObject({ ok: false, problem: 'expired' });
    expect(await prisma.calendarConnection.count({ where: { provider: 'zoho', userId: users.mona } })).toBe(0);
  });

  it('never puts a token or a secret in an answer or the audit log', async () => {
    const audits = await prisma.auditLog.findMany({ where: { entityType: { in: ['calendar_settings', 'calendar_connection', 'meeting_settings', 'meeting_connection'] } } });
    const all = JSON.stringify([answers, audits], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
    for (const secret of [...cal.secrets, ...meetings.secrets]) expect(all, 'a token or a secret').not.toContain(secret);
  });
});
