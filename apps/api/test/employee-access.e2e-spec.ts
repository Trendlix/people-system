import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ACCESS_IP_TOKEN,
  ACCESS_LINK_STATE_TEXT,
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  FORGOT_PASSWORD_ANSWER,
  type AccessLinkCheck,
  type AccessLinkResult,
  type AccessState,
  type BulkInviteResult,
  type EmployeeAccessView,
  type Role,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, addMonths, toDateOnly, todayInCairo } from '../src/common/date-only.js';
import { EmployeeAccessService } from '../src/employee-access/employee-access.service.js';
import { MailService } from '../src/mail/mail.service.js';
import { OffboardingService } from '../src/offboarding/offboarding.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Every active employee gets access (owner, 22 October 2026: "i dont thint that the users and employees needs to be
// divided, any active employee with active contract should have access. how can we make it?"; asked: "Set-password
// link", "Create now, HR sends when ready", "let the HR Choose which mail to use", "On the employee profile"). An account
// and a profile with the same work email are linked; the sweep makes an account for everyone with a signed contract in
// force and an email, sending nothing, and never for someone without one or whose email another account holds; HR
// switches the sign-in email, the password still working; invited by a link (copied or emailed), they set a password
// and sign in, the link used once; an expired, used or unknown link says so; Forgot password answers the same whatever
// the email, within its limits; Send invitations to many; the account's tools stay an Admin's; turning it off ends their
// sessions; their employment's end still closes it; the Users page lists only the other accounts; a developer changes
// nothing; the audit never holds a token. Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';
process.env.WEB_ORIGIN = 'https://people.example.test';

