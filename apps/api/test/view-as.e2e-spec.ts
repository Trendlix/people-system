import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

// View as another user (owner's decisions, 17 October 2026): "a super admin can view any other user profile from a
// switcher, only the super admin"; "view only with a button to act but by default not checked". The switched session
// answers as the user viewed; every change is refused until Act as them is on; what is done then, and the restricted
// data viewed, is recorded as the user's and the Super Admin's; switching, acting and going back are recorded too.

const RUN = Date.now().toString(36);

/** The session cookie a response sets ("ps_session=…"), with its Max-Age in seconds. */
function cookieOf(res: request.Response): { cookie: string; maxAge: number } {
  const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='));
  if (!header) throw new Error('No session cookie returned');
  return { cookie: header.split(';')[0], maxAge: Number(/Max-Age=(\d+)/i.exec(header)?.[1]) };
}

/** The claims of a session cookie's token, read without checking it (the API checks it). */
function claimsOf(cookie: string): Record<string, unknown> {
  const token = cookie.slice('ps_session='.length);
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('View as (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  let superEmail: string;
  let superId: string;
  let superAdmin: string; // the Super Admin's own session
  let otherSuperId: string;
  let admin: string;
  let hr: string;
  let hrId: string;
  let hrEmail: string;
  let employeeEmail: string;
  let employeeUserId: string;
  let deactivatedId: string;
  let profile: { id: string; employmentId: string }; // the employee's own profile, hired, with a contract drafted
  const employeeName = `Viewed Employee ${RUN}`;

  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  /** Switches the Super Admin's own session to the user, and answers the new session cookie. */
  async function viewAs(userId: string, session = superAdmin): Promise<string> {
    return cookieOf(await api().post('/api/auth/view-as').set('Cookie', session).send({ userId }).expect(200)).cookie;
  }

  async function act(session: string, on: boolean): Promise<string> {
    return cookieOf(await api().post('/api/auth/view-as/act').set('Cookie', session).send({ act: on }).expect(200)).cookie;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    superEmail = await createUser(prisma, ['super_admin']);
    superId = await idOf(superEmail);
    superAdmin = await signIn(app, superEmail);
    otherSuperId = await idOf(await createUser(prisma, ['super_admin']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    hrEmail = await createUser(prisma, ['hr']);
    hrId = await idOf(hrEmail);
    hr = await signIn(app, hrEmail);
    // a work email is the company's: the employee signs in with theirs
    employeeEmail = `viewed.${RUN}@trendlix.com`;
    employeeUserId = (await prisma.user.create({ data: { email: employeeEmail, passwordHash: await hashPassword(PASSWORD), roles: { create: { role: { connect: { key: 'employee' } } } } } })).id;
    const deactivated = await createUser(prisma, ['employee']);
    deactivatedId = await idOf(deactivated);
    await prisma.user.update({ where: { id: deactivatedId }, data: { isActive: false } });

    // the employee's own profile (their work email is their sign-in email), hired, with a contract drafted by HR
    const added = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: employeeName, fullNameAr: 'موظف معروض', workEmail: employeeEmail }).expect(201);
    const hired = await api()
      .post(`/api/employees/${added.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: '2026-01-15' })
      .expect(201);
    profile = { id: added.body.id, employmentId: hired.body.employment.id };
    await api().post(`/api/employees/${profile.id}/employments/${profile.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: 12000 }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets only a Super Admin switch', async () => {
    await api().post('/api/auth/view-as').send({ userId: hrId }).expect(401);
    for (const session of [admin, hr]) {
      const res = await api().post('/api/auth/view-as').set('Cookie', session).send({ userId: employeeUserId }).expect(403);
      expect(res.body.message).toBe('Only a Super Admin can view as another user.');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('refuses switching to themself, to a deactivated user, or to no one', async () => {
    const self = await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: superId }).expect(400);
    expect(self.body.message).toBe('You cannot view as yourself.');
    const off = await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: deactivatedId }).expect(409);
    expect(off.body.message).toContain('is deactivated');
    await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: 'someone' }).expect(400);
    expect(await prisma.auditLog.count({ where: { action: 'view_as_start', userId: superId, entityId: { in: [superId, deactivatedId] } } })).toBe(0);
  });

  it('answers as the user viewed: their roles, their data, their refusals; view only to start with', async () => {
    const res = await api().post('/api/auth/view-as').set('Cookie', superAdmin).send({ userId: employeeUserId }).expect(200);
    expect(res.body).toMatchObject({
      id: employeeUserId,
      email: employeeEmail,
      roles: ['employee'],
      employeeId: profile.id,
      name: employeeName,
      viewAs: { by: { id: superId, email: superEmail }, act: false },
    });
    const { cookie: viewing, maxAge } = cookieOf(res);

    const me = await api().get('/api/auth/me').set('Cookie', viewing).expect(200);
    expect(me.body).toEqual(res.body);
    // what only an admin sees: refused, as it is for the employee
    await api().get('/api/users').set('Cookie', viewing).expect(403);
    await api().get('/api/users').set('Cookie', superAdmin).expect(200);
    // the people the employee sees: only themself
    const people = await api().get('/api/employees').set('Cookie', viewing).expect(200);
    expect(people.body.map((e: { id: string }) => e.id)).toEqual([profile.id]);
    // their own contract, without the salary, as the employee sees it
    const contracts = `/api/employees/${profile.id}/employments/${profile.employmentId}/contracts`;
    const own = await api().get(contracts).set('Cookie', viewing).expect(200);
    expect(own.body[0]).toMatchObject({ grossSalary: null, salaryHidden: true });
    const asHr = await api().get(contracts).set('Cookie', hr).expect(200);
    expect(asHr.body[0]).toMatchObject({ grossSalary: 12000, salaryHidden: false });

    // the switched session ends with the Super Admin's own: the same expiry
    expect(claimsOf(viewing).exp).toBe(claimsOf(superAdmin).exp);
    expect(maxAge).toBeLessThanOrEqual(8 * 60 * 60);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'view_as_start', entityId: employeeUserId }, orderBy: { id: 'desc' } });
    expect(audit).toMatchObject({ userId: superId, onBehalfById: null, entityType: 'user', diff: { from: superEmail, to: employeeEmail, act: false } });
  });

  it('shows what a Super Admin alone cannot see, as the user viewed, and records the Super Admin with it', async () => {
    await api().get(`/api/employees/${profile.id}/bank`).set('Cookie', superAdmin).expect(403); // not HR, Finance or the CEO
    const viewing = await viewAs(hrId);
    await api().get(`/api/employees/${profile.id}/bank`).set('Cookie', viewing).expect(200);
    const seen = await prisma.auditLog.findFirstOrThrow({ where: { action: 'view_restricted', entityId: profile.id }, orderBy: { id: 'desc' } });
    expect(seen).toMatchObject({ userId: hrId, onBehalfById: superId, diff: { fields: ['accountNo', 'iban'] } });
    // HR viewing it themself: no one behind them
    await api().get(`/api/employees/${profile.id}/bank`).set('Cookie', hr).expect(200);
    const own = await prisma.auditLog.findFirstOrThrow({ where: { action: 'view_restricted', entityId: profile.id }, orderBy: { id: 'desc' } });
    expect(own).toMatchObject({ userId: hrId, onBehalfById: null });
  });

  it('refuses every change while view only, whatever the endpoint', async () => {
    const viewing = await viewAs(hrId);
    const message = `Viewing as ${hrEmail}: view only. Switch on Act as them to make changes.`; // HR has no profile: their email
    const before = await prisma.auditLog.count();
    const patch = await api().patch(`/api/employees/${profile.id}`).set('Cookie', viewing).send({ personalEmail: `changed-${RUN}@test.local` }).expect(403);
    expect(patch.body.message).toBe(message);
    const created = await api().post('/api/employees').set('Cookie', viewing).send({ fullNameEn: `Not Added ${RUN}`, fullNameAr: 'لا' }).expect(403);
    expect(created.body.message).toBe(message);
    await api().post('/api/auth/change-password').set('Cookie', viewing).send({ currentPassword: 'x', newPassword: 'another-password-1' }).expect(403);

    // viewing as another Super Admin, even a delete is refused
    const asSuper = await viewAs(otherSuperId);
    await api().delete(`/api/employees/${profile.id}`).set('Cookie', asSuper).expect(403);
    await api().get('/api/users').set('Cookie', asSuper).expect(200); // reading is not

    expect((await prisma.employee.findUniqueOrThrow({ where: { id: profile.id } })).personalEmail).toBeNull();
    expect(await prisma.auditLog.count()).toBe(before + 1); // only the second switch
  });

  it('lets the Super Admin act as them with Act as them on, recording both; off again on every switch', async () => {
    const viewing = await viewAs(hrId);
    const acting = await act(viewing, true);
    expect(claimsOf(acting)).toMatchObject({ sub: superId, viewAs: hrId, act: true, exp: claimsOf(superAdmin).exp });
    const me = await api().get('/api/auth/me').set('Cookie', acting).expect(200);
    expect(me.body.viewAs).toEqual({ by: { id: superId, email: superEmail }, act: true });

    const email = `acted-${RUN}@test.local`;
    await api().patch(`/api/employees/${profile.id}`).set('Cookie', acting).send({ personalEmail: email }).expect(200);
    const done = await prisma.auditLog.findFirstOrThrow({ where: { action: 'update', entityType: 'employee', entityId: profile.id }, orderBy: { id: 'desc' } });
    expect(done).toMatchObject({ userId: hrId, onBehalfById: superId, diff: { personalEmail: { from: null, to: email } } });

    // a file sent too (read before the endpoint runs): recorded the same way
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    await api().put('/api/company/thumbnail').set('Cookie', acting).attach('file', png, 'thumbnail.png').expect(200);
    const uploaded = await prisma.auditLog.findFirstOrThrow({ where: { action: 'update', entityType: 'company' }, orderBy: { id: 'desc' } });
    expect(uploaded).toMatchObject({ userId: hrId, onBehalfById: superId, diff: { thumbnail: { type: 'image/png' } } });

    // still only what HR may do: no user accounts
    await api().post('/api/users').set('Cookie', acting).send({ email: `nope-${RUN}@test.local`, password: 'temporary-pass-1', roles: ['employee'] }).expect(403);

    const viewOnly = await act(acting, false);
    await api().patch(`/api/employees/${profile.id}`).set('Cookie', viewOnly).send({ personalEmail: null }).expect(403);

    const turns = await prisma.auditLog.findMany({ where: { action: 'view_as_act', userId: superId, entityId: hrId }, orderBy: { id: 'desc' }, take: 2 });
    expect(turns.map((t) => t.diff)).toEqual([
      { from: superEmail, to: hrEmail, act: false },
      { from: superEmail, to: hrEmail, act: true },
    ]);
    expect(turns.every((t) => t.onBehalfById === null)).toBe(true);

    // switching to someone else starts view only again, after going back
    const actingAgain = await act(viewOnly, true);
    const back = cookieOf(await api().post('/api/auth/view-as/stop').set('Cookie', actingAgain).expect(200)).cookie;
    expect(claimsOf(await viewAs(hrId, back))).toMatchObject({ viewAs: hrId, act: false });
  });

  it('never nests: no switching while switched, even when viewing as another Super Admin', async () => {
    for (const userId of [hrId, otherSuperId]) {
      const viewing = await viewAs(userId);
      const res = await api().post('/api/auth/view-as').set('Cookie', viewing).send({ userId: employeeUserId }).expect(409);
      expect(res.body.message).toContain('Go back to your account first.');
      const acting = await act(viewing, true);
      await api().post('/api/auth/view-as').set('Cookie', acting).send({ userId: employeeUserId }).expect(409);
    }
    const own = await api().post('/api/auth/view-as/act').set('Cookie', superAdmin).send({ act: true }).expect(409);
    expect(own.body.message).toBe('You are not viewing as anyone.');
  });

  it('goes back to the Super Admin’s own session at once, recorded', async () => {
    const viewing = await viewAs(employeeUserId);
    const res = await api().post('/api/auth/view-as/stop').set('Cookie', viewing).expect(200);
    expect(res.body).toMatchObject({ id: superId, email: superEmail, roles: ['super_admin'], viewAs: null });
    const { cookie: back } = cookieOf(res);
    expect(claimsOf(back)).toMatchObject({ sub: superId, exp: claimsOf(superAdmin).exp });
    expect(claimsOf(back)).not.toHaveProperty('viewAs');
    await api().get('/api/users').set('Cookie', back).expect(200);
    await api().get('/api/employees/' + profile.id + '/bank').set('Cookie', back).expect(403);

    const stop = await prisma.auditLog.findFirstOrThrow({ where: { action: 'view_as_stop', entityId: employeeUserId }, orderBy: { id: 'desc' } });
    expect(stop).toMatchObject({ userId: superId, onBehalfById: null, diff: { from: superEmail, to: employeeEmail, act: false } });

    // pressed again: nothing changes, nothing recorded
    const count = await prisma.auditLog.count({ where: { action: 'view_as_stop' } });
    const again = await api().post('/api/auth/view-as/stop').set('Cookie', back).expect(200);
    expect(again.body).toMatchObject({ id: superId, viewAs: null });
    expect(await prisma.auditLog.count({ where: { action: 'view_as_stop' } })).toBe(count);
  });

  it('ends a switched session when the Super Admin loses the role or the user viewed is deactivated', async () => {
    const email = await createUser(prisma, ['super_admin']);
    const id = await idOf(email);
    const session = await signIn(app, email);
    const viewing = await viewAs(employeeUserId, session);
    await prisma.userRole.deleteMany({ where: { userId: id, role: { key: 'super_admin' } } });
    await api().get('/api/auth/me').set('Cookie', viewing).expect(401);

    const target = await idOf(await createUser(prisma, ['employee']));
    const mine = await viewAs(target);
    await prisma.user.update({ where: { id: target }, data: { isActive: false } });
    await api().get('/api/auth/me').set('Cookie', mine).expect(401);
    await api().get('/api/auth/me').set('Cookie', superAdmin).expect(200);
  });

  it('cannot be forged', async () => {
    const own = await signIn(app, employeeEmail);
    const [header, , signature] = own.slice('ps_session='.length).split('.');
    const exp = Math.floor(Date.now() / 1000) + 3600;

    // the employee's own token, its claims changed to view as HR and act
    const tampered = `ps_session=${header}.${b64({ sub: employeeUserId, viewAs: hrId, act: true, exp })}.${signature}`;
    await api().get('/api/auth/me').set('Cookie', tampered).expect(401);
    // a Super Admin's switched session, Act as them turned on without asking
    const viewing = await viewAs(hrId);
    const [h, payload, s] = viewing.slice('ps_session='.length).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as object;
    await api().patch(`/api/employees/${profile.id}`).set('Cookie', `ps_session=${h}.${b64({ ...claims, act: true })}.${s}`).send({ personalEmail: null }).expect(401);
    // signed with another secret, or not signed at all
    const other = await new JwtService({ secret: 'not-the-secret' }).signAsync({ sub: superId, viewAs: hrId, act: true, exp });
    await api().get('/api/auth/me').set('Cookie', `ps_session=${other}`).expect(401);
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: superId, viewAs: hrId, act: true, exp })}.`;
    await api().get('/api/auth/me').set('Cookie', `ps_session=${unsigned}`).expect(401);
    await api().get('/api/auth/me').set('Authorization', `Bearer ${unsigned}`).expect(401);
    // signed with the right secret, but for someone who is not a Super Admin: refused as well
    const jwt = app.get(JwtService, { strict: false });
    const notSuper = await jwt.signAsync({ sub: employeeUserId, viewAs: hrId, act: true, exp });
    await api().get('/api/auth/me').set('Cookie', `ps_session=${notSuper}`).expect(401);
  });

  it('keeps the Super Admin only on entries they made in someone else’s name', async () => {
    // the database refuses an entry naming the same user twice
    await expect(prisma.auditLog.create({ data: { userId: superId, onBehalfById: superId, action: 'update', entityType: 'user' } })).rejects.toThrow();
  });
});
