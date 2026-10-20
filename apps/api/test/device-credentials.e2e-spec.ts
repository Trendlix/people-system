import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser, PASSWORD, signIn } from './helpers.js';

// Fingerprint sign-in in the Trendlix People app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first
// password sign-in"; apps/mobile/README.md, Phase 3). Turned on from an app session, never while viewing as someone; the
// phone's secret is kept only hashed and traded for an ordinary app session (the new one wins, the 15 minutes apply). It
// stops when revoked by its owner or an Admin, after 90 days without use, when the account is deactivated, or when the
// password is changed or reset.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const REFUSED = 'Sign in with your password this time.';
const APP_ONLY = 'Fingerprint sign-in can only be turned on in the Trendlix People app.';
const SUPER_ADMIN_ONLY = "Only a Super Admin can change a Super Admin's account.";
const PIXEL = { deviceName: 'Google Pixel 8', platform: 'android' } as const;

/** The claims of a session cookie's token, read without checking it (the API checks it). */
function claimsOf(cookie: string): Record<string, unknown> {
  const token = cookie.slice('ps_session='.length);
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

const sidOf = (cookie: string) => claimsOf(cookie).sid as string;

/** The session cookie a response sets. */
function cookieOf(res: { headers: Record<string, unknown> }): string {
  const cookie = ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('ps_session='));
  if (!cookie) throw new Error('No session cookie returned');
  return cookie.split(';')[0];
}

let address = 0;
/** A new address for each group of attempts, so the limit on refusals from one address is counted apart. */
const newIp = () => `10.20.${Math.floor(++address / 250)}.${(address % 250) + 1}`;

