import type { INestApplication } from '@nestjs/common';
import {
  DEVELOPER_NO_FILES,
  DEVELOPER_READ_ONLY,
  MEETINGS_SCHEDULERS_ONLY,
  MEETINGS_SUPER_ADMIN_ONLY,
  type InterviewSaved,
  type InterviewView,
  type MeetingChoices,
  type MeetingConnectResult,
  type MeetingSettingsView,
  type MyMeetingsView,
  type Role,
  type VacancyView,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { MailService } from '../src/mail/mail.service.js';
import { MeetingHttp } from '../src/meetings/meeting-http.js';
import { MeetingTokensService } from '../src/meetings/meeting-tokens.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { fakeMeetingProviders, type FakeApps, type FakeProviders } from './fake-meetings.js';
import { createApp, createUser, signIn } from './helpers.js';

// Online interview meetings made by the system (owner, 24 October 2026: "can i link an online meeting service provider to
// automatically generate meeting links? line teams - gogole meet - zoom - etc.."; "Google Meet, Microsoft Teams, Zoom";
// "make it both"). Google, Microsoft and Zoom are one fake in MeetingHttp's place (fake-meetings.ts): nothing is ever sent
// to them. A Super Admin sets each provider's app and connects the company's accounts (Google by signing in, through the
// return with a fake code; Microsoft's mailbox and Zoom's user by naming them), tests one, sets the default; an HR person
// connects their own Google; online interviews scheduled with a choice get their meeting, its link in the candidate's
// email, the interviewers' and the .ics; a move moves it, another choice replaces it, a cancel deletes it; a provider's
// refusal saves the interview all the same, tells nobody, and says why, until Try again or Paste a link; a revoked
// sign-in marks the connection needs reconnecting and tells its owner. No token or secret is in any answer or audit
// entry; a developer is refused the settings and sees no meeting link; nobody else opens the company's settings. Email
// is kept in MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `mt${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const ORIGIN = 'https://people.trendlix.test';
const APPS: FakeApps = {
  google: { clientId: `1234-${RUN}.apps.googleusercontent.com`, clientSecret: `GOCSPX-${RUN}-g-secret` },
  microsoft: { tenantId: '0b1c2d3e-0000-4000-8000-00000000aa01', clientId: '0b1c2d3e-0000-4000-8000-00000000aa02', clientSecret: `ms~${RUN}-secret` },
  zoom: { accountId: `Acc_${RUN}`, clientId: `S2s_${RUN}`, clientSecret: `zoom-s2s-${RUN}-secret`, userClientId: `Gen_${RUN}`, userClientSecret: `zoom-general-${RUN}-secret` },
};
const COMPANY_GOOGLE = `hr.company.${RUN}@trendlix.test`;
const HOST_MAILBOX = `hr.mailbox.${RUN}@trendlix.test`;
const HOST_ZOOM = `hr.zoom.${RUN}@trendlix.test`;

describe('Online interview meetings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  let fake: FakeProviders;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  const employeeIds: string[] = [];
  let departmentId: string;
  let jobTitleId: string;
  let v: VacancyView;
  let applicationId: string;
  let vacancyId: string | undefined;
  /** Every answer this file received, to search for the tokens and secrets. */
  const answers: unknown[] = [];

  /** Every answer kept as it arrives (superagent's response event, with its body read). */
  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  const as = (who: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', sessions[who])),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', sessions[who]).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', sessions[who]).send(body)),
  });
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const icsOf = (m: { attachments?: { content: Buffer | string; encoding?: string }[] }) => {
    const a = m.attachments?.[0];
    if (!a) return '';
    const bytes = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, (a.encoding as BufferEncoding) ?? 'base64');
    return bytes.toString('utf8').replace(/\r\n /g, '');
  };
  const candidateEmail = () => `sara.${RUN}@mail.test`;
  const interviewBody = (extra: object = {}) => ({ date: addDays(TODAY, 7), time: '10:30', minutes: 45, kind: 'online', interviewerIds: [people.iv1], note: 'Bring your reel.', ...extra });

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  async function person(key: string, name: string) {
    await account(key, ['employee']);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: emails[key],
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId } },
      },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: e.id } });
    people[key] = e.id;
    employeeIds.push(e.id);
  }

  /** The sign-in at a provider and its return: start, then the provider's code back through the website. */
  async function connect(who: string, provider: 'google' | 'microsoft' | 'zoom', owner: 'company' | 'personal', code: string, email: string): Promise<MeetingConnectResult> {
    const started = (await as(who).post('/meetings/oauth/start', { provider, owner, origin: ORIGIN }).expect(200)).body as { url: string };
    const url = new URL(started.url);
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/meetings/oauth/${provider}`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    fake.code(provider, code, email);
    return (await as(who).post('/meetings/oauth/finish', { provider, code, state: url.searchParams.get('state') }).expect(200)).body as MeetingConnectResult;
  }

  const interviewOf = async (id: string) => (await as('hr').get(`/recruitment/applications/${applicationId}`).expect(200)).body.interviews.find((i: InterviewView) => i.id === id) as InterviewView;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    fake = fakeMeetingProviders(RUN, APPS);
    fake.mailboxes.add(HOST_MAILBOX);
    app.get(MeetingHttp).fetch = fake.fetch;
    // a test run before this one left nothing; this file's own rows are deleted at the end
    await prisma.meetingConnection.deleteMany({});
    await prisma.meetingApp.deleteMany({});
    departmentId = (await prisma.department.create({ data: { nameEn: `Meetings ${RUN}` }, select: { id: true } })).id;
    const gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    const shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Video Editor ${RUN}`, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('hr2', ['hr']);
    await account('ceo', ['ceo']);
    await account('admin', ['admin']);
    await account('developer', ['developer']);
    await person('iv1', 'Ivan Interviewer');
    const made = await as('hr').post('/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, gradeId, shiftId, salaryMin: 15000, salaryMax: 25000 }).expect(201);
    vacancyId = made.body.id;
    await as('hr').post(`/recruitment/vacancies/${made.body.id}/submit`).expect(200);
    v = (await as('ceo').post(`/recruitment/vacancies/${made.body.id}/approve`).expect(200)).body as VacancyView;
    applicationId = (
      await prisma.jobApplication.create({
        data: {
          number: `APP-1999-${String(Date.now()).slice(-7)}9`,
          vacancyId: v.id,
          stage: 'shortlisted',
          fullName: `Sara Applicant ${RUN}`,
          email: candidateEmail(),
          mobile: '+20 100 123 4567',
          consentAt: new Date(),
          cv: { create: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 10, data: Buffer.from('%PDF-1.4\n%%EOF\n') } },
          steps: { create: [{ event: 'applied', stage: 'applied' }, { event: 'shortlisted', stage: 'shortlisted' }] },
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (vacancyId) {
      await prisma.jobApplication.deleteMany({ where: { vacancyId } });
      await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    }
    await prisma.meetingConnection.deleteMany({});
    await prisma.meetingApp.deleteMany({});
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('the company’s settings', () => {
    it('are a Super Admin’s: refused to HR, the CEO, an Admin and a developer', async () => {
      for (const who of ['hr', 'ceo', 'admin']) {
        const res = await as(who).get('/meetings/settings').expect(403);
        expect(res.body.message, who).toBe(MEETINGS_SUPER_ADMIN_ONLY);
        expect((await as(who).put('/meetings/apps/google', { clientId: APPS.google.clientId })).status, who).toBe(403);
        expect((await as(who).post('/meetings/company/zoom/test')).status, who).toBe(403);
      }
      // the CEO and an Admin don't schedule interviews: no meetings of their own either
      expect((await as('ceo').get('/meetings/mine').expect(403)).body.message).toBe(MEETINGS_SCHEDULERS_ONLY);
      expect((await as('admin').get('/meetings/choices').expect(403)).body.message).toBe(MEETINGS_SCHEDULERS_ONLY);
      // HR may not connect the company's account
      expect((await as('hr').post('/meetings/oauth/start', { provider: 'google', owner: 'company', origin: ORIGIN }).expect(403)).body.message).toBe(MEETINGS_SUPER_ADMIN_ONLY);
      const empty = (await as('superAdmin').get('/meetings/settings').expect(200)).body as MeetingSettingsView;
      expect(empty.apps.map((a) => [a.provider, a.companyReady, a.personalReady])).toEqual([
        ['google', false, false],
        ['microsoft', false, false],
        ['zoom', false, false],
      ]);
      expect(empty).toMatchObject({ company: [], defaultChoice: null });
    });

    it('a developer: refused every meetings page and every change', async () => {
      for (const path of ['/meetings/settings', '/meetings/mine', '/meetings/choices']) {
        const res = await as('developer').get(path).expect(403);
        expect(res.body.message, path).toBe(DEVELOPER_NO_FILES);
      }
      for (const res of [
        await as('developer').put('/meetings/apps/google', { clientId: APPS.google.clientId }),
        await as('developer').post('/meetings/oauth/start', { provider: 'google', owner: 'personal', origin: ORIGIN }),
        await as('developer').put('/meetings/default', { choice: null }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.message).toBe(DEVELOPER_READ_ONLY);
      }
    });

    it('saves each provider’s app, its secrets sealed and only said to be set; checked in words', async () => {
      expect(said(await as('superAdmin').put('/meetings/apps/google', { clientId: 'not-google' }).expect(400))).toEqual([
        'A Google client ID ends with .apps.googleusercontent.com: copy it from Google Cloud → APIs & Services → Credentials.',
      ]);
      await as('superAdmin').put('/meetings/apps/google', { clientId: APPS.google.clientId, clientSecret: APPS.google.clientSecret }).expect(200);
      await as('superAdmin').put('/meetings/apps/microsoft', { tenantId: APPS.microsoft.tenantId, clientId: APPS.microsoft.clientId, clientSecret: APPS.microsoft.clientSecret }).expect(200);
      const saved = (
        await as('superAdmin')
          .put('/meetings/apps/zoom', { accountId: APPS.zoom.accountId, clientId: APPS.zoom.clientId, clientSecret: APPS.zoom.clientSecret, userClientId: APPS.zoom.userClientId, userClientSecret: APPS.zoom.userClientSecret })
          .expect(200)
      ).body as MeetingSettingsView;
      expect(saved.apps.map((a) => [a.provider, a.clientSecretSet, a.companyReady, a.personalReady])).toEqual([
        ['google', true, true, true],
        ['microsoft', true, true, true],
        ['zoom', true, true, true],
      ]);
      expect(saved.apps[2]).toMatchObject({ accountId: APPS.zoom.accountId, userClientId: APPS.zoom.userClientId, userClientSecretSet: true });
      // kept sealed; an empty secret keeps the saved one
      const row = await prisma.meetingApp.findUniqueOrThrow({ where: { provider: 'google' } });
      expect(row.clientSecretEnc).toMatch(/^v1:/);
      expect(row.clientSecretEnc).not.toContain(APPS.google.clientSecret);
      await as('superAdmin').put('/meetings/apps/google', { clientId: APPS.google.clientId, clientSecret: '' }).expect(200);
      expect((await prisma.meetingApp.findUniqueOrThrow({ where: { provider: 'google' } })).clientSecretEnc).toBe(row.clientSecretEnc);
      // audited as "changed"
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'meeting_settings', action: 'update', userId: users.superAdmin, diff: { path: ['provider'], equals: 'zoom' } } });
      expect(entry.diff).toEqual({ provider: 'zoom', clientId: 'changed', accountId: 'changed', userClientId: 'changed', clientSecret: 'changed', userClientSecret: 'changed' });
    });

    it('connects the company’s Google account through the return with a fake code', async () => {
      const done = await connect('superAdmin', 'google', 'company', `company-google-${RUN}`, COMPANY_GOOGLE);
      expect(done).toEqual({ provider: 'google', back: '/organization/meetings', ok: true, problem: null, said: null });
      const s = (await as('superAdmin').get('/meetings/settings').expect(200)).body as MeetingSettingsView;
      expect(s.company).toEqual([expect.objectContaining({ provider: 'google', owner: 'company', accountEmail: COMPANY_GOOGLE, status: 'connected', problem: null })]);
      const row = await prisma.meetingConnection.findFirstOrThrow({ where: { provider: 'google', userId: null } });
      expect(row.refreshTokenEnc).toMatch(/^v1:/);
      // a return that isn't the starter's, expired, or used again isn't connected
      const started = (await as('superAdmin').post('/meetings/oauth/start', { provider: 'google', owner: 'company', origin: ORIGIN }).expect(200)).body as { url: string };
      const state = new URL(started.url).searchParams.get('state');
      expect((await as('hr').post('/meetings/oauth/finish', { provider: 'google', code: 'x', state }).expect(200)).body).toMatchObject({ ok: false, problem: 'other_user' });
      expect((await as('superAdmin').post('/meetings/oauth/finish', { provider: 'google', code: 'x', state: 'v1:not:a:state' }).expect(200)).body).toMatchObject({ ok: false, problem: 'expired' });
      expect((await as('superAdmin').post('/meetings/oauth/finish', { provider: 'zoom', code: 'x', state }).expect(200)).body).toMatchObject({ ok: false, problem: 'expired' });
      expect((await as('superAdmin').post('/meetings/oauth/finish', { provider: 'google', error: 'access_denied', state }).expect(200)).body).toMatchObject({ ok: false, problem: 'denied' });
      expect((await as('superAdmin').post('/meetings/oauth/finish', { provider: 'google', code: 'never-given', state }).expect(200)).body).toMatchObject({ ok: false, problem: 'refused', said: 'invalid_grant' });
      // the company's Microsoft and Zoom host by the app: no sign-in to start
      expect(said(await as('superAdmin').post('/meetings/oauth/start', { provider: 'zoom', owner: 'company', origin: ORIGIN }).expect(400))[0]).toMatch(/hosts by the app/);
      expect(said(await as('superAdmin').post('/meetings/oauth/start', { provider: 'google', owner: 'company', origin: 'http://evil.test' }).expect(400))).toEqual(['The website’s address could not be read. Reload the page and try again.']);
    });

    it('names the company’s Microsoft mailbox and Zoom user, checked with the app’s own token', async () => {
      expect(said(await as('superAdmin').post('/meetings/company/microsoft/host', { hostEmail: `nobody.${RUN}@trendlix.test` }).expect(400))).toEqual([
        'Microsoft can’t find the host mailbox: a Super Admin checks it on Organization → Meetings (it needs an Exchange Online mailbox).',
      ]);
      await as('superAdmin').post('/meetings/company/microsoft/host', { hostEmail: HOST_MAILBOX.toUpperCase() }).expect(200);
      const s = (await as('superAdmin').post('/meetings/company/zoom/host', { hostEmail: HOST_ZOOM }).expect(200)).body as MeetingSettingsView;
      expect(s.company.map((c) => [c.provider, c.accountEmail, c.status])).toEqual([
        ['google', COMPANY_GOOGLE, 'connected'],
        ['microsoft', HOST_MAILBOX, 'connected'],
        ['zoom', HOST_ZOOM, 'connected'],
      ]);
      // a wrong secret is said plainly, never shown
      await as('superAdmin').put('/meetings/apps/zoom', { accountId: APPS.zoom.accountId, clientId: APPS.zoom.clientId, clientSecret: 'wrong-secret-xyz', userClientId: APPS.zoom.userClientId }).expect(200);
      expect(said(await as('superAdmin').post('/meetings/company/zoom/host', { hostEmail: HOST_ZOOM }).expect(400))).toEqual([
        'Zoom refused the app’s client ID or secret: a Super Admin checks them on Organization → Meetings.',
      ]);
      await as('superAdmin').put('/meetings/apps/zoom', { accountId: APPS.zoom.accountId, clientId: APPS.zoom.clientId, clientSecret: APPS.zoom.clientSecret, userClientId: APPS.zoom.userClientId }).expect(200);
    });

    it('creates a test meeting with each connection and deletes it, and sets the default', async () => {
      for (const provider of ['google', 'microsoft', 'zoom']) {
        const before = fake.meetings.size;
        const test = (await as('superAdmin').post(`/meetings/company/${provider}/test`).expect(200)).body;
        expect(test, provider).toMatchObject({ ok: true });
        expect(test.message).toMatch(/^A test meeting was created and deleted: .* works, hosted by /);
        expect(fake.meetings.size).toBe(before);
      }
      const made = fake.calls.filter((c) => c.method === 'POST' && /events|meetings$/.test(c.url));
      expect(made.length).toBeGreaterThanOrEqual(3);
      expect(said(await as('superAdmin').put('/meetings/default', { choice: 'personal:zoom' }).expect(400))).toEqual(['Choose one of the company’s connections, or none.']);
      expect(((await as('superAdmin').put('/meetings/default', { choice: 'company:zoom' }).expect(200)).body as MeetingSettingsView).defaultChoice).toBe('company:zoom');
    });
  });

  describe('an HR person’s own', () => {
    it('connects their own Google account, and sees the choices: the company’s default first, then their own', async () => {
      const done = await connect('hr', 'google', 'personal', `personal-google-${RUN}`, emails.hr);
      expect(done).toMatchObject({ ok: true, back: '/account/meetings' });
      const mine = (await as('hr').get('/meetings/mine').expect(200)).body as MyMeetingsView;
      expect(mine.providers.map((p) => [p.provider, p.available, p.connection?.accountEmail ?? null, p.connection?.status ?? null])).toEqual([
        ['google', true, emails.hr, 'connected'],
        ['microsoft', true, null, null],
        ['zoom', true, null, null],
      ]);
      // another HR person doesn't see it, and can't disconnect it
      expect(((await as('hr2').get('/meetings/mine').expect(200)).body as MyMeetingsView).providers.every((p) => !p.connection)).toBe(true);
      const choices = (await as('hr').get('/meetings/choices').expect(200)).body as MeetingChoices;
      expect(choices.choices.map((c) => c.key)).toEqual(['company:zoom', 'personal:google', 'company:google', 'company:microsoft']);
      expect(choices.start).toBe('company:zoom');
      expect(((await as('hr2').get('/meetings/choices').expect(200)).body as MeetingChoices).choices.map((c) => c.key)).toEqual(['company:zoom', 'company:google', 'company:microsoft']);
      // their own test meeting
      expect((await as('hr').post('/meetings/mine/google/test').expect(200)).body).toMatchObject({ ok: true });
      expect(said(await as('hr').post('/meetings/mine/zoom/test').expect(400))).toEqual(['Your Zoom isn’t connected: connect it first.']);
    });

    it('connects their own Microsoft (delegated, the same Entra app) and Zoom (the General app); Zoom’s refresh token kept as it turns', async () => {
      expect(await connect('hr2', 'microsoft', 'personal', `personal-ms-${RUN}`, emails.hr2)).toMatchObject({ ok: true, back: '/account/meetings' });
      expect(await connect('hr2', 'zoom', 'personal', `personal-zoom-${RUN}`, emails.hr2)).toMatchObject({ ok: true });
      const mine = (await as('hr2').get('/meetings/mine').expect(200)).body as MyMeetingsView;
      expect(mine.providers.map((p) => p.connection?.accountEmail ?? null)).toEqual([null, emails.hr2, emails.hr2]);
      expect((await as('hr2').post('/meetings/mine/microsoft/test').expect(200)).body).toMatchObject({ ok: true });
      // made in their own calendar (Graph's /me), not the company's mailbox
      expect(fake.calls.some((c) => c.method === 'POST' && c.url === 'https://graph.microsoft.com/v1.0/me/events')).toBe(true);
      // the access token gone (as after an hour): refreshed, and Zoom's new refresh token kept at once
      const zoom = await prisma.meetingConnection.findFirstOrThrow({ where: { provider: 'zoom', userId: users.hr2 } });
      app.get(MeetingTokensService).forgetConnection(zoom.id);
      expect((await as('hr2').post('/meetings/mine/zoom/test').expect(200)).body).toMatchObject({ ok: true });
      expect(fake.calls.some((c) => c.method === 'POST' && c.url === 'https://api.zoom.us/v2/users/me/meetings')).toBe(true);
      const after = await prisma.meetingConnection.findFirstOrThrow({ where: { id: zoom.id } });
      expect(after.refreshTokenEnc).not.toBe(zoom.refreshTokenEnc);
      app.get(MeetingTokensService).forgetConnection(zoom.id);
      expect((await as('hr2').post('/meetings/mine/zoom/test').expect(200)).body).toMatchObject({ ok: true });
      expect(await prisma.meetingConnection.findFirstOrThrow({ where: { id: zoom.id }, select: { status: true } })).toEqual({ status: 'connected' });
      // the choices: theirs after the company's default
      expect(((await as('hr2').get('/meetings/choices').expect(200)).body as MeetingChoices).choices.map((c) => c.key)).toEqual(['company:zoom', 'personal:microsoft', 'personal:zoom', 'company:google', 'company:microsoft']);
      // disconnected: gone from their page, the sign-in revoked at Zoom
      await as('hr2').post('/meetings/mine/zoom/disconnect').expect(200);
      expect(fake.calls.some((c) => c.url === 'https://zoom.us/oauth/revoke')).toBe(true);
      expect(await prisma.meetingConnection.count({ where: { userId: users.hr2 } })).toBe(1);
    });
  });

  describe('interviews', () => {
    let interviewId: string;

    it('scheduling an online interview creates the meeting, and its link is in every invitation', async () => {
      const before = mail.outbox.length;
      const saved = (await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ meeting: 'personal:google', location: null })).expect(201)).body as InterviewSaved;
      interviewId = saved.interview.id;
      expect(saved).toMatchObject({ email: 'sent', meeting: 'created', meetingProblem: null });
      const link = saved.interview.location!;
      expect(link).toMatch(/^https:\/\/meet\.google\.com\//);
      expect(saved.interview.meeting).toEqual({ provider: 'google', owner: 'personal', joinUrl: link });
      // made on the HR person's own calendar, with the interview's title, start (10:30 in Cairo) and length, nobody invited there
      const made = [...fake.meetings.values()].find((m) => m.joinUrl === link)!;
      expect(made).toMatchObject({ provider: 'google', host: emails.hr, title: `Interview: Sara Applicant ${RUN} · Video Editor ${RUN}`, minutes: 45 });
      expect(new Date(made.start).toISOString()).toBe(new Date(`${addDays(TODAY, 7)}T08:30:00.000Z`).toISOString());
      expect(made.attendees).toBeUndefined();
      // the candidate's email and .ics, and the interviewer's
      const sent = mail.outbox.slice(before);
      const toCandidate = sent.find((m) => m.to === candidateEmail())!;
      expect(toCandidate.text).toContain(`Online (Google Meet): ${link}`);
      expect(icsOf(toCandidate)).toContain(link);
      const toInterviewer = sent.find((m) => m.to === emails.iv1)!;
      expect(toInterviewer.text).toContain(`Online (Google Meet): ${link}`);
      expect(icsOf(toInterviewer)).toContain(link);
      // the interviewer's notification names the service, never the link
      const notice = await prisma.notification.findFirstOrThrow({ where: { userId: users.iv1, kind: 'interview_scheduled' }, orderBy: { createdAt: 'desc' } });
      expect(notice.body).toMatch(/, on Google Meet$/);
      expect(notice.body).not.toContain('https://');
      // audited with the provider and its id there
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'interview', entityId: interviewId, action: 'meeting_create' } });
      expect(audit.diff).toMatchObject({ provider: 'google', owner: 'personal', meetingId: made.id });
      // the interviewer sees it on My Hiring, with its link
      const mine = (await as('iv1').get('/recruitment/my-hiring').expect(200)).body;
      expect(mine.interviews.find((i: InterviewView) => i.id === interviewId)).toMatchObject({ meeting: { provider: 'google', joinUrl: link }, location: link });
    });

    it('moving it moves the meeting; another choice replaces it; the link sent each time', async () => {
      const link = (await interviewOf(interviewId)).location!;
      const made = [...fake.meetings.values()].find((m) => m.joinUrl === link)!;
      const moved = (await as('hr').put(`/recruitment/interviews/${interviewId}`, interviewBody({ time: '13:00', minutes: 60, meeting: 'keep', location: null })).expect(200)).body as InterviewSaved;
      expect(moved).toMatchObject({ meeting: 'updated', email: 'sent' });
      expect(moved.interview.location).toBe(link);
      expect(fake.meetings.get(made.id)).toMatchObject({ minutes: 60, start: new Date(`${addDays(TODAY, 7)}T11:00:00.000Z`).toISOString() });
      // an older page that sends no choice and the same link keeps the meeting too
      expect(((await as('hr').put(`/recruitment/interviews/${interviewId}`, interviewBody({ time: '13:00', minutes: 60, location: link })).expect(200)).body as InterviewSaved).meeting).toBe('updated');
      // the company's Zoom instead: Google's event deleted, Zoom's made
      const before = mail.outbox.length;
      const replaced = (await as('hr').put(`/recruitment/interviews/${interviewId}`, interviewBody({ time: '13:00', minutes: 60, meeting: 'company:zoom', location: null })).expect(200)).body as InterviewSaved;
      expect(replaced).toMatchObject({ meeting: 'created', email: 'sent' });
      expect(fake.meetings.has(made.id)).toBe(false);
      const zoomLink = replaced.interview.location!;
      expect(zoomLink).toMatch(/^https:\/\/us06web\.zoom\.us\/j\/\d+\?pwd=/);
      expect(replaced.interview.meeting).toEqual({ provider: 'zoom', owner: 'company', joinUrl: zoomLink });
      expect([...fake.meetings.values()].find((m) => m.joinUrl === zoomLink)).toMatchObject({ provider: 'zoom', host: HOST_ZOOM, minutes: 60 });
      expect(mail.outbox.slice(before).find((m) => m.to === candidateEmail())!.text).toContain(`Online (Zoom): ${zoomLink}`);
      const actions = (await prisma.auditLog.findMany({ where: { entityType: 'interview', entityId: interviewId }, orderBy: { id: 'asc' }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(['schedule', 'meeting_create', 'reschedule', 'meeting_update', 'reschedule', 'meeting_update', 'reschedule', 'meeting_delete', 'meeting_create']);
    });

    it('cancelling it deletes the meeting', async () => {
      const zoomLink = (await interviewOf(interviewId)).location!;
      const zoom = [...fake.meetings.values()].find((m) => m.joinUrl === zoomLink)!;
      const cancelled = (await as('hr').post(`/recruitment/interviews/${interviewId}/cancel`, { reason: 'Moved on' }).expect(200)).body as InterviewSaved;
      expect(cancelled).toMatchObject({ meeting: 'deleted', email: 'sent', meetingProblem: null });
      expect(fake.meetings.has(zoom.id)).toBe(false);
      expect(fake.calls.some((c) => c.method === 'DELETE' && c.url.startsWith(`https://api.zoom.us/v2/meetings/${zoom.id}`))).toBe(true);
    });

    it('a provider’s refusal still saves the interview, tells nobody and says why, until Try again', async () => {
      fake.refuseNext('microsoft', 403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } });
      const before = mail.outbox.length;
      const saved = (await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ date: addDays(TODAY, 8), meeting: 'company:microsoft', location: null })).expect(201)).body as InterviewSaved;
      expect(saved).toMatchObject({ email: 'not_sent', meeting: 'failed' });
      expect(saved.meetingProblem).toBe(
        'Microsoft refused access to the calendar: grant the Calendars.ReadWrite permission with admin consent, and include the host mailbox in the app’s access policy if it has one. Nobody was told yet: try again, or paste a link.',
      );
      expect(saved.interview).toMatchObject({ status: 'scheduled', location: null, meeting: null, can: { meeting: true } });
      expect(mail.outbox.length).toBe(before);
      expect(await prisma.auditLog.count({ where: { entityType: 'interview', entityId: saved.interview.id, action: 'meeting_failed' } })).toBe(1);
      // Try again: made this time, and now everyone is invited with the Teams link
      const retried = (await as('hr').post(`/recruitment/interviews/${saved.interview.id}/meeting`, { meeting: 'company:microsoft' }).expect(200)).body as InterviewSaved;
      expect(retried).toMatchObject({ meeting: 'created', email: 'sent', meetingProblem: null });
      expect(retried.interview.location).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);
      expect(retried.interview.can.meeting).toBe(false);
      expect(mail.outbox.slice(before).find((m) => m.to === candidateEmail())!.text).toContain(`Online (Microsoft Teams): ${retried.interview.location}`);
      // it has its link now: nothing more to try
      expect(said(await as('hr').post(`/recruitment/interviews/${saved.interview.id}/meeting`, { meeting: 'company:google' }).expect(409))).toEqual(['It has its link already: move the interview to change its meeting.']);
    });

    it('or Paste a link; and an unavailable choice is refused before anything is saved', async () => {
      fake.refuseNext('google', 500, { error: { code: 500, message: 'Backend Error' } });
      const saved = (await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ date: addDays(TODAY, 9), meeting: 'company:google', location: null })).expect(201)).body as InterviewSaved;
      expect(saved.meetingProblem).toBe('Google is busy right now (Backend Error): try again in a moment. Nobody was told yet: try again, or paste a link.');
      expect(said(await as('hr').post(`/recruitment/interviews/${saved.interview.id}/meeting`, { link: 'zoom' }).expect(400))).toEqual(['Give the meeting’s link in full, starting with https://.']);
      const pasted = (await as('hr').post(`/recruitment/interviews/${saved.interview.id}/meeting`, { link: 'https://meet.example.com/abc' }).expect(200)).body as InterviewSaved;
      expect(pasted).toMatchObject({ meeting: 'none', email: 'sent', meetingProblem: null, interview: { location: 'https://meet.example.com/abc', meeting: null } });
      // HR's own Zoom isn't connected; nothing is saved
      const count = await prisma.interview.count({ where: { applicationId } });
      expect(said(await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ meeting: 'personal:zoom', location: null })).expect(400))).toEqual([
        'Your Zoom isn’t connected: connect it on Your Meetings, or choose another.',
      ]);
      expect(await prisma.interview.count({ where: { applicationId } })).toBe(count);
      // a pasted link, as before, still works without a choice
      expect(((await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ date: addDays(TODAY, 10), location: 'https://zoom.us/j/1' })).expect(201)).body as InterviewSaved).meeting).toBe('none');
    });

    it('a sign-in revoked at the provider: the connection needs reconnecting and its owner is told', async () => {
      fake.revoke(emails.hr);
      const saved = (await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ date: addDays(TODAY, 11), meeting: 'personal:google', location: null })).expect(201)).body as InterviewSaved;
      expect(saved.meeting).toBe('failed');
      expect(saved.meetingProblem).toBe('Google says the connection was revoked or has expired: connect the account again. Nobody was told yet: try again, or paste a link.');
      const mine = (await as('hr').get('/meetings/mine').expect(200)).body as MyMeetingsView;
      expect(mine.providers[0].connection).toMatchObject({ status: 'needs_reconnecting', problem: 'Google says the connection was revoked or has expired: connect the account again.' });
      expect(await prisma.notification.findMany({ where: { userId: users.hr, kind: 'meeting_connection' }, select: { title: true, link: true } })).toEqual([{ title: 'Connect your Google Meet again', link: '/account/meetings' }]);
      expect(await prisma.auditLog.count({ where: { entityType: 'meeting_connection', action: 'needs_reconnecting' } })).toBe(1);
      // no longer offered, and refused if chosen
      expect(((await as('hr').get('/meetings/choices').expect(200)).body as MeetingChoices).choices.map((c) => c.key)).not.toContain('personal:google');
      expect(said(await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, interviewBody({ meeting: 'personal:google', location: null })).expect(400))[0]).toMatch(/^Your Google Meet needs connecting again/);
      // connecting again mends it; disconnecting removes it
      expect((await connect('hr', 'google', 'personal', `personal-google-again-${RUN}`, emails.hr)).ok).toBe(true);
      expect(((await as('hr').get('/meetings/mine').expect(200)).body as MyMeetingsView).providers[0].connection).toMatchObject({ status: 'connected', problem: null });
      expect(((await as('hr').post('/meetings/mine/google/disconnect').expect(200)).body as MyMeetingsView).providers[0].connection).toBeNull();
      expect(await prisma.auditLog.count({ where: { entityType: 'meeting_connection', action: 'disconnect', userId: users.hr } })).toBe(1);
    });
  });

  describe('what nobody may see', () => {
    it('a developer sees no meeting link nor its id, on any interview page or in the audit log', async () => {
      const links = (await prisma.interview.findMany({ where: { applicationId }, select: { location: true } })).map((i) => i.location ?? '').filter((l) => l.startsWith('https://'));
      const ids = (await prisma.auditLog.findMany({ where: { entityType: 'interview', action: { startsWith: 'meeting_' } }, select: { diff: true } }))
        .map((a) => (a.diff as { meetingId?: string } | null)?.meetingId)
        .filter((x): x is string => !!x);
      expect(links.length).toBeGreaterThan(2);
      expect(ids.length).toBeGreaterThan(2);
      for (const path of [`/recruitment/applications/${applicationId}`, '/recruitment/interviews', '/recruitment/my-hiring', '/audit', `/audit?entityType=interview`, '/audit?entityType=meeting_connection', '/me/notifications']) {
        const res = await as('developer').get(path);
        expect([200, 403, 404], `${path}: ${res.status}`).toContain(res.status);
        const text = JSON.stringify(res.body);
        for (const l of links) expect(text, path).not.toContain(l);
        for (const id of ids) expect(text, path).not.toContain(id);
        expect(text, path).not.toMatch(/meet\.google\.com|zoom\.us\/j|teams\.microsoft\.com/);
        expect(text, path).not.toContain(COMPANY_GOOGLE);
      }
      const shown = (await as('developer').get(`/recruitment/applications/${applicationId}`).expect(200)).body.interviews as InterviewView[];
      expect(shown.length).toBeGreaterThan(2);
      expect(shown.every((i) => i.location === null && (i.meeting === null || i.meeting.joinUrl === null))).toBe(true);
      // HR sees them
      expect(JSON.stringify((await as('hr').get(`/recruitment/applications/${applicationId}`).expect(200)).body)).toMatch(/teams\.microsoft\.com/);
    });

    it('no token or secret in any answer or audit entry', async () => {
      expect(fake.secrets.size).toBeGreaterThan(8);
      const everything = JSON.stringify(answers);
      // the answers were kept (the settings name the company's account)
      expect(answers.length).toBeGreaterThan(40);
      expect(everything).toContain(COMPANY_GOOGLE);
      const audit = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: { in: ['meeting_settings', 'meeting_connection', 'interview'] } }, select: { diff: true } }));
      const notices = JSON.stringify(await prisma.notification.findMany({ where: { userId: { in: Object.values(users) } }, select: { title: true, body: true } }));
      for (const secret of fake.secrets) {
        expect(everything.includes(secret), `answers: ${secret.slice(0, 8)}…`).toBe(false);
        expect(audit.includes(secret), `audit: ${secret.slice(0, 8)}…`).toBe(false);
        expect(notices.includes(secret), `notifications: ${secret.slice(0, 8)}…`).toBe(false);
      }
      // nor kept as they came: sealed in the database
      const rows = JSON.stringify(await prisma.meetingConnection.findMany());
      for (const secret of fake.secrets) expect(rows.includes(secret)).toBe(false);
    });
  });
});