const RUN = `ea${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const YESTERDAY = addDays(TODAY, -1);
const NEW_PASSWORD = 'a-brand-new-password-1';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Employee access (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let access: EmployeeAccessService;
  let mail: MailService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const people: Record<string, { id: string; employmentId: string }> = {};
  const tokens: string[] = [];
  let usersBefore: Set<string>;
  let g9: string;
  let contracts = 0;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const put = (as: string, path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const patch = (as: string, path: string, body: object) => api().patch(`/api${path}`).set('Cookie', sessions[as]).send(body);

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    sessions[key] = await signIn(app, email);
    return email;
  }

  /** A profile with a current employment; a signed contract in force today unless `contract` is false. */
  async function employee(
    key: string,
    name: string,
    o: { workEmail?: string | null; personalEmail?: string | null; contract?: boolean; managerId?: string; gradeId?: string } = {},
  ) {
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'موظف تجريبي',
        workEmail: o.workEmail === undefined ? `${key}.${RUN}@work.test` : o.workEmail,
        personalEmail: o.personalEmail === undefined ? `${key}.${RUN}@personal.test` : o.personalEmail,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: toDateOnly('2025-01-01'), managerId: o.managerId ?? null, gradeId: o.gradeId ?? null } },
      },
      select: { id: true, employments: { select: { id: true } } },
    });
    people[key] = { id: e.id, employmentId: e.employments[0].id };
    if (o.contract !== false) {
      const start = addMonths(TODAY, -2);
      await prisma.contract.create({
        data: {
          number: `EA-${RUN}-${++contracts}`,
          employmentId: e.employments[0].id,
          version: 1,
          form: 'fixed',
          startDate: toDateOnly(start),
          endDate: toDateOnly(addDays(addMonths(start, 12), -1)),
          durationMonths: 12,
          grossSalary: 10_000,
          insuredSalary: 10_000,
          status: 'active',
          signedOn: toDateOnly(start),
        },
      });
    }
    return people[key];
  }

  const accountOf = (key: string) => prisma.user.findUnique({ where: { employeeId: people[key].id }, include: { roles: { include: { role: true } } } });
  const accessOf = async (as: string, key: string) => (await get(as, `/employees/${people[key].id}/access`).expect(200)).body as EmployeeAccessView;
  const listed = async (as: string) => (await get(as, '/employees').expect(200)).body as { id: string; access?: { state: AccessState; withoutContract: boolean } | null }[];
  const stateInList = async (key: string) => (await listed('hr')).find((r) => r.id === people[key].id)?.access;

  /** A link to copy, its token kept to check the audit never holds one. */
  async function copiedLink(key: string, purpose: 'invite' | 'reset', as = 'hr') {
    const res = (await post(as, `/employees/${people[key].id}/access/${purpose}`, { mode: 'copy' }).expect(200)).body as AccessLinkResult;
    expect(res.emailed).toBe(false);
    expect(res.link).toMatch(/^https:\/\/people\.example\.test\/set-password#[A-Za-z0-9_-]{43}$/);
    const token = res.link!.split('/set-password#')[1];
    tokens.push(token);
    return token;
  }

  const tokenIn = (text: string) => {
    const t = /\/set-password#([A-Za-z0-9_-]{43})/.exec(text)?.[1];
    if (t) tokens.push(t);
    return t;
  };

  /** Headers carrying an address the website signed (WEB_KEY), as it does for Forgot password and the link's page. */
  const signedFrom = (ip: string) => {
    const at = String(Date.now());
    return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(process.env.WEB_KEY!, ip, at, ACCESS_IP_TOKEN) };
  };
  const checkLink = (token: string, ip = '198.51.100.10') => api().post('/api/auth/password-link/check').set(signedFrom(ip)).send({ token });
  const setPassword = (token: string, password = NEW_PASSWORD, ip = '198.51.100.10') => api().post('/api/auth/password-link').set(signedFrom(ip)).send({ token, password });
  const forgot = (email: string, ip = '198.51.100.20') => api().post('/api/auth/forgot-password').set(signedFrom(ip)).send({ email });
  const login = (email: string, password: string) => api().post('/api/auth/login').send({ email, password });
  const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    access = app.get(EmployeeAccessService);
    mail = app.get(MailService);
    usersBefore = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
    await account('hr', ['hr']);
    await account('admin', ['admin']);
    await account('superAdmin', ['super_admin']);
    await account('ceo', ['ceo']);
    await account('outsider', ['employee']);
    await account('developer', ['employee', 'developer']);
    g9 = (await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } })).id;

    const boss = await employee('boss', 'Bassem Boss');
    await employee('mona', 'Mona Main', { managerId: boss.id });
    await employee('nocon', 'Nader NoContract', { contract: false });
    await employee('noemail', 'Nour NoEmail', { workEmail: null, personalEmail: null });
    await employee('omar', 'Omar Emailed');
    await employee('pia', 'Pia Pending');
    await employee('rita', 'Rita Renewal');
    await employee('leo', 'Leo Leaver');
    await employee('chief', 'Clara Chief', { gradeId: g9 });
    // an account of the Users page with Paula's personal email, made before everyone had access
    const paulaPersonal = `paula.${RUN}@personal.test`;
    await prisma.user.create({ data: { email: paulaPersonal } });
    await employee('paula', 'Paula Personal', { personalEmail: paulaPersonal });
    // Clash: Bassem has his account (Direct manager: Mona reports to him), and Cyrus's only email is the one it signs in with
    expect(await access.ensureFor(boss.id)).toBe('created');
    await employee('clash', 'Cyrus Clash', { workEmail: null, personalEmail: `boss.${RUN}@work.test` });
  });

  afterAll(async () => {
    const mine = Object.values(people).map((p) => p.id);
    // the accounts the sweep made for other files' people still in the database: theirs never existed before
    await prisma.user.deleteMany({ where: { id: { notIn: [...usersBefore] }, employeeId: { notIn: mine }, NOT: { employeeId: null } } });
    await prisma.employment.updateMany({ where: { employeeId: { in: mine } }, data: { managerId: null } });
    await prisma.employee.deleteMany({ where: { id: { in: mine } } });
    await app.close();
  });

  // ---------- the link between an account and a profile ----------

  it('links an account and a profile with the same work email, whichever is made first; only the link counts after', async () => {
    const before = await createUser(prisma, ['employee']);
    const first = await prisma.employee.create({ data: { employeeCode: `L1-${RUN}`, fullNameEn: `Link First ${RUN}`, fullNameAr: 'ربط', workEmail: before.toUpperCase() }, select: { id: true } });
    people.linkFirst = { id: first.id, employmentId: '' };
    expect((await prisma.user.findUniqueOrThrow({ where: { email: before } })).employeeId).toBe(first.id);

    const second = await prisma.employee.create({ data: { employeeCode: `L2-${RUN}`, fullNameEn: `Link Second ${RUN}`, fullNameAr: 'ربط', workEmail: `later.${RUN}@work.test` }, select: { id: true } });
    people.linkSecond = { id: second.id, employmentId: '' };
    const later = await prisma.user.create({ data: { email: `later.${RUN}@work.test` }, select: { employeeId: true } });
    expect(later.employeeId).toBe(second.id);

    // their own profile is found by the link: /auth/me, with their work email changed
    const session = await signIn(app, before);
    await prisma.employee.update({ where: { id: first.id }, data: { workEmail: `changed.${RUN}@work.test` } });
    expect((await api().get('/api/auth/me').set('Cookie', session).expect(200)).body).toMatchObject({ employeeId: first.id, name: `Link First ${RUN}` });
  });

  // ---------- the accounts ----------

  it('shows HR who is waiting for an account, and nobody else sees the Access column', async () => {
    expect(await stateInList('mona')).toEqual({ state: 'pending', withoutContract: false });
    expect(await stateInList('nocon')).toEqual({ state: 'not_eligible', withoutContract: false });
    expect(await stateInList('noemail')).toEqual({ state: 'no_email', withoutContract: false });
    // C-level people are only directory cards for HR: no access shown
    expect((await listed('hr')).find((r) => r.id === people.chief.id)).not.toHaveProperty('access');
    expect((await listed('ceo')).find((r) => r.id === people.mona.id)).not.toHaveProperty('access');
    // a Super Admin with HR's sight sees it too; an Admin alone doesn't see the Employees list's people
    await account('superHr', ['super_admin', 'hr']);
    expect((await listed('superHr')).find((r) => r.id === people.mona.id)?.access).toEqual({ state: 'pending', withoutContract: false });
  });

  it('makes an account for every active employee with an active contract, sending nothing', async () => {
    const outbox = mail.outbox.length;
    const counts = await access.sweep();
    expect(counts).not.toBeNull();
    expect(mail.outbox.length).toBe(outbox);

    const mona = await accountOf('mona');
    expect(mona).toMatchObject({ email: `mona.${RUN}@work.test`, isActive: true, passwordHash: null });
    expect(mona!.roles.map((r) => r.role.key)).toEqual(['employee']);
    // someone reports to Bassem: Direct manager too
    expect((await accountOf('boss'))!.roles.map((r) => r.role.key).sort()).toEqual(['employee', 'manager']);
    // no contract, no email, an email in use: none
    expect(await accountOf('nocon')).toBeNull();
    expect(await accountOf('noemail')).toBeNull();
    expect(await accountOf('clash')).toBeNull();
    // the Users page's account with Paula's personal email is hers: no second one, her personal email her sign-in one
    const paula = await accountOf('paula');
    expect(paula?.email).toBe(`paula.${RUN}@personal.test`);
    expect(await prisma.user.count({ where: { email: `paula.${RUN}@work.test` } })).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: people.paula.id } })).signInEmail).toBe('personal');

    expect(await stateInList('mona')).toEqual({ state: 'not_invited', withoutContract: false });
    expect(await stateInList('clash')).toEqual({ state: 'clash', withoutContract: false });
    // the audit says the system made it
    const made = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: mona!.id, action: 'create' } });
    expect(made.userId).toBeNull();
    // a second sweep changes nothing for them
    await access.sweep();
    expect(await prisma.user.count({ where: { employeeId: people.mona.id } })).toBe(1);
  });

  it('shows the Access tab to HR, an Admin, a Super Admin; a C-level person’s only to the CEO and a Super Admin', async () => {
    const hr = await accessOf('hr', 'mona');
    expect(hr).toMatchObject({
      employeeId: people.mona.id,
      state: 'not_invited',
      signInEmail: { choice: null, work: `mona.${RUN}@work.test`, personal: `mona.${RUN}@personal.test`, email: `mona.${RUN}@work.test` },
      eligible: true,
      notEligibleReason: null,
      account: { email: `mona.${RUN}@work.test`, isActive: true, passwordSet: false, lastSignInAt: null, roles: ['employee'], assetsAccess: 'none' },
      closedReason: null,
      link: null,
      clash: null,
      withoutContract: false,
      emailReady: true,
      can: { invite: true, manageAccount: false },
    });
    expect((await accessOf('admin', 'mona')).can).toEqual({ invite: true, manageAccount: true });
    expect((await accessOf('superAdmin', 'mona')).can).toEqual({ invite: true, manageAccount: true });
    await get('outsider', `/employees/${people.mona.id}/access`).expect(404);
    await get('ceo', `/employees/${people.mona.id}/access`).expect(404);

    await get('hr', `/employees/${people.chief.id}/access`).expect(404);
    expect((await accessOf('ceo', 'chief')).can.invite).toBe(true);
    expect((await accessOf('superAdmin', 'chief')).state).toBe('not_invited');

    expect(await accessOf('hr', 'nocon')).toMatchObject({ state: 'not_eligible', eligible: false, notEligibleReason: 'Their employment has no contract yet.', account: null });
    expect(await accessOf('hr', 'clash')).toMatchObject({ state: 'clash', clash: { email: `boss.${RUN}@work.test`, otherEmployee: { id: people.boss.id } } });
  });

  it('gives access now from the profile, or says why it can’t', async () => {
    const nina = await employee('nina', 'Nina Now');
    expect((await accessOf('hr', 'nina')).state).toBe('pending');
    const now = (await post('hr', `/employees/${nina.id}/access/account`).expect(200)).body as EmployeeAccessView;
    expect(now).toMatchObject({ state: 'not_invited', account: { email: `nina.${RUN}@work.test` } });
    const made = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: now.account!.id, action: 'create' } });
    expect(made.userId).toBe(users.hr);

    expect((await post('hr', `/employees/${people.nocon.id}/access/account`).expect(409)).body.message).toBe('Their employment has no contract yet.');
    expect((await post('hr', `/employees/${people.noemail.id}/access/account`).expect(409)).body.message).toBe('Add a work or personal email to their profile first.');
    expect((await post('hr', `/employees/${people.clash.id}/access/account`).expect(409)).body.message).toContain('Another account already uses this email.');
    await post('outsider', `/employees/${nina.id}/access/account`).expect(404);
  });

  // ---------- the first password ----------

  it('invites by a link to copy: they set a password with it, once, and sign in', async () => {
    const token = await copiedLink('mona', 'invite');
    expect(await accessOf('hr', 'mona')).toMatchObject({ state: 'invited', link: { purpose: 'invite', emailed: false } });
    // only its SHA-256 is kept
    expect(await prisma.accessLink.count({ where: { tokenHash: sha256(token) } })).toBe(1);
    expect(await prisma.accessLink.count({ where: { tokenHash: token } })).toBe(0);

    const check = (await checkLink(token).expect(200)).body as AccessLinkCheck;
    expect(check).toMatchObject({ state: 'ok', email: `mona.${RUN}@work.test`, purpose: 'invite' });

    expect((await setPassword(token, 'short').expect(400)).body.message).toEqual(['Choose a password of at least 10 characters.']);
    expect((await setPassword(token).expect(200)).body).toEqual({ email: `mona.${RUN}@work.test` });
    const res = await login(`mona.${RUN}@work.test`, NEW_PASSWORD).expect(200);
    sessions.mona = cookieOf(res);
    expect((await api().get('/api/auth/me').set('Cookie', sessions.mona).expect(200)).body).toMatchObject({ employeeId: people.mona.id, roles: ['employee'] });

    // used once
    expect((await checkLink(token).expect(200)).body).toEqual({ state: 'used' });
    expect((await setPassword(token, 'another-password-2').expect(400)).body.message).toEqual([ACCESS_LINK_STATE_TEXT.used]);
    expect(await stateInList('mona')).toEqual({ state: 'active', withoutContract: false });
    // no invitation once their password is set: a reset instead
    expect((await post('hr', `/employees/${people.mona.id}/access/invite`, { mode: 'copy' }).expect(409)).body.message).toContain('send a password reset instead');
  });

  it('shows the person their own sign-in, read only', async () => {
    const own = await accessOf('mona', 'mona');
    expect(own).toMatchObject({ state: 'active', signInEmail: { work: null, personal: null, email: `mona.${RUN}@work.test` }, account: { roles: [] }, link: null, can: { invite: false, manageAccount: false } });
    expect(own.account!.lastSignInAt).not.toBeNull();
    await put('mona', `/employees/${people.mona.id}/access/sign-in-email`, { choice: 'personal' }).expect(404);
    await post('mona', `/employees/${people.mona.id}/access/reset`, { mode: 'copy' }).expect(404);
    await get('mona', `/employees/${people.boss.id}/access`).expect(404);
  });

  it('switches the sign-in email to the personal one and back, the password still working', async () => {
    const personal = (await put('hr', `/employees/${people.mona.id}/access/sign-in-email`, { choice: 'personal' }).expect(200)).body as EmployeeAccessView;
    expect(personal).toMatchObject({ signInEmail: { choice: 'personal', email: `mona.${RUN}@personal.test` }, account: { email: `mona.${RUN}@personal.test` } });
    await login(`mona.${RUN}@work.test`, NEW_PASSWORD).expect(401);
    await login(`mona.${RUN}@personal.test`, NEW_PASSWORD).expect(200);
    const audited = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: people.mona.id, action: 'update' }, orderBy: { at: 'desc' } });
    expect(audited.diff).toEqual({ signInEmail: { from: null, to: 'personal' } });

    const work = (await put('hr', `/employees/${people.mona.id}/access/sign-in-email`, { choice: 'work' }).expect(200)).body as EmployeeAccessView;
    expect(work.account!.email).toBe(`mona.${RUN}@work.test`);
    sessions.mona = cookieOf(await login(`mona.${RUN}@work.test`, NEW_PASSWORD).expect(200));

    // refused, nothing changed, when another account has the email; and an email the profile hasn't
    await prisma.employee.update({ where: { id: people.mona.id }, data: { personalEmail: `boss.${RUN}@work.test` } });
    expect((await put('hr', `/employees/${people.mona.id}/access/sign-in-email`, { choice: 'personal' }).expect(409)).body.message).toBe(`Another account already signs in with boss.${RUN}@work.test.`);
    expect((await accountOf('mona'))!.email).toBe(`mona.${RUN}@work.test`);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: people.mona.id } })).signInEmail).toBe('work');
    await prisma.employee.update({ where: { id: people.mona.id }, data: { personalEmail: `mona.${RUN}@personal.test` } });
    expect((await put('hr', `/employees/${people.noemail.id}/access/sign-in-email`, { choice: 'work' }).expect(400)).body.message).toEqual(['They have no work email: add it on Basic Data first.']);
    expect((await put('hr', `/employees/${people.mona.id}/access/sign-in-email`, { choice: 'other' }).expect(400)).body.message).toEqual(['Choose their work email or their personal email.']);
  });

  it('emails an invitation in English and Arabic; a new link cancels the one before', async () => {
    const first = await copiedLink('omar', 'invite');
    const outbox = mail.outbox.length;
    const sent = (await post('hr', `/employees/${people.omar.id}/access/invite`, { mode: 'email' }).expect(200)).body as AccessLinkResult;
    expect(sent).toEqual({ emailed: true, expiresAt: expect.any(String) });
    const [m] = mail.outbox.slice(outbox);
    expect(m.to).toBe(`omar.${RUN}@work.test`);
    expect(m.text).toContain(`Hello Omar Emailed ${RUN},`);
    expect(m.text).toContain(`Your sign-in email: omar.${RUN}@work.test`);
    expect(m.text).toContain('بريد الدخول');
    const second = tokenIn(m.text)!;
    expect(second).toBeDefined();
    expect((await checkLink(first).expect(200)).body).toEqual({ state: 'expired' });
    expect((await checkLink(second).expect(200)).body.state).toBe('ok');
    expect(await accessOf('hr', 'omar')).toMatchObject({ state: 'invited', link: { purpose: 'invite', emailed: true } });
  });

  it('says when a link has expired, or doesn’t work at all', async () => {
    const token = await copiedLink('pia', 'invite');
    const now = Date.now();
    await prisma.accessLink.update({ where: { tokenHash: sha256(token) }, data: { createdAt: new Date(now - 9 * 86_400_000), expiresAt: new Date(now - 2 * 86_400_000) } });
    expect((await checkLink(token).expect(200)).body).toEqual({ state: 'expired' });
    expect((await setPassword(token).expect(400)).body.message).toEqual([ACCESS_LINK_STATE_TEXT.expired]);
    expect(await stateInList('pia')).toEqual({ state: 'not_invited', withoutContract: false });

    const unknown = 'A'.repeat(43);
    expect((await checkLink(unknown).expect(200)).body).toEqual({ state: 'unknown' });
    expect((await checkLink('not-a-token').expect(200)).body).toEqual({ state: 'unknown' });
    expect((await setPassword(unknown).expect(400)).body.message).toEqual([ACCESS_LINK_STATE_TEXT.unknown]);
  });

  it('stops an address after too many failed tries with links', async () => {
    const ip = '203.0.113.77';
    for (let i = 0; i < 20; i++) await setPassword('B'.repeat(43), NEW_PASSWORD, ip).expect(400);
    expect((await setPassword('B'.repeat(43), NEW_PASSWORD, ip).expect(429)).body.message).toBe('Too many tries. Please try again in an hour.');
    // another address isn't stopped
    await setPassword('B'.repeat(43), NEW_PASSWORD, '203.0.113.78').expect(400);
  });

  // ---------- a new password ----------

  it('sends a password reset from the profile: their sessions end, the new password works', async () => {
    const token = await copiedLink('mona', 'reset');
    expect((await checkLink(token).expect(200)).body).toMatchObject({ state: 'ok', purpose: 'reset' });
    await setPassword(token, 'the-reset-password-3').expect(200);
    await api().get('/api/auth/me').set('Cookie', sessions.mona).expect(401);
    await login(`mona.${RUN}@work.test`, NEW_PASSWORD).expect(401);
    sessions.mona = cookieOf(await login(`mona.${RUN}@work.test`, 'the-reset-password-3').expect(200));
    const set = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'user', entityId: (await accountOf('mona'))!.id, action: 'password_set' }, orderBy: { at: 'desc' } });
    expect(set.diff).toMatchObject({ purpose: 'reset', via: 'link', sessionsEnded: 1 });
  });

  it('answers Forgot password the same whatever the email, emailing a reset link to an account, within its limits', async () => {
    const email = `mona.${RUN}@work.test`;
    let outbox = mail.outbox.length;
    expect((await forgot(email.toUpperCase()).expect(200)).body).toEqual({ message: FORGOT_PASSWORD_ANSWER });
    const [m] = mail.outbox.slice(outbox);
    expect(m.to).toBe(email);
    expect(m.subject).toBe('Set a new password for Trendlix People');
    const token = tokenIn(m.text)!;
    expect((await checkLink(token).expect(200)).body).toMatchObject({ state: 'ok', purpose: 'reset' });

    outbox = mail.outbox.length;
    expect((await forgot(`nobody.${RUN}@nowhere.test`).expect(200)).body).toEqual({ message: FORGOT_PASSWORD_ANSWER });
    expect(mail.outbox.length).toBe(outbox);

    // three links an hour for one email; then the same answer, nothing sent
    await forgot(email).expect(200);
    await forgot(email).expect(200);
    outbox = mail.outbox.length;
    expect((await forgot(email).expect(200)).body).toEqual({ message: FORGOT_PASSWORD_ANSWER });
    expect(mail.outbox.length).toBe(outbox);

    // too many from one address
    const ip = '203.0.113.90';
    await prisma.accessLinkRequest.createMany({ data: Array.from({ length: 20 }, () => ({ kind: 'forgot', email: `x.${RUN}@nowhere.test`, ip })) });
    expect((await forgot(`y.${RUN}@nowhere.test`, ip).expect(429)).body.message).toBe('Too many tries. Please try again in an hour.');
    expect((await forgot('not-an-email').expect(400)).body.message).toEqual(['Enter your sign-in email.']);
  });

  // ---------- many at once ----------

  it('sends invitations to the people chosen, saying why the others got none', async () => {
    const outbox = mail.outbox.length;
    const result = (await post('hr', '/employees/access/invitations', { employeeIds: [people.pia.id, people.mona.id, people.nocon.id, people.clash.id] }).expect(200)).body as BulkInviteResult;
    expect(result.sent).toBe(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { employeeId: people.mona.id, fullNameEn: `Mona Main ${RUN}`, reason: 'They have set their password already.' },
        { employeeId: people.nocon.id, fullNameEn: `Nader NoContract ${RUN}`, reason: 'No signed contract in force today.' },
        { employeeId: people.clash.id, fullNameEn: `Cyrus Clash ${RUN}`, reason: 'Another account uses their email.' },
      ]),
    );
    expect(mail.outbox.slice(outbox).map((m) => m.to)).toEqual([`pia.${RUN}@work.test`]);
    tokenIn(mail.outbox.at(-1)!.text);

    // everyone not invited yet: Rita and Leo among them, never the C-level person HR doesn't see
    const all = (await post('hr', '/employees/access/invitations', { allNotInvited: true }).expect(200)).body as BulkInviteResult;
    expect(all.sent).toBeGreaterThanOrEqual(2);
    for (const m of mail.outbox.slice(outbox)) tokenIn(m.text);
    expect(await stateInList('rita')).toEqual({ state: 'invited', withoutContract: false });
    expect(await stateInList('leo')).toEqual({ state: 'invited', withoutContract: false });
    expect((await accessOf('ceo', 'chief')).state).toBe('not_invited');

    await post('outsider', '/employees/access/invitations', { allNotInvited: true }).expect(403);
    expect((await post('hr', '/employees/access/invitations', {}).expect(400)).body.message).toEqual(['Choose the people to invite, or everyone not invited yet.']);
  });

  // ---------- the account's tools ----------

  it('keeps the roles and turning access off an Admin’s; turning it off ends their sessions, the sweep never turns it on', async () => {
    const monaId = (await accountOf('mona'))!.id;
    await patch('hr', `/users/${monaId}`, { roles: ['employee', 'manager'] }).expect(403);
    expect((await patch('admin', `/users/${monaId}`, { roles: ['employee', 'manager'] }).expect(200)).body.roles).toEqual(['employee', 'manager']);
    expect((await get('admin', `/users/${monaId}`).expect(200)).body.employee).toEqual({ id: people.mona.id, employeeCode: `MONA-${RUN}`, fullNameEn: `Mona Main ${RUN}` });

    await patch('admin', `/users/${monaId}`, { isActive: false }).expect(200);
    await api().get('/api/auth/me').set('Cookie', sessions.mona).expect(401);
    expect(await stateInList('mona')).toEqual({ state: 'closed', withoutContract: false });
    expect((await accessOf('hr', 'mona')).closedReason).toBe('Turned off by an Admin.');
    await access.sweep();
    expect((await accountOf('mona'))!.isActive).toBe(false);
    expect((await post('hr', `/employees/${people.mona.id}/access/reset`, { mode: 'copy' }).expect(409)).body.message).toBe('Their access is turned off: turn it on first.');
    // Forgot password sends nothing to a closed account, with the same answer (its hour's count started afresh)
    await prisma.accessLinkRequest.deleteMany({ where: { email: `mona.${RUN}@work.test` } });
    const outbox = mail.outbox.length;
    expect((await forgot(`mona.${RUN}@work.test`, '198.51.100.30').expect(200)).body).toEqual({ message: FORGOT_PASSWORD_ANSWER });
    expect(mail.outbox.length).toBe(outbox);
    await patch('admin', `/users/${monaId}`, { isActive: true }).expect(200);
  });

  it('lists an active account without a contract in force, never closing it; their employment’s end closes it', async () => {
    // Rita's contract ended yesterday, a renewal on its way
    await prisma.contract.updateMany({ where: { employmentId: people.rita.employmentId }, data: { endDate: toDateOnly(YESTERDAY), startDate: toDateOnly(addMonths(TODAY, -12)) } });
    const rita = await accountOf('rita');
    await prisma.user.update({ where: { id: rita!.id }, data: { passwordHash: 'x' } });
    expect(await stateInList('rita')).toEqual({ state: 'active', withoutContract: true });
    expect((await accessOf('hr', 'rita')).withoutContract).toBe(true);
    await access.sweep();
    expect((await accountOf('rita'))!.isActive).toBe(true);

    // Leo signs in with his personal email; his employment ended yesterday: offboarding closes his account by the link
    await put('hr', `/employees/${people.leo.id}/access/sign-in-email`, { choice: 'personal' }).expect(200);
    await prisma.employment.update({ where: { id: people.leo.employmentId }, data: { endDate: toDateOnly(YESTERDAY), status: 'resigned' } });
    expect(await app.get(OffboardingService).closeSignIn(people.leo.employmentId)).toBe(true);
    expect(await accountOf('leo')).toMatchObject({ email: `leo.${RUN}@personal.test`, isActive: false });
    expect((await accessOf('hr', 'leo')).closedReason).toBe(`Their employment ended on ${YESTERDAY}.`);
  });

  it('lists only the accounts that aren’t employees’ on the Users page; View as keeps them all', async () => {
    const other = await createUser(prisma, ['finance']);
    const page = (await get('admin', '/users?only=other').expect(200)).body as { email: string; employee: unknown }[];
    expect(page.some((u) => u.email === other)).toBe(true);
    expect(page.some((u) => u.email === `mona.${RUN}@work.test`)).toBe(false);
    expect(page.every((u) => u.employee === null)).toBe(true);
    const all = (await get('admin', '/users').expect(200)).body as { email: string }[];
    expect(all.some((u) => u.email === `mona.${RUN}@work.test`)).toBe(true);
    await get('hr', '/users?only=other').expect(403);
  });

  it('lets a developer look and change nothing', async () => {
    expect((await accessOf('developer', 'omar')).state).toBe('invited');
    await post('developer', `/employees/${people.pia.id}/access/invite`, { mode: 'copy' }).expect(403);
    await post('developer', `/employees/${people.nina.id}/access/account`).expect(403);
    await put('developer', `/employees/${people.pia.id}/access/sign-in-email`, { choice: 'personal' }).expect(403);
    await post('developer', '/employees/access/invitations', { allNotInvited: true }).expect(403);
  });

  it('never keeps a token in the audit log', async () => {
    expect(tokens.length).toBeGreaterThanOrEqual(6);
    const accountIds = (await prisma.user.findMany({ where: { employeeId: { in: Object.values(people).map((p) => p.id) } }, select: { id: true } })).map((u) => u.id);
    const entries = await prisma.auditLog.findMany({ where: { entityType: 'user', entityId: { in: accountIds } }, select: { action: true, diff: true } });
    expect(entries.some((e) => e.action === 'invite')).toBe(true);
    expect(entries.some((e) => e.action === 'password_link')).toBe(true);
    const text = JSON.stringify(entries);
    for (const t of tokens) {
      expect(text).not.toContain(t);
      expect(text).not.toContain(sha256(t));
    }
  });
});