describe('Fingerprint sign-in (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  /** Every secret the API gave out here: none may be kept anywhere (checked at the end). */
  const secrets: string[] = [];

  let admin: string;
  let superAdmin: string;

  /** Turns fingerprint sign-in on for the phone the session is on; answers the credential. */
  async function turnOn(session: string, phone: { deviceName: string; platform: string } = PIXEL): Promise<{ id: string; secret: string }> {
    const res = await api().post('/api/auth/devices').set('Cookie', session).send(phone).expect(201);
    secrets.push(res.body.secret);
    return res.body;
  }

  /** The website's request when the phone has unlocked the credential with the fingerprint. */
  const fingerprint = (body: { id: string; secret: string }, ip: string = newIp()) =>
    api().post('/api/auth/devices/sign-in').send({ ...body, userAgent: APP_USER_AGENT, ip });

  /** A user signed in in the app, with fingerprint sign-in turned on there. */
  async function enrolled(roles: Parameters<typeof createUser>[1] = ['employee']) {
    const email = await createUser(prisma, roles);
    const phone = await signIn(app, email, APP_USER_AGENT);
    const credential = await turnOn(phone);
    return { email, userId: await idOf(email), phone, credential };
  }

  const row = (id: string) => prisma.deviceCredential.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
  });

  afterAll(async () => {
    await app.close();
  });

  it('turns it on only from an app session, giving the secret once and keeping only its hash', async () => {
    const email = await createUser(prisma, ['employee']);
    const userId = await idOf(email);
    const web = await signIn(app, email, BROWSER);
    const refused = await api().post('/api/auth/devices').set('Cookie', web).send(PIXEL).expect(403);
    expect(refused.body.message).toBe(APP_ONLY);
    await api().post('/api/auth/devices').send(PIXEL).expect(401);

    const phone = await signIn(app, email, APP_USER_AGENT);
    await api().post('/api/auth/devices').set('Cookie', phone).send({ ...PIXEL, platform: 'windows' }).expect(400);
    await api().post('/api/auth/devices').set('Cookie', phone).send({ ...PIXEL, secret: 'mine' }).expect(400);
    const { id, secret } = await turnOn(phone, { deviceName: '  Google   Pixel 8 ', platform: 'android' });
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const kept = await row(id);
    expect(kept).toMatchObject({ userId, deviceName: 'Google Pixel 8', platform: 'android', lastUsedAt: null, revokedAt: null, revokeReason: null });
    expect(kept.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(kept.secretHash).not.toContain(secret);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device_add', entityId: userId } });
    expect(audit).toMatchObject({ userId, entityType: 'user', diff: { credentialId: id, deviceName: 'Google Pixel 8', platform: 'android', sessionId: sidOf(phone) } });

    // a phone that gives no name gets the platform's word
    expect((await row((await turnOn(phone, { deviceName: '   ', platform: 'android' })).id)).deviceName).toBe('Android phone');
  });

  it('signs in with the fingerprint: an ordinary app session that replaces the older one', async () => {
    const { email, userId, phone, credential } = await enrolled(['hr']);
    const web = await signIn(app, email, BROWSER);
    const ip = newIp();

    const res = await fingerprint(credential, ip).expect(200);
    expect(res.body).toEqual({ id: userId, email, roles: ['hr'] });
    const fresh = cookieOf(res);
    expect(claimsOf(fresh)).toMatchObject({ sub: userId, sid: expect.any(String) });
    expect(sidOf(fresh)).not.toBe(sidOf(phone));

    // an app session, kept as a password sign-in's: where it came from, and the 15 minutes for HR
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sidOf(fresh) } });
    expect(session).toMatchObject({ userId, kind: 'app', endedAt: null, userAgent: APP_USER_AGENT, ip });
    const me = await api().get('/api/auth/me').set('Cookie', fresh).expect(200);
    expect(me.body.session).toEqual({ id: sidOf(fresh), kind: 'app', idleTimeoutMs: 15 * MIN });

    // the new one wins: the older app session ends, the website's stays
    expect((await api().get('/api/auth/me').set('Cookie', phone).expect(401)).body.reason).toBe('replaced');
    await api().get('/api/auth/me').set('Cookie', web).expect(200);

    // kept as used now, and in the audit log (never the secret)
    expect((await row(credential.id)).lastUsedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device_login', entityId: userId } });
    expect(audit).toMatchObject({ userId, entityType: 'user', diff: { kind: 'app', sessionId: sidOf(fresh), credentialId: credential.id } });

    // the 15 minutes end it as any other
    await prisma.session.update({ where: { id: sidOf(fresh) }, data: { lastActiveAt: new Date(Date.now() - 16 * MIN) } });
    expect((await api().get('/api/auth/me').set('Cookie', fresh).expect(401)).body.reason).toBe('idle');
    // and the fingerprint signs in again
    await fingerprint(credential).expect(200);
  });

  it('is an app session whatever user agent the request has, and counts as the last sign-in', async () => {
    const { email, userId, credential } = await enrolled();
    await prisma.auditLog.updateMany({ where: { action: 'login', entityId: userId }, data: { at: new Date(Date.now() - DAY) } });
    const res = await api().post('/api/auth/devices/sign-in').set('User-Agent', BROWSER).send(credential).expect(200);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sidOf(cookieOf(res)) } })).kind).toBe('app');
    const user = await api().get(`/api/users/${userId}`).set('Cookie', admin).expect(200);
    expect(user.body.email).toBe(email);
    expect(new Date(user.body.lastSignInAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('refuses an unknown credential and a wrong secret alike, saying to use the password', async () => {
    const { credential, userId } = await enrolled();
    for (const body of [
      { id: '00000000-0000-4000-8000-000000000000', secret: credential.secret },
      { id: credential.id, secret: `${credential.secret}x` },
      { id: 'not-an-id', secret: credential.secret },
    ]) {
      const refused = await fingerprint(body).expect(401);
      expect(refused.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: REFUSED, reason: 'unknown' });
      expect(refused.headers['set-cookie']).toBeUndefined();
    }
    await api().post('/api/auth/devices/sign-in').send({ id: credential.id }).expect(400);
    // the wrong secret didn't revoke it
    expect((await row(credential.id)).revokedAt).toBeNull();
    await fingerprint(credential).expect(200);

    const refusals = await prisma.auditLog.findMany({ where: { action: 'device_login_failed', diff: { path: ['credentialId'], equals: credential.id } } });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ userId: null, entityId: userId, diff: { reason: 'unknown', problem: 'wrong_secret', ip: expect.any(String) } });
  });

  it('refuses one signed out on Your Sessions, and lists and signs out only one’s own', async () => {
    const { email, credential, phone } = await enrolled();
    const tablet = await turnOn(phone, { deviceName: 'Samsung SM-X710', platform: 'android' });
    const list = await api().get('/api/auth/devices').set('Cookie', phone).expect(200);
    expect(list.body).toEqual([
      { id: tablet.id, deviceName: 'Samsung SM-X710', platform: 'android', createdAt: expect.any(String), lastUsedAt: null },
      { id: credential.id, deviceName: 'Google Pixel 8', platform: 'android', createdAt: expect.any(String), lastUsedAt: null },
    ]);

    // another's: not found; not an id: refused
    const stranger = await enrolled();
    await api().post(`/api/auth/devices/${stranger.credential.id}/revoke`).set('Cookie', phone).expect(404);
    await api().post('/api/auth/devices/nope/revoke').set('Cookie', phone).expect(400);
    await fingerprint(stranger.credential).expect(200);

    // from the website too
    const web = await signIn(app, email, BROWSER);
    await api().post(`/api/auth/devices/${credential.id}/revoke`).set('Cookie', web).expect(204);
    await api().post(`/api/auth/devices/${credential.id}/revoke`).set('Cookie', web).expect(204); // again: nothing more
    expect(await row(credential.id)).toMatchObject({ revokedAt: expect.any(Date), revokeReason: 'signed_out' });
    expect((await fingerprint(credential).expect(401)).body).toMatchObject({ reason: 'revoked', message: REFUSED });
    expect((await api().get('/api/auth/devices').set('Cookie', web).expect(200)).body.map((d: { id: string }) => d.id)).toEqual([tablet.id]);
    const userId = await idOf(email);
    expect(await prisma.auditLog.count({ where: { action: 'device_revoke', entityId: userId } })).toBe(1);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'device_revoke', entityId: userId } })).toMatchObject({
      userId,
      diff: { reason: 'signed_out', credentials: [{ id: credential.id, deviceName: 'Google Pixel 8', platform: 'android' }] },
    });
    // the sessions aren't touched
    await api().get('/api/auth/me').set('Cookie', web).expect(200);
  });

  it('keeps one a phone: turning it on again there replaces the older one', async () => {
    const { phone, credential } = await enrolled();
    const again = await turnOn(phone, { deviceName: 'GOOGLE PIXEL 8', platform: 'android' });
    expect(await row(credential.id)).toMatchObject({ revokeReason: 'replaced', revokedAt: expect.any(Date) });
    expect((await fingerprint(credential).expect(401)).body.reason).toBe('revoked');
    // (the fingerprint's session is the app's now: the older one ended)
    const signedIn = cookieOf(await fingerprint(again).expect(200));
    // another phone, or the same name on another platform, keeps its own
    const other = await turnOn(signedIn, { deviceName: 'Google Pixel 8', platform: 'ios' });
    expect((await row(again.id)).revokedAt).toBeNull();
    expect((await row(other.id)).revokedAt).toBeNull();
  });

  it('stops after 90 days without use, revoking it then', async () => {
    const { email, credential } = await enrolled();
    const web = await signIn(app, email, BROWSER);
    await prisma.deviceCredential.update({ where: { id: credential.id }, data: { createdAt: new Date(Date.now() - 200 * DAY), lastUsedAt: new Date(Date.now() - 89 * DAY) } });
    await fingerprint(credential).expect(200); // within the 90 days: used again now

    await prisma.deviceCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date(Date.now() - 91 * DAY) } });
    // the list leaves it out already
    expect((await api().get('/api/auth/devices').set('Cookie', web).expect(200)).body).toEqual([]);
    expect((await fingerprint(credential).expect(401)).body).toMatchObject({ reason: 'expired', message: REFUSED });
    expect(await row(credential.id)).toMatchObject({ revokeReason: 'expired', revokedAt: expect.any(Date) });
    expect((await fingerprint(credential).expect(401)).body.reason).toBe('revoked');

    // never used: from when it was made
    const fresh = await turnOn(await signIn(app, email, APP_USER_AGENT), { deviceName: 'Nokia G42', platform: 'android' });
    await prisma.deviceCredential.update({ where: { id: fresh.id }, data: { createdAt: new Date(Date.now() - 91 * DAY) } });
    expect((await fingerprint(fresh).expect(401)).body.reason).toBe('expired');
  });

  it('stops when the account is deactivated, and stays stopped when it is reactivated', async () => {
    const { userId, credential } = await enrolled();
    await api().patch(`/api/users/${userId}`).set('Cookie', admin).send({ isActive: false }).expect(200);
    expect(await row(credential.id)).toMatchObject({ revokeReason: 'deactivated', revokedAt: expect.any(Date) });
    await api().patch(`/api/users/${userId}`).set('Cookie', admin).send({ isActive: true }).expect(200);
    expect((await fingerprint(credential).expect(401)).body.reason).toBe('revoked');

    // an account found inactive with a credential still on: refused and revoked then
    const other = await enrolled();
    await prisma.user.update({ where: { id: other.userId }, data: { isActive: false } });
    expect((await fingerprint(other.credential).expect(401)).body.reason).toBe('revoked');
    expect(await row(other.credential.id)).toMatchObject({ revokeReason: 'deactivated' });
    await prisma.user.update({ where: { id: other.userId }, data: { isActive: true } });
  });

  it('stops when the password is changed, and ends the other sessions; the one it was changed from stays', async () => {
    const { email, userId, credential } = await enrolled();
    const fromPhone = cookieOf(await fingerprint(credential).expect(200));
    const web = await signIn(app, email, BROWSER);
    await api().post('/api/auth/change-password').set('Cookie', web).send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' }).expect(204);

    expect(await row(credential.id)).toMatchObject({ revokeReason: 'password_changed', revokedAt: expect.any(Date) });
    expect((await fingerprint(credential).expect(401)).body.reason).toBe('revoked');
    expect((await api().get('/api/auth/me').set('Cookie', fromPhone).expect(401)).body.reason).toBe('revoked');
    await api().get('/api/auth/me').set('Cookie', web).expect(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'password_change', entityId: userId } });
    expect(audit.diff).toEqual({ sessionsEnded: 1, devicesRevoked: 1 });
    expect(JSON.stringify(audit.diff)).not.toContain('a-brand-new-password');
  });

  it('stops when an Admin resets the password; the sessions stay', async () => {
    const { email, userId, credential } = await enrolled();
    const web = await signIn(app, email, BROWSER);
    await api().put(`/api/users/${userId}/password`).set('Cookie', admin).send({ password: 'temporary-password-9' }).expect(204);
    expect(await row(credential.id)).toMatchObject({ revokeReason: 'password_reset', revokedAt: expect.any(Date) });
    expect((await fingerprint(credential).expect(401)).body.reason).toBe('revoked');
    await api().get('/api/auth/me').set('Cookie', web).expect(200);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'password_reset', entityId: userId } })).diff).toEqual({ devicesRevoked: 1 });
  });

  it('waits after 10 refusals of a credential within 15 minutes, even with its secret', async () => {
    const { credential } = await enrolled();
    const ip = newIp();
    for (let i = 0; i < 10; i++) await fingerprint({ id: credential.id, secret: `wrong-${i}` }, ip).expect(401);
    const limited = await fingerprint(credential, newIp()).expect(429);
    expect(limited.body.message).toBe('Too many fingerprint sign-in attempts. Sign in with your password, or try again in 15 minutes.');
    // a refusal for the limit isn't written again
    expect(await prisma.auditLog.count({ where: { action: 'device_login_failed', diff: { path: ['credentialId'], equals: credential.id } } })).toBe(10);
    // 15 minutes later it signs in again
    await prisma.auditLog.updateMany({ where: { action: 'device_login_failed', diff: { path: ['credentialId'], equals: credential.id } }, data: { at: new Date(Date.now() - 16 * MIN) } });
    await fingerprint(credential, newIp()).expect(200);
  });

  it('waits after 20 refusals from one address within 15 minutes; another address is not held up', async () => {
    const { credential } = await enrolled();
    const ip = newIp();
    for (let i = 0; i < 20; i++) await fingerprint({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, secret: 'x' }, ip).expect(401);
    await fingerprint(credential, ip).expect(429);
    await fingerprint(credential, newIp()).expect(200);
  });

  it('lets an Admin list and sign out a user’s phones, one or all; a Super Admin’s only a Super Admin', async () => {
    const { email, userId, phone, credential } = await enrolled(['hr']);
    const second = await turnOn(phone, { deviceName: 'Xiaomi 14', platform: 'android' });

    const listed = await api().get(`/api/users/${userId}/devices`).set('Cookie', admin).expect(200);
    expect(listed.body.map((d: { id: string }) => d.id)).toEqual([second.id, credential.id]);
    expect(Object.keys(listed.body[0]).sort()).toEqual(['createdAt', 'deviceName', 'id', 'lastUsedAt', 'platform']);
    // only Admins
    const employee = await signIn(app, await createUser(prisma, ['employee']));
    await api().get(`/api/users/${userId}/devices`).set('Cookie', employee).expect(403);
    await api().post(`/api/users/${userId}/devices/revoke`).set('Cookie', phone).expect(403); // HR is not an Admin
    await api().get('/api/users/00000000-0000-4000-8000-000000000000/devices').set('Cookie', admin).expect(404);

    // one
    expect((await api().post(`/api/users/${userId}/devices/${credential.id}/revoke`).set('Cookie', admin).expect(200)).body).toEqual({ revoked: 1 });
    expect(await row(credential.id)).toMatchObject({ revokeReason: 'revoked' });
    expect((await fingerprint(credential).expect(401)).body.reason).toBe('revoked');
    await fingerprint(second).expect(200);
    await api().post(`/api/users/${userId}/devices/${credential.id}/revoke`).set('Cookie', admin).expect(404); // not active any more

    // all
    const third = await turnOn(await signIn(app, email, APP_USER_AGENT), { deviceName: 'Oppo A79', platform: 'android' });
    expect((await api().post(`/api/users/${userId}/devices/revoke`).set('Cookie', admin).expect(200)).body).toEqual({ revoked: 2 });
    for (const c of [second, third]) expect((await fingerprint(c).expect(401)).body.reason).toBe('revoked');
    expect((await api().post(`/api/users/${userId}/devices/revoke`).set('Cookie', admin).expect(200)).body).toEqual({ revoked: 0 });
    const audits = await prisma.auditLog.findMany({ where: { action: 'device_revoke', entityId: userId }, orderBy: { id: 'asc' } });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ diff: { reason: 'revoked', credentials: [{ id: credential.id, deviceName: 'Google Pixel 8', platform: 'android' }] } });
    expect(audits[0].userId).not.toBe(userId);

    // a Super Admin's: an Admin is refused, a Super Admin may
    const theirs = await enrolled(['super_admin']);
    await api().get(`/api/users/${theirs.userId}/devices`).set('Cookie', admin).expect(200);
    const refused = await api().post(`/api/users/${theirs.userId}/devices/revoke`).set('Cookie', admin).expect(403);
    expect(refused.body.message).toBe(SUPER_ADMIN_ONLY);
    await api().post(`/api/users/${theirs.userId}/devices/${theirs.credential.id}/revoke`).set('Cookie', admin).expect(403);
    await fingerprint(theirs.credential).expect(200);
    await api().post(`/api/users/${theirs.userId}/devices/revoke`).set('Cookie', superAdmin).expect(200);
    expect((await fingerprint(theirs.credential).expect(401)).body.reason).toBe('revoked');
  });

  it('is never turned on while viewing as someone, even acting as them', async () => {
    const email = await createUser(prisma, ['super_admin']);
    const own = await signIn(app, email, APP_USER_AGENT);
    const target = await enrolled();
    const viewing = cookieOf(await api().post('/api/auth/view-as').set('Cookie', own).send({ userId: target.userId }).expect(200));
    expect((await api().post('/api/auth/devices').set('Cookie', viewing).send(PIXEL).expect(403)).body.message).toContain('view only');
    const acting = cookieOf(await api().post('/api/auth/view-as/act').set('Cookie', viewing).send({ act: true }).expect(200));
    const refused = await api().post('/api/auth/devices').set('Cookie', acting).send(PIXEL).expect(403);
    expect(refused.body.message).toBe('You cannot turn on fingerprint sign-in while viewing as someone.');
    expect(await prisma.deviceCredential.count({ where: { userId: { in: [target.userId, await idOf(email)] } } })).toBe(1);
    // the list is the viewed user's, to read
    expect((await api().get('/api/auth/devices').set('Cookie', viewing).expect(200)).body.map((d: { id: string }) => d.id)).toEqual([target.credential.id]);
  });

  it('has the table refuse what isn’t a hash, an unknown platform or reason, and a revocation without its reason', async () => {
    const userId = await idOf(await createUser(prisma, ['employee']));
    const hash = 'a'.repeat(64);
    const insert = (over: Record<string, unknown>) =>
      prisma.deviceCredential.create({ data: { userId, deviceName: 'Phone', platform: 'android', secretHash: hash, ...over } });
    await expect(insert({ secretHash: 'q3Jx0m3x2f8cX1u6o0b9l0wV5bQkz1gk2Yb3QeR7m9s' })).rejects.toThrow();
    await expect(insert({ platform: 'windows' })).rejects.toThrow();
    await expect(insert({ deviceName: '  ' })).rejects.toThrow();
    await expect(insert({ revokedAt: new Date() })).rejects.toThrow();
    await expect(insert({ revokedAt: new Date(), revokeReason: 'lost' })).rejects.toThrow();
    const ok = await insert({});
    await prisma.deviceCredential.delete({ where: { id: ok.id } });
  });

  it('never keeps a secret, nor writes one to the audit log', async () => {
    expect(secrets.length).toBeGreaterThan(10);
    const rows = await prisma.$queryRaw<{ text: string }[]>`SELECT row_to_json(d)::text AS text FROM device_credentials d`;
    const audit = await prisma.$queryRaw<{ text: string }[]>`SELECT coalesce(diff::text, '') AS text FROM audit_log`;
    const sessions = await prisma.$queryRaw<{ text: string }[]>`SELECT row_to_json(s)::text AS text FROM sessions s`;
    for (const secret of secrets) {
      for (const r of [...rows, ...audit, ...sessions]) expect(r.text).not.toContain(secret);
    }
  });
});
