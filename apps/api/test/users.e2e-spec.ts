import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

// Unique names per run: the test files share one database (emptied at the start of each run).
const RUN = Date.now().toString(36);
let counter = 0;
const newEmail = () => `account-${RUN}-${++counter}@test.local`;
const TEMPORARY = 'temporary-pass-1';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let adminId: string;
  const api = () => request(app.getHttpServer());

  /** Signs in with the given password and returns the session cookie. */
  async function signInWith(email: string, password: string): Promise<string> {
    const res = await api().post('/api/auth/login').send({ email, password }).expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='));
    return cookie!.split(';')[0];
  }

  /** Creates an account through the API and returns its id. */
  async function createAccount(email: string, roles: string[] = ['employee']): Promise<string> {
    const res = await api().post('/api/users').set('Cookie', admin).send({ email, password: TEMPORARY, roles }).expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const email = await createUser(prisma, ['admin']);
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    admin = await signIn(app, email);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an admin create a user who can then sign in, without logging the password', async () => {
    const email = newEmail();
    const res = await api()
      .post('/api/users')
      .set('Cookie', admin)
      .send({ email: `  ${email.toUpperCase()} `, password: TEMPORARY, roles: ['hr', 'employee'] })
      .expect(201);
    expect(res.body).toMatchObject({ email, isActive: true, roles: ['employee', 'hr'], lastSignInAt: null, employee: null });
    expect(res.body).not.toHaveProperty('passwordHash');

    await api().post('/api/auth/login').send({ email, password: TEMPORARY }).expect(200);
    const one = await api().get(`/api/users/${res.body.id}`).set('Cookie', admin).expect(200);
    expect(new Date(one.body.lastSignInAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: res.body.id, action: 'create' } });
    expect(audit).toMatchObject({ userId: adminId, diff: { email, roles: ['employee', 'hr'], isActive: true } });
    expect(JSON.stringify(audit.diff)).not.toContain(TEMPORARY);
  });

  it('lists users by email, with the employee whose work email matches', async () => {
    const [b, a] = [`list-${RUN}-b@test.local`, `list-${RUN}-a@test.local`];
    await createAccount(b);
    const aId = await createAccount(a);
    const employee = await prisma.employee.create({
      data: {
        employeeCode: `USR-${RUN}`,
        fullNameEn: 'Linked Person',
        fullNameAr: 'شخص مرتبط',
        workEmail: a, // a profile: being employed or not makes no difference here
      },
    });

    const res = await api().get('/api/users').set('Cookie', admin).expect(200);
    const emails: string[] = res.body.map((u: { email: string }) => u.email);
    expect(emails.indexOf(a)).toBeLessThan(emails.indexOf(b));
    expect(res.body.find((u: { id: string }) => u.id === aId).employee).toEqual({
      id: employee.id,
      employeeCode: `USR-${RUN}`,
      fullNameEn: 'Linked Person',
    });
    expect(res.body.find((u: { email: string }) => u.email === b).employee).toBeNull();
  });

  it('refuses everyone but admins', async () => {
    const hr = await signIn(app, await createUser(prisma, ['hr', 'ceo']));
    await api().get('/api/users').expect(401);
    await api().get('/api/users').set('Cookie', hr).expect(403);
    await api().get(`/api/users/${adminId}`).set('Cookie', hr).expect(403);
    await api().post('/api/users').set('Cookie', hr).send({ email: newEmail(), password: TEMPORARY, roles: ['admin'] }).expect(403);
    await api().patch(`/api/users/${adminId}`).set('Cookie', hr).send({ isActive: false }).expect(403);
    await api().put(`/api/users/${adminId}/password`).set('Cookie', hr).send({ password: TEMPORARY }).expect(403);
  });

  it('rejects a duplicate email, whatever its case', async () => {
    const email = newEmail();
    await createAccount(email);
    const res = await api()
      .post('/api/users')
      .set('Cookie', admin)
      .send({ email: email.toUpperCase(), password: TEMPORARY, roles: ['employee'] })
      .expect(409);
    expect(res.body.message).toBe('A user with this email already exists.');
  });

  it('rejects invalid values', async () => {
    const send = (body: object) => api().post('/api/users').set('Cookie', admin).send(body).expect(400);
    await send({ email: 'not-an-email', password: TEMPORARY, roles: ['employee'] });
    const short = await send({ email: newEmail(), password: 'too-short', roles: ['employee'] });
    expect(short.body.message).toContain('The password must be at least 10 characters.');
    await send({ email: newEmail(), password: 'x'.repeat(201), roles: ['employee'] });
    await send({ email: newEmail(), password: TEMPORARY, roles: [] });
    await send({ email: newEmail(), password: TEMPORARY, roles: ['owner'] });
    await send({ email: newEmail(), password: TEMPORARY, roles: ['hr', 'hr'] });
    await api().patch(`/api/users/${adminId}`).set('Cookie', admin).send({ email: newEmail() }).expect(400);
    await api().get('/api/users/00000000-0000-4000-8000-000000000000').set('Cookie', admin).expect(404);
  });

  it('changes roles, which apply to the next request', async () => {
    const email = newEmail();
    const id = await createAccount(email, ['employee']);
    const session = await signInWith(email, TEMPORARY);

    const res = await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ roles: ['hr', 'finance'] }).expect(200);
    expect(res.body.roles).toEqual(['hr', 'finance']);
    const me = await api().get('/api/auth/me').set('Cookie', session).expect(200);
    expect(me.body.roles).toEqual(expect.arrayContaining(['hr', 'finance']));

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: id, action: 'update' } });
    expect(audit.diff).toEqual({ roles: { from: ['employee'], to: ['hr', 'finance'] } });
  });

  it('deactivating a user ends their session and stops them signing in; reactivating lets them back', async () => {
    const email = newEmail();
    const id = await createAccount(email);
    const session = await signInWith(email, TEMPORARY);

    const res = await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ isActive: false }).expect(200);
    expect(res.body.isActive).toBe(false);
    await api().get('/api/auth/me').set('Cookie', session).expect(401);
    await api().post('/api/auth/login').send({ email, password: TEMPORARY }).expect(401);

    await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ isActive: true }).expect(200);
    await api().post('/api/auth/login').send({ email, password: TEMPORARY }).expect(200);

    const audits = await prisma.auditLog.findMany({ where: { entityType: 'user', entityId: id, action: 'update' }, orderBy: { id: 'asc' } });
    expect(audits.map((a) => a.diff)).toEqual([{ isActive: { from: true, to: false } }, { isActive: { from: false, to: true } }]);
  });

  it('lets an admin set a new temporary password', async () => {
    const email = newEmail();
    const id = await createAccount(email);
    const fresh = 'another-temporary-2';

    await api().put(`/api/users/${id}/password`).set('Cookie', admin).send({ password: 'short' }).expect(400);
    await api().put(`/api/users/${id}/password`).set('Cookie', admin).send({ password: fresh }).expect(204);
    await api().post('/api/auth/login').send({ email, password: TEMPORARY }).expect(401);
    await api().post('/api/auth/login').send({ email, password: fresh }).expect(200);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: id, action: 'password_reset' } });
    expect(audit.userId).toBe(adminId);
    expect(JSON.stringify(audit.diff ?? null)).not.toContain(fresh);
  });

  it('lets anyone signed in change their own password', async () => {
    const email = await createUser(prisma, ['employee']);
    const session = await signIn(app, email);
    const change = (body: object) => api().post('/api/auth/change-password').set('Cookie', session).send(body);
    const fresh = 'my-own-new-password';

    await api().post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: fresh }).expect(401);
    const wrong = await change({ currentPassword: 'not-my-password', newPassword: fresh }).expect(400);
    expect(wrong.body.message).toBe('Your current password is not correct.');
    const same = await change({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    expect(same.body.message).toContain('different from your current one');
    await change({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);

    await change({ currentPassword: PASSWORD, newPassword: fresh }).expect(204);
    await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await api().post('/api/auth/login').send({ email, password: fresh }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: user.id, action: 'password_change' } });
    expect(audit.userId).toBe(user.id);
    expect(JSON.stringify(audit.diff ?? null)).not.toContain(fresh);
  });

  it('will not let an admin deactivate themself or remove their own admin role', async () => {
    const deactivate = await api().patch(`/api/users/${adminId}`).set('Cookie', admin).send({ isActive: false }).expect(409);
    expect(deactivate.body.message).toContain('You cannot deactivate your own account');
    const demote = await api().patch(`/api/users/${adminId}`).set('Cookie', admin).send({ roles: ['hr'] }).expect(409);
    expect(demote.body.message).toContain('You cannot remove your own admin role');

    // Other changes to their own roles are fine.
    const res = await api().patch(`/api/users/${adminId}`).set('Cookie', admin).send({ roles: ['hr', 'admin'] }).expect(200);
    expect(res.body).toMatchObject({ isActive: true, roles: ['hr', 'admin'] });
  });

  it('lets an admin remove another admin, since an active admin remains', async () => {
    const email = newEmail();
    const id = await createAccount(email, ['admin']);
    const other = await signInWith(email, TEMPORARY);
    await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ isActive: false }).expect(200);
    await api().get('/api/users').set('Cookie', other).expect(401);
  });

  describe('Super Admin (owner’s decision, 15 October 2026)', () => {
    const ROLE_ONLY = 'Only a Super Admin can give or take away the Super Admin role.';
    const ACCOUNT_ONLY = "Only a Super Admin can change a Super Admin's account.";
    let superAdmin: string;
    let superAdminId: string;

    beforeAll(async () => {
      // a Super Admin without the admin role itself: it has an Admin's powers all the same
      const email = await createUser(prisma, ['super_admin']);
      superAdminId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
      superAdmin = await signIn(app, email);
    });

    it('is a role only a Super Admin gives or takes away', async () => {
      const refused = await api().post('/api/users').set('Cookie', admin).send({ email: newEmail(), password: TEMPORARY, roles: ['super_admin'] }).expect(403);
      expect(refused.body.message).toBe(ROLE_ONLY);
      const id = await createAccount(newEmail(), ['hr']);
      const promote = await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ roles: ['hr', 'super_admin'] }).expect(403);
      expect(promote.body.message).toBe(ROLE_ONLY);
      const self = await api().patch(`/api/users/${adminId}`).set('Cookie', admin).send({ roles: ['admin', 'super_admin'] }).expect(403);
      expect(self.body.message).toBe(ROLE_ONLY);
      expect((await api().get(`/api/users/${id}`).set('Cookie', admin).expect(200)).body.roles).toEqual(['hr']);

      // a Super Admin can, on a new account and an existing one, and both are audited
      const created = await api()
        .post('/api/users')
        .set('Cookie', superAdmin)
        .send({ email: newEmail(), password: TEMPORARY, roles: ['super_admin', 'admin'] })
        .expect(201);
      expect(created.body.roles).toEqual(['admin', 'super_admin']);
      const promoted = await api().patch(`/api/users/${id}`).set('Cookie', superAdmin).send({ roles: ['hr', 'super_admin'] }).expect(200);
      expect(promoted.body.roles).toEqual(['hr', 'super_admin']);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: id, action: 'update' } });
      expect(audit).toMatchObject({ userId: superAdminId, diff: { roles: { from: ['hr'], to: ['hr', 'super_admin'] } } });

      // and takes it away again
      const demoted = await api().patch(`/api/users/${id}`).set('Cookie', superAdmin).send({ roles: ['hr'] }).expect(200);
      expect(demoted.body.roles).toEqual(['hr']);
    });

    it('protects a Super Admin’s account from an Admin: roles, active, password', async () => {
      const email = newEmail();
      const id = (await api().post('/api/users').set('Cookie', superAdmin).send({ email, password: TEMPORARY, roles: ['super_admin'] }).expect(201)).body.id;

      // an Admin can see the account, not change it
      await api().get(`/api/users/${id}`).set('Cookie', admin).expect(200);
      const roles = await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ roles: ['super_admin', 'hr'] }).expect(403);
      expect(roles.body.message).toBe(ACCOUNT_ONLY);
      const demote = await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ roles: ['admin'] }).expect(403);
      expect(demote.body.message).toBe(ROLE_ONLY);
      const deactivate = await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ isActive: false }).expect(403);
      expect(deactivate.body.message).toBe(ACCOUNT_ONLY);
      const password = await api().put(`/api/users/${id}/password`).set('Cookie', admin).send({ password: 'admin-chosen-pass' }).expect(403);
      expect(password.body.message).toBe(ACCOUNT_ONLY);
      await api().patch(`/api/users/${id}`).set('Cookie', admin).send({ email: newEmail() }).expect(400); // nobody changes an email
      await api().post('/api/auth/login').send({ email, password: TEMPORARY }).expect(200);
      expect(await prisma.auditLog.count({ where: { entityType: 'user', entityId: id, userId: adminId } })).toBe(0);

      // another Super Admin can
      await api().patch(`/api/users/${id}`).set('Cookie', superAdmin).send({ roles: ['super_admin', 'hr'] }).expect(200);
      await api().put(`/api/users/${id}/password`).set('Cookie', superAdmin).send({ password: 'super-chosen-pass' }).expect(204);
      await api().post('/api/auth/login').send({ email, password: 'super-chosen-pass' }).expect(200);
      await api().patch(`/api/users/${id}`).set('Cookie', superAdmin).send({ isActive: false }).expect(200);
      const audits = await prisma.auditLog.findMany({ where: { entityType: 'user', entityId: id, userId: superAdminId }, orderBy: { id: 'asc' } });
      expect(audits.map((a) => a.action)).toEqual(['create', 'update', 'password_reset', 'update']);
      expect(audits[3].diff).toEqual({ isActive: { from: true, to: false } });
    });

    it('lets a Super Admin manage accounts as an Admin does, without the admin role itself', async () => {
      await api().get('/api/users').set('Cookie', superAdmin).expect(200);
      const id = await createAccount(newEmail(), ['admin']);
      await api().patch(`/api/users/${id}`).set('Cookie', superAdmin).send({ roles: ['hr'] }).expect(200);
      await api().put(`/api/users/${id}/password`).set('Cookie', superAdmin).send({ password: 'another-temporary-3' }).expect(204);
    });

    it('always leaves at least one active Super Admin', async () => {
      // this Super Admin made the only active one for the test (other test files add their own)
      const others = await prisma.user.findMany({
        where: { id: { not: superAdminId }, isActive: true, roles: { some: { role: { key: 'super_admin' } } } },
        select: { id: true },
      });
      await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
      try {
        const last = await api().patch(`/api/users/${superAdminId}`).set('Cookie', superAdmin).send({ roles: ['admin'] }).expect(409);
        expect(last.body.message).toBe('There must always be at least one active Super Admin.');
        const off = await api().patch(`/api/users/${superAdminId}`).set('Cookie', superAdmin).send({ isActive: false }).expect(409);
        expect(off.body.message).toContain('You cannot deactivate your own account');
        expect((await api().get(`/api/users/${superAdminId}`).set('Cookie', superAdmin).expect(200)).body).toMatchObject({
          isActive: true,
          roles: ['super_admin'],
        });

        // with a second Super Admin, the first can step down to Admin
        const second = await api().post('/api/users').set('Cookie', superAdmin).send({ email: newEmail(), password: TEMPORARY, roles: ['super_admin'] }).expect(201);
        const stepped = await api().patch(`/api/users/${superAdminId}`).set('Cookie', superAdmin).send({ roles: ['admin'] }).expect(200);
        expect(stepped.body.roles).toEqual(['admin']);
        // and is an Admin now: the remaining Super Admin's account is out of reach
        const reach = await api().patch(`/api/users/${second.body.id}`).set('Cookie', superAdmin).send({ isActive: false }).expect(403);
        expect(reach.body.message).toBe(ACCOUNT_ONLY);
      } finally {
        await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
      }
    });
  });
});
