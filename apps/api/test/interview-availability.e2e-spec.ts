import type { INestApplication } from '@nestjs/common';
import {
  addDaysYmd,
  LAW_LEAVE_TYPES,
  weekdayOf,
  type AvailabilityView,
  type InterviewersView,
  type InterviewHoursView,
  type InterviewSaved,
  type MyInterviewHoursView,
  type Role,
  type TimeCheckView,
  type VacancyView,
  zonedMoment,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CalendarHttp } from '../src/calendars/calendar-http.js';
import { addDays, todayInCairo, toDateOnly } from '../src/common/date-only.js';
import { MeetingHttp } from '../src/meetings/meeting-http.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { fakeCalendars, type FakeCalendars } from './fake-calendars.js';
import { createApp, createUser, signIn } from './helpers.js';

// Interviewers' availability (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; asked, "Hours + calendar" and "HR only"; then "its zoho mails"). Each interviewer sets weekly interview
// hours once (their own, or HR's for them; nobody else's; audited); "Find a time" for a panel gives the times all of them
// are free, with leave, booked interviews (and their buffer) and the company's Zoho Calendar busy times taken away (Zoho
// is a fake in CalendarHttp's place: nothing is ever sent to it); a calendar that refuses or is slow still leaves the
// times offered, marked; a time picked is booked as any interview; a time typed by hand that conflicts is saved with the
// warnings. Leave is only ever "unavailable", never its type; a C-level person's leave is only "isn't free" to HR, and
// their hours are the CEO's and a Super Admin's; no calendar event's title reaches any answer. Email is kept in
// MailService's outbox (MAIL_TRANSPORT=memory). Every name is invented; this file deletes what it made.

process.env.MAIL_TRANSPORT = 'memory';

const RUN = `ia${Date.now().toString(36)}`;
const TODAY = todayInCairo();
const ORIGIN = 'https://people.trendlix.test';
const ZOHO = { clientId: `1000.${RUN.toUpperCase()}AVAILAPP`, clientSecret: `zoho-${RUN}-avail-secret` };
const COMPANY_ZOHO = `hr.zoho.${RUN}@trendlix.test`;
const SECRET_TITLE = `Board meeting about the merger ${RUN}`;

/** The first Sunday at least three days ahead (past every notice), and the two after it. */
function firstSunday(): string {
  let d = addDays(TODAY, 3);
  while (weekdayOf(d) !== 0) d = addDays(d, 1);
  return d;
}
const SUN = firstSunday();
const SUN2 = addDaysYmd(SUN, 7);
const SUN3 = addDaysYmd(SUN, 14);
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

