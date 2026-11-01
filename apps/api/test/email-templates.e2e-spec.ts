import type { INestApplication } from '@nestjs/common';
import { ACCESS_IP_TOKEN, CLIENT_IP_AT_HEADER, CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATES } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Organization → Email Templates (owner, 1 November 2026: "build the mail templetes"): HR, the CEO and a Super Admin
// read every email's words; HR and a Super Admin save their own, reset to the standard and send themselves a test; the
// checks refuse words without the email's code or link, or with a field it doesn't have; the system's emails (here a
// sign-in code) go with HR's words once saved, and with the standard ones again after a reset. Email is kept in
// MailService's outbox (MAIL_TRANSPORT=memory). This file deletes the templates, accounts and codes it made.

process.env.MAIL_TRANSPORT = 'memory';

describe('Email templates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  const sessions: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => api().get(`/api${path}`).set('Cookie', sessions[who]),
    put: (path: string, body: object) => api().put(`/api${path}`).set('Cookie', sessions[who]).send(body),
    post: (path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[who]).send(body),
  });
  const signedFrom = (ip: string) => {
    const at = String(Date.now());
    return { [CLIENT_IP_HEADER]: ip, [CLIENT_IP_AT_HEADER]: at, [CLIENT_IP_SIGNATURE_HEADER]: signatureOf(process.env.WEB_KEY!, ip, at, ACCESS_IP_TOKEN) };
  };
  /** Asks for a sign-in code for the employee's account, and the email it sends. */
  const askCode = async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails.employee } });
    // a new code may be asked for a minute after the last
    await prisma.loginCode.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const before = mail.outbox.length;
    await api().post('/api/auth/email-code').set(signedFrom('198.51.100.77')).send({ email: emails.employee }).expect(200);
    const sent = mail.outbox.slice(before);
    expect(sent).toHaveLength(1);
    return sent[0];
  };
  const lastAudit = (action: string) => prisma.auditLog.findFirstOrThrow({ where: { entityType: 'email_template', action }, orderBy: { at: 'desc' } });

  const custom = { subject: 'Sign in to People: {{code}}', body: 'Hi {{name}}!\n\nYour code: {{code}} ({{minutes}} minutes).\n\nTrendLIX HR' };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    await prisma.emailTemplate.deleteMany({});
    mail.forgetTemplates();
    await prisma.accessLinkRequest.deleteMany({ where: { kind: 'login_code', ip: '198.51.100.77' } });
    for (const [who, roles] of [
      ['hr', ['hr']],
      ['ceo', ['ceo']],
      ['superAdmin', ['super_admin']],
      ['finance', ['finance']],
      ['admin', ['admin']],
      ['employee', ['employee']],
    ] as const) {
      emails[who] = await createUser(prisma, [...roles]);
      sessions[who] = await signIn(app, emails[who]);
    }
  });

  afterAll(async () => {
    await prisma.emailTemplate.deleteMany({});
    await prisma.accessLinkRequest.deleteMany({ where: { kind: 'login_code' } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
  });

  it('lists every email, with its fields and standard words, to HR, the CEO and a Super Admin only', async () => {
    const res = await as('hr').get('/email-templates').expect(200);
    expect(res.body.map((t: { key: string }) => t.key)).toEqual([...EMAIL_TEMPLATE_KEYS]);
    const code = res.body.find((t: { key: string }) => t.key === 'sign_in_code');
    expect(code).toMatchObject({ group: 'employees', label: 'Sign-in code', required: ['code'], start: EMAIL_TEMPLATES.sign_in_code.start, custom: null });
    expect(code.fields.map((f: { key: string }) => f.key)).toEqual(['name', 'code', 'minutes']);
    await as('ceo').get('/email-templates').expect(200);
    await as('superAdmin').get('/email-templates').expect(200);
    for (const who of ['finance', 'admin', 'employee']) await as(who).get('/email-templates').expect(403);
  });

  it('lets HR and a Super Admin change the words, not the CEO or anyone else', async () => {
    for (const who of ['ceo', 'finance', 'admin', 'employee']) {
      await as(who).put('/email-templates/sign_in_code', custom).expect(403);
      await as(who).post('/email-templates/sign_in_code/reset').expect(403);
      await as(who).post('/email-templates/sign_in_code/test', {}).expect(403);
    }
    expect(await prisma.emailTemplate.count()).toBe(0);
  });

  it('refuses words without the code, with a field the email doesn’t have, or for an email that doesn’t exist', async () => {
    const noCode = await as('hr').put('/email-templates/sign_in_code', { subject: 'Your code', body: 'Hello {{name}}' }).expect(400);
    expect(noCode.body.message).toEqual(['The text needs {{code}}: the email is no use without it.']);
    const unknown = await as('hr').put('/email-templates/sign_in_code', { subject: 'Hi {{job}}', body: '{{code}}' }).expect(400);
    expect(unknown.body.message).toEqual(['{{job}} isn’t one of this email’s fields: use {{name}}, {{code}}, {{minutes}}.']);
    await as('hr').put('/email-templates/sign_in_code', { subject: 'One\ntwo', body: '{{code}}' }).expect(400);
    await as('hr').put('/email-templates/no_such_email', custom).expect(404);
    expect(await prisma.emailTemplate.count()).toBe(0);
  });

  it('sends the sign-in code with HR’s words once saved, filled in, with its HTML; audited with what changed', async () => {
    const standard = await askCode();
    expect(standard.subject).toBe('Your People sign-in code');

    const res = await as('hr').put('/email-templates/sign_in_code', custom).expect(200);
    expect(res.body.custom).toMatchObject({ subject: custom.subject, body: custom.body });
    expect(res.body.custom.updatedBy.id).toBeTruthy();
    const audit = await lastAudit('update');
    expect(audit.diff).toMatchObject({ email: 'Sign-in code', key: 'sign_in_code', subject: { from: EMAIL_TEMPLATES.sign_in_code.start.subject, to: custom.subject } });

    const m = await askCode();
    const code = /Your code: (\d{3} \d{3})/.exec(m.text)![1];
    expect(m.subject).toBe(`Sign in to People: ${code}`);
    // no name on this account: "Hi !" tidied to "Hi!"
    expect(m.text).toBe(`Hi!\n\nYour code: ${code} (10 minutes).\n\nTrendLIX HR`);
    expect(m.html).toContain(`<p dir="auto">Your code: ${code} (10 minutes).</p>`);

    // the code from HR's email still signs in
    await api().post('/api/auth/email-code/sign-in').send({ email: emails.employee, code }).expect(200);
  });

  it('saving the standard words again puts the email back to standard', async () => {
    const res = await as('superAdmin').put('/email-templates/sign_in_code', EMAIL_TEMPLATES.sign_in_code.start).expect(200);
    expect(res.body.custom).toBeNull();
    expect(await prisma.emailTemplate.count()).toBe(0);
    expect((await askCode()).subject).toBe('Your People sign-in code');
  });

  it('resets to standard: the system’s words again, audited', async () => {
    await as('hr').put('/email-templates/sign_in_code', custom).expect(200);
    const res = await as('hr').post('/email-templates/sign_in_code/reset').expect(200);
    expect(res.body.custom).toBeNull();
    const audit = await lastAudit('reset_to_standard');
    expect(audit.diff).toMatchObject({ key: 'sign_in_code', subject: { from: custom.subject, to: EMAIL_TEMPLATES.sign_in_code.start.subject } });
    expect((await askCode()).subject).toBe('Your People sign-in code');
    // nothing to reset: answered as it is, nothing audited
    const count = await prisma.auditLog.count({ where: { entityType: 'email_template', action: 'reset_to_standard' } });
    await as('hr').post('/email-templates/sign_in_code/reset').expect(200);
    expect(await prisma.auditLog.count({ where: { entityType: 'email_template', action: 'reset_to_standard' } })).toBe(count);
  });

  it('sends HR a test with the words on screen, unsaved, filled with the sample values; audited', async () => {
    const before = mail.outbox.length;
    const words = { subject: 'Your offer for {{position}}', body: 'Dear {{name}},\n\nOpen your offer: {{link}}' };
    const res = await as('hr').post('/email-templates/job_offer/test', words).expect(200);
    expect(res.body).toMatchObject({ ok: true, to: emails.hr });
    const [m] = mail.outbox.slice(before);
    expect(m.to).toBe(emails.hr);
    expect(m.subject).toBe(`[Test] Your offer for ${EMAIL_TEMPLATES.job_offer.fields.find((f) => f.key === 'position')!.sample}`);
    expect(m.text).toMatch(/^Dear Mona Ali,\n\nOpen your offer: https:\/\//);
    // nothing saved by a test
    expect(await prisma.emailTemplate.count()).toBe(0);
    expect((await lastAudit('send_test')).diff).toMatchObject({ key: 'job_offer', sentTo: emails.hr, sent: true });

    // the standard words when none are sent; refused words aren't sent
    await as('hr').post('/email-templates/interview_invite/test', {}).expect(200);
    await as('hr').post('/email-templates/job_offer/test', { subject: 'Offer', body: 'No link' }).expect(400);
  });
});
