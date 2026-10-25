import type { INestApplication } from '@nestjs/common';
import {
  CLIENT_IP_AT_HEADER,
  CLIENT_IP_HEADER,
  CLIENT_IP_SIGNATURE_HEADER,
  careersIpToken,
  DEVELOPER_NO_FILES,
  WHATSAPP_LOG_STAFF_ONLY,
  WHATSAPP_OPT_IN_OWN,
  WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  zonedMoment,
  type MyWhatsAppView,
  type Role,
  type VacancyView,
  type WhatsAppMessagePage,
  type WhatsAppPersonView,
  type WhatsAppSettingsView,
  type WhatsAppTemplatesResult,
  type WhatsAppTestView,
} from '@trendlix/shared';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { signatureOf } from '../src/attendance/signed-ip.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { NoticesService } from '../src/notifications/notices.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { PROBLEMS } from '../src/whatsapp/graph.js';
import { WhatsAppHttp } from '../src/whatsapp/whatsapp-http.js';
import { WhatsAppSenderService } from '../src/whatsapp/whatsapp-sender.service.js';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service.js';
import { fakeWhatsAppGraph, type FakeGraph } from './fake-whatsapp.js';
import { createApp, createUser, signIn } from './helpers.js';

// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; asked, "Employees and
// candidates", "Approvals waiting, Request decisions, Check-in reminders, Interviews", "Directly to Meta"). Meta's Graph
// API is a fake in WhatsAppHttp's place (fake-whatsapp.ts): nothing is ever sent to Meta. A Super Admin saves the
// settings (the token and the app secret never returned), sends a test message, submits the templates and syncs their
// statuses; an employee opts in (never HR for them, never a Super Admin viewing as them); an opted-in employee gets a
// leave decision on WhatsApp and one not opted in none; an approver gets approvals waiting, several in 10 minutes as a
// digest; a candidate who ticked it gets "application received", the interview's invitation, its change and
// cancellation, and the reminder the day before; quiet hours hold a message to 08:00 and drop a reminder; Meta's webhook
// verifies, refuses a bad signature, keeps the statuses and answers STOP; a failure is tried again, then fails with a
// reason; HR's log hides a C-level person's; developers are refused; every write is audited, the secrets only as
// "changed". Email is kept in MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes
// what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `wa${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const APP_SECRET = `9f8e7d6c5b4a${RUN}`.replace(/[^A-Za-z0-9]/g, '').padEnd(32, '0').slice(0, 32);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