describe('Interviewers’ availability (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cal: FakeCalendars;
  const api = () => request(app.getHttpServer());
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const emails: Record<string, string> = {};
  const people: Record<string, string> = {};
  const work: Record<string, string> = {};
  const employeeIds: string[] = [];
  let departmentId: string;
  let jobTitleId: string;
  let vacancyId: string | undefined;
  let applicationId: string;
  let otherApplicationId: string;
  const answers: unknown[] = [];

  const kept = (t: request.Test) => t.on('response', (res: request.Response) => answers.push(res.body));
  const as = (who: string) => ({
    get: (path: string) => kept(api().get(`/api${path}`).set('Cookie', sessions[who])),
    put: (path: string, body: object) => kept(api().put(`/api${path}`).set('Cookie', sessions[who]).send(body)),
    post: (path: string, body: object = {}) => kept(api().post(`/api${path}`).set('Cookie', sessions[who]).send(body)),
  });
  const said = (res: request.Response) => (Array.isArray(res.body.message) ? res.body.message : [res.body.message]) as string[];
  const sunday = (from: string, to: string) => ({ windows: [{ day: 0, from, to }], changes: [], effectiveFrom: TODAY, noticeHours: null, bufferMinutes: null });
  const times = (v: AvailabilityView, date: string) => v.days.find((d) => d.date === date)!.slots.map((s) => s.time);
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  async function account(key: string, roles: Role[]) {
    const email = await createUser(prisma, roles);
    emails[key] = email;
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    sessions[key] = await signIn(app, email);
  }

  /** An account with an employee profile (its work email `work[key]`); `gradeCode` G9: a C-level person. */
  async function person(key: string, name: string, gradeCode?: string) {
    await account(key, ['employee']);
    work[key] = `${key.toLowerCase()}.${RUN}@trendlix.test`;
    const gradeId = gradeCode ? (await prisma.grade.findFirstOrThrow({ where: { code: gradeCode }, select: { id: true } })).id : null;
    const e = await prisma.employee.create({
      data: {
        employeeCode: `${key.toUpperCase()}-${RUN}`,
        fullNameEn: `${name} ${RUN}`,
        fullNameAr: 'اسم',
        workEmail: work[key],
        employments: { create: { employmentType: 'full_time', status: 'active', joinDate: new Date('2024-01-01'), departmentId, ...(gradeId && { gradeId }) } },
      },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: users[key] }, data: { employeeId: e.id } });
    people[key] = e.id;
    employeeIds.push(e.id);
    sessions[key] = await signIn(app, emails[key]);
  }

  /**
   * The hiring steps before a first interview (owner, 29 October 2026: "Manager view the shortlisted and accept or reject
   * them - HR Screening and scheduling"; hiring-steps.ts): shortlisted (as made here), accepted by Ahmed (the vacancy's
   * hiring manager), and HR's screening call passed.
   */
  async function readyToInterview(id: string) {
    await as('ahmed').post(`/recruitment/applications/${id}/suggest`, { suggestion: 'next' }).expect(200);
    await as('hr').post(`/recruitment/applications/${id}/screening-call`, { result: 'passed' }).expect(200);
  }

  /** A leave of theirs on a date, approved or waiting. */
  async function leave(key: string, date: string, status: 'approved' | 'with_hr') {
    const employment = await prisma.employment.findFirstOrThrow({ where: { employeeId: people[key] }, select: { id: true } });
    const type = await prisma.leaveType.findFirstOrThrow({ where: { key: 'annual' }, select: { id: true } });
    await prisma.leaveRequest.create({ data: { employeeId: people[key], employmentId: employment.id, typeId: type.id, startDate: toDateOnly(date), endDate: toDateOnly(date), days: 1, status, reason: `Family wedding ${RUN}` } });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    cal = fakeCalendars(RUN, { zoho: ZOHO });
    app.get(CalendarHttp).fetch = cal.fetch;
    app.get(MeetingHttp).fetch = cal.fetch;
    await prisma.calendarConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.meetingConnection.deleteMany({});
    await prisma.interviewSettings.deleteMany({});
    departmentId = (await prisma.department.create({ data: { nameEn: `Availability ${RUN}` }, select: { id: true } })).id;
    const gradeId = (await prisma.grade.findFirstOrThrow({ where: { code: 'G3' }, select: { id: true } })).id;
    const shiftId = (await prisma.shift.findFirstOrThrow({ where: { code: 'A' }, select: { id: true } })).id;
    jobTitleId = (await prisma.jobTitle.create({ data: { departmentId, titleEn: `Motion Designer ${RUN}`, jdPurpose: '<p>Animate the studio’s work.</p>' }, select: { id: true } })).id;
    await account('superAdmin', ['super_admin']);
    await account('hr', ['hr']);
    await account('ceo', ['ceo']);
    await person('ahmed', 'Ahmed Interviewer');
    await person('sara', 'Sara Panelist');
    await person('omar', 'Omar Executive', 'G9');
    await person('nour', 'Nour Colleague');
    const made = await as('hr').post('/recruitment/vacancies', { jobTitleId, employmentType: 'full_time', headcount: 1, gradeId, shiftId, salaryMin: 15000, salaryMax: 25000 }).expect(201);
    vacancyId = made.body.id;
    await as('hr').post(`/recruitment/vacancies/${vacancyId}/submit`).expect(200);
    const v = (await as('ceo').post(`/recruitment/vacancies/${vacancyId}/approve`).expect(200)).body as VacancyView;
    // Ahmed hires for it
    await prisma.vacancy.update({ where: { id: v.id }, data: { hiringManagerId: people.ahmed } });
    const applicant = async (n: number) =>
      (
        await prisma.jobApplication.create({
          data: {
            number: `APP-1998-${String(Date.now()).slice(-6)}${n}`,
            vacancyId: v.id,
            stage: 'shortlisted',
            fullName: `Candidate ${n} ${RUN}`,
            email: `candidate${n}.${RUN}@mail.test`,
            mobile: '+20 100 765 4321',
            consentAt: new Date(),
            cv: { create: { fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 10, data: Buffer.from('%PDF-1.4\n%%EOF\n') } },
            steps: { create: [{ event: 'applied', stage: 'applied' }, { event: 'shortlisted', stage: 'shortlisted' }] },
          },
          select: { id: true },
        })
      ).id;
    applicationId = await applicant(1);
    otherApplicationId = await applicant(2);
  });

  afterAll(async () => {
    if (vacancyId) {
      await prisma.jobApplication.deleteMany({ where: { vacancyId } });
      await prisma.vacancy.deleteMany({ where: { id: vacancyId } });
    }
    await prisma.calendarConnection.deleteMany({});
    await prisma.calendarApp.deleteMany({});
    await prisma.interviewSettings.deleteMany({});
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.interviewHours.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.user.updateMany({ where: { id: { in: Object.values(users) } }, data: { employeeId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.jobTitle.deleteMany({ where: { id: jobTitleId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  describe('interview hours', () => {
    it('are set once by the interviewer, checked, and audited; the dashboard asks until then', async () => {
      const before = (await as('ahmed').get('/me/interview-hours').expect(200)).body as MyInterviewHoursView;
      expect(before).toMatchObject({ employeeId: people.ahmed, hours: null, defaults: { noticeHours: 24, bufferMinutes: 15 }, needsHours: true, upcoming: [] });
      expect((await as('ahmed').get('/me/interview-hours/reminder').expect(200)).body).toEqual({ show: true });

      expect(said(await as('ahmed').put('/me/interview-hours', sunday('12:10', '15:00')).expect(400))).toEqual(['Start and end Sunday’s range on the quarter hour (:00, :15, :30, :45).']);
      expect(said(await as('ahmed').put('/me/interview-hours', { ...sunday('12:00', '15:00'), noticeHours: 12 }).expect(400))).toEqual(['Your notice can’t be shorter than the company’s 24 hours.']);

      const saved = (await as('ahmed').put('/me/interview-hours', sunday('12:00', '15:00')).expect(200)).body as MyInterviewHoursView;
      expect(saved.hours).toEqual({ windows: [{ day: 0, from: '12:00', to: '15:00' }], changes: [], effectiveFrom: TODAY, noticeHours: null, bufferMinutes: null });
      expect(saved.needsHours).toBe(false);
      expect((await as('ahmed').get('/me/interview-hours/reminder').expect(200)).body).toEqual({ show: false });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'interview_hours', entityId: people.ahmed }, orderBy: { id: 'desc' } });
      expect(audit).toMatchObject({ action: 'create', userId: users.ahmed, diff: { windows: { from: 'None', to: 'Sun 12:00 PM–3:00 PM' } } });

      // an account that isn't an employee's has none, and no reminder
      expect(said(await as('hr').get('/me/interview-hours').expect(404))).toEqual(['Your account has no employee profile: interview hours are for the people who interview.']);
      expect((await as('hr').get('/me/interview-hours/reminder').expect(200)).body).toEqual({ show: false });
    });

    it('are set by HR for others; anyone else is refused; a C-level person’s are only the CEO’s and a Super Admin’s', async () => {
      const sara = (await as('hr').put(`/interview-hours/people/${people.sara}`, sunday('13:00', '16:00')).expect(200)).body as InterviewHoursView;
      expect(sara.hours?.windows).toEqual([{ day: 0, from: '13:00', to: '16:00' }]);
      expect(await prisma.auditLog.count({ where: { entityType: 'interview_hours', entityId: people.sara, userId: users.hr } })).toBe(1);

      for (const res of [
        await as('nour').get(`/interview-hours/people/${people.sara}`),
        await as('nour').put(`/interview-hours/people/${people.sara}`, sunday('09:00', '10:00')),
        await as('nour').get('/interview-hours'),
        await as('nour').post('/recruitment/availability', { interviewerIds: [people.sara], minutes: 30, kind: 'online', from: SUN, to: SUN }),
      ]) {
        expect(res.status).toBe(403);
      }
      // the CEO reads, but books nothing
      expect((await as('ceo').post('/recruitment/availability', { interviewerIds: [people.sara], minutes: 30, kind: 'online', from: SUN, to: SUN }).expect(403)).body.message).toBe(
        'Only HR (or a Super Admin) finds times and books interviews.',
      );

      expect((await as('hr').get(`/interview-hours/people/${people.omar}`)).status).toBe(404);
      expect((await as('hr').put(`/interview-hours/people/${people.omar}`, sunday('09:00', '17:00'))).status).toBe(404);
      await as('ceo').put(`/interview-hours/people/${people.omar}`, sunday('09:00', '17:00')).expect(200);
      expect(((await as('superAdmin').get(`/interview-hours/people/${people.omar}`).expect(200)).body as InterviewHoursView).hours?.windows).toHaveLength(1);

      const list = (await as('hr').get('/interview-hours').expect(200)).body as InterviewersView;
      const ahmed = list.people.find((p) => p.employeeId === people.ahmed);
      expect(ahmed).toMatchObject({ reasons: ['hiring_manager', 'hours'], summary: 'Sun 12:00 PM–3:00 PM' });
      expect(list.people.some((p) => p.employeeId === people.sara)).toBe(true);
      expect(list.people.some((p) => p.employeeId === people.omar)).toBe(false);
      expect(list.settings.defaults).toEqual({ noticeHours: 24, bufferMinutes: 15 });
      expect(((await as('ceo').get('/interview-hours').expect(200)).body as InterviewersView).people.some((p) => p.employeeId === people.omar)).toBe(true);
    });

    it('take the company’s defaults, changed by HR and audited', async () => {
      expect(said(await as('hr').put('/interview-hours/settings', { noticeHours: 24, bufferMinutes: 7 }).expect(400))).toEqual(['Give the buffer between interviews in minutes, in fives, from 0 to 120.']);
      const changed = (await as('hr').put('/interview-hours/settings', { noticeHours: 48, bufferMinutes: 15 }).expect(200)).body;
      expect(changed.defaults).toEqual({ noticeHours: 48, bufferMinutes: 15 });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'interview_settings' }, orderBy: { id: 'desc' } });
      expect(audit).toMatchObject({ action: 'update', userId: users.hr, diff: { noticeHours: { from: 24, to: 48 } } });
      await as('hr').put('/interview-hours/settings', { noticeHours: 24, bufferMinutes: 15 }).expect(200);
      expect((await as('nour').put('/interview-hours/settings', { noticeHours: 1, bufferMinutes: 0 })).status).toBe(403);
    });
  });

  describe('"Find a time"', () => {
    it('connects the company’s Zoho Calendar (a Super Admin, once)', async () => {
      await as('superAdmin').put('/calendars/apps/zoho', { clientId: ZOHO.clientId, clientSecret: ZOHO.clientSecret, dataCentre: 'com' }).expect(200);
      const started = (await as('superAdmin').post('/calendars/oauth/start', { provider: 'zoho', owner: 'company', origin: ORIGIN }).expect(200)).body as { url: string };
      cal.code('zoho', `code-${RUN}`, COMPANY_ZOHO);
      const done = (await as('superAdmin').post('/calendars/oauth/finish', { provider: 'zoho', code: `code-${RUN}`, state: new URL(started.url).searchParams.get('state') }).expect(200)).body;
      expect(done.ok).toBe(true);
    });

    it('gives the panel’s common free times, without leave, booked interviews and busy calendars', async () => {
      // Sara's calendar is busy on Sunday 1:00–1:30 PM; Ahmed has another interview at 2:30 PM (15 minutes' buffer)
      cal.busy(work.sara, [{ start: at(SUN, '13:00'), end: at(SUN, '13:30'), title: SECRET_TITLE }]);
      await prisma.interview.create({
        data: { applicationId: otherApplicationId, startsAt: at(SUN, '14:30'), minutes: 30, kind: 'online', location: 'https://meet.example.test/x', interviewers: { create: [{ employeeId: people.ahmed }] } },
      });
      // Sara is on leave the next Sunday; Ahmed's leave the one after waits for a decision
      await leave('sara', SUN2, 'approved');
      await leave('ahmed', SUN3, 'with_hr');

      const v = (await as('hr').post('/recruitment/availability', { interviewerIds: [people.ahmed, people.sara], minutes: 30, kind: 'online', from: SUN, to: SUN3 }).expect(200)).body as AvailabilityView;
      // Ahmed 12–3, Sara 1–4: 1–3, less her busy 1–1:30 and his interview's 2:15–3:15
      expect(times(v, SUN)).toEqual(['13:30', '13:45']);
      expect(v.days.find((d) => d.date === SUN)!.slots.every((s) => !s.marked && s.people.every((p) => p.status === 'free'))).toBe(true);
      expect(times(v, SUN2)).toEqual([]);
      const third = v.days.find((d) => d.date === SUN3)!;
      expect(third.slots.map((s) => s.time)).toEqual(['13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30']);
      expect(third.slots.every((s) => s.marked && s.people.find((p) => p.employeeId === people.ahmed)?.status === 'maybe')).toBe(true);
      expect(v.people.map((p) => [p.employeeId, p.hasHours, p.calendar, p.sources])).toEqual([
        [people.ahmed, true, 'checked', ['Zoho Calendar']],
        [people.sara, true, 'checked', ['Zoho Calendar']],
      ]);
      // read live from Zoho by each one's work email
      expect(cal.calls.some((c) => c.url.includes('/api/v1/calendars/freebusy') && c.url.includes(encodeURIComponent(work.sara)))).toBe(true);
      // moments in Cairo's time: 1:30 PM on the Sunday
      const first = v.days.find((d) => d.date === SUN)!.slots[0];
      expect(CLOCK.format(new Date(first.start))).toBe('13:30');
    });

    it('still offers the times when a calendar refuses or is slow, marked', async () => {
      cal.fail(work.sara);
      const failed = (await as('hr').post('/recruitment/availability', { interviewerIds: [people.ahmed, people.sara], minutes: 30, kind: 'online', from: SUN, to: SUN }).expect(200)).body as AvailabilityView;
      expect(times(failed, SUN)).toEqual(['13:00', '13:15', '13:30', '13:45']);
      expect(failed.days[0].slots.every((s) => s.marked && s.people.find((p) => p.employeeId === people.sara)?.status === 'maybe')).toBe(true);
      expect(failed.people.find((p) => p.employeeId === people.sara)?.calendar).toBe('failed');
      expect(failed.notes.some((n) => n.startsWith('Couldn’t check Sara’s calendar'))).toBe(true);
      cal.heal(work.sara);
      cal.busy(work.sara, [{ start: at(SUN, '13:00'), end: at(SUN, '13:30'), title: SECRET_TITLE }]);

      cal.slow(work.sara, 7000);
      const started = Date.now();
      const slow = (await as('hr').post('/recruitment/availability', { interviewerIds: [people.sara], minutes: 30, kind: 'online', from: SUN, to: SUN }).expect(200)).body as AvailabilityView;
      expect(Date.now() - started).toBeLessThan(6500);
      expect(slow.people[0].calendar).toBe('failed');
      expect(slow.days[0].slots.length).toBeGreaterThan(0);
      cal.heal(work.sara);
      cal.busy(work.sara, [{ start: at(SUN, '13:00'), end: at(SUN, '13:30'), title: SECRET_TITLE }]);
    }, 30_000);

    it('books a time picked as any interview, and the time is then taken', async () => {
      await readyToInterview(applicationId);
      const saved = (
        await as('hr').post(`/recruitment/applications/${applicationId}/interviews`, { date: SUN, time: '13:30', minutes: 30, kind: 'in_person', interviewerIds: [people.ahmed, people.sara] }).expect(201)
      ).body as InterviewSaved;
      expect(saved.warnings).toEqual([]);
      expect(saved.interview).toMatchObject({ status: 'scheduled', minutes: 30, kind: 'in_person' });
      expect(saved.interview.interviewers.map((i) => i.employeeId).sort()).toEqual([people.ahmed, people.sara].sort());
      expect(saved.email).toBe('sent');
      const after = (await as('hr').post('/recruitment/availability', { interviewerIds: [people.ahmed, people.sara], minutes: 30, kind: 'online', from: SUN, to: SUN }).expect(200)).body as AvailabilityView;
      expect(times(after, SUN)).toEqual([]);
      // the interviewer sees it on their own page
      const mine = (await as('sara').get('/me/interview-hours').expect(200)).body as MyInterviewHoursView;
      expect(mine.upcoming.map((u) => u.id)).toContain(saved.interview.id);
    });

    it('saves a time typed by hand that conflicts, with the warnings; and checks a move the same way', async () => {
      await leave('omar', SUN, 'approved');
      await readyToInterview(otherApplicationId);
      const saved = (
        await as('hr')
          .post(`/recruitment/applications/${otherApplicationId}/interviews`, { date: SUN, time: '14:30', minutes: 30, kind: 'online', location: 'https://meet.example.test/y', interviewerIds: [people.ahmed, people.omar] })
          .expect(201)
      ).body as InterviewSaved;
      expect(saved.warnings).toEqual(['Ahmed has another interview at 2:30 PM.', 'Omar isn’t free then.']);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'interview', entityId: saved.interview.id, action: 'schedule' } });
      expect(audit.diff).toMatchObject({ warnings: saved.warnings });

      // the same time checked by a Super Admin, who sees C-level people: Omar is unavailable (never the leave's type)
      const seen = (await as('superAdmin').post('/recruitment/availability/check', { interviewerIds: [people.omar], date: SUN, time: '14:30', minutes: 30, kind: 'online', interviewId: saved.interview.id }).expect(200)).body as TimeCheckView;
      expect(seen.warnings).toEqual(['Omar is unavailable then.']);

      // outside the hours, and Sara's leave on the move
      const outside = (await as('hr').post('/recruitment/availability/check', { interviewerIds: [people.ahmed], date: SUN, time: '10:00', minutes: 30, kind: 'online' }).expect(200)).body as TimeCheckView;
      expect(outside.warnings).toEqual(['Outside Ahmed’s interview hours.']);
      const moved = (
        await as('hr')
          .put(`/recruitment/interviews/${saved.interview.id}`, { date: SUN2, time: '13:30', minutes: 30, kind: 'online', location: 'https://meet.example.test/y', interviewerIds: [people.sara], meeting: 'link' })
          .expect(200)
      ).body as InterviewSaved;
      expect(moved.warnings).toEqual(['Sara is unavailable then.']);
      // a move left out of their own booked interviews: back to the same time warns of nothing new
      const same = (await as('hr').post('/recruitment/availability/check', { interviewerIds: [people.sara], date: SUN2, time: '13:30', minutes: 30, kind: 'online', interviewId: saved.interview.id }).expect(200)).body as TimeCheckView;
      expect(same.warnings).toEqual(['Sara is unavailable then.']);
    });

    it('never gives a leave’s type, a calendar event’s title, a token or a secret', async () => {
      const text = JSON.stringify(answers);
      for (const t of LAW_LEAVE_TYPES) expect(text, t.nameEn).not.toContain(t.nameEn);
      expect(text).not.toContain('Family wedding');
      expect(text).not.toContain(SECRET_TITLE);
      for (const s of cal.secrets) expect(text).not.toContain(s);
      const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { at: { gte: new Date(Date.now() - 3_600_000) } }, select: { diff: true } }));
      expect(audits).not.toContain(SECRET_TITLE);
      for (const s of cal.secrets) expect(audits).not.toContain(s);
    });
  });
});
