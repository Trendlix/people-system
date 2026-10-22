import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_ACTS_AS, DEVELOPER_READ_ONLY, IDLE_TIMEOUT_MS, MODE_IN_APP, MODE_NOT_YOURS, VIEW_MODE_NOT_THEIRS } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo, weekday } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, PASSWORD, signIn } from './helpers.js';

// A developer who is also an employee chooses how to use the system (owner, 22 October 2026: "when a developer signin,
// give hin a switched to use the account as the main role assigned to him or as a developer, to not confuse him"). On
// the website they choose after the password (nothing chosen yet: the developer view, read only), and switch later; as
// themselves they are the employee they are (their own real data, checking in, leave; other people's data refused as for
// any employee, no pseudonyms, no 15 minutes); as a developer, the developer view (read only, pseudonyms). Every choice
// and switch is audited, in the same session. A developer alone has no choice; the app is always as themselves; a Super
// Admin viewing as them sees them as themselves, or as a developer with the banner's switch. Every name is invented;
// the test deletes what it made.

const RUN = `dm${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const JOINED = firstDay(monthsLater(TODAY.slice(0, 7), -3));
const DEV_NAME = `Dina Devmode ${RUN}`;
const OTHER_NAME = `Omar Otherperson ${RUN}`;
const PLAIN_NAME = `Pia Plainemployee ${RUN}`;
const NEAR = { latitude: 30.0601, longitude: 31.3465, accuracy: 18.4 };

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const cookieOf = (res: request.Response) => {
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='));
  if (!cookie) throw new Error('No session cookie returned');
  return cookie.split(';')[0];
};

describe('A developer chooses: as themselves or as a developer (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const as = (key: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[key]),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[key]).send(body),
  });

  async function account(key: string, roles: Parameters<typeof createUser>[1], userAgent?: string) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email, userAgent);
  }

  let departmentId: string;
  let shiftId: string;
  let devEmployeeId: string;
  let devCode: string;
  let otherEmployeeId: string;
  let otherCode: string;
  let unpaidTypeId: string;
  const people: string[] = [];

  async function person(name: string): Promise<{ id: string; code: string }> {
    const made = (await as('hr').post('/employees', { fullNameEn: name, fullNameAr: 'موظف تجريبي' }).expect(201)).body as { id: string; employeeCode: string };
    people.push(made.id);
    await as('hr').post(`/employees/${made.id}/employments`, { employmentType: 'full_time', joinDate: JOINED, departmentId, shiftId }).expect(201);
    return { id: made.id, code: made.employeeCode };
  }

  /** A working day of their shift, two weeks or more ahead, none of them a holiday: for a leave request. */
  async function workingDayAhead(): Promise<string> {
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { workingDays: true } });
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
    let d = addDays(TODAY, 14);
    while (!shift.workingDays.includes(weekday(d)) || holidays.has(d)) d = addDays(d, 1);
    return d;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('employee', ['employee']);
    departmentId = (await as('hr').post('/departments', { nameEn: `Developer mode ${RUN}` }).expect(201)).body.id;
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    ({ id: devEmployeeId, code: devCode } = await person(DEV_NAME));
    ({ id: otherEmployeeId, code: otherCode } = await person(OTHER_NAME));
    // the developer: an employee's account with the Developer role beside it, linked to their profile
    await account('dev', ['employee', 'developer']);
    await prisma.user.update({ where: { id: users.dev }, data: { employeeId: devEmployeeId } });
    // the plain employee, to compare with: linked to a profile of their own
    const plain = await person(PLAIN_NAME);
    await prisma.user.update({ where: { id: users.employee }, data: { employeeId: plain.id } });
    await account('devOnly', ['developer']);
    unpaidTypeId = ((await as('hr').get('/leave/types').expect(200)).body as { id: string; key: string }[]).find((t) => t.key === 'unpaid')!.id;
    // a fresh website sign-in for the developer, now that the account is linked
    sessions.dev = await signIn(app, emails.dev);
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveBalanceYear.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.user.updateMany({ where: { employeeId: { in: people } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await app.close();
  });

  const modeAudits = (userId: string) =>
    prisma.auditLog.findMany({ where: { userId, action: { in: ['mode_chosen', 'mode_switched', 'view_as_mode'] } }, orderBy: { at: 'asc' }, select: { action: true, diff: true, entityId: true } });

  it('signs in and must choose: nothing chosen, the developer view meanwhile (read only)', async () => {
    const login = await api().post('/api/auth/login').send({ email: emails.dev, password: PASSWORD }).expect(200);
    sessions.dev = cookieOf(login);
    expect(login.body).toMatchObject({ mode: null });
    expect(login.body.roles).toHaveLength(2);
    expect(login.body.roles).toEqual(expect.arrayContaining(['developer', 'employee']));
    const me = (await as('dev').get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ mode: null, developer: true });
    const choice = (await as('dev').get('/auth/mode').expect(200)).body;
    // their own name as it is (it is about themselves), their own roles, nothing chosen before
    expect(choice).toEqual({ chooses: true, mode: null, last: null, name: DEV_NAME, roles: ['employee'], switchable: true });
    // until they choose, nothing changes: a check-in is refused as a developer's
    const punch = await as('dev').post('/me/attendance/punches', { kind: 'in', ...NEAR }).expect(403);
    expect(said(punch)).toEqual([DEVELOPER_READ_ONLY]);
    expect(said(await as('dev').post('/auth/mode', { mode: 'admin' }).expect(400))).toEqual(['Choose to use the system as yourself or as a developer.']);
  });

  it('as themselves: their own real data, a check-in and a leave request work, others’ data refused as for any employee', async () => {
    const before = (await as('dev').get('/auth/session').expect(200)).body.id as string;
    const chosen = (await as('dev').post('/auth/mode', { mode: 'self' }).expect(200)).body;
    expect(chosen).toMatchObject({ chooses: true, mode: 'self', name: DEV_NAME, roles: ['employee'] });

    const me = (await as('dev').get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ id: users.dev, roles: ['employee'], mode: 'self', employeeId: devEmployeeId, name: DEV_NAME });
    expect(me.developer).toBeUndefined();
    // no 15 minutes: an employee's session
    expect(me.session).toMatchObject({ id: before, kind: 'web', idleTimeoutMs: null });

    // their own profile, real, no pseudonym
    const own = (await as('dev').get(`/employees/${devEmployeeId}`).expect(200)).body;
    expect(own.fullNameEn).toBe(DEV_NAME);
    expect(JSON.stringify(own)).not.toContain(`Employee ${devCode}`);

    // someone else's: answered as for any employee
    for (const path of [`/employees/${otherEmployeeId}`, '/employees', '/payroll/runs', '/users', `/employees/${otherEmployeeId}/identity`]) {
      const plain = await as('employee').get(path);
      const self = await as('dev').get(path);
      expect(self.status, path).toBe(plain.status);
      if (path !== '/employees') expect(self.status, path).not.toBe(200);
      expect(JSON.stringify(self.body), path).not.toContain(OTHER_NAME);
    }

    // a check-in, and a leave request
    const punch = await as('dev').post('/me/attendance/punches', { kind: 'in', ...NEAR });
    expect(punch.status, JSON.stringify(punch.body)).toBe(200);
    const day = await workingDayAhead();
    const leave = await api()
      .post('/api/me/leave/requests')
      .set('Cookie', sessions.dev)
      .field('typeId', unpaidTypeId)
      .field('startDate', day)
      .field('endDate', day)
      .field('halfDay', 'false')
      .field('reason', `Family errand ${RUN}`);
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    // their own lists: real, theirs
    expect((await as('dev').get('/me/leave/requests').expect(200)).body).toHaveLength(1);
    await as('dev').get('/me/payslips').expect(200);

    // the choice: audited with the mode, in the same session (no new sign-in)
    const audits = await modeAudits(users.dev);
    expect(audits).toEqual([{ action: 'mode_chosen', entityId: users.dev, diff: { mode: 'self', from: null, kind: 'web', sessionId: before } }]);
    expect((await as('dev').get('/auth/session').expect(200)).body.id).toBe(before);
  });

  it('as a developer: read only, pseudonyms, writes refused; the switch audited, the session the same', async () => {
    const before = (await as('dev').get('/auth/session').expect(200)).body.id as string;
    const logins = await prisma.auditLog.count({ where: { userId: users.dev, action: 'login' } });
    const switched = (await as('dev').post('/auth/mode', { mode: 'developer' }).expect(200)).body;
    expect(switched).toMatchObject({ mode: 'developer', last: 'developer', name: DEV_NAME });

    const me = (await as('dev').get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ developer: true, mode: 'developer' });
    expect(me.roles).toEqual([...DEVELOPER_ACTS_AS]);
    expect(me.session.idleTimeoutMs).toBe(IDLE_TIMEOUT_MS);

    // everyone a pseudonym, themselves too
    const other = (await as('dev').get(`/employees/${otherEmployeeId}`).expect(200)).body;
    expect(other.fullNameEn).toBe(`Employee ${otherCode}`);
    expect(JSON.stringify(other)).not.toContain(OTHER_NAME);
    expect((await as('dev').get(`/employees/${devEmployeeId}`).expect(200)).body.fullNameEn).toBe(`Employee ${devCode}`);
    expect(JSON.stringify((await as('dev').get('/employees').expect(200)).body)).not.toContain(DEV_NAME);

    // nothing changes
    expect(said(await as('dev').post('/me/attendance/punches', { kind: 'out', ...NEAR }).expect(403))).toEqual([DEVELOPER_READ_ONLY]);
    expect(said(await as('dev').post('/departments', { nameEn: `Nope ${RUN}` }).expect(403))).toEqual([DEVELOPER_READ_ONLY]);

    // the switch: audited, the same session, no new sign-in
    const audits = await modeAudits(users.dev);
    expect(audits.at(-1)).toEqual({ action: 'mode_switched', entityId: users.dev, diff: { mode: 'developer', from: 'self', kind: 'web', sessionId: before } });
    expect((await as('dev').get('/auth/session').expect(200)).body.id).toBe(before);
    expect(await prisma.auditLog.count({ where: { userId: users.dev, action: 'login' } })).toBe(logins);
    // the same mode again changes nothing, and isn't written again
    await as('dev').post('/auth/mode', { mode: 'developer' }).expect(200);
    expect(await modeAudits(users.dev)).toHaveLength(audits.length);
    // and back: one click
    await as('dev').post('/auth/mode', { mode: 'self' }).expect(200);
    expect((await as('dev').get('/auth/me').expect(200)).body).toMatchObject({ roles: ['employee'], mode: 'self' });
    expect((await modeAudits(users.dev)).at(-1)).toMatchObject({ action: 'mode_switched', diff: { mode: 'self', from: 'developer' } });
  });

  it('the last choice is remembered for the next sign-in, which asks again', async () => {
    await as('dev').post('/auth/mode', { mode: 'developer' }).expect(200);
    sessions.dev = await signIn(app, emails.dev);
    expect((await as('dev').get('/auth/mode').expect(200)).body).toMatchObject({ mode: null, last: 'developer' });
    expect((await as('dev').get('/auth/me').expect(200)).body).toMatchObject({ mode: null, developer: true });
    await as('dev').post('/auth/mode', { mode: 'self' }).expect(200);
  });

  it('a developer alone has no choice: always a developer', async () => {
    const login = await api().post('/api/auth/login').send({ email: emails.devOnly, password: PASSWORD }).expect(200);
    sessions.devOnly = cookieOf(login);
    expect('mode' in login.body).toBe(false);
    expect((await as('devOnly').get('/auth/mode').expect(200)).body).toEqual({ chooses: false, mode: null, last: null, name: null, roles: [], switchable: false });
    const me = (await as('devOnly').get('/auth/me').expect(200)).body;
    expect(me.developer).toBe(true);
    expect('mode' in me).toBe(false);
    expect(said(await as('devOnly').post('/auth/mode', { mode: 'self' }).expect(403))).toEqual([MODE_NOT_YOURS]);
    expect((await as('devOnly').get('/auth/me').expect(200)).body.developer).toBe(true);
    // and a plain employee has none either
    expect(said(await as('employee').post('/auth/mode', { mode: 'developer' }).expect(403))).toEqual([MODE_NOT_YOURS]);
  });

  it('in the app: always as themselves, no choice asked, checking in works', async () => {
    const login = await api().post('/api/auth/login').set('User-Agent', APP_USER_AGENT).send({ email: emails.dev, password: PASSWORD }).expect(200);
    sessions.devApp = cookieOf(login);
    expect(login.body).toMatchObject({ mode: 'self' });
    const me = (await as('devApp').get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ roles: ['employee'], mode: 'self', session: { kind: 'app' } });
    expect(me.developer).toBeUndefined();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: me.session.id }, select: { mode: true } })).toEqual({ mode: 'self' });
    expect((await as('devApp').get('/auth/mode').expect(200)).body).toMatchObject({ chooses: true, mode: 'self', switchable: false });
    expect(said(await as('devApp').post('/auth/mode', { mode: 'developer' }).expect(400))).toEqual([MODE_IN_APP]);
    expect((await as('devApp').get(`/employees/${devEmployeeId}`).expect(200)).body.fullNameEn).toBe(DEV_NAME);
    const punch = await as('devApp').post('/me/attendance/punches', { kind: 'out', ...NEAR });
    expect(punch.status, JSON.stringify(punch.body)).toBe(200);
    // the website's session goes on beside it, in its own mode
    expect((await as('dev').get('/auth/me').expect(200)).body).toMatchObject({ mode: 'self', session: { kind: 'web' } });
  });

  it('viewed as by a Super Admin: as themselves first, as a developer with the banner’s switch, and back', async () => {
    const own = sessions.superAdmin;
    sessions.viewing = cookieOf(await as('superAdmin').post('/auth/view-as', { userId: users.dev }).expect(200));
    const seen = (await as('viewing').get('/auth/me').expect(200)).body;
    expect(seen).toMatchObject({ id: users.dev, roles: ['employee'], mode: 'self', name: DEV_NAME, viewAs: { act: false } });
    expect(seen.developer).toBeUndefined();
    expect((await as('viewing').get(`/employees/${devEmployeeId}`).expect(200)).body.fullNameEn).toBe(DEV_NAME);
    expect((await as('viewing').get('/auth/mode').expect(200)).body).toMatchObject({ chooses: true, mode: 'self', switchable: false });
    // their own switch isn't for the Super Admin: view only refuses it
    await as('viewing').post('/auth/mode', { mode: 'developer' }).expect(403);

    // as a developer: the developer view, pseudonyms, read only
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/mode', { mode: 'developer' }).expect(200));
    const asDev = (await as('viewing').get('/auth/me').expect(200)).body;
    expect(asDev).toMatchObject({ developer: true, mode: 'developer', viewAs: { act: false } });
    expect((await as('viewing').get(`/employees/${otherEmployeeId}`).expect(200)).body.fullNameEn).toBe(`Employee ${otherCode}`);
    // Act as them changes nothing in the developer view: still read only
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/act', { act: true }).expect(200));
    expect(said(await as('viewing').post('/departments', { nameEn: `Nope ${RUN}` }).expect(403))).toEqual([DEVELOPER_READ_ONLY]);
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/act', { act: false }).expect(200));

    // back to themselves, from the developer view (the switcher still works there)
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/mode', { mode: 'self' }).expect(200));
    expect((await as('viewing').get('/auth/me').expect(200)).body).toMatchObject({ roles: ['employee'], mode: 'self' });
    const audits = await modeAudits(users.superAdmin);
    expect(audits.map((a) => a.diff)).toEqual([
      { from: emails.superAdmin, to: emails.dev, mode: 'developer', before: 'self' },
      { from: emails.superAdmin, to: emails.dev, mode: 'self', before: 'developer' },
    ]);
    expect(audits.every((a) => a.action === 'view_as_mode' && a.entityId === users.dev)).toBe(true);
    // the developer's own session keeps its mode: the Super Admin's switch is theirs alone
    expect((await as('dev').get('/auth/me').expect(200)).body).toMatchObject({ mode: 'self' });

    // back to their account from the developer view, too
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/mode', { mode: 'developer' }).expect(200));
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/stop').expect(200));
    expect((await as('viewing').get('/auth/me').expect(200)).body).toMatchObject({ id: users.superAdmin, viewAs: null });
    expect('mode' in (await as('viewing').get('/auth/me').expect(200)).body).toBe(false);

    // a developer alone is seen as a developer (no choice), and the Super Admin still goes back
    sessions.viewing = cookieOf(await api().post('/api/auth/view-as').set('Cookie', own).send({ userId: users.devOnly }).expect(200));
    expect((await as('viewing').get('/auth/me').expect(200)).body.developer).toBe(true);
    expect(said(await as('viewing').post('/auth/view-as/mode', { mode: 'self' }).expect(400))).toEqual([VIEW_MODE_NOT_THEIRS]);
    sessions.viewing = cookieOf(await as('viewing').post('/auth/view-as/stop').expect(200));
    expect((await as('viewing').get('/auth/me').expect(200)).body).toMatchObject({ id: users.superAdmin, viewAs: null });
  });

  it('the Users page keeps both roles', async () => {
    const roles = (await as('superAdmin').get(`/users/${users.dev}`).expect(200)).body.roles;
    expect(roles).toHaveLength(2);
    expect(roles).toEqual(expect.arrayContaining(['developer', 'employee']));
  });
});
