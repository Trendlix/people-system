import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, PASSWORD, signIn } from './helpers.js';

// Sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
// inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session to be
// working spontaneously"). Asked: a second sign-in of the same kind, the new one wins (the older one ends at once); the
// 15 minutes for HR, Admin and Super Admin, on the website and the app alike.

const MIN = 60_000;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IDLE = 'You were signed out after 15 minutes without activity.';
const REPLACED = 'You were signed out because you signed in on another device.';
const ENDED = 'Your session ended.';

/** The claims of a session cookie's token, read without checking it (the API checks it). */
function claimsOf(cookie: string): Record<string, unknown> {
  const token = cookie.slice('ps_session='.length);
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

const sidOf = (cookie: string) => claimsOf(cookie).sid as string;

describe('Sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const row = (cookie: string) => prisma.session.findUniqueOrThrow({ where: { id: sidOf(cookie) } });
  /** Moves the session's last activity back, as if nothing had been done with it for that long. */
  const idleFor = (cookie: string, ms: number) => prisma.session.update({ where: { id: sidOf(cookie) }, data: { lastActiveAt: new Date(Date.now() - ms) } });

  let admin: string;
  let superAdmin: string;
  let superEmail: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superEmail = await createUser(prisma, ['super_admin']);
    superAdmin = await signIn(app, superEmail);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps each sign-in as a session on the server, named by its token', async () => {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/auth/login').send({ email, password: PASSWORD, userAgent: `  ${BROWSER}  `, ip: '41.33.10.2' }).expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    const claims = claimsOf(cookie);
    expect(claims).toMatchObject({ sub: await idOf(email), sid: expect.any(String), exp: expect.any(Number) });

    const session = await row(cookie);
    expect(session).toMatchObject({ userId: await idOf(email), kind: 'web', endedAt: null, endReason: null, userAgent: BROWSER, ip: '41.33.10.2' });
    // its 8 hours, as the token's expiry
    expect(session.expiresAt.getTime()).toBe((claims.exp as number) * 1000);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeGreaterThan(8 * 60 * MIN - 5000);

    const login = await prisma.auditLog.findFirstOrThrow({ where: { action: 'login', entityId: await idOf(email) }, orderBy: { id: 'desc' } });
    expect(login.diff).toEqual({ kind: 'web', sessionId: session.id });
  });

  it('a second website sign-in ends the first at once: the new one wins', async () => {
    const email = await createUser(prisma, ['hr']);
    const first = await signIn(app, email, BROWSER);
    await api().get('/api/auth/me').set('Cookie', first).expect(200);
    const second = await signIn(app, email, BROWSER);

    const refused = await api().get('/api/auth/me').set('Cookie', first).expect(401);
    expect(refused.body).toMatchObject({ reason: 'replaced', message: REPLACED });
    // and every request after it
    await api().get('/api/departments').set('Cookie', first).expect(401);
    await api().get('/api/auth/me').set('Cookie', second).expect(200);

    expect(await row(first)).toMatchObject({ endReason: 'replaced', endedAt: expect.any(Date) });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'session_replaced', entityId: await idOf(email) } });
    expect(audit).toMatchObject({ userId: await idOf(email), entityType: 'user', diff: { kind: 'web', sessionId: sidOf(first), by: sidOf(second) } });
  });

  it('keeps a website and an app session together; a second app sign-in ends only the app one', async () => {
    const email = await createUser(prisma, ['employee']);
    const web = await signIn(app, email, BROWSER);
    const phone = await signIn(app, email, APP_USER_AGENT);
    expect((await row(phone)).kind).toBe('app');
    await api().get('/api/auth/me').set('Cookie', web).expect(200);
    await api().get('/api/auth/me').set('Cookie', phone).expect(200);

    // the app's user agent on the request itself, as without the website passing it on
    const res = await api().post('/api/auth/login').set('User-Agent', APP_USER_AGENT).send({ email, password: PASSWORD }).expect(200);
    const phone2 = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    expect((await row(phone2)).kind).toBe('app');
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(401)).body.reason).toBe('replaced');
    await api().get('/api/auth/me').set('Cookie', web).expect(200);
    await api().get('/api/auth/me').set('Cookie', phone2).expect(200);
  });

  it('signs HR, an Admin and a Super Admin out after 15 minutes without activity', async () => {
    for (const role of ['hr', 'admin', 'super_admin'] as const) {
      const email = await createUser(prisma, [role]);
      const session = await signIn(app, email);
      await idleFor(session, 14 * MIN);
      await api().get('/api/auth/me').set('Cookie', session).expect(200); // within the 15 minutes: activity again

      await idleFor(session, 15 * MIN + 5000);
      const refused = await api().get('/api/auth/me').set('Cookie', session).expect(401);
      expect(refused.body).toMatchObject({ reason: 'idle', message: IDLE });
      expect(await row(session)).toMatchObject({ endReason: 'idle', endedAt: expect.any(Date) });
      // ended for good: the next request says why too, and the audit log has it once
      expect((await api().get('/api/auth/me').set('Cookie', session).expect(401)).body.reason).toBe('idle');
      const userId = await idOf(email);
      expect(await prisma.auditLog.count({ where: { action: 'session_idle', entityId: userId } })).toBe(1);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'session_idle', entityId: userId } });
      expect(audit).toMatchObject({ userId, onBehalfById: null, diff: { kind: 'web', sessionId: sidOf(session), minutes: 15 } });
    }
  });

  it('applies the 15 minutes in the app too', async () => {
    const email = await createUser(prisma, ['hr']);
    const phone = await signIn(app, email, APP_USER_AGENT);
    await idleFor(phone, 16 * MIN);
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(401)).body.reason).toBe('idle');
  });

  it('never times out an employee, a manager, Finance or the CEO', async () => {
    for (const role of ['employee', 'manager', 'finance', 'ceo'] as const) {
      const session = await signIn(app, await createUser(prisma, [role]));
      await idleFor(session, 3 * 60 * MIN);
      await api().get('/api/auth/me').set('Cookie', session).expect(200);
    }
  });

  it('doesn’t count the web’s background requests as activity, nor refreshes it more than every 30 seconds', async () => {
    const session = await signIn(app, await createUser(prisma, ['hr']));
    const before = (await idleFor(session, 5 * MIN)).lastActiveAt;

    await api().get('/api/auth/me').set('Cookie', session).set('x-background', '1').expect(200);
    const status = await api().get('/api/auth/session').set('Cookie', session).set('x-background', '1').expect(200);
    expect((await row(session)).lastActiveAt).toEqual(before);
    expect(status.body).toMatchObject({ id: sidOf(session), kind: 'web', idleTimeoutMs: 15 * MIN });
    expect(status.body.idleMsLeft).toBeGreaterThan(10 * MIN - 5000);
    expect(status.body.idleMsLeft).toBeLessThanOrEqual(10 * MIN);

    // a real request (Stay signed in) counts
    const stay = await api().get('/api/auth/session').set('Cookie', session).expect(200);
    expect(stay.body.idleMsLeft).toBeGreaterThan(15 * MIN - 5000);
    const touched = (await row(session)).lastActiveAt;
    expect(touched.getTime()).toBeGreaterThan(Date.now() - 5000);
    // again within 30 seconds: not written again
    await api().get('/api/departments').set('Cookie', session).expect(200);
    expect((await row(session)).lastActiveAt).toEqual(touched);

    // a background request after the 15 minutes is refused all the same
    await idleFor(session, 15 * MIN + 5000);
    expect((await api().get('/api/auth/session').set('Cookie', session).set('x-background', '1').expect(401)).body.reason).toBe('idle');
  });

  it('says on /auth/me whether the 15 minutes apply, and to which session', async () => {
    const hr = await signIn(app, await createUser(prisma, ['hr']));
    const me = await api().get('/api/auth/me').set('Cookie', hr).expect(200);
    expect(me.body.session).toEqual({ id: sidOf(hr), kind: 'web', idleTimeoutMs: 15 * MIN });
    const phone = await signIn(app, await createUser(prisma, ['employee']), APP_USER_AGENT);
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(200)).body.session).toEqual({ id: sidOf(phone), kind: 'app', idleTimeoutMs: null });
    const status = await api().get('/api/auth/session').set('Cookie', phone).expect(200);
    expect(status.body).toMatchObject({ kind: 'app', idleTimeoutMs: null, idleMsLeft: null });
  });

  it('signing out ends the session on the server', async () => {
    const email = await createUser(prisma, ['hr']);
    const session = await signIn(app, email);
    const res = await api().post('/api/auth/logout').set('Cookie', session).expect(204);
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';')).toMatch(/ps_session=;/);
    expect(await row(session)).toMatchObject({ endReason: 'signed_out', endedAt: expect.any(Date) });
    const refused = await api().get('/api/auth/me').set('Cookie', session).expect(401);
    expect(refused.body).toMatchObject({ reason: 'signed_out', message: ENDED });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'logout', entityId: await idOf(email) } });
    expect(audit).toMatchObject({ userId: await idOf(email), diff: { kind: 'web', sessionId: sidOf(session) } });

    // as the website sends it (the token as a bearer), and once more: nothing more happens
    const other = await signIn(app, email);
    await api().post('/api/auth/logout').set('Authorization', `Bearer ${other.slice('ps_session='.length)}`).expect(204);
    expect((await row(other)).endReason).toBe('signed_out');
    await api().post('/api/auth/logout').set('Cookie', other).expect(204);
    expect(await prisma.auditLog.count({ where: { action: 'logout', entityId: await idOf(email) } })).toBe(2);
    await api().post('/api/auth/logout').set('Cookie', 'ps_session=not.a.token').expect(204);
  });

  it('refuses a token from before sessions were kept (no session named), and one past its 8 hours', async () => {
    const email = await createUser(prisma, ['employee']);
    const jwt = app.get(JwtService, { strict: false });
    const old = await jwt.signAsync({ sub: await idOf(email) }, { expiresIn: '8h' });
    const refused = await api().get('/api/auth/me').set('Cookie', `ps_session=${old}`).expect(401);
    expect(refused.body).toMatchObject({ reason: 'ended', message: ENDED });

    const session = await signIn(app, email);
    const expired = await jwt.signAsync({ sub: await idOf(email), sid: sidOf(session), exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await api().get('/api/auth/me').set('Cookie', `ps_session=${expired}`).expect(401)).body.reason).toBe('expired');
    // a session row past its 8 hours ends when next used
    await prisma.session.update({ where: { id: sidOf(session) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api().get('/api/auth/me').set('Cookie', session).expect(401)).body.reason).toBe('expired');
    expect((await row(session)).endReason).toBe('expired');
    // a token naming another user's session
    const mine = await signIn(app, await createUser(prisma, ['employee']));
    const borrowed = await jwt.signAsync({ sub: await idOf(email), sid: sidOf(mine), exp: Math.floor(Date.now() / 1000) + 3600 });
    expect((await api().get('/api/auth/me').set('Cookie', `ps_session=${borrowed}`).expect(401)).body.reason).toBe('ended');
  });

  it('view as is the Super Admin’s own session: their 15 minutes and a newer sign-in end it; going back keeps it', async () => {
    const email = await createUser(prisma, ['super_admin']);
    const own = await signIn(app, email);
    const employee = await idOf(await createUser(prisma, ['employee']));
    const viewing = ([] as string[])
      .concat((await api().post('/api/auth/view-as').set('Cookie', own).send({ userId: employee }).expect(200)).headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ps_session='))!
      .split(';')[0];
    expect(sidOf(viewing)).toBe(sidOf(own));
    // the Super Admin's rule, though the requests answer as the employee
    const me = await api().get('/api/auth/me').set('Cookie', viewing).expect(200);
    expect(me.body).toMatchObject({ id: employee, roles: ['employee'], session: { id: sidOf(own), idleTimeoutMs: 15 * MIN } });

    // going back keeps the session
    const back = ([] as string[])
      .concat((await api().post('/api/auth/view-as/stop').set('Cookie', viewing).expect(200)).headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ps_session='))!
      .split(';')[0];
    expect(sidOf(back)).toBe(sidOf(own));
    await api().get('/api/auth/me').set('Cookie', back).expect(200);

    await idleFor(viewing, 15 * MIN + 5000);
    expect((await api().get('/api/auth/me').set('Cookie', viewing).expect(401)).body.reason).toBe('idle');
    expect((await api().get('/api/auth/me').set('Cookie', back).expect(401)).body.reason).toBe('idle');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'session_idle', entityId: await idOf(email) } });
    expect(audit).toMatchObject({ userId: await idOf(email), onBehalfById: null });

    // a newer sign-in of the same kind ends a switched session too
    const again = await signIn(app, email);
    const switched = ([] as string[])
      .concat((await api().post('/api/auth/view-as').set('Cookie', again).send({ userId: employee }).expect(200)).headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('ps_session='))!
      .split(';')[0];
    await signIn(app, email);
    expect((await api().get('/api/auth/me').set('Cookie', switched).expect(401)).body.reason).toBe('replaced');
  });

  it('lists one’s own open sessions and signs one out', async () => {
    const email = await createUser(prisma, ['employee']);
    const web = await signIn(app, email, BROWSER);
    const phone = await signIn(app, email, APP_USER_AGENT);
    const list = await api().get('/api/auth/sessions').set('Cookie', web).expect(200);
    expect(list.body).toEqual([
      { id: sidOf(phone), kind: 'app', createdAt: expect.any(String), lastActiveAt: expect.any(String), expiresAt: expect.any(String), userAgent: APP_USER_AGENT, client: null, current: false },
      { id: sidOf(web), kind: 'web', createdAt: expect.any(String), lastActiveAt: expect.any(String), expiresAt: expect.any(String), userAgent: BROWSER, client: null, current: true },
    ]);

    await api().post(`/api/auth/sessions/${sidOf(phone)}/end`).set('Cookie', web).expect(204);
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(401)).body.reason).toBe('signed_out');
    expect((await api().get('/api/auth/sessions').set('Cookie', web).expect(200)).body.map((s: { id: string }) => s.id)).toEqual([sidOf(web)]);
    expect(await prisma.auditLog.count({ where: { action: 'logout', entityId: await idOf(email) } })).toBe(1);

    // another user's: not found; not an id: refused
    const stranger = await signIn(app, await createUser(prisma, ['employee']));
    await api().post(`/api/auth/sessions/${sidOf(stranger)}/end`).set('Cookie', web).expect(404);
    await api().get('/api/auth/me').set('Cookie', stranger).expect(200);
    await api().post('/api/auth/sessions/nope/end').set('Cookie', web).expect(400);
  });

  it('lets an Admin end a user’s sessions, all or one; a Super Admin’s only a Super Admin', async () => {
    const email = await createUser(prisma, ['hr']);
    const userId = await idOf(email);
    const web = await signIn(app, email, BROWSER);
    const phone = await signIn(app, email, APP_USER_AGENT);

    const listed = await api().get(`/api/users/${userId}/sessions`).set('Cookie', admin).expect(200);
    expect(listed.body.map((s: { kind: string; current: boolean }) => [s.kind, s.current])).toEqual([['app', false], ['web', false]]);
    // only Admins
    const employee = await signIn(app, await createUser(prisma, ['employee']));
    await api().get(`/api/users/${userId}/sessions`).set('Cookie', employee).expect(403);
    await api().post(`/api/users/${userId}/sessions/end`).set('Cookie', web).expect(403); // HR is not an Admin
    await api().get('/api/users/00000000-0000-4000-8000-000000000000/sessions').set('Cookie', admin).expect(404);

    // one
    const one = await api().post(`/api/users/${userId}/sessions/${sidOf(phone)}/end`).set('Cookie', admin).expect(200);
    expect(one.body).toEqual({ ended: 1 });
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(401)).body).toMatchObject({ reason: 'revoked', message: ENDED });
    await api().get('/api/auth/me').set('Cookie', web).expect(200);
    await api().post(`/api/users/${userId}/sessions/${sidOf(phone)}/end`).set('Cookie', admin).expect(404); // not open any more

    // all
    const again = await signIn(app, email, APP_USER_AGENT);
    expect((await api().post(`/api/users/${userId}/sessions/end`).set('Cookie', admin).expect(200)).body).toEqual({ ended: 2 });
    for (const s of [web, again]) expect((await api().get('/api/auth/me').set('Cookie', s).expect(401)).body.reason).toBe('revoked');
    expect((await api().post(`/api/users/${userId}/sessions/end`).set('Cookie', admin).expect(200)).body).toEqual({ ended: 0 });
    const audits = await prisma.auditLog.findMany({ where: { action: 'session_revoked', entityId: userId }, orderBy: { id: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ userId: await idOf(await emailOf(admin)), diff: { sessions: [{ id: sidOf(phone), kind: 'app' }] } });

    // a Super Admin's: an Admin is refused, a Super Admin may
    const otherSuper = await createUser(prisma, ['super_admin']);
    const theirs = await signIn(app, otherSuper);
    const refused = await api().post(`/api/users/${await idOf(otherSuper)}/sessions/end`).set('Cookie', admin).expect(403);
    expect(refused.body.message).toBe("Only a Super Admin can change a Super Admin's account.");
    await api().get('/api/auth/me').set('Cookie', theirs).expect(200);
    await api().post(`/api/users/${await idOf(otherSuper)}/sessions/end`).set('Cookie', superAdmin).expect(200);
    expect((await api().get('/api/auth/me').set('Cookie', theirs).expect(401)).body.reason).toBe('revoked');
  });

  it('deactivating an account ends its sessions, so reactivating it doesn’t bring one back', async () => {
    const email = await createUser(prisma, ['employee']);
    const userId = await idOf(email);
    const session = await signIn(app, email);
    await api().patch(`/api/users/${userId}`).set('Cookie', admin).send({ isActive: false }).expect(200);
    await api().patch(`/api/users/${userId}`).set('Cookie', admin).send({ isActive: true }).expect(200);
    expect((await api().get('/api/auth/me').set('Cookie', session).expect(401)).body.reason).toBe('revoked');
    await signIn(app, email); // a new sign-in works
  });

  /** The email of the user a session cookie is for. */
  async function emailOf(cookie: string): Promise<string> {
    return (await prisma.user.findUniqueOrThrow({ where: { id: claimsOf(cookie).sub as string } })).email;
  }

  it('keeps the Super Admin’s session open while they sign in again on the app', async () => {
    const phone = await signIn(app, superEmail, APP_USER_AGENT);
    await api().get('/api/auth/me').set('Cookie', superAdmin).expect(200);
    await api().get('/api/auth/me').set('Cookie', phone).expect(200);
  });
});
