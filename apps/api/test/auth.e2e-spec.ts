import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { MAX_FAILED_LOGINS } from '../src/auth/auth.service.js';
import { createApp, createUser, PASSWORD, signIn } from './helpers.js';

describe('Sign-in and access (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('health check works without signing in', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200).expect({ status: 'ok', database: 'ok' });
  });

  it('rejects requests without a session', () => {
    return request(app.getHttpServer()).get('/api/departments').expect(401);
  });

  it('rejects a wrong password with a generic message and logs the attempt', async () => {
    const email = await createUser(prisma, ['employee']);
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    expect(res.body.message).toBe('Invalid email or password.');

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await prisma.auditLog.count({ where: { action: 'login_failed', entityId: user.id } })).toBe(1);
  });

  it('rejects an unknown email with the same message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: PASSWORD })
      .expect(401);
    expect(res.body.message).toBe('Invalid email or password.');
  });

  it('locks an email out after too many failed attempts, even with the right password', async () => {
    const email = await createUser(prisma, ['employee']);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'wrong' }).expect(401);
    }
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(429);
    expect(res.body.message).toContain('Too many failed sign-in attempts');
  });

  it('rejects a deactivated account', async () => {
    const email = await createUser(prisma, ['employee']);
    await prisma.user.update({ where: { email }, data: { isActive: false } });
    await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
  });

  it('signs in with an httpOnly cookie and returns the roles', async () => {
    const email = await createUser(prisma, ['hr', 'admin']);
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: PASSWORD })
      .expect(200);
    expect(res.body).toMatchObject({ email, roles: expect.arrayContaining(['hr', 'admin']) });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toContain('ps_session=');
    expect(cookie).toContain('HttpOnly');

    const session = await signIn(app, email);
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', session).expect(200);
    expect(me.body.email).toBe(email);
  });

  it('/auth/me gives the id and name of one’s own employee profile (by work email), or null', async () => {
    const email = await createUser(prisma, ['employee']);
    const session = await signIn(app, email);
    const before = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', session).expect(200);
    // nobody viewing as them: their own session (see view-as.e2e-spec.ts)
    // `leads`: in charge of no department or team (see department-leads.e2e-spec.ts)
    // `session`: the session kept on the server, and no 15 minutes without activity for an employee (see sessions.e2e-spec.ts)
    // `assets`: no Assets access until one is set on the Users page (21 October 2026; see assets.e2e-spec.ts)
    // `hiring`: no vacancy to hire for nor interview to sit on (22 October 2026; see recruitment-phase2.e2e-spec.ts)
    // `standingInFor`: standing in for no approver on leave (25 October 2026; see leave-coverage.e2e-spec.ts)
    expect(before.body).toEqual({
      id: expect.any(String),
      email,
      roles: ['employee'],
      employeeId: null,
      name: null,
      leads: false,
      standingInFor: [],
      assets: { access: 'none', values: false, ai: false },
      hiring: false,
      viewAs: null,
      session: { id: expect.any(String), kind: 'web', idleTimeoutMs: null },
    });

    const employee = await prisma.employee.create({
      data: { employeeCode: `ME-${Date.now().toString(36)}`, fullNameEn: 'Signed In', fullNameAr: 'مستخدم', workEmail: email },
    });
    const after = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', session).expect(200);
    expect(after.body).toMatchObject({ employeeId: employee.id, name: 'Signed In' });
  });

  it('rejects a tampered session', () => {
    return request(app.getHttpServer()).get('/api/auth/me').set('Cookie', 'ps_session=not.a.token').expect(401);
  });

  it('logout clears the cookie', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';')).toMatch(/ps_session=;/);
  });

  it('employees can read organisation data but not change it', async () => {
    const session = await signIn(app, await createUser(prisma, ['employee']));
    await request(app.getHttpServer()).get('/api/departments').set('Cookie', session).expect(200);
    await request(app.getHttpServer())
      .post('/api/departments')
      .set('Cookie', session)
      .send({ nameEn: 'Not allowed' })
      .expect(403);
  });
});
