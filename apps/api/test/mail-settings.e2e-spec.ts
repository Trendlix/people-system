import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, DEVELOPER_READ_ONLY, MAIL_PASSWORD_UNREADABLE, MAIL_SETTINGS_OWN_ACCOUNT, MAIL_SETTINGS_SUPER_ADMIN_ONLY } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { closedPort, fakeSmtp, type FakeMessage, type FakeSmtp } from './fake-smtp.js';
import { createApp, createUser, signIn } from './helpers.js';

// Email (SMTP) settings in the system (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"):
// Organization → Email Settings, a Super Admin's only. A Super Admin saves and reads them, the password never in any
// answer or audit entry; everyone else is refused (HR, Admin, the CEO, a developer, a Super Admin viewing as someone);
// an empty password keeps the saved one; "Send a test email" talks to a real SMTP server and answers in plain words; the
// system's emails (here an access invitation) go out with the system's settings while they are on, else with the
// server's (deploy/.env), as before.
//
// Two SMTP servers run in this process (fake-smtp.ts): "the company's mailbox", which asks for a sign-in and allows one
// sender, and "the server's settings", set as SMTP_HOST/SMTP_PORT/MAIL_FROM before the app starts. MAIL_TRANSPORT is
// unset here, so the messages really go out by SMTP, to 127.0.0.1 only. Every address is invented; this file deletes
// the settings, the employee and the account it made.

delete process.env.MAIL_TRANSPORT;

const RUN = `ms${Date.now().toString(36)}`;
/** The mailbox's password: distinctive, so every answer and audit entry can be searched for it. */
const SMTP_PASSWORD = `Pw-${RUN}-Zq9!xK`;
const MAILBOX = 'hr@trendlix.test';
const SERVER_FROM = 'Server Settings <server@test.local>';

