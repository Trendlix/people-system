import type { INestApplication } from '@nestjs/common';
import type { ApplicationView, HiringBatchResult, MyHiring, Role, VacancyView } from '@trendlix/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MailService } from '../src/mail/mail.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The hiring steps, HR's shortlist and the hiring manager's review (owner, 29 October 2026: "HR Filteration and
// shortlisting - Manager view the shortlisted and accept or reject them"; asked, "Tick several at once" and "One message
// per batch"). A Video Editor vacancy with Hana as its hiring manager, another without one, and one whose hiring manager
// is in HR: HR shortlists several at once (those at Applied of the vacancy; the others skipped with why), Hana told once a
// batch in the app and by email, also for a single shortlist; Hana accepts or rejects several at once with a note, HR
// told once a batch; My Hiring lists her shortlist, those not reviewed first; HR's move clears her review. Email is kept
// in MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `hs${Date.now().toString(36)}`;

describe('The hiring steps: HR’s shortlist and the hiring manager’s review (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: MailService;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  let departmentId: string;
  let jobTitleId: string;
  let gradeId: string;
  let shiftId: string;
  /** Hana's vacancy, one without a hiring manager, and one whose hiring manager is in HR. */
  let v: VacancyView;
  let noManager: VacancyView;
  let hrManaged: VacancyView;
  const vacancyIds: string[] = [];
  const employeeIds: string[] = [];
  const apps: Record<string, string> = {};
  let n = 0;

  const get = (as: string, path: string) => api().get(`/api${path}`).set('Cookie', sessions[as]);
  const post = (as: string, path: string, body: object = {}) => api().post(`/api${path}`).set('Cookie', sessions[as]).send(body);
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const notices = (key: string, kind: string) => prisma.notification.findMany({ where: { userId: users[key], kind }, orderBy: { createdAt: 'asc' }, select: { title: true, body: true, link: true } });
  const name = (key: string) => `${key} Applicant ${RUN}`;
  const job = `Video Editor ${RUN}`;

  /** A user with an employee profile (their work email their sign-in) and a current employment. */
  async function person(key: string, roles: Role[], fullName: string) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${fullName} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: email,
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId } },
      },
      select: { id: true },
    });
    people[key] = e.id;
    employeeIds.push(e.id);
  }

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** A vacancy drafted by HR and approved by the CEO. */
  async function vacancy(hiringManagerId: string | null): Promise<VacancyView> {
    const made = await post('hr', '/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 2, gradeId, shiftId, ...(hiringManagerId && { hiringManagerId }) }).expect(201);
    vacancyIds.push(made.body.id);
    await post('hr', `/recruitment/vacancies/${made.body.id}/submit`).expect(200);
    return (await post('ceo', `/recruitment/vacancies/${made.body.id}/approve`).expect(200)).body as VacancyView;
  }

  /** An applicant as the careers page makes one, at a stage (its history to it); the earlier made, the better their match. */
  async function applicant(key: string, vacancyId: string, stage: 'applied' | 'shortlisted', extra: { filteredOut?: boolean } = {}) {
    n++;
    const steps = [{ event: 'applied', stage: 'applied' }];
    if (stage === 'shortlisted') steps.push({ event: 'shortlisted', stage: 'shortlisted' });
    const a = await prisma.jobApplication.create({
      data: {
        // a year the careers page never numbers, so the numbering of real applications never meets it
        number: `APP-1998-${String(Date.now()).slice(-7)}${n}`,
        vacancyId,
        stage,
        filteredOut: extra.filteredOut ?? false,
        fullName: name(key),
        email: `${key.toLowerCase()}.${RUN}@mail.test`,
        mobile: '+20 100 123 4567',
        consentAt: new Date(),
        matchPercent: 80 - n,
        points: 8,
        maxPoints: 10,
        cv: { create: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 10, data: Buffer.from('%PDF-1.4\n%%EOF\n') } },
        steps: { create: steps.map((s, i) => ({ ...s, at: new Date(Date.now() - (steps.length - i) * 86_400_000) })) },
      },
      select: { id: true },
    });
    apps[key] = a.id;
    return a.id;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    mail = app.get(MailService);
    departmentId = (await prisma.department.create({ data: { nameEn: `Post Production ${RUN}` }, select: { id: true } })).id;
    gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: job, jdPurpose: '<p>Edit the studio’s videos.</p>' }, select: { id: true } })).id;
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await person('hm', ['employee', 'manager'], 'Hana Hiring');
    await person('hrHm', ['hr'], 'Hadi HR');
    await person('outsider', ['employee'], 'Omar Outsider');
    v = await vacancy(people.hm);
    noManager = await vacancy(null);
    hrManaged = await vacancy(people.hrHm);
    await applicant('Sara', v.id, 'applied');
    await applicant('Adam', v.id, 'applied');
    await applicant('Nour', v.id, 'applied');
    await applicant('Lina', v.id, 'applied');
    await applicant('Fady', v.id, 'applied', { filteredOut: true });
    await applicant('Omar', v.id, 'shortlisted');
    await applicant('Bassem', noManager.id, 'applied');
    await applicant('Basma', noManager.id, 'applied');
    await applicant('Hoda', hrManaged.id, 'applied');
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { vacancyId: { in: vacancyIds } } });
    await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('HR shortlists several at once', () => {
    it('shortlists those at Applied of the vacancy, each as their page would; the others skipped with why', async () => {
      const before = mail.outbox.length;
      const stray = randomUUID();
      const r = (
        await post('hr', `/recruitment/vacancies/${v.id}/shortlist`, { applicationIds: [apps.Sara, apps.Adam, apps.Fady, apps.Omar, apps.Bassem, stray, apps.Nour, apps.Sara] }).expect(200)
      ).body as HiringBatchResult;
      expect(r.done.map((d) => d.id)).toEqual([apps.Sara, apps.Adam, apps.Nour]);
      expect(r.done[0]).toMatchObject({ fullName: name('Sara'), number: expect.stringMatching(/^APP-1998-/) });
      expect(r.skipped).toEqual([
        { id: apps.Fady, number: expect.any(String), fullName: name('Fady'), reason: 'They failed a must-have question and were filtered out: restore them first.' },
        { id: apps.Omar, number: expect.any(String), fullName: name('Omar'), reason: 'They are shortlisted already.' },
        { id: apps.Bassem, number: expect.any(String), fullName: name('Bassem'), reason: 'They applied to another vacancy.' },
        { id: stray, number: null, fullName: null, reason: 'Applicant not found.' },
      ]);
      // as Shortlist on their page: the stage, the history step by HR, the audit log
      const sara = (await get('hr', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView;
      expect(sara.stage).toBe('shortlisted');
      expect(sara.history.at(-1)).toMatchObject({ event: 'shortlisted', stage: 'shortlisted', by: { email: emails.hr } });
      expect(await prisma.auditLog.count({ where: { entityType: 'job_application', entityId: { in: [apps.Sara, apps.Adam, apps.Nour] }, action: 'stage' } })).toBe(3);
      // those skipped stay as they were
      expect((await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.Fady }, select: { stage: true } })).stage).toBe('applied');
      expect((await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.Bassem }, select: { stage: true } })).stage).toBe('applied');
      // Hana told once, in the app and by email
      expect(await notices('hm', 'shortlist_review')).toEqual([
        { title: `3 applicants shortlisted for ${job}: please accept or reject them`, body: [name('Sara'), name('Adam'), name('Nour')].join(', '), link: '/recruitment/my-hiring' },
      ]);
      const sent = mail.outbox.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: emails.hm, replyTo: emails.hr, subject: `3 applicants shortlisted for ${job}: please accept or reject them` });
      expect(sent[0].text).toContain(`- ${name('Adam')}`);
      expect(sent[0].text).toMatch(/Please accept or reject them on My Hiring: https?:\/\/\S+\/recruitment\/my-hiring$/);
    });

    it('is HR’s (or a Super Admin’s) only, a list of 1 to 100 applicants, on a vacancy they see', async () => {
      for (const who of ['hm', 'outsider', 'ceo']) await post(who, `/recruitment/vacancies/${v.id}/shortlist`, { applicationIds: [apps.Lina] }).expect(403);
      expect(said(await post('hr', `/recruitment/vacancies/${v.id}/shortlist`, { applicationIds: [] }).expect(400))).toEqual(['Tick at least one applicant to shortlist.']);
      expect(said(await post('hr', `/recruitment/vacancies/${v.id}/shortlist`, { applicationIds: ['APP-1'] }).expect(400))).toEqual(['Send each applicant as their application’s id.']);
      const many = Array.from({ length: 101 }, () => randomUUID());
      expect(said(await post('hr', `/recruitment/vacancies/${v.id}/shortlist`, { applicationIds: many }).expect(400))).toEqual(['Shortlist at most 100 applicants at a time.']);
      await post('hr', `/recruitment/vacancies/${randomUUID()}/shortlist`, { applicationIds: [apps.Lina] }).expect(404);
      // nothing shortlisted: nobody told
      const r = (await post('hr', `/recruitment/vacancies/${v.id}/shortlist`, { applicationIds: [apps.Omar] }).expect(200)).body as HiringBatchResult;
      expect(r).toEqual({ done: [], skipped: [expect.objectContaining({ id: apps.Omar, reason: 'They are shortlisted already.' })] });
      expect(await notices('hm', 'shortlist_review')).toHaveLength(1);
      expect((await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.Lina }, select: { stage: true } })).stage).toBe('applied');
    });

    it('tells the hiring manager of a single shortlist too, a batch of one', async () => {
      await post('hr', `/recruitment/applications/${apps.Lina}/stage`, { to: 'shortlisted' }).expect(200);
      const told = await notices('hm', 'shortlist_review');
      expect(told).toHaveLength(2);
      expect(told[1]).toEqual({ title: `1 applicant shortlisted for ${job}: please accept or reject them`, body: name('Lina'), link: '/recruitment/my-hiring' });
    });

    it('tells nobody on a vacancy without a hiring manager, nor a hiring manager who shortlisted them themself', async () => {
      const before = mail.outbox.length;
      expect(((await post('hr', `/recruitment/vacancies/${noManager.id}/shortlist`, { applicationIds: [apps.Basma] }).expect(200)).body as HiringBatchResult).done.map((d) => d.id)).toEqual([apps.Basma]);
      expect(((await post('hrHm', `/recruitment/vacancies/${hrManaged.id}/shortlist`, { applicationIds: [apps.Hoda] }).expect(200)).body as HiringBatchResult).done.map((d) => d.id)).toEqual([apps.Hoda]);
      expect(await prisma.notification.count({ where: { kind: 'shortlist_review', body: { in: [name('Basma'), name('Hoda')] } } })).toBe(0);
      expect(mail.outbox.length).toBe(before);
    });
  });

  describe('the hiring manager reviews several at once', () => {
    it('is the vacancy’s hiring manager’s only', async () => {
      for (const who of ['hr', 'outsider', 'hrHm']) await post(who, `/recruitment/vacancies/${v.id}/review`, { applicationIds: [apps.Sara], decision: 'next' }).expect(403);
      await post('hm', `/recruitment/vacancies/${noManager.id}/review`, { applicationIds: [apps.Basma], decision: 'next' }).expect(403);
      expect(said(await post('hm', `/recruitment/vacancies/${v.id}/review`, { applicationIds: [apps.Sara], decision: 'maybe' }).expect(400))).toEqual(['Choose Accept or Reject.']);
      expect(said(await post('hm', `/recruitment/vacancies/${v.id}/review`, { applicationIds: [apps.Sara], decision: 'next', note: 'x'.repeat(501) }).expect(400))).toEqual([
        'Keep the note to 500 characters or fewer.',
      ]);
      expect(said(await post('hm', `/recruitment/vacancies/${v.id}/review`, { applicationIds: [], decision: 'next' }).expect(400))).toEqual(['Tick at least one applicant to accept or reject.']);
      expect(await notices('hr', 'hiring_suggestion')).toEqual([]);
    });

    it('accepts or rejects them with a note, kept as their review; HR told once a batch', async () => {
      const accepted = (await post('hm', `/recruitment/vacancies/${v.id}/review`, { applicationIds: [apps.Sara, apps.Adam], decision: 'next' }).expect(200)).body as HiringBatchResult;
      expect(accepted).toEqual({ done: [expect.objectContaining({ id: apps.Sara }), expect.objectContaining({ id: apps.Adam })], skipped: [] });
      const rejected = (
        await post('hm', `/recruitment/vacancies/${v.id}/review`, { applicationIds: [apps.Nour, apps.Fady, apps.Bassem], decision: 'reject', note: '  Not enough motion work  ' }).expect(200)
      ).body as HiringBatchResult;
      expect(rejected.done.map((d) => d.id)).toEqual([apps.Nour]);
      // one filtered out, and another vacancy's: neither hers to see
      expect(rejected.skipped).toEqual([
        { id: apps.Fady, number: null, fullName: null, reason: 'Applicant not found.' },
        { id: apps.Bassem, number: null, fullName: null, reason: 'Applicant not found.' },
      ]);
      const nour = (await get('hr', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView;
      expect(nour.stage).toBe('shortlisted');
      expect(nour.suggestion).toMatchObject({ kind: 'reject', note: 'Not enough motion work', by: { email: emails.hm } });
      expect(((await get('hr', `/recruitment/applications/${apps.Sara}`).expect(200)).body as ApplicationView).suggestion).toMatchObject({ kind: 'next', note: null });
      expect(await prisma.auditLog.count({ where: { entityType: 'job_application', entityId: { in: [apps.Sara, apps.Adam, apps.Nour] }, action: 'suggest' } })).toBe(3);
      const link = `/recruitment/vacancies/${v.id}?stage=shortlisted`;
      expect(await notices('hr', 'hiring_suggestion')).toEqual([
        { title: 'Hiring manager reviewed the shortlist: 2 accepted', body: job, link },
        { title: 'Hiring manager reviewed the shortlist: 1 rejected', body: job, link },
      ]);
    });

    it('skips one not shortlisted; reviewing nobody tells nobody', async () => {
      await post('hr', `/recruitment/applications/${apps.Adam}/stage`, { to: 'rejected', reason: 'Took another job' }).expect(200);
      const r = (await post('hm', `/recruitment/vacancies/${v.id}/review`, { applicationIds: [apps.Adam], decision: 'next' }).expect(200)).body as HiringBatchResult;
      expect(r).toEqual({ done: [], skipped: [{ id: apps.Adam, number: expect.any(String), fullName: name('Adam'), reason: 'They were rejected already.' }] });
      expect(await notices('hr', 'hiring_suggestion')).toHaveLength(2);
    });

    it('a single review on an applicant’s page tells HR in its words', async () => {
      await post('hm', `/recruitment/applications/${apps.Lina}/suggest`, { suggestion: 'next' }).expect(200);
      expect((await notices('hr', 'hiring_suggestion')).at(-1)).toEqual({ title: 'Accepted by the hiring manager', body: `${name('Lina')} · ${job}`, link: `/recruitment/applicants/${apps.Lina}` });
    });
  });

  describe('My Hiring', () => {
    it('lists the shortlist to review: those not reviewed first, then accepted, then rejected, each with their review', async () => {
      const mine = (await get('hm', '/recruitment/my-hiring').expect(200)).body as MyHiring;
      expect(mine.toReview).toHaveLength(1);
      const group = mine.toReview![0];
      expect(group.vacancy).toEqual({ id: v.id, number: v.number, title: job });
      // Omar (not reviewed); Sara and Lina (accepted, the best match first); Nour (rejected); Adam, rejected by HR, gone
      expect(group.applicants.map((a) => a.fullName)).toEqual([name('Omar'), name('Sara'), name('Lina'), name('Nour')]);
      const [omar, sara] = group.applicants;
      expect(omar).toMatchObject({ id: apps.Omar, suggestion: null, note: null, matchPercent: 74, cvMatchPercent: null, yearsTyped: null });
      expect(omar.shortlistedAt).toEqual(expect.any(String));
      expect(sara).toMatchObject({ id: apps.Sara, suggestion: 'next', note: null, matchPercent: 79 });
      expect(Date.now() - Date.parse(sara.shortlistedAt!)).toBeLessThan(10 * 60_000);
      expect(sara.fromCv).not.toBeNull();
      expect(group.applicants.at(-1)).toMatchObject({ id: apps.Nour, suggestion: 'reject', note: 'Not enough motion work' });
      // nobody else's shortlist
      expect(((await get('outsider', '/recruitment/my-hiring').expect(200)).body as MyHiring).toReview ?? []).toEqual([]);
      // the vacancy without a hiring manager: nobody's
      expect(JSON.stringify(mine)).not.toContain(name('Basma'));
    });

    it('drops their review once HR moves them: HR confirms a rejection with its reason', async () => {
      await post('hr', `/recruitment/applications/${apps.Nour}/stage`, { to: 'rejected', reason: 'The hiring manager’s rejection' }).expect(200);
      const nour = (await get('hr', `/recruitment/applications/${apps.Nour}`).expect(200)).body as ApplicationView;
      expect(nour).toMatchObject({ stage: 'rejected', suggestion: null });
      expect((await prisma.jobApplication.findUniqueOrThrow({ where: { id: apps.Nour }, select: { suggestion: true, suggestionNote: true, suggestedById: true } })).suggestion).toBeNull();
      const mine = (await get('hm', '/recruitment/my-hiring').expect(200)).body as MyHiring;
      expect(mine.toReview![0].applicants.map((a) => a.id)).not.toContain(apps.Nour);
    });
  });
});
