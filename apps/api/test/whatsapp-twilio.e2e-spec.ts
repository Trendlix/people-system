import type { INestApplication } from '@nestjs/common';
import {
  DEVELOPER_NO_FILES,
  twilioTemplateName,
  WHATSAPP_LANGUAGES,
  WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  type MyWhatsAppView,
  type Role,
  type WhatsAppSettingsView,
  type WhatsAppTemplatesResult,
  type WhatsAppTestView,
} from '@trendlix/shared';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { NoticesService } from '../src/notifications/notices.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { EMPTY_TWIML, TWILIO_PROBLEMS, twilioSignature } from '../src/whatsapp/twilio.js';
import { WhatsAppHttp } from '../src/whatsapp/whatsapp-http.js';
import { WhatsAppSenderService } from '../src/whatsapp/whatsapp-sender.service.js';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service.js';
import { fakeTwilio, type FakeTwilio } from './fake-twilio.js';
import { fakeWhatsAppGraph, type FakeGraph } from './fake-whatsapp.js';
import { createApp, createUser, signIn } from './helpers.js';

// Twilio as a second way to send WhatsApp (owner, 25 October 2026: "is the system ready to be linked with twillio?";
// asked, "Add Twilio as a choice" and "No, WhatsApp only"). Twilio and Meta's Graph API are fakes in WhatsAppHttp's place
// (fake-twilio.ts, fake-whatsapp.ts): nothing is ever sent to either. With WhatsApp running through Meta, a Super Admin
// switches to Twilio and saves (the Auth Token sealed, never returned); a message waiting is then not sent while no
// Twilio template is approved; the test message goes through Twilio, its refusals in plain words; the templates are made
// as Twilio Content, submitted for WhatsApp's approval and synced; an opted-in employee's leave decision goes through
// Twilio with its Content and variables (from the number, then a Messaging Service); Twilio's signed status callback
// updates the log, a bad signature is refused; an incoming STOP opts the number out and is answered through Twilio (an
// SMS is never read); switching back to Meta keeps working; developers and HR are refused; everything is audited, the
// Auth Token only as "changed". Every name is invented; this file deletes what it made, its audit entries too (the
// Meta file counts its own).

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `tw${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const APP_SECRET = `5e4d3c2b1a09${RUN}`.replace(/[^A-Za-z0-9]/g, '').padEnd(32, '0').slice(0, 32);

const mobileOf = (who: string) => {
  const key = `${who}|${RUN}`;
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `+2012${String(h % 100_000_000).padStart(8, '0')}`;
};

describe('WhatsApp through Twilio (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let graph: FakeGraph;
  let twilio: FakeTwilio;
  let whatsapp: WhatsAppService;
  let sender: WhatsAppSenderService;
  let notices: NoticesService;
  let startedAt: Date;
  let emailDomainBefore: string | null;
  let deptId: string;
  let typeId: string;
  let view: WhatsAppSettingsView;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  /** Every answer this file received, to search for the Auth Token. */
  const answers: unknown[] = [];
  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  const as = (who: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', sessions[who])),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', sessions[who]).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', sessions[who]).send(body)),
  });
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const messagesTo = (key: string) => prisma.whatsAppMessage.findMany({ where: { userId: users[key] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const twilioTo = (mobile: string) => twilio.sent.filter((m) => m.to === `whatsapp:${mobile}`);
  const round = (now = new Date()) => sender.runOnce(now);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { entityType: 'whatsapp_settings', action, at: { gte: startedAt } }, orderBy: { id: 'asc' } });
  const meta = { phoneNumberId: '', businessAccountId: '', displayPhone: '+20 100 000 7777', enabled: true, quietHours: false };
  const twilioFields = () => ({ twilioAccountSid: twilio.accountSid, twilioSender: 'whatsapp:+20 100 000 5555' });

  /** Twilio's call, signed with the Auth Token (or another) for the public URL Twilio called (or another). */
  const signed = (path: 'status' | 'incoming', params: Record<string, string>, opts: { token?: string; url?: string; signature?: string | null } = {}) => {
    const url = opts.url ?? (path === 'status' ? view.twilio.statusCallbackUrl : view.twilio.incomingUrl);
    const signature = opts.signature === undefined ? twilioSignature(url, Object.entries(params), opts.token ?? twilio.authToken) : opts.signature;
    const req = api().post(`/api/public/whatsapp/twilio/${path}`).set('content-type', 'application/x-www-form-urlencoded');
    if (signature !== null) req.set('x-twilio-signature', signature);
    return req.send(new URLSearchParams(params).toString());
  };
  const status = (sid: string, s: string, extra: Record<string, string> = {}) => signed('status', { AccountSid: twilio.accountSid, MessageSid: sid, SmsSid: sid, MessageStatus: s, ChannelPrefix: 'whatsapp', ...extra });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** A profile with a sign-in account, an employment and a mobile. */
  async function person(key: string, en: string, ar: string, employment: Record<string, unknown> = {}) {
    const email = await createUser(prisma, ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
    const res = await api().post('/api/employees').set('Cookie', sessions.hr).send({ fullNameEn: `${en} ${RUN}`, fullNameAr: ar, workEmail: email }).expect(201);
    ids[key] = res.body.id;
    people.push(res.body.id);
    await api().post(`/api/employees/${res.body.id}/employments`).set('Cookie', sessions.hr).send({ employmentType: 'full_time', joinDate: '2026-01-01', departmentId: deptId, ...employment }).expect(201);
    await prisma.employee.update({ where: { id: res.body.id }, data: { mobile: mobileOf(key) } });
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: res.body.id } });
  }

  /** A leave decided for `key`, notified as the leave flow does. */
  async function leaveDecided(key: string, days = 40) {
    const start = addDays(TODAY, days);
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: ids[key],
        employmentId: (await prisma.employment.findFirstOrThrow({ where: { employeeId: ids[key] } })).id,
        typeId,
        startDate: toDateOnly(start),
        endDate: toDateOnly(start),
        days: 1,
        status: 'approved',
        createdById: users[key],
      },
      select: { id: true },
    });
    await notices.leave(leave.id, 'decided');
    return leave.id;
  }

  const payslip = (key: string, month: string) => whatsapp.fromNotification([users[key]], { kind: 'payslip_issued', link: `/app/payslips/${month}`, whatsapp: { facts: { template: 'payslip_ready', month } } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    startedAt = new Date();
    graph = fakeWhatsAppGraph(RUN);
    twilio = fakeTwilio(RUN);
    app.get(WhatsAppHttp).fetch = (url, init) => (new URL(url).host === 'graph.facebook.com' ? graph.fetch(url, init) : twilio.fetch(url, init));
    whatsapp = app.get(WhatsAppService);
    sender = app.get(WhatsAppSenderService);
    notices = app.get(NoticesService);
    await prisma.whatsAppMessage.deleteMany({});
    await prisma.whatsAppOptIn.deleteMany({});
    await prisma.whatsAppTemplate.deleteMany({});
    await prisma.whatsAppTwilioTemplate.deleteMany({});
    await prisma.whatsAppSettings.deleteMany({});
    whatsapp.forget();
    meta.phoneNumberId = graph.phoneNumberId;
    meta.businessAccountId = graph.wabaId;
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('developer', ['developer']);
    emailDomainBefore = (await api().get('/api/company').set('Cookie', sessions.hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: '' }).expect(200);
    deptId = (await prisma.department.create({ data: { nameEn: `WhatsApp Twilio ${RUN}` }, select: { id: true } })).id;
    await person('mona', 'Mona Manager', 'منى مديرة');
    await person('rami', 'Rami Report', 'رامي موظف', { managerId: ids.mona });
    typeId = (await prisma.leaveType.findUniqueOrThrow({ where: { key: 'casual' }, select: { id: true } })).id;
    // Rami in Arabic, Mona in English
    await as('rami').put('/me/whatsapp', { on: true, language: 'ar' }).expect(200);
    await as('mona').put('/me/whatsapp', { on: true, language: 'en' }).expect(200);

    // WhatsApp running through Meta, as before Twilio: saved, its templates approved
    await as('superAdmin').put('/whatsapp/settings', { ...meta, accessToken: graph.token, appSecret: APP_SECRET }).expect(200);
    await as('superAdmin').post('/whatsapp/templates/submit').expect(200);
    graph.review('APPROVED');
    await as('superAdmin').post('/whatsapp/templates/sync').expect(200);
    view = (await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView;
    expect(view).toMatchObject({ provider: 'meta', sending: { on: true } });
  });

  afterAll(async () => {
    await prisma.whatsAppMessage.deleteMany({});
    await prisma.whatsAppOptIn.deleteMany({});
    await prisma.whatsAppTemplate.deleteMany({});
    await prisma.whatsAppTwilioTemplate.deleteMany({});
    await prisma.whatsAppSettings.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ['whatsapp_settings', 'whatsapp_opt_in'] }, at: { gte: startedAt } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people }, managerId: { not: null } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', sessions.hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('switching to Twilio', () => {
    it('is a Super Admin’s only: refused to HR, and to a developer before anything runs', async () => {
      const body = { ...meta, provider: 'twilio', ...twilioFields(), twilioAuthToken: twilio.authToken };
      expect((await as('hr').put('/whatsapp/settings', body).expect(403)).body.message).toBe(WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY);
      expect((await as('developer').get('/whatsapp/settings').expect(403)).body.message).toBe(DEVELOPER_NO_FILES);
      expect((await as('developer').put('/whatsapp/settings', body)).status).toBe(403);
      expect((await as('developer').post('/whatsapp/templates/submit', { provider: 'twilio' })).status).toBe(403);
      expect((await as('developer').post('/whatsapp/settings/test', { to: mobileOf('rami'), provider: 'twilio' })).status).toBe(403);
      expect((await prisma.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } })).provider).toBe('meta');
    });

    it('saves with the Auth Token sealed, never returned; says what is missing or wrong; keeps Meta’s; audited as “changed”', async () => {
      expect(said(await as('superAdmin').put('/whatsapp/settings', { ...meta, provider: 'twilio' }).expect(400))).toEqual([
        'To send WhatsApp messages through Twilio, enter the Account SID, the Auth Token and the WhatsApp sender.',
      ]);
      expect(said(await as('superAdmin').put('/whatsapp/settings', { ...meta, provider: 'twilio', twilioAccountSid: 'AC12', twilioAuthToken: 'short', twilioSender: 'nope' }).expect(400))).toEqual([
        expect.stringContaining('Account SID'),
        expect.stringContaining('Auth Token'),
        expect.stringContaining('WhatsApp sender'),
      ]);
      await as('superAdmin').put('/whatsapp/settings', { ...meta, provider: 'sms' }).expect(400);

      // a message waiting while Meta sends
      expect(await payslip('rami', '2026-07')).toBe(1);
      const saved = (await as('superAdmin').put('/whatsapp/settings', { ...meta, provider: 'twilio', ...twilioFields(), twilioAuthToken: twilio.authToken }).expect(200)).body as WhatsAppSettingsView;
      view = saved;
      expect(saved).toMatchObject({
        provider: 'twilio',
        phoneNumberId: graph.phoneNumberId,
        tokenSet: true,
        missing: [],
        twilio: { accountSid: twilio.accountSid, authTokenSet: true, authTokenUnreadable: false, sender: 'whatsapp:+201000005555', senderKind: 'number', missing: [] },
        // Twilio has no approved template yet: nothing goes on WhatsApp until it has
        sending: { on: false, why: 'No template is approved on Twilio yet: submit them, then sync their status.' },
      });
      expect(saved.twilio.statusCallbackUrl).toMatch(/^https?:\/\/[^/]+\/whatsapp\/twilio\/status$/);
      expect(saved.twilio.incomingUrl).toMatch(/^https?:\/\/[^/]+\/whatsapp\/twilio\/incoming$/);
      expect(saved.twilio.templates).toHaveLength(WHATSAPP_TEMPLATE_KEYS.length * 2);
      expect(new Set(saved.twilio.templates.map((t) => t.status))).toEqual(new Set(['not_submitted']));
      expect(saved.twilio.templates[0].name).toBe('people_approval_waiting_en');
      const row = await prisma.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(row.twilioAuthTokenEnc).toMatch(/^v1:/);
      expect(row.twilioAuthTokenEnc).not.toContain(twilio.authToken);

      // again without the Auth Token, and without Twilio's fields at all: kept
      expect(((await as('superAdmin').put('/whatsapp/settings', { ...meta, provider: 'twilio', ...twilioFields() }).expect(200)).body as WhatsAppSettingsView).twilio.authTokenSet).toBe(true);
      expect(((await as('superAdmin').put('/whatsapp/settings', meta).expect(200)).body as WhatsAppSettingsView)).toMatchObject({ provider: 'twilio', twilio: { accountSid: twilio.accountSid, authTokenSet: true } });
      const updates = await audit('update');
      const switched = updates.findIndex((a) => (a.diff as { provider?: { to?: string } }).provider?.to === 'twilio');
      expect(updates[switched].diff).toEqual({
        provider: { from: 'meta', to: 'twilio' },
        twilioAccountSid: { from: null, to: twilio.accountSid },
        twilioSender: { from: null, to: 'whatsapp:+201000005555' },
        twilioAuthToken: 'changed',
      });
      // the two saves after it changed nothing: not audited
      expect(updates.slice(switched + 1)).toEqual([]);

      // the message waiting goes by Twilio now, whose template isn't approved: not sent (the bell and push had it)
      expect(await payslip('mona', '2026-07')).toBe(0);
      const r = await round();
      expect(r).toMatchObject({ sent: 0, cancelled: 1 });
      expect((await messagesTo('rami')).at(-1)).toMatchObject({ status: 'cancelled', error: 'Its template isn’t approved on Twilio (not yet, or not any more): not sent.' });
      expect(twilio.sent).toEqual([]);
    });
  });

  describe('the test message', () => {
    it('goes through Twilio as a plain text until ours is approved; Twilio’s refusals in plain words', async () => {
      const to = mobileOf('superAdmin');
      const ok = (await as('superAdmin').post('/whatsapp/settings/test', { to }).expect(200)).body as WhatsAppTestView;
      expect(ok).toMatchObject({ ok: true, message: expect.stringContaining('as a plain text') });
      const [text] = twilioTo(to);
      expect(text).toMatchObject({ from: 'whatsapp:+201000005555', contentSid: null, body: expect.stringContaining('This is a test message from'), statusCallback: view.twilio.statusCallbackUrl });
      expect(await prisma.whatsAppMessage.findFirstOrThrow({ where: { wamid: text.sid } })).toMatchObject({ provider: 'twilio', template: 'test_message', templateName: 'text', status: 'sent' });

      // outside the 24 hours, Twilio fails it afterwards (63016): the log and the last test say so
      await status(text.sid, 'failed', { ErrorCode: '63016' }).expect(200);
      expect(await prisma.whatsAppMessage.findFirstOrThrow({ where: { wamid: text.sid } })).toMatchObject({ status: 'failed', error: TWILIO_PROBLEMS.window, errorCode: 63016 });
      expect(((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).lastTest).toMatchObject({ ok: false, message: TWILIO_PROBLEMS.window });

      twilio.refuse(401, { code: 20003, message: 'Authenticate', more_info: 'https://www.twilio.com/docs/errors/20003', status: 401 });
      expect((await as('superAdmin').post('/whatsapp/settings/test', { to }).expect(200)).body).toMatchObject({ ok: false, message: TWILIO_PROBLEMS.auth });
      twilio.refuse(400, { code: 63007, message: 'Twilio could not find a Channel with the specified From address', status: 400 });
      expect((await as('superAdmin').post('/whatsapp/settings/test', { to }).expect(200)).body).toMatchObject({ ok: false, message: TWILIO_PROBLEMS.sender });

      // Meta's test still, when asked for: through the Graph API
      expect((await as('superAdmin').post('/whatsapp/settings/test', { to, provider: 'meta' }).expect(200)).body).toMatchObject({ ok: true });
      expect(graph.sent.at(-1)).toMatchObject({ to: to.replace(/\D/g, ''), template: 'people_test_message' });

      const tests = await audit('send_test_message');
      expect(tests.map((a) => [(a.diff as { provider?: string }).provider ?? 'meta', (a.diff as { sent: boolean }).sent])).toEqual([
        ['twilio', true],
        ['twilio', false],
        ['twilio', false],
        ['meta', true],
      ]);
    });
  });

  describe('the templates on Twilio', () => {
    it('are made as Content (twilio/text, or twilio/call-to-action with the button), submitted for WhatsApp’s approval, then synced', async () => {
      const result = (await as('superAdmin').post('/whatsapp/templates/submit').expect(200)).body as WhatsAppTemplatesResult;
      expect(result.ok).toBe(true);
      expect(twilio.contents.size).toBe(WHATSAPP_TEMPLATE_KEYS.length * 2);
      for (const key of WHATSAPP_TEMPLATE_KEYS) {
        for (const lang of WHATSAPP_LANGUAGES) {
          const c = twilio.byName(twilioTemplateName(key, lang))!;
          expect(c, `${key} ${lang}`).toBeDefined();
          expect(c.language).toBe(lang);
          expect(Object.keys(c.types)).toEqual([WHATSAPP_TEMPLATES[key].button ? 'twilio/call-to-action' : 'twilio/text']);
          expect(c.approval).toMatchObject({ name: twilioTemplateName(key, lang), category: 'UTILITY', status: 'received' });
        }
      }
      const approval = twilio.byName('people_approval_waiting_en')!;
      expect(approval.types['twilio/call-to-action'].actions).toEqual([{ type: 'URL', title: 'Open Trendlix People', url: expect.stringMatching(/^https?:\/\/.+\/\{\{4\}\}$/) }]);
      expect(approval.types['twilio/call-to-action'].body).toContain('Reply STOP to stop these messages');
      expect(new Set(result.templates.map((t) => t.status))).toEqual(new Set(['pending']));
      expect(result.templates.map((t) => t.name)).toContain('people_payslip_ready_ar');

      // WhatsApp approves all but one, which it rejects
      twilio.review('approved');
      twilio.review('rejected', { name: 'people_cv_received_ar' }, 'The body has too many variables.');
      const synced = (await as('superAdmin').post('/whatsapp/templates/sync').expect(200)).body as WhatsAppTemplatesResult;
      expect(synced.message).toBe(`Synced with Twilio: ${WHATSAPP_TEMPLATE_KEYS.length * 2 - 1} approved, 0 pending, 1 rejected.`);
      expect(synced.templates.find((t) => t.name === 'people_cv_received_ar')).toMatchObject({ status: 'rejected', reason: 'The body has too many variables.' });
      // each one's Content SID kept
      expect((await prisma.whatsAppTwilioTemplate.findUniqueOrThrow({ where: { key_language: { key: 'payslip_ready', language: 'ar' } } })).contentSid).toBe(twilio.byName('people_payslip_ready_ar')!.sid);

      // submitting again tries only the rejected one, making nothing new (Twilio says it is submitted already)
      const calls = twilio.calls.length;
      await as('superAdmin').post('/whatsapp/templates/submit').expect(200);
      expect(twilio.calls.slice(calls).filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', url: `https://content.twilio.com/v1/Content/${twilio.byName('people_cv_received_ar')!.sid}/ApprovalRequests/whatsapp` }]);
      expect(twilio.contents.size).toBe(WHATSAPP_TEMPLATE_KEYS.length * 2);

      // a Content's SID lost here is found again at Twilio by its name
      await prisma.whatsAppTwilioTemplate.update({ where: { key_language: { key: 'payslip_ready', language: 'en' } }, data: { contentSid: null, status: 'not_submitted' } });
      twilio.review('approved', { name: 'people_cv_received_ar' });
      await as('superAdmin').post('/whatsapp/templates/sync').expect(200);
      expect(await prisma.whatsAppTwilioTemplate.findUniqueOrThrow({ where: { key_language: { key: 'payslip_ready', language: 'en' } } })).toMatchObject({ status: 'approved', contentSid: twilio.byName('people_payslip_ready_en')!.sid });

      const now = (await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView;
      expect(now.sending).toEqual({ on: true, why: null });
      expect(now.twilio.templatesSyncedAt).toEqual(expect.any(String));
      // Meta's own approval is untouched
      expect(new Set(now.templates.map((t) => t.status))).toEqual(new Set(['approved']));

      // the test with our own template now: its Content SID and variable
      const to = mobileOf('superAdmin');
      await as('superAdmin').post('/whatsapp/settings/test', { to }).expect(200);
      expect(twilioTo(to).at(-1)).toMatchObject({ contentSid: twilio.byName('people_test_message_en')!.sid, variables: { 1: expect.any(String) }, body: null });
      const presses = [...(await audit('submit_templates')), ...(await audit('sync_templates'))].filter((a) => (a.diff as { provider?: string }).provider === 'twilio');
      expect(presses).toHaveLength(4);
    });
  });

  describe('sending through Twilio', () => {
    let decided: string;

    it('an opted-in employee’s decision goes with its Content SID, its variables and the status callback', async () => {
      const leaveId = await leaveDecided('rami');
      const [queued] = (await messagesTo('rami')).filter((m) => m.status === 'queued');
      expect(queued).toMatchObject({ template: 'request_update', language: 'ar', provider: null });
      const metaSent = graph.sent.length;
      expect(await round()).toMatchObject({ sent: 1, failed: 0 });
      const m = twilioTo(mobileOf('rami')).at(-1)!;
      expect(m).toMatchObject({ from: 'whatsapp:+201000005555', messagingServiceSid: null, contentSid: twilio.byName('people_request_update_ar')!.sid, statusCallback: view.twilio.statusCallbackUrl });
      expect(m.variables).toEqual({ 1: 'رامي', 2: 'طلب الإجازة الخاص بك', 3: expect.stringMatching(/^[٠-٩/]+$/), 4: 'تمت الموافقة', 5: `leave/${leaveId}` });
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: 'sent', provider: 'twilio', wamid: m.sid, templateName: 'people_request_update_ar', attempts: 1 });
      expect(graph.sent.length).toBe(metaSent);
      decided = queued.id;
    });

    it('from a Messaging Service when its SID is the sender', async () => {
      await as('superAdmin').put('/whatsapp/settings', { ...meta, twilioSender: twilio.messagingServiceSid }).expect(200);
      expect(await payslip('mona', '2026-08')).toBe(1);
      await round();
      expect(twilioTo(mobileOf('mona')).at(-1)).toMatchObject({ from: null, messagingServiceSid: twilio.messagingServiceSid, contentSid: twilio.byName('people_payslip_ready_en')!.sid, variables: { 1: 'Mona', 2: 'August 2026', 3: 'app/payslips/2026-08' } });
      view = (await as('superAdmin').put('/whatsapp/settings', { ...meta, twilioSender: twilio.sender }).expect(200)).body as WhatsAppSettingsView;
      expect(view.twilio.senderKind).toBe('number');
    });

    it('Twilio’s status callback keeps the statuses, never going back, and a failure with why; Twilio’s answer is an empty TwiML', async () => {
      const sid = (await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: decided } })).wamid!;
      const delivered = await status(sid, 'delivered').expect(200);
      expect(delivered.text).toBe(EMPTY_TWIML);
      expect(delivered.headers['content-type']).toMatch(/^text\/xml/);
      await status(sid, 'read').expect(200);
      // late ones: "delivered" after "read", and those before sending
      await status(sid, 'delivered').expect(200);
      await status(sid, 'queued').expect(200);
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: decided } })).toMatchObject({ status: 'read', deliveredAt: expect.any(Date), readAt: expect.any(Date) });
      // undelivered, with Twilio's code: failed, in plain words
      const monas = (await messagesTo('mona')).find((m) => m.status === 'sent')!;
      await status(monas.wamid!, 'undelivered', { ErrorCode: '63003' }).expect(200);
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: monas.id } })).toMatchObject({ status: 'failed', error: TWILIO_PROBLEMS.recipient, errorCode: 63003 });
      // not ours: left aside
      await status(`SM${'9'.repeat(32)}`, 'read').expect(200);
      expect(((await as('superAdmin').get('/whatsapp/settings').expect(200)).body as WhatsAppSettingsView).twilio.lastEventAt).toEqual(expect.any(String));
    });

    it('refuses a call without a valid signature: another token, none, or signed for the API’s own address instead of the public one', async () => {
      const sid = (await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: decided } })).wamid!;
      await prisma.whatsAppMessage.update({ where: { id: decided }, data: { status: 'sent', readAt: null } });
      const params = { MessageSid: sid, MessageStatus: 'read' };
      await signed('status', params, { token: 'x'.repeat(32) }).expect(403);
      await signed('status', params, { signature: null }).expect(403);
      await signed('status', params, { url: `http://127.0.0.1:3001/api/public/whatsapp/twilio/status` }).expect(403);
      await signed('incoming', { From: `whatsapp:${mobileOf('rami')}`, Body: 'STOP' }, { token: 'y'.repeat(32) }).expect(403);
      // signed for the status URL, sent to the incoming one
      await signed('incoming', { From: `whatsapp:${mobileOf('rami')}`, Body: 'STOP' }, { url: view.twilio.statusCallbackUrl }).expect(403);
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: decided } })).toMatchObject({ status: 'sent', readAt: null });
      expect((await prisma.whatsAppOptIn.findUniqueOrThrow({ where: { userId: users.rami } })).stoppedAt).toBeNull();
    });
  });

  describe('STOP through Twilio', () => {
    it('turns the number off, cancels what waits, and is answered once through Twilio; anything else, and an SMS, get nothing', async () => {
      expect(await payslip('mona', '2026-09')).toBe(1);
      const waiting = (await messagesTo('mona')).find((m) => m.status === 'queued')!;
      const before = await prisma.whatsAppMessage.count();
      const from = `whatsapp:${mobileOf('mona')}`;
      const hello = await signed('incoming', { AccountSid: twilio.accountSid, From: from, To: twilio.sender, Body: 'Hello, is this HR?', WaId: mobileOf('mona').slice(1) }).expect(200);
      expect(hello.text).toBe(EMPTY_TWIML);
      // an SMS saying STOP to the same number: never read (WhatsApp only)
      await signed('incoming', { AccountSid: twilio.accountSid, From: mobileOf('mona'), To: '+201000005555', Body: 'STOP' }).expect(200);
      expect(await prisma.whatsAppMessage.count()).toBe(before);
      expect((await prisma.whatsAppOptIn.findUniqueOrThrow({ where: { userId: users.mona } })).stoppedAt).toBeNull();

      await signed('incoming', { AccountSid: twilio.accountSid, From: from, To: twilio.sender, Body: ' Stop. ', WaId: mobileOf('mona').slice(1) }).expect(200);
      expect(await prisma.whatsAppOptIn.findUniqueOrThrow({ where: { userId: users.mona } })).toMatchObject({ stoppedAt: expect.any(Date), stoppedBy: 'stop' });
      expect(await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ status: 'cancelled', error: 'They replied STOP: not sent.' });
      await round();
      expect(twilioTo(mobileOf('mona')).at(-1)).toMatchObject({ contentSid: null, body: expect.stringContaining('You won’t get WhatsApp messages'), from: twilio.sender });
      expect((await prisma.whatsAppMessage.findFirstOrThrow({ where: { mobile: mobileOf('mona'), template: 'stop_confirmation' } })).provider).toBe('twilio');
      expect(((await as('mona').get('/me/whatsapp').expect(200)).body as MyWhatsAppView)).toMatchObject({ on: false, stoppedBy: 'stop' });
      expect(await prisma.auditLog.count({ where: { entityType: 'whatsapp_opt_in', action: 'whatsapp_stop', at: { gte: startedAt } } })).toBe(1);
    });
  });

  describe('switching back to Meta', () => {
    it('keeps working: a message queued while Twilio sent goes by Meta, Twilio’s settings kept; Meta’s webhook still heard', async () => {
      expect(await payslip('rami', '2026-10')).toBe(1);
      const waiting = (await messagesTo('rami')).find((m) => m.status === 'queued')!;
      const back = (await as('superAdmin').put('/whatsapp/settings', { ...meta, provider: 'meta' }).expect(200)).body as WhatsAppSettingsView;
      expect(back).toMatchObject({ provider: 'meta', sending: { on: true, why: null }, twilio: { accountSid: twilio.accountSid, authTokenSet: true, sender: twilio.sender } });
      const sentByTwilio = twilio.sent.length;
      await round();
      expect(twilio.sent.length).toBe(sentByTwilio);
      expect(graph.sent.at(-1)).toMatchObject({ to: mobileOf('rami').slice(1), template: 'people_payslip_ready', language: 'ar', button: 'app/payslips/2026-10' });
      const sent = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: waiting.id } });
      expect(sent).toMatchObject({ status: 'sent', provider: 'meta', templateName: 'people_payslip_ready' });
      // Meta's webhook, signed with the app secret
      const raw = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: graph.wabaId, changes: [{ field: 'messages', value: { statuses: [{ id: sent.wamid, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '20' }] } }] }],
      });
      const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
      expect((await api().post('/api/public/whatsapp/webhook').set('content-type', 'application/json').set('x-hub-signature-256', signature).send(raw).expect(200)).body).toEqual({ statuses: 1, stops: 0 });
      // and Twilio's statuses of what it sent before are still heard
      const twilioSent = (await messagesTo('rami')).find((m) => m.provider === 'twilio' && m.status === 'sent')!;
      await status(twilioSent.wamid!, 'read').expect(200);
      expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: twilioSent.id } })).status).toBe('read');
      expect((await audit('update')).at(-1)!.diff).toEqual({ provider: { from: 'twilio', to: 'meta' } });
    });
  });

  describe('the Auth Token', () => {
    it('is in no answer and no audit entry', async () => {
      expect(JSON.stringify(answers)).not.toContain(twilio.authToken);
      const entries = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: { in: ['whatsapp_settings', 'whatsapp_opt_in'] }, at: { gte: startedAt } }, select: { action: true, diff: true } }));
      expect(entries).not.toContain(twilio.authToken);
      expect(entries).not.toContain(graph.token);
      expect(entries).toContain('"twilioAuthToken":"changed"');
    });
  });
});