describe('Email settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  let mailbox: FakeSmtp;
  let fallback: FakeSmtp;
  const sessions: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const ids: Record<string, string> = {};
  /** Every answer this file received, to search for the password. */
  const answers: unknown[] = [];
  let invitee: { employeeId: string; userId: string; email: string };

  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[who]),
    put: (path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[who]).send(body),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[who]).send(body),
    delete: (path: string) => api().delete(`/api${path}`).set('Cookie', sessions[who]),
  });
  const kept = (res: request.Response) => {
    answers.push(res.body);
    return res;
  };
  const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];

  /** The settings as the page sends them: the company's mailbox, switched on. */
  const settings = (over: Record<string, unknown> = {}) => ({
    provider: 'other',
    host: '127.0.0.1',
    port: mailbox.port,
    security: 'none',
    username: MAILBOX,
    password: SMTP_PASSWORD,
    fromName: 'TrendLIX HR',
    fromAddress: 'HR@Trendlix.test',
    replyTo: 'jobs@trendlix.test',
    enabled: true,
    ...over,
  });
  /** The form's values as the test takes them: all but the switch. */
  const form = (over: Record<string, unknown> = {}) => {
    const { enabled: _enabled, ...values } = settings(over);
    return values;
  };
  const testWith = (over: Record<string, unknown> = {}) => as('superAdmin').post('/mail-settings/test', form(over));
  const header = (m: FakeMessage, name: string) => new RegExp(`^${name}: (.*)$`, 'mi').exec(m.data)?.[1] ?? null;
  const invite = () => as('hr').post(`/employees/${invitee.employeeId}/access/invite`, { mode: 'email' });

  beforeAll(async () => {
    mailbox = await fakeSmtp({ user: MAILBOX, pass: SMTP_PASSWORD, senders: [MAILBOX] });
    fallback = await fakeSmtp();
    // the server's settings (deploy/.env), whatever apps/api/.env says: this file's own fake server
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(fallback.port), SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: SERVER_FROM });
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    // none saved to start with (a run stopped halfway may have left them)
    await prisma.mailSettings.deleteMany();
    mail.forget();

    for (const [who, roles] of [
      ['superAdmin', ['super_admin']],
      ['otherSuperAdmin', ['super_admin']],
      ['hr', ['hr']],
      ['admin', ['admin']],
      ['ceo', ['ceo']],
      ['developer', ['employee', 'developer']],
    ] as const) {
      emails[who] = await createUser(prisma, [...roles]);
      ids[who] = (await prisma.user.findUniqueOrThrow({ where: { email: emails[who] }, select: { id: true } })).id;
      sessions[who] = await signIn(app, emails[who]);
    }

    // someone to invite: an employee with an account and no password yet
    const email = `ina.${RUN}@work.test`;
    const employee = await prisma.employee.create({ data: { employeeCode: `MS-${RUN}`, fullNameEn: `Ina Invite ${RUN}`, fullNameAr: 'إينا', workEmail: email }, select: { id: true } });
    const user = await prisma.user.create({ data: { email, employeeId: employee.id }, select: { id: true } });
    invitee = { employeeId: employee.id, userId: user.id, email };
  });

  afterAll(async () => {
    await prisma.mailSettings.deleteMany();
    if (invitee) {
      await prisma.accessLink.deleteMany({ where: { userId: invitee.userId } });
      await prisma.user.deleteMany({ where: { id: invitee.userId } });
      await prisma.employee.deleteMany({ where: { id: invitee.employeeId } });
    }
    await app.close();
    await mailbox.close();
    await fallback.close();
  });

  it('with nothing saved, mail goes out with the server’s settings', async () => {
    const view = kept(await as('superAdmin').get('/mail-settings').expect(200)).body;
    expect(view).toMatchObject({ passwordSet: false, passwordUnreadable: false, enabled: false, lastTest: null, updatedBy: null, sending: { source: 'server', from: SERVER_FROM, address: 'server@test.local' } });

    const before = fallback.messages.length;
    expect(kept(await invite().expect(200)).body).toMatchObject({ emailed: true });
    const [m] = fallback.messages.slice(before);
    expect(m).toMatchObject({ from: 'server@test.local', to: [invitee.email] });
    expect(header(m, 'From')).toBe(SERVER_FROM);
  });

  it('refuses everyone but a Super Admin in their own session', async () => {
    for (const who of ['hr', 'admin', 'ceo']) {
      for (const res of [
        await as(who).get('/mail-settings'),
        await as(who).put('/mail-settings', settings()),
        await as(who).post('/mail-settings/test', { to: MAILBOX }),
        await as(who).delete('/mail-settings/password'),
      ]) {
        expect(res.status).toBe(403);
        expect(kept(res).body.message).toBe(MAIL_SETTINGS_SUPER_ADMIN_ONLY);
      }
    }
    // a developer: not even to read (the mailbox and its server), and no change
    expect(kept(await as('developer').get('/mail-settings').expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
    expect(kept(await as('developer').put('/mail-settings', settings()).expect(403)).body.message).toBe(DEVELOPER_READ_ONLY);
    expect(kept(await as('developer').post('/mail-settings/test', {}).expect(403)).body.message).toBe(DEVELOPER_READ_ONLY);

    // a Super Admin viewing as HR, and as another Super Admin, even acting in their name
    sessions.viewingHr = cookieOf(await as('superAdmin').post('/auth/view-as', { userId: ids.hr }).expect(200));
    expect(kept(await as('viewingHr').get('/mail-settings').expect(403)).body.message).toBe(MAIL_SETTINGS_SUPER_ADMIN_ONLY);
    await as('viewingHr').post('/auth/view-as/stop').expect(200);
    sessions.viewingSuper = cookieOf(await as('superAdmin').post('/auth/view-as', { userId: ids.otherSuperAdmin }).expect(200));
    expect(kept(await as('viewingSuper').get('/mail-settings').expect(403)).body.message).toBe(MAIL_SETTINGS_OWN_ACCOUNT);
    expect((await as('viewingSuper').put('/mail-settings', settings())).status).toBe(403);
    sessions.viewingSuper = cookieOf(await as('viewingSuper').post('/auth/view-as/act', { act: true }).expect(200));
    expect(kept(await as('viewingSuper').get('/mail-settings').expect(403)).body.message).toBe(MAIL_SETTINGS_OWN_ACCOUNT);
    expect(kept(await as('viewingSuper').put('/mail-settings', settings()).expect(403)).body.message).toBe(MAIL_SETTINGS_OWN_ACCOUNT);
    expect(kept(await as('viewingSuper').post('/mail-settings/test', { to: MAILBOX, ...form() }).expect(403)).body.message).toBe(MAIL_SETTINGS_OWN_ACCOUNT);
    expect(kept(await as('viewingSuper').delete('/mail-settings/password').expect(403)).body.message).toBe(MAIL_SETTINGS_OWN_ACCOUNT);
    await as('viewingSuper').post('/auth/view-as/stop').expect(200);
    sessions.superAdmin = await signIn(app, emails.superAdmin);

    expect(await prisma.mailSettings.count()).toBe(0);
  });

  it('a Super Admin saves and reads them: the password sealed, never answered, only "changed" in the audit log', async () => {
    const saved = kept(await as('superAdmin').put('/mail-settings', settings()).expect(200)).body;
    expect(saved).toMatchObject({
      provider: 'other',
      host: '127.0.0.1',
      port: mailbox.port,
      security: 'none',
      username: MAILBOX,
      passwordSet: true,
      passwordUnreadable: false,
      fromName: 'TrendLIX HR',
      fromAddress: MAILBOX,
      replyTo: 'jobs@trendlix.test',
      enabled: true,
      missing: [],
      updatedBy: { id: ids.superAdmin },
      sending: { source: 'system', from: `TrendLIX HR <${MAILBOX}>`, address: MAILBOX },
    });
    expect(saved).not.toHaveProperty('password');
    expect(kept(await as('superAdmin').get('/mail-settings').expect(200)).body).toEqual(saved);

    const row = await prisma.mailSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.passwordEnc).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(row.passwordEnc).not.toContain(SMTP_PASSWORD);
    expect(row.passwordKeyId).toMatch(/^[0-9a-f]{12}$/);

    const [entry] = await prisma.auditLog.findMany({ where: { entityType: 'mail_settings', action: 'update' } });
    expect(entry).toMatchObject({ userId: ids.superAdmin, entityId: null });
    expect(entry.diff).toMatchObject({ host: { from: null, to: '127.0.0.1' }, username: { from: null, to: MAILBOX }, enabled: { from: null, to: true }, password: 'changed' });

    // saved again unchanged: nothing written
    kept(await as('superAdmin').put('/mail-settings', settings({ password: '' })).expect(200));
    expect(await prisma.auditLog.count({ where: { entityType: 'mail_settings', action: 'update' } })).toBe(1);
  });

  it('refuses settings that can’t be right, and a switched-on set without what it needs', async () => {
    const res = kept(await as('superAdmin').put('/mail-settings', settings({ host: 'smtp gmail', port: 0, fromAddress: 'hr@', password: 'x' })).expect(400));
    expect(res.body.message).toEqual(expect.arrayContaining(['The port is a whole number from 1 to 65535, usually 587 or 465.']));
    const lacking = kept(await as('superAdmin').put('/mail-settings', settings({ host: '', fromAddress: '' })).expect(400));
    expect(lacking.body.message).toEqual(['To send emails with these settings, enter the server and the sender’s address.']);
    expect(kept(await as('superAdmin').put('/mail-settings', settings({ provider: 'yahoo' })).expect(400)).body.message).toEqual(['Choose the email provider.']);
  });

  it('a caller (an access invitation) goes out with the system’s settings: the mailbox signed in, its sender and reply-to', async () => {
    const before = { mailbox: mailbox.messages.length, fallback: fallback.messages.length };
    kept(await invite().expect(200));
    expect(fallback.messages.length).toBe(before.fallback);
    const [m] = mailbox.messages.slice(before.mailbox);
    expect(m).toMatchObject({ from: MAILBOX, to: [invitee.email], user: MAILBOX });
    expect(header(m, 'From')).toBe(`TrendLIX HR <${MAILBOX}>`);
    expect(header(m, 'Reply-To')).toBe('jobs@trendlix.test');
    expect(m.data).toMatch(/set-password#/);
  });

  it('an empty password keeps the saved one', async () => {
    const sealed = (await prisma.mailSettings.findUniqueOrThrow({ where: { id: 1 } })).passwordEnc;
    const saved = kept(await as('superAdmin').put('/mail-settings', settings({ password: '', fromName: 'TrendLIX People' })).expect(200)).body;
    expect(saved).toMatchObject({ passwordSet: true, fromName: 'TrendLIX People', sending: { source: 'system', from: `TrendLIX People <${MAILBOX}>` } });
    expect((await prisma.mailSettings.findUniqueOrThrow({ where: { id: 1 } })).passwordEnc).toBe(sealed);
    const [latest] = await prisma.auditLog.findMany({ where: { entityType: 'mail_settings', action: 'update' }, orderBy: { at: 'desc' }, take: 1 });
    expect(latest.diff).toEqual({ fromName: { from: 'TrendLIX HR', to: 'TrendLIX People' } });

    // and still signs in: the next email goes out through the mailbox
    const before = mailbox.messages.length;
    kept(await invite().expect(200));
    expect(mailbox.messages.slice(before)).toEqual([expect.objectContaining({ user: MAILBOX, to: [invitee.email] })]);
  });

  it('sends a test email with the form’s values, the saved password when none is typed, and keeps the last test', async () => {
    const before = mailbox.messages.length;
    const ok = kept(await testWith({ password: '' }).expect(200)).body;
    expect(ok).toEqual({ at: expect.any(String), ok: true, message: `Sent to ${emails.superAdmin}. Check that it arrived, and look in the spam folder if it didn’t.` });
    const [m] = mailbox.messages.slice(before);
    expect(m).toMatchObject({ from: MAILBOX, to: [emails.superAdmin], user: MAILBOX });
    expect(header(m, 'Subject')).toBe('Test email from Trendlix People');

    // to another address, typed
    kept(await testWith({ to: 'Owner@Trendlix.test' }).expect(200));
    expect(mailbox.messages.at(-1)!.to).toEqual(['owner@trendlix.test']);

    const view = kept(await as('superAdmin').get('/mail-settings').expect(200)).body;
    expect(view.lastTest).toEqual({ at: expect.any(String), ok: true, message: expect.stringContaining('Sent to owner@trendlix.test') });
    const tests = await prisma.auditLog.findMany({ where: { entityType: 'mail_settings', action: 'send_test' }, orderBy: { at: 'asc' } });
    expect(tests.map((t) => t.diff)).toEqual([
      { sentTo: emails.superAdmin, sent: true },
      { sentTo: 'owner@trendlix.test', sent: true },
    ]);
  });

  it('answers a failed test in plain words', async () => {
    const closed = await closedPort();
    const cases: [Record<string, unknown>, string][] = [
      [{ password: 'wrong-password' }, 'The username or password was refused.'],
      [{ port: closed }, `Couldn’t reach 127.0.0.1 on port ${closed}.`],
      [{ fromAddress: 'ceo@trendlix.test' }, 'The sender address isn’t allowed for this mailbox.'],
      [{ security: 'starttls' }, 'The secure connection failed: try port 465 with SSL, or 587 with STARTTLS.'],
      [{ security: 'ssl' }, 'The secure connection failed: try port 465 with SSL, or 587 with STARTTLS.'],
      [{ username: null, password: null }, 'The server asks for a username and password: enter them.'],
    ];
    for (const [over, said] of cases) {
      const res = kept(await testWith(over).expect(200));
      expect(res.body).toEqual({ at: expect.any(String), ok: false, message: said });
    }
    expect(kept(await as('superAdmin').get('/mail-settings').expect(200)).body.lastTest).toMatchObject({ ok: false, message: cases.at(-1)![1] });
    const failed = await prisma.auditLog.findMany({ where: { entityType: 'mail_settings', action: 'send_test', diff: { path: ['sent'], equals: false } } });
    expect(failed).toHaveLength(cases.length);
    expect(failed[0].diff).toMatchObject({ sentTo: emails.superAdmin, sent: false, reason: expect.any(String) });

    // what can't be tested at all: refused before anything is sent
    expect(kept(await testWith({ host: '' }).expect(400)).body.message).toEqual(['To send a test email, enter the server.']);
    expect(kept(await testWith({ to: 'nobody' }).expect(400)).body.message).toEqual(['Write the address to send the test to in full, e.g. hr@trendlix.com.']);
  });

  it('falls back to the server’s settings while switched off, and back to the system’s once on', async () => {
    const off = kept(await as('superAdmin').put('/mail-settings', settings({ password: '', enabled: false })).expect(200)).body;
    expect(off).toMatchObject({ enabled: false, passwordSet: true, sending: { source: 'server', address: 'server@test.local' } });
    let before = { mailbox: mailbox.messages.length, fallback: fallback.messages.length };
    kept(await invite().expect(200));
    expect(mailbox.messages.length).toBe(before.mailbox);
    expect(fallback.messages.slice(before.fallback)).toEqual([expect.objectContaining({ from: 'server@test.local', to: [invitee.email], user: null })]);

    kept(await as('superAdmin').put('/mail-settings', settings({ password: '' })).expect(200));
    before = { mailbox: mailbox.messages.length, fallback: fallback.messages.length };
    kept(await invite().expect(200));
    expect(fallback.messages.length).toBe(before.fallback);
    expect(mailbox.messages.length).toBe(before.mailbox + 1);
  });

  it('a saved password sealed with another key: said on the page, the server’s settings meanwhile, and entered again', async () => {
    await prisma.mailSettings.update({ where: { id: 1 }, data: { passwordKeyId: '000000000000' } });
    mail.forget();
    const view = kept(await as('superAdmin').get('/mail-settings').expect(200)).body;
    expect(view).toMatchObject({ passwordSet: true, passwordUnreadable: true, enabled: true, missing: ['the password'], sending: { source: 'server' } });
    const before = fallback.messages.length;
    kept(await invite().expect(200));
    expect(fallback.messages.length).toBe(before + 1);
    expect(kept(await as('superAdmin').put('/mail-settings', settings({ password: '' })).expect(400)).body.message).toEqual([MAIL_PASSWORD_UNREADABLE]);
    expect(kept(await testWith({ password: '' }).expect(400)).body.message).toEqual([MAIL_PASSWORD_UNREADABLE]);

    // entered again: read with this server's key
    const again = kept(await as('superAdmin').put('/mail-settings', settings()).expect(200)).body;
    expect(again).toMatchObject({ passwordUnreadable: false, missing: [], sending: { source: 'system' } });
  });

  it('removes the saved password: switched on with a username, the server’s settings are used until one is entered', async () => {
    const removed = kept(await as('superAdmin').delete('/mail-settings/password').expect(200)).body;
    expect(removed).toMatchObject({ passwordSet: false, enabled: true, missing: ['the password'], sending: { source: 'server' } });
    const row = await prisma.mailSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(row).toMatchObject({ passwordEnc: null, passwordKeyId: null });
    const [entry] = await prisma.auditLog.findMany({ where: { entityType: 'mail_settings', action: 'remove_password' } });
    expect(entry.diff).toEqual({ password: 'changed' });
    // nothing to remove: nothing written
    kept(await as('superAdmin').delete('/mail-settings/password').expect(200));
    expect(await prisma.auditLog.count({ where: { entityType: 'mail_settings', action: 'remove_password' } })).toBe(1);
  });

  it('never has the password in any answer or audit entry; a developer’s audit log hides the mailbox and its server', async () => {
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'mail_settings' } });
    expect(audit.length).toBeGreaterThan(5);
    const page = kept(await as('superAdmin').get('/audit?entityType=mail_settings&limit=100').expect(200)).body;
    expect(page.entries.length).toBeGreaterThan(5);
    expect(page.entries[0]).toMatchObject({ entityLabel: 'Email settings', link: { href: '/organization/email', label: 'Open email settings' } });
    const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? String(x) : x));
    for (const text of [json(answers), json(audit), json(page)]) {
      expect(text).not.toContain(SMTP_PASSWORD);
      expect(text).not.toContain('wrong-password');
    }

    const developer = JSON.stringify((await as('developer').get('/audit?entityType=mail_settings&limit=100').expect(200)).body);
    for (const secret of [SMTP_PASSWORD, MAILBOX, 'jobs@trendlix.test', '127.0.0.1', 'TrendLIX HR', 'owner@trendlix.test']) expect(developer).not.toContain(secret);
  });
});
