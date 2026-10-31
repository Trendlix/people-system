import type { INestApplication } from '@nestjs/common';
import { ACCESS_IP_TOKEN, CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, LOGIN_CODE_ANSWER, LOGIN_CODE_FORMAT, LOGIN_CODE_REFUSED } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { APP_USER_AGENT, createApp, createUser } from './helpers.js';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"): asking gets the same answer whatever the email, an active account is
// emailed 6 digits; the code signs in once (the website's session or the app's, by the user agent), within 10 minutes
// and 5 tries; a new code ends the one before, none sooner than a minute after the last; every refusal in the same
// words, each a failed sign-in (the sign-in's lockout); asking limited by the address and the email. Email is kept in
// MailService's outbox (MAIL_TRANSPORT=memory). These tests make their own accounts and delete them.

process.env.MAIL_TRANSPORT = 'memory';

describe('Sign-in codes by email (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  const made: string[] = [];
  const api = () => request(app.getHttpServer());
  const signedFrom = (ip: string) => {
    const at = String(Date.now());
    return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(process.env.WEB_KEY!, ip, at, ACCESS_IP_TOKEN) };
  };
  const ask = (email: string, ip = '198.51.100.31') => api().post('/api/auth/email-code').set(signedFrom(ip)).send({ email });
  const signIn = (email: string, code: string, userAgent?: string) => api().post('/api/auth/email-code/sign-in').send({ email, code, ...(userAgent && { userAgent }) });
  const codeIn = (text: string) => /: (\d{3}) (\d{3})/.exec(text)!.slice(1).join('');
  const account = async () => {
    const email = await createUser(prisma, ['employee']);
    made.push(email);
    return email;
  };
  /** The last code's row made a minute and more ago, so a new one may be asked for. */
  const backdate = async (email: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.loginCode.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await prisma.accessLinkRequest.deleteMany({ where: { kind: 'login_code' } });
    await prisma.user.deleteMany({ where: { email: { in: made } } });
    await app.close();
  });

  it('emails an active account a code that signs in once, on the website or in the app', async () => {
    const email = await account();
    const before = mail.outbox.length;
    expect((await ask(email.toUpperCase()).expect(200)).body).toEqual({ message: LOGIN_CODE_ANSWER });
    const [m] = mail.outbox.slice(before);
    expect(m.to).toBe(email);
    expect(m.subject).toBe('Your People sign-in code');
    expect(m.text).toContain('It works once, for 10 minutes.');
    expect(m.text).toContain('nobody can sign in without the code');
    const code = codeIn(m.text);
    // the code is kept only as its HMAC
    const row = await prisma.loginCode.findFirstOrThrow({ where: { user: { email } } });
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);

    const res = await signIn(email, `${code.slice(0, 3)} ${code.slice(3)}`, APP_USER_AGENT).expect(200);
    expect(res.body).toMatchObject({ email, roles: ['employee'] });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
    await api().get('/api/auth/me').set('Cookie', cookie).expect(200);
    const session = await prisma.session.findFirstOrThrow({ where: { user: { email }, endedAt: null }, orderBy: { createdAt: 'desc' } });
    expect(session.kind).toBe('app');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'login', entityId: session.userId }, orderBy: { at: 'desc' } });
    expect(audit.diff).toMatchObject({ kind: 'app', method: 'email_code' });
    // once only
    expect((await signIn(email, code).expect(401)).body.message).toBe(LOGIN_CODE_REFUSED);
  });

  it('answers the same for no account, and refuses any code for it in the same words', async () => {
    const before = mail.outbox.length;
    expect((await ask(`nobody.${Date.now()}@nowhere.test`).expect(200)).body).toEqual({ message: LOGIN_CODE_ANSWER });
    expect(mail.outbox.length).toBe(before);
    expect((await signIn(`nobody.${Date.now()}@nowhere.test`, '123456').expect(401)).body.message).toBe(LOGIN_CODE_REFUSED);
    expect((await signIn('someone@example.test', '12ab').expect(400)).body.message).toEqual([LOGIN_CODE_FORMAT]);
    expect((await ask('not-an-email').expect(400)).body.message).toEqual(['Enter your sign-in email.']);
  });

  it('takes 5 tries, ends a code when a new one is sent, and sends none sooner than a minute after the last', async () => {
    const email = await account();
    let before = mail.outbox.length;
    await ask(email).expect(200);
    const first = codeIn(mail.outbox[before].text);
    // a minute hasn't passed: the same answer, nothing sent
    before = mail.outbox.length;
    await ask(email).expect(200);
    expect(mail.outbox.length).toBe(before);
    // a new one, a minute on: the first stops working
    await backdate(email);
    await ask(email).expect(200);
    const second = codeIn(mail.outbox[before].text);
    if (first !== second) expect((await signIn(email, first).expect(401)).body.message).toBe(LOGIN_CODE_REFUSED);
    // five wrong tries end it, even for the right code after them
    const wrong = second === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await signIn(email, wrong).expect(401);
    expect((await signIn(email, second).expect(401)).body.message).toBe(LOGIN_CODE_REFUSED);
    expect((await prisma.auditLog.count({ where: { action: 'login_failed', diff: { path: ['email'], equals: email } } })) >= 6).toBe(true);
  });

  it('refuses an expired code and a closed account, and counts towards the sign-in’s lockout', async () => {
    const email = await account();
    let before = mail.outbox.length;
    await ask(email).expect(200);
    const code = codeIn(mail.outbox[before].text);
    await prisma.loginCode.updateMany({ where: { user: { email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await signIn(email, code).expect(401)).body.message).toBe(LOGIN_CODE_REFUSED);

    const closed = await account();
    await prisma.user.update({ where: { email: closed }, data: { isActive: false } });
    before = mail.outbox.length;
    expect((await ask(closed).expect(200)).body).toEqual({ message: LOGIN_CODE_ANSWER });
    expect(mail.outbox.length).toBe(before);

    // ten failed sign-ins in 15 minutes: refused before any code is looked at
    const locked = await account();
    await prisma.auditLog.createMany({ data: Array.from({ length: 10 }, () => ({ action: 'login_failed', entityType: 'user', diff: { email: locked } })) });
    expect((await signIn(locked, '123456').expect(429)).body.message).toMatch(/Too many failed sign-in attempts/);
  });

  it('limits asking: quietly for one email, refused from one address', async () => {
    const email = await account();
    for (let i = 0; i < 5; i++) {
      await ask(email).expect(200);
      await backdate(email);
    }
    const before = mail.outbox.length;
    expect((await ask(email).expect(200)).body).toEqual({ message: LOGIN_CODE_ANSWER });
    expect(mail.outbox.length).toBe(before);
    const ip = '203.0.113.131';
    await prisma.accessLinkRequest.createMany({ data: Array.from({ length: 20 }, () => ({ kind: 'login_code', email: `x.${Date.now()}@nowhere.test`, ip })) });
    expect((await ask(email, ip).expect(429)).body.message).toBe('Too many tries. Please try again in an hour.');
  });
});