/** A distinct mobile a person, kept as the system keeps phones. */
const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 11;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2011${String(h % 100_000_000).padStart(8, '0')}`;
};
const digits = (mobile: string) => mobile.replace(/\D/g, '');

describe('WhatsApp notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fake: FakeGraph;
  let whatsapp: WhatsAppService;
  let sender: WhatsAppSenderService;
  let notifications: NotificationsService;
  let notices: NoticesService;
  let emailDomainBefore: string | null;
  let deptId: string;
  let jobTitleId: string;
  let typeId: string;
  let vacancy: VacancyView;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const vacancyIds: string[] = [];
  /** Every answer this file received, to search for the token and the app secret. */
  const answers: unknown[] = [];
  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  const as = (who: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', sessions[who])),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', sessions[who]).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', sessions[who]).send(body)),
  });
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const messagesTo = (key: string) => prisma.whatsAppMessage.findMany({ where: { userId: users[key] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const sentTo = (mobile: string) => fake.sent.filter((m) => m.to === digits(mobile));
  const round = (now = new Date()) => sender.runOnce(now);
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
  const settingsBody = (extra: object = {}) => ({
    phoneNumberId: fake.phoneNumberId,
    businessAccountId: fake.wabaId,
    displayPhone: '+20 100 000 7777',
    enabled: true,
    quietHours: false,
    ...extra,
  });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** A profile with a sign-in account, an employment and a mobile. */
  async function person(key: string, en: string, ar: string, employment: Record<string, unknown> = {}, by = 'hr') {
    const email = await createUser(prisma, ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
    const res = await api().post('/api/employees').set('Cookie', sessions.hr).send({ fullNameEn: `${en} ${RUN}`, fullNameAr: ar, workEmail: email }).expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', sessions[by]).send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, ...employment }).expect(201);
    await prisma.employee.update({ where: { id: res.body.id }, data: { mobile: mobileOf(key) } });
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: res.body.id } });
  }

  /** An application from the careers page, as the website sends it (its address signed with the tests' WEB_KEY). */
  function apply(slug: string, fields: Record<string, string>) {
    const ip = `198.51.100.${(Object.keys(fields).length * 7 + fields.fullName.length) % 250}`;
    const at = String(Date.now());
    let req = api()
      .post(`/api/public/careers/${slug}/apply`)
      .set(CLIENT_IP_HEADER, ip)
      .set(CLIENT_IP_AT_HEADER, at)
      .set(CLIENT_IP_SIGNATURE_HEADER, signatureOf(process.env.WEB_KEY!, ip, at, careersIpToken(slug)));
    // a showreel of their own: a video editor's form asks for one (owner, 25 October 2026: "Portfolio per position")
    const reel = `https://vimeo.com/${Array.from({ length: (fields.email ?? fields.fullName).length }, (_, i) => (fields.email ?? fields.fullName).charCodeAt(i)).reduce((h, c) => (Math.imul(h, 31) + c) >>> 0, 7)}`;
    for (const [k, v] of Object.entries({ portfolioLinks: JSON.stringify([reel]), ...fields, ip })) req = req.field(k, v);
    return req.attach('cv', PDF, 'cv.pdf');
  }

  /** Meta's webhook call, signed with the app secret (or another). */
  const webhook = (payload: object, secret = APP_SECRET) => {
    const raw = JSON.stringify(payload);
    return api()
      .post('/api/public/whatsapp/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
      .send(raw);
  };
  const call = (value: object) => ({ object: 'whatsapp_business_account', entry: [{ id: fake.wabaId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: fake.phoneNumberId }, ...value } }] }] });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    fake = fakeWhatsAppGraph(RUN);
    app.get(WhatsAppHttp).fetch = fake.fetch;
    whatsapp = app.get(WhatsAppService);
    sender = app.get(WhatsAppSenderService);
    notifications = app.get(NotificationsService);
    notices = app.get(NoticesService);
    // a run before this one left nothing; this file's own rows are deleted at the end
    await prisma.whatsAppMessage.deleteMany({});
    await prisma.whatsAppOptIn.deleteMany({});
    await prisma.whatsAppTemplate.deleteMany({});
    await prisma.whatsAppSettings.deleteMany({});
    whatsapp.forget();
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('hrSuper', ['hr', 'super_admin']);
    await account('ceo', ['ceo']);
    await account('admin', ['admin']);
    await account('developer', ['developer']);
    emailDomainBefore = (await api().get('/api/company').set('Cookie', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    deptId = (await prisma.department.create({ data: { nameEn: `WhatsApp ${RUN}` }, select: { id: true } })).id;
    await person('mona', 'Mona Manager', 'منى مديرة');
    await person('rami', 'Rami Report', 'رامي موظف', { managerId: ids.mona });
    await person('noah', 'Noah Nobody', 'نوح', { managerId: ids.mona });
    await person('ivy', 'Ivy Interviewer', 'آيفي');
    const g9 = await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true } });
    await person('cleo', 'Cleo Chief', 'كليو', { gradeId: g9.id }, 'hrSuper');
    typeId = (await prisma.leaveType.findUniqueOrThrow({ where: { key: 'casual' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId: deptId, titleEn: `Video Editor ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    const gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    const made = await as('hr').post('/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, gradeId, salaryMin: 15000, salaryMax: 25000 }).expect(201);
    vacancyIds.push(made.body.id);
    await as('hr').post(`/recruitment/vacancies/${made.body.id}/submit`).expect(200);
    vacancy = (await as('ceo').post(`/recruitment/vacancies/${made.body.id}/approve`).expect(200)).body as VacancyView;
  });

  afterAll(async () => {
    await prisma.whatsAppMessage.deleteMany({});
    await prisma.whatsAppOptIn.deleteMany({});
    await prisma.whatsAppTemplate.deleteMany({});
    await prisma.whatsAppSettings.deleteMany({});
    for (const id of vacancyIds) {
      await prisma.jobApplication.deleteMany({ where: { vacancyId: id } });
      await prisma.vacancy.deleteMany({ where: { id } });
    }
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people }, managerId: { not: null } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the settings', () => {
    it('are a Super Admin’s only: refused to HR, the CEO, an Admin; a developer before anything runs', async () => {
      for (const who of ['hr', 'ceo', 'admin']) {
        expect((await as(who).get('/whatsapp/settings').expect(403)).body.message, who).toBe(WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY);
        expect((await as(who).put('/whatsapp/settings', settingsBody())).status, who).toBe(403);
        expect((await as(who).post('/whatsapp/templates/submit')).status, who).toBe(403);
      }
      expect((await as('developer').get('/whatsapp/settings').expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
      expect((await as('developer').put('/whatsapp/settings', settingsBody())).status).toBe(403);
      expect(await prisma.whatsAppSettings.count()).toBe(0);
    });

    it('start empty, with a verify token made by the system and the webhook’s address', async () => {
      const v = (await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView;
      // quiet hours on from the start (the brief: "no WhatsApp between 22:00 and 08:00 Cairo")
      expect(v).toMatchObject({ phoneNumberId: null, tokenSet: false, appSecretSet: false, enabled: false, quietHours: { from: '22:00', to: '08:00' }, sending: { on: false } });
      expect(v.verifyToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(v.webhookUrl).toMatch(/\/whatsapp\/webhook$/);
      expect(v.templates).toHaveLength(WHATSAPP_TEMPLATE_KEYS.length * 2);
      expect(new Set(v.templates.map((t) => t.status))).toEqual(new Set(['not_submitted']));
      // the same token on the next look
      expect(((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).verifyToken).toBe(v.verifyToken);
    });

    it('save with the token and the app secret sealed, never returned; an empty box keeps them; audited as “changed”', async () => {
      expect(said(await as('superAdmin').put('/whatsapp/settings', settingsBody()).expect(400))).toEqual([expect.stringContaining('the access token and the app secret')]);
      expect(said(await as('superAdmin').put('/whatsapp/settings', settingsBody({ phoneNumberId: 'abc', quietHours: true, quietFrom: '22:00', quietTo: '22:00', enabled: false })).expect(400))).toEqual([
        expect.stringContaining('phone number ID'),
        'Quiet hours start and end at different times.',
      ]);
      const saved = (await as('superAdmin').put('/whatsapp/settings', settingsBody({ accessToken: fake.token, appSecret: APP_SECRET })).expect(200)).body as WhatsAppSettingsView;
      expect(saved).toMatchObject({ phoneNumberId: fake.phoneNumberId, businessAccountId: fake.wabaId, displayPhone: '+201000007777', tokenSet: true, appSecretSet: true, tokenUnreadable: false, enabled: true, missing: [] });
      // switched on, but no template is approved yet
      expect(saved.sending).toEqual({ on: false, why: 'No template is approved by Meta yet: submit them, then sync their status.' });
      const row = await prisma.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(row.accessTokenEnc).toMatch(/^v1:/);
      expect(`${row.accessTokenEnc}${row.appSecretEnc}`).not.toContain(fake.token);
      expect(`${row.accessTokenEnc}${row.appSecretEnc}`).not.toContain(APP_SECRET);
      // again without them: kept
      const again = (await as('superAdmin').put('/whatsapp/settings', settingsBody({ displayPhone: '+20 100 000 8888' })).expect(200)).body as WhatsAppSettingsView;
      expect(again).toMatchObject({ tokenSet: true, appSecretSet: true, displayPhone: '+201000008888' });
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'whatsapp_settings', action: 'update' }, orderBy: { id: 'asc' } });
      expect(audit[0].diff).toMatchObject({ accessToken: 'changed', appSecret: 'changed', enabled: { from: false, to: true }, quietFrom: { from: '22:00', to: null } });
      expect(audit[1].diff).toEqual({ displayPhone: { from: '+201000007777', to: '+201000008888' } });
      // a new verify token, audited
      const before = again.verifyToken;
      const renewed = (await as('superAdmin').post('/whatsapp/settings/verify-token').expect(200)).body as WhatsAppSettingsView;
      expect(renewed.verifyToken).not.toBe(before);
      expect(await prisma.auditLog.count({ where: { entityType: 'whatsapp_settings', action: 'new_verify_token' } })).toBe(1);
    });

    it('send a test message: Meta’s sample until ours is approved; Meta’s refusal in plain words', async () => {
      const mine = mobileOf('superAdmin');
      const ok = (await as('superAdmin').post('/whatsapp/settings/test', { to: mine }).expect(200)).body as WhatsAppTestView;
      expect(ok).toMatchObject({ ok: true, message: expect.stringContaining('hello_world') });
      expect(sentTo(mine)).toEqual([expect.objectContaining({ type: 'template', template: 'hello_world', language: 'en_US', body: [] })]);
      fake.refuse(400, { error: { message: '(#131026) Message undeliverable', code: 131026, type: 'OAuthException' } });
      const refused = (await as('superAdmin').post('/whatsapp/settings/test', { to: '+20 100 999 0000' }).expect(200)).body as WhatsAppTestView;
      expect(refused).toMatchObject({ ok: false, message: PROBLEMS.recipient });
      expect(((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).lastTest).toMatchObject({ ok: false, message: PROBLEMS.recipient });
      expect(said(await as('superAdmin').post('/whatsapp/settings/test', { to: '123' }).expect(400))).toEqual([expect.stringContaining('country code')]);
      // in the log, and the audit log
      expect(await prisma.whatsAppMessage.count({ where: { template: 'test_message' } })).toBe(2);
      expect((await prisma.auditLog.findMany({ where: { entityType: 'whatsapp_settings', action: 'send_test_message' } })).map((a) => (a.diff as { sent: boolean }).sent).sort((x, y) => Number(x) - Number(y))).toEqual([false, true]);
    });

    it('submit the templates (Utility, both languages, the button to the website), then sync their statuses', async () => {
      const result = (await as('superAdmin').post('/whatsapp/templates/submit').expect(200)).body as WhatsAppTemplatesResult;
      expect(result.ok).toBe(true);
      expect(fake.templates.size).toBe(WHATSAPP_TEMPLATE_KEYS.length * 2);
      for (const t of fake.templates.values()) {
        expect(t.category).toBe('UTILITY');
        expect((t.components as { type: string }[]).map((c) => c.type)).toContain('FOOTER');
      }
      const approval = fake.templates.get('people_approval_waiting:en')!;
      expect(approval.components).toContainEqual({ type: 'BUTTONS', buttons: [expect.objectContaining({ type: 'URL', url: expect.stringMatching(/^https:\/\/.+\/\{\{1\}\}$/) })] });
      expect(new Set(result.templates.map((t) => t.status))).toEqual(new Set(['pending']));

      // Meta approves all but one, which it rejects; the sync reads every page (20 a page)
      fake.review('APPROVED');
      fake.review('REJECTED', { name: 'people_cv_received', language: 'ar' }, 'INVALID_FORMAT');
      const synced = (await as('superAdmin').post('/whatsapp/templates/sync').expect(200)).body as WhatsAppTemplatesResult;
      expect(synced.message).toBe(`Synced with Meta: ${WHATSAPP_TEMPLATE_KEYS.length * 2 - 1} approved, 0 pending, 1 rejected.`);
      expect(synced.templates.find((t) => t.name === 'people_cv_received' && t.language === 'ar')).toMatchObject({ status: 'rejected', reason: 'Meta found its format invalid.' });
      expect(fake.calls.filter((c) => c.method === 'GET' && c.url.includes('message_templates')).length).toBeGreaterThanOrEqual(2);

      // submitting again sends only the rejected one (Meta says it exists: its status read again)
      const calls = fake.calls.length;
      await as('superAdmin').post('/whatsapp/templates/submit').expect(200);
      expect(fake.calls.slice(calls).filter((c) => c.method === 'POST').length).toBe(1);
      fake.review('APPROVED', { name: 'people_cv_received', language: 'ar' });
      await as('superAdmin').post('/whatsapp/templates/sync').expect(200);
      const now = (await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView;
      expect(now.sending).toEqual({ on: true, why: null });
      expect(now.templatesSyncedAt).toEqual(expect.any(String));

      // the test with our own template now
      const mine = mobileOf('superAdmin');
      await as('superAdmin').post('/whatsapp/settings/test', { to: mine }).expect(200);
      expect(sentTo(mine).at(-1)).toMatchObject({ template: 'people_test_message', language: 'en', body: [expect.any(String)] });
      expect((await prisma.auditLog.findMany({ where: { entityType: 'whatsapp_settings', action: { in: ['submit_templates', 'sync_templates'] } } })).length).toBe(4);
    });
  });

  describe('an employee’s own choice', () => {
    it('is off until they turn it on at their mobile, every group on; Approvals waiting only for those who approve', async () => {
      const rami = (await as('rami').get('/me/whatsapp').expect(200)).body as MyWhatsAppView;
      expect(rami).toEqual({
        available: true,
        mobile: mobileOf('rami'),
        on: false,
        language: 'en',
        groups: { approvals: true, decisions: true, check_in: true, interviews: true },
        approver: false,
        optedInAt: null,
        mobileChanged: false,
        stoppedAt: null,
        stoppedBy: null,
      });
      expect(((await as('mona').get('/me/whatsapp').expect(200)).body as MyWhatsAppView).approver).toBe(true);
      expect(((await as('hr').get('/me/whatsapp').expect(200)).body as MyWhatsAppView).approver).toBe(true);
      for (const key of ['mona', 'ivy', 'cleo']) {
        expect(((await as(key).put('/me/whatsapp', { on: true, language: 'en' }).expect(200)).body as MyWhatsAppView).on, key).toBe(true);
      }
      const on = (await as('rami').put('/me/whatsapp', { on: true, language: 'ar', groups: { check_in: false } }).expect(200)).body as MyWhatsAppView;
      expect(on).toMatchObject({ on: true, language: 'ar', groups: { approvals: true, decisions: true, check_in: false, interviews: true }, optedInAt: expect.any(String) });
      expect(await prisma.auditLog.count({ where: { entityType: 'whatsapp_opt_in', action: 'whatsapp_opt_in', entityId: users.rami } })).toBe(1);
      // the same again: nothing changes, nothing audited; another group: audited as the choices
      await as('rami').put('/me/whatsapp', { on: true, language: 'ar', groups: { check_in: false } }).expect(200);
      expect(await prisma.auditLog.count({ where: { entityType: 'whatsapp_opt_in', entityId: users.rami } })).toBe(1);
      await as('rami').put('/me/whatsapp', { on: true, language: 'ar', groups: { check_in: false, interviews: false } }).expect(200);
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'whatsapp_opt_in', action: 'whatsapp_choices', entityId: users.rami } })).diff).toEqual({
        language: 'ar',
        groups: { approvals: true, decisions: true, check_in: false, interviews: false },
      });
      // off, and on again: the time is the new one's
      expect(((await as('mona').put('/me/whatsapp', { on: false, language: 'en' }).expect(200)).body as MyWhatsAppView)).toMatchObject({ on: false, stoppedBy: 'self' });
      expect(((await as('mona').put('/me/whatsapp', { on: true, language: 'en' }).expect(200)).body as MyWhatsAppView)).toMatchObject({ on: true, stoppedBy: null });
      expect(await prisma.auditLog.count({ where: { entityType: 'whatsapp_opt_in', action: 'whatsapp_opt_out', entityId: users.mona } })).toBe(1);
      // without a mobile: said in words
      await prisma.employee.update({ where: { id: ids.noah }, data: { mobile: null } });
      expect(said(await as('noah').put('/me/whatsapp', { on: true, language: 'en' }).expect(400))).toEqual([expect.stringContaining('ask HR to add it')]);
      await prisma.employee.update({ where: { id: ids.noah }, data: { mobile: mobileOf('noah') } });
      await as('rami').put('/me/whatsapp', { on: true, language: 'xx' }).expect(400);
    });

    it('HR sees it, never changes it; a Super Admin viewing as them can’t turn it on for them, even acting as them', async () => {
      const seen = (await as('hr').get(`/whatsapp/people/${ids.rami}`).expect(200)).body as WhatsAppPersonView;
      expect(seen).toMatchObject({ on: true, mobile: mobileOf('rami'), language: 'ar', groups: { check_in: false, interviews: false }, optedInAt: expect.any(String), noAccount: false });
      expect(((await as('hr').get(`/whatsapp/people/${ids.noah}`).expect(200)).body as WhatsAppPersonView).on).toBe(false);
      // a C-level person's: not found for HR, seen by the CEO
      await as('hr').get(`/whatsapp/people/${ids.cleo}`).expect(404);
      expect(((await as('ceo').get(`/whatsapp/people/${ids.cleo}`).expect(200)).body as WhatsAppPersonView).on).toBe(true);
      expect((await as('developer').get(`/whatsapp/people/${ids.rami}`).expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
      await as('rami').get(`/whatsapp/people/${ids.mona}`).expect(403);

      const cookieOf = (res: request.Response) => ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ps_session='))!.split(';')[0];
      const viewing = cookieOf(await api().post('/api/auth/view-as').set('Cookie', sessions.superAdmin).send({ userId: users.noah }).expect(200));
      expect(((await api().get('/api/me/whatsapp').set('Cookie', viewing).expect(200)).body as MyWhatsAppView).on).toBe(false);
      await api().put('/api/me/whatsapp').set('Cookie', viewing).send({ on: true, language: 'en' }).expect(403);
      const acting = cookieOf(await api().post('/api/auth/view-as/act').set('Cookie', viewing).send({ act: true }).expect(200));
      expect((await api().put('/api/me/whatsapp').set('Cookie', acting).send({ on: true, language: 'en' }).expect(403)).body.message).toBe(WHATSAPP_OPT_IN_OWN);
      await api().post('/api/auth/view-as/stop').set('Cookie', acting).expect(200);
      expect(await prisma.whatsAppOptIn.count({ where: { userId: users.noah } })).toBe(0);
    });
  });

  describe('what employees get', () => {
    let leaveId: string;
    let start: string;

    it('an approver gets the leave waiting; the opted-in requester gets the decision, in Arabic; one not opted in gets none', async () => {
      start = addDays(TODAY, 40);
      leaveId = (
        await prisma.leaveRequest.create({
          data: { employeeId: ids.rami, employmentId: (await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.rami } })).id, typeId, startDate: toDateOnly(start), endDate: toDateOnly(addDays(start, 1)), days: 2, status: 'with_manager', managerId: ids.mona, approverRole: 'direct_manager', createdById: users.rami },
          select: { id: true },
        })
      ).id;
      await notices.leave(leaveId, 'sent');
      const [waiting] = await messagesTo('mona');
      const span = `${start.slice(8, 10)}/${start.slice(5, 7)}/${start.slice(0, 4)}–${addDays(start, 1).slice(8, 10)}/${addDays(start, 1).slice(5, 7)}/${addDays(start, 1).slice(0, 4)}`;
      expect(waiting).toMatchObject({ template: 'approval_waiting', language: 'en', groupKey: 'approvals', status: 'queued', mobile: mobileOf('mona'), kind: 'leave_waiting', reference: 'Leave', confidential: false });
      expect(waiting.variables).toEqual({ body: ['Mona', 'a leave request', `Rami Report ${RUN}, ${span}`], button: `leave/${leaveId}` });

      await as('mona').post(`/leave/requests/${leaveId}/decide`, { decision: 'approve' }).expect(200);
      // HR's step: HR didn't opt in, so nothing on WhatsApp; the bell as ever
      expect(await messagesTo('hr')).toEqual([]);
      expect(await prisma.notification.count({ where: { userId: users.hr, kind: 'leave_waiting' } })).toBe(1);
      await as('hr').post(`/leave/requests/${leaveId}/decide`, { decision: 'reject', comment: 'Invented: the team is away' }).expect(200);
      const [decided] = await messagesTo('rami');
      expect(decided).toMatchObject({ template: 'request_update', language: 'ar', groupKey: 'decisions', kind: 'leave_decided' });
      expect((decided.variables as { body: string[] }).body).toEqual(['رامي', 'طلب الإجازة الخاص بك', expect.stringMatching(/^من [٠-٩/]+ إلى [٠-٩/]+$/), 'تم الرفض']);
      // never the comment
      expect(JSON.stringify(decided.variables)).not.toContain('Invented');

      // Noah didn't opt in: his leave decided goes to the bell only
      const noahs = await prisma.leaveRequest.create({
        data: { employeeId: ids.noah, employmentId: (await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.noah } })).id, typeId, startDate: toDateOnly(start), endDate: toDateOnly(start), days: 1, status: 'approved', createdById: users.noah },
        select: { id: true },
      });
      await notices.leave(noahs.id, 'decided');
      expect(await prisma.notification.count({ where: { userId: users.noah, kind: 'leave_decided' } })).toBe(1);
      expect(await messagesTo('noah')).toEqual([]);

      // the round sends them, each with its button into the system
      const r = await round();
      expect(r).toMatchObject({ sent: 2, failed: 0 });
      expect(sentTo(mobileOf('mona'))).toEqual([{ to: digits(mobileOf('mona')), type: 'template', template: 'people_approval_waiting', language: 'en', body: ['Mona', 'a leave request', `Rami Report ${RUN}, ${span}`], button: `leave/${leaveId}`, text: null, wamid: expect.any(String) }]);
      expect(sentTo(mobileOf('rami'))).toEqual([expect.objectContaining({ template: 'people_request_update', language: 'ar' })]);
      expect((await messagesTo('rami'))[0]).toMatchObject({ status: 'sent', wamid: expect.stringMatching(/^wamid\./), attempts: 1, sentAt: expect.any(Date) });
    });

    it('a C-level person’s decision goes to them, kept marked so HR never sees it', async () => {
      const cleos = await prisma.leaveRequest.create({
        data: { employeeId: ids.cleo, employmentId: (await prisma.employment.findFirstOrThrow({ where: { employeeId: ids.cleo } })).id, typeId, startDate: toDateOnly(start), endDate: toDateOnly(start), days: 1, status: 'approved', createdById: users.cleo },
        select: { id: true },
      });
      await notices.leave(cleos.id, 'decided');
      expect(await messagesTo('cleo')).toEqual([expect.objectContaining({ template: 'request_update', confidential: true })]);
      await round();
    });

    it('more than 3 approvals within 10 minutes: the first 3 one by one, the rest as one digest when the 10 minutes end', async () => {
      await prisma.whatsAppMessage.deleteMany({ where: { userId: users.mona } });
      for (let i = 1; i <= 5; i++) {
        await notifications.notify([users.mona], {
          kind: 'wfh_waiting',
          title: 'A work from home request is waiting for you',
          body: `Rami Report ${RUN}, day ${i}`,
          link: `/attendance/wfh/${i}`,
          whatsapp: { facts: { template: 'approval_waiting', what: 'wfh', who: { en: `Rami Report ${RUN}` }, span: { from: start, to: start } }, about: ids.rami },
        });
      }
      const queued = await messagesTo('mona');
      expect(queued.map((m) => m.template)).toEqual(['approval_waiting', 'approval_waiting', 'approval_waiting', 'approvals_digest']);
      const digest = queued[3];
      expect(digest.variables).toEqual({ body: ['Mona', '2'], button: 'notifications', count: 2 });
      expect(digest.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
      const sent = fake.sent.length;
      await round();
      expect(fake.sent.slice(sent).map((m) => m.template)).toEqual(['people_approval_waiting', 'people_approval_waiting', 'people_approval_waiting']);
      await round(later(11));
      expect(fake.sent.at(-1)).toMatchObject({ template: 'people_approvals_digest', body: ['Mona', '2'], button: 'notifications' });
    });

    it('a check-in reminder at most once a day; none for one who turned check-in reminders off', async () => {
      const remind = (key: string) =>
        notifications.remind(users[key], { kind: 'check_in_reminder', title: 'You haven’t checked in', body: 'Your shift started at 9:00 AM. Check in now.', link: '/my-attendance', whatsapp: { facts: { template: 'check_in_reminder', shiftStart: '09:00' } } }, { tag: 'check_in_reminder' });
      await remind('mona');
      await remind('mona');
      await remind('rami');
      expect((await messagesTo('mona')).filter((m) => m.template === 'check_in_reminder')).toHaveLength(1);
      // Rami turned "Check-in reminders" off
      expect((await messagesTo('rami')).filter((m) => m.template === 'check_in_reminder')).toEqual([]);
      const reminder = (await messagesTo('mona')).find((m) => m.template === 'check_in_reminder')!;
      expect(reminder.variables).toEqual({ body: ['Mona', '9:00 AM'], button: 'my-attendance' });
      expect(reminder.sendBefore!.getTime() - reminder.createdAt.getTime()).toBe(30 * 60_000);
      await round();
    });
  });

  describe('what candidates get', () => {
    let applicationId: string;
    let interviewId: string;
    const sara = mobileOf('sara');

    it('“application received” when they ticked it on the careers form; nothing when they didn’t', async () => {
      await apply(vacancy.slug, { fullName: `Sara Applicant ${RUN}`, email: `sara.${RUN}@mail.test`, mobile: sara, yearsExperience: '4', consent: 'true', whatsapp: 'true' }).expect(201);
      await apply(vacancy.slug, { fullName: `Adam Untick ${RUN}`, email: `adam.${RUN}@mail.test`, mobile: mobileOf('adam'), yearsExperience: '3', consent: 'true' }).expect(201);
      const a = await prisma.jobApplication.findFirstOrThrow({ where: { email: `sara.${RUN}@mail.test` }, select: { id: true, number: true, whatsappOptInAt: true, whatsappLanguage: true, candidate: { select: { whatsappOptInAt: true } } } });
      applicationId = a.id;
      expect(a).toMatchObject({ whatsappOptInAt: expect.any(Date), whatsappLanguage: 'en', candidate: { whatsappOptInAt: expect.any(Date) } });
      expect((await prisma.jobApplication.findFirstOrThrow({ where: { email: `adam.${RUN}@mail.test` } })).whatsappOptInAt).toBeNull();
      expect(await prisma.whatsAppMessage.findMany({ where: { applicationId }, select: { template: true, reference: true, mobile: true } })).toEqual([{ template: 'application_received', reference: a.number, mobile: sara }]);
      expect(await prisma.whatsAppMessage.count({ where: { mobile: mobileOf('adam') } })).toBe(0);
      await round();
      expect(sentTo(sara)).toEqual([expect.objectContaining({ template: 'people_application_received', body: ['Sara', vacancy.title, expect.any(String), a.number], button: null })]);
    });

    it('the interview’s invitation (and the interviewer’s), its change, and the reminder the day before', async () => {
      const saved = await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, { date: addDays(TODAY, 7), time: '10:30', minutes: 45, kind: 'in_person', interviewerIds: [ids.ivy], note: 'Bring your reel.' }).expect(201);
      interviewId = saved.body.interview.id;
      await round();
      expect(sentTo(sara).at(-1)).toMatchObject({ template: 'people_interview_invitation', body: ['Sara', vacancy.title, expect.any(String), expect.stringMatching(/2026|2027/), '10:30 AM', expect.stringMatching(/^In person: /)] });
      expect(sentTo(mobileOf('ivy')).at(-1)).toMatchObject({ template: 'people_interview_panel', body: ['Ivy', 'scheduled', `Sara Applicant ${RUN}`, vacancy.title, expect.stringContaining('at 10:30 AM')], button: `recruitment/applicants/${applicationId}` });
      // never the note
      expect(JSON.stringify(fake.sent)).not.toContain('Bring your reel');

      // moved: the change, and the reminder cleared for the new day
      await as('hr').put(`/recruitment/interviews/${interviewId}`, { date: addDays(TODAY, 8), time: '13:00', minutes: 45, kind: 'in_person', interviewerIds: [ids.ivy] }).expect(200);
      await round();
      expect(sentTo(sara).at(-1)).toMatchObject({ template: 'people_interview_updated', body: expect.arrayContaining(['1:00 PM']) });
      expect(sentTo(mobileOf('ivy')).at(-1)).toMatchObject({ template: 'people_interview_panel', body: expect.arrayContaining(['changed']) });

      // the day before, from 10:00 Cairo: the reminder, once
      const dayBefore = addDays(TODAY, 7);
      expect((await round(new Date(zonedMoment(dayBefore, '09:30'))))!.reminders).toBe(0);
      const r = await round(new Date(zonedMoment(dayBefore, '10:30')));
      expect(r!.reminders).toBe(1);
      expect(sentTo(sara).at(-1)).toMatchObject({ template: 'people_interview_reminder', body: ['Sara', vacancy.title, expect.any(String), '1:00 PM', expect.stringMatching(/^In person: /)] });
      expect((await round(new Date(zonedMoment(dayBefore, '11:30'))))!.reminders).toBe(0);
      expect((await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } })).whatsappRemindedAt).toEqual(expect.any(Date));
    });

    it('the cancellation; then none after they reply STOP (توقف), answered once in Arabic', async () => {
      await as('hr').post(`/recruitment/interviews/${interviewId}/cancel`, { reason: 'Invented: the role is on hold' }).expect(200);
      await round();
      expect(sentTo(sara).at(-1)).toMatchObject({ template: 'people_interview_cancelled' });
      expect(JSON.stringify(sentTo(sara).at(-1))).not.toContain('Invented');

      await webhook(call({ contacts: [{ wa_id: digits(sara) }], messages: [{ from: digits(sara), id: `wamid.in.${RUN}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'توقف' } }] })).expect(200);
      expect(await prisma.jobApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { whatsappStoppedAt: true } })).toEqual({ whatsappStoppedAt: expect.any(Date) });
      await round();
      expect(sentTo(sara).at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('لن تصلك رسائل واتساب') });
      // a new interview: email as ever, never WhatsApp
      const count = sentTo(sara).length;
      await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, { date: addDays(TODAY, 9), time: '11:00', minutes: 30, kind: 'phone', interviewerIds: [ids.ivy] }).expect(201);
      await round();
      expect(sentTo(sara)).toHaveLength(count);
      expect(await prisma.auditLog.count({ where: { entityType: 'whatsapp_opt_in', action: 'whatsapp_stop' } })).toBe(1);
    });
  });

  describe('quiet hours', () => {
    beforeAll(async () => {
      await as('superAdmin').put('/whatsapp/settings', settingsBody({ quietHours: true, quietFrom: '22:00', quietTo: '08:00' })).expect(200);
    });
    afterAll(async () => {
      await as('superAdmin').put('/whatsapp/settings', settingsBody()).expect(200);
    });

    it('hold a message to 08:00 Cairo; a check-in reminder in them is dropped', async () => {
      const night = new Date(zonedMoment(TODAY, '23:00'));
      const morning = new Date(zonedMoment(addDays(TODAY, 1), '08:00'));
      await prisma.whatsAppMessage.deleteMany({ where: { userId: users.mona } });
      expect(await whatsapp.fromNotification([users.mona], { kind: 'payslip_issued', link: '/app/payslips/line-1', whatsapp: { facts: { template: 'payslip_ready', month: '2026-10' } } }, night)).toBe(1);
      expect(await whatsapp.fromNotification([users.mona], { kind: 'check_in_reminder', link: '/my-attendance', whatsapp: { facts: { template: 'check_in_reminder', shiftStart: '22:30' } } }, night)).toBe(0);
      const [held] = await messagesTo('mona');
      expect(held).toMatchObject({ template: 'payslip_ready', status: 'queued', nextAttemptAt: morning });
      const sent = fake.sent.length;
      await round(new Date(zonedMoment(TODAY, '23:30')));
      await round(new Date(morning.getTime() - 60_000));
      expect(fake.sent.length).toBe(sent);
      await round(morning);
      expect(fake.sent.at(-1)).toMatchObject({ template: 'people_payslip_ready', body: ['Mona', 'October 2026'], button: 'app/payslips/line-1' });
    });
  });

  describe('Meta’s webhook', () => {
    it('verifies with the verify token, answering the challenge; refuses another token', async () => {
      const token = ((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).verifyToken;
      const ok = await api().get('/api/public/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' }).expect(200);
      expect(ok.text).toBe('1158201444');
      expect(ok.headers['content-type']).toContain('text/plain');
      await api().get('/api/public/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'not-the-token', 'hub.challenge': '1' }).expect(403);
      await api().get('/api/public/whatsapp/webhook').query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': token, 'hub.challenge': '1' }).expect(403);
      expect(((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).webhook.verifiedAt).toEqual(expect.any(String));
    });

    it('refuses a call without a valid signature, reading nothing in it', async () => {
      const [decided] = await messagesTo('rami');
      const payload = call({ statuses: [{ id: decided.wamid, status: 'read', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: digits(mobileOf('rami')) }] });
      await webhook(payload, 'another-secret-entirely').expect(401);
      await api().post('/api/public/whatsapp/webhook').set('content-type', 'application/json').send(JSON.stringify(payload)).expect(401);
      expect((await messagesTo('rami'))[0].status).toBe('sent');
    });

    it('keeps the statuses, never going back, and a failure with why', async () => {
      const [decided] = await messagesTo('rami');
      const ts = String(Math.floor(Date.now() / 1000));
      const status = (id: string | null, s: string, extra: object = {}) => ({ id, status: s, timestamp: ts, recipient_id: '20', ...extra });
      expect((await webhook(call({ statuses: [status(decided.wamid, 'delivered')] })).expect(200)).body).toEqual({ statuses: 1, stops: 0 });
      await webhook(call({ statuses: [status(decided.wamid, 'read')] })).expect(200);
      // a late "delivered" after "read": stays read
      expect((await webhook(call({ statuses: [status(decided.wamid, 'delivered')] })).expect(200)).body).toEqual({ statuses: 0, stops: 0 });
      expect((await messagesTo('rami'))[0]).toMatchObject({ status: 'read', deliveredAt: expect.any(Date), readAt: expect.any(Date) });
      // one that failed at Meta after it was accepted
      const cleos = (await messagesTo('cleo'))[0];
      await webhook(call({ statuses: [status(cleos.wamid, 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] })] })).expect(200);
      expect((await messagesTo('cleo'))[0]).toMatchObject({ status: 'failed', error: PROBLEMS.recipient, errorCode: 131026 });
      // not ours, and other fields: left aside
      await webhook(call({ statuses: [status('wamid.not-ours', 'read')] })).expect(200);
      await webhook({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED' } }] }] }).expect(200);
      expect(((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).webhook.lastEventAt).toEqual(expect.any(String));
    });

    it('STOP turns the number off, cancels what waits for it, and is answered once; anything else gets no answer', async () => {
      await whatsapp.fromNotification([users.rami], { kind: 'payslip_issued', link: '/app/payslips/2', whatsapp: { facts: { template: 'payslip_ready', month: '2026-11' } } });
      const waiting = (await messagesTo('rami')).find((m) => m.status === 'queued')!;
      const before = await prisma.whatsAppMessage.count();
      await webhook(call({ messages: [{ from: digits(mobileOf('rami')), type: 'text', text: { body: 'Hello, is this HR?' } }] })).expect(200);
      expect(await prisma.whatsAppMessage.count()).toBe(before);
      expect((await webhook(call({ messages: [{ from: digits(mobileOf('rami')), type: 'text', text: { body: ' Stop. ' } }] })).expect(200)).body).toEqual({ statuses: 0, stops: 1 });
      expect(await prisma.whatsAppOptIn.findUniqueOrThrow({ where: { userId: users.rami } })).toMatchObject({ stoppedAt: expect.any(Date), stoppedBy: 'stop' });
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: 'cancelled', error: 'They replied STOP: not sent.' });
      await round();
      expect(sentTo(mobileOf('rami')).at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('You won’t get WhatsApp messages') });
      expect((await as('rami').get('/me/whatsapp').expect(200)).body).toMatchObject({ on: false, stoppedBy: 'stop' });
      // nothing more for them on WhatsApp
      await whatsapp.fromNotification([users.rami], { kind: 'payslip_issued', link: '/app/payslips/3', whatsapp: { facts: { template: 'payslip_ready', month: '2026-12' } } });
      expect((await messagesTo('rami')).filter((m) => m.status === 'queued')).toEqual([]);
      // turning it on again is theirs, a new opt-in
      expect(((await as('rami').put('/me/whatsapp', { on: true, language: 'en' }).expect(200)).body as MyWhatsAppView).on).toBe(true);
    });
  });

  describe('sending', () => {
    it('a refusal worth trying again goes back after 1, 5, 30 and 120 minutes, then fails with the reason', async () => {
      await prisma.whatsAppMessage.deleteMany({ where: { userId: users.mona } });
      fake.refuse(500, { error: { message: 'Something went wrong', code: 131000, type: 'OAuthException' } }, 5);
      await whatsapp.fromNotification([users.mona], { kind: 'payslip_issued', link: '/app/payslips/9', whatsapp: { facts: { template: 'payslip_ready', month: '2026-09' } } });
      const id = (await messagesTo('mona'))[0].id;
      const t0 = Date.now();
      const tries = [0, 2, 8, 40, 170];
      for (const [i, m] of tries.entries()) {
        await round(new Date(t0 + m * 60_000));
        const row = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id } });
        expect(row.attempts, `try ${i + 1}`).toBe(i + 1);
        if (i < tries.length - 1) expect(row).toMatchObject({ status: 'queued', error: PROBLEMS.meta });
      }
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'failed', error: 'Meta’s service had a problem. Tried 5 times.', errorCode: 131000, failedAt: expect.any(Date) });
    });

    it('a refusal not worth trying again fails at once, in plain words', async () => {
      fake.refuse(401, { error: { message: 'Error validating access token: Session has expired', code: 190, error_subcode: 463 } });
      await whatsapp.fromNotification([users.mona], { kind: 'access_hold', link: '/hold', whatsapp: { facts: { template: 'access_on_hold' } } });
      await round();
      expect((await messagesTo('mona')).at(-1)).toMatchObject({ template: 'access_on_hold', status: 'failed', attempts: 1, error: PROBLEMS.token });
    });

    it('a template Meta no longer approves isn’t sent: the bell and push carry it', async () => {
      await prisma.whatsAppTemplate.update({ where: { key_language: { key: 'payslip_ready', language: 'en' } }, data: { status: 'paused' } });
      whatsapp.forget();
      expect(await whatsapp.fromNotification([users.mona], { kind: 'payslip_issued', link: '/app/payslips/8', whatsapp: { facts: { template: 'payslip_ready', month: '2026-08' } } })).toBe(0);
      await prisma.whatsAppTemplate.update({ where: { key_language: { key: 'payslip_ready', language: 'en' } }, data: { status: 'approved' } });
      whatsapp.forget();
    });
  });

  describe('HR’s log', () => {
    it('HR and a Super Admin: newest first, by status and type, each day’s counts; never the texts; HR never a C-level person’s', async () => {
      const hr = (await as('hr').get('/whatsapp/messages').expect(200)).body as WhatsAppMessagePage;
      const all = (await as('superAdmin').get('/whatsapp/messages').expect(200)).body as WhatsAppMessagePage;
      expect(all.total).toBe(hr.total + 1);
      expect(all.items.some((m) => m.recipient.id === users.cleo)).toBe(true);
      expect(hr.items.some((m) => m.recipient.id === users.cleo)).toBe(false);
      // the template and the reference, never its variables
      expect(Object.keys(hr.items[0]).sort()).toEqual(['at', 'attempts', 'deliveredAt', 'id', 'label', 'language', 'mobile', 'problem', 'readAt', 'recipient', 'reference', 'sentAt', 'status', 'template', 'templateKey']);
      // no message text (names of whom it is about, dates, months) beyond the template and the reference
      expect(JSON.stringify(all)).not.toContain('October 2026');
      expect(JSON.stringify(all)).not.toContain('a leave request');
      const failed = (await as('superAdmin').get('/whatsapp/messages?status=failed').expect(200)).body as WhatsAppMessagePage;
      expect(failed.items.length).toBeGreaterThan(0);
      expect(failed.items.every((m) => m.status === 'failed' && !!m.problem)).toBe(true);
      const reminders = (await as('superAdmin').get('/whatsapp/messages?template=interview_reminder').expect(200)).body as WhatsAppMessagePage;
      expect(reminders.items.map((m) => [m.label, m.recipient.kind])).toEqual([['Interview tomorrow', 'candidate']]);
      expect(all.days[0]).toMatchObject({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), total: expect.any(Number), sent: expect.any(Number) });
      expect(all.days.reduce((n, d) => n + d.total, 0)).toBeGreaterThan(0);
      await as('hr').get('/whatsapp/messages?status=nope').expect(400);
      expect((await as('ceo').get('/whatsapp/messages').expect(403)).body.message).toBe(WHATSAPP_LOG_STAFF_ONLY);
      expect((await as('developer').get('/whatsapp/messages').expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
      await as('rami').get('/whatsapp/messages').expect(403);
    });
  });

  describe('the secrets', () => {
    it('are in no answer and no audit entry, and every write was audited', async () => {
      const everything = JSON.stringify(answers);
      expect(everything).not.toContain(fake.token);
      expect(everything).not.toContain(APP_SECRET);
      const audit = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: { in: ['whatsapp_settings', 'whatsapp_opt_in'] } }, select: { action: true, diff: true } }));
      expect(audit).not.toContain(fake.token);
      expect(audit).not.toContain(APP_SECRET);
      const actions = new Set((await prisma.auditLog.findMany({ where: { entityType: { in: ['whatsapp_settings', 'whatsapp_opt_in'] } }, select: { action: true } })).map((a) => a.action));
      for (const a of ['update', 'new_verify_token', 'send_test_message', 'submit_templates', 'sync_templates', 'whatsapp_opt_in', 'whatsapp_choices', 'whatsapp_opt_out', 'whatsapp_stop']) expect(actions, a).toContain(a);
      // the names of the templates as Meta has them
      expect(WHATSAPP_TEMPLATES.approval_waiting.name).toBe('people_approval_waiting');
      expect(fromDateOnly(toDateOnly(TODAY))).toBe(TODAY);
    });
  });
});
