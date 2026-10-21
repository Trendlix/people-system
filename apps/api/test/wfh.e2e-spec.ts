import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { OFF_NETWORK_MESSAGE } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { WfhService } from '../src/wfh/wfh.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp"; asked,
// "Manager, then HR", "its 2 days per month with a gap of 1 week between each record (Biweekly)", "A day before"): the
// Leave Setup's limits; who asks for a day (an Office arrangement on a working day, a Hybrid one on its office days only;
// Work from home and Outdoor never; not on a rest day, an official holiday or a day of leave); the notice (today refused,
// tomorrow fine); 2 a calendar month and 7 days apart, across months; decided by the approver in charge (the direct
// manager, else the team lead), then HR, a C-level person's HR stage by the CEO; cancelled while being decided, by HR
// once approved; HR recording a day with a reason, past the limits with warnings; an approved day at check-in (no
// "Outside the office" flag, the office network's lock waived); the attendance month showing it; the notifications; and
// Zoho People's history brought over, duplicates skipped. These tests look at their own people (names end with RUN) and
// delete what they made. Every name, point and address is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);
const AFTER = monthsLater(CURRENT, 2);

const OFFICE = { name: `Head ${RUN}`, latitude: 30.0596, longitude: 31.3462, radiusMetres: 150 };
const FAR = { latitude: 29.9792, longitude: 31.1342, accuracy: 30 };

interface View {
  id: string;
  kind: 'wfh';
  employee: { id: string; fullNameEn: string };
  type: { nameEn: string };
  date: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  stage: string | null;
  waitingForYou: boolean;
  confidential: boolean;
  canCancel: boolean;
  hrCanCancel: boolean;
  manager: { id: string; fullNameEn: string; role: string } | null;
  rejectedStage: string | null;
  rejectReason: string | null;
  recordedByHr: boolean;
  source: string;
  warnings: string[];
  steps: { kind: string; decision: string | null; comment: string | null; actor: string | null }[];
  monthUsed: number | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const kinds = (v: View) => v.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
/** The first day of `month` on `wd` (0 = Sunday). */
const firstOn = (month: string, wd: number) => [...Array(7).keys()].map((n) => addDays(firstDay(month), n)).find((d) => weekday(d) === wd)!;

describe('Working from home (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let ceo: string;
  let ceoUserId: string;
  let hrSuper: string;
  let emailDomainBefore: string | null;
  let networksBefore: { officeNetworks: unknown; officeNetworkLock: boolean };
  let deptId: string;
  let teamId: string;
  let shiftId: string;
  let holiday: string;
  let holidayMade = false;
  const locations: string[] = [];
  const sessions: Record<string, string> = {};
  const users: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account, hired from 2024 under the every-day shift unless said. */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, session = () => hr) {
    const email = await createUser(prisma, ['employee']);
    users[key] = (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, shiftId, workArrangement: 'office', ...employment })
      .expect(201);
  }

  const ask = (key: string, body: Record<string, unknown>) => api().post('/api/me/wfh').set('Cookie', sessions[key]).send(body);
  const record = (employeeId: string, body: Record<string, unknown>, session = hr) => api().post('/api/wfh').set('Cookie', session).send({ employeeId, ...body });
  const decide = (id: string, session: string, body: object = { decision: 'approve' }) => api().post(`/api/wfh/${id}/decide`).set('Cookie', session).send(body);
  const one = async (id: string, session = hr) => (await api().get(`/api/wfh/${id}`).set('Cookie', session).expect(200)).body as View;
  const inbox = (key: string | { userId: string }) =>
    prisma.notification.findMany({ where: { userId: typeof key === 'string' ? users[key] : key.userId, kind: { startsWith: 'wfh_' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { kind: true, title: true, body: true, link: true } });
  const punch = (key: string, body: Record<string, unknown>) => api().post('/api/me/attendance/punches').set('Cookie', sessions[key]).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoUserId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    const s = await prisma.payrollSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 }, select: { officeNetworks: true, officeNetworkLock: true } });
    networksBefore = { officeNetworks: s.officeNetworks, officeNetworkLock: s.officeNetworkLock };
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Working From Home ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Desk', parentId: deptId }).expect(201)).body.id;
    // a shift working every day, so the days these tests pick are working days whatever the weekday
    shiftId = (
      await prisma.shift.create({
        data: { code: `W${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    // the owner's limits, whatever an earlier test left
    await api().patch('/api/wfh/settings').set('Cookie', hr).send({ daysPerMonth: 2, minGapDays: 7 }).expect(200);
    // an official holiday on a day of next month nobody else here asks for
    holiday = addDays(firstDay(NEXT), 24);
    if (!(await prisma.holiday.findUnique({ where: { date: toDateOnly(holiday) } }))) {
      await prisma.holiday.create({ data: { date: toDateOnly(holiday), nameEn: `Test Day ${RUN}` } });
      holidayMade = true;
    }

    // everyone hired before the leads are chosen, so none of them gets a lead as their direct manager
    await person('mona', 'Mona Manager');
    await person('ben', 'Ben Asking', { managerId: ids.mona });
    await person('nia', 'Nia Notice', { managerId: ids.mona });
    await person('nora', 'Nora Alone', { departmentId: null });
    await person('hana', 'Hana Hybrid', { managerId: ids.mona, workArrangement: 'hybrid', officeDays: [0, 1] });
    await person('walid', 'Walid Wfh', { workArrangement: 'wfh' });
    await person('otto', 'Otto Outdoor', { workArrangement: 'outdoor' });
    await person('rhea', 'Rhea Rest', { shiftId: null });
    await person('dan', 'Dan Head');
    await person('lia', 'Lia Lead', { departmentId: teamId });
    await person('tom', 'Tom Team', { departmentId: teamId });
    await person('olga', 'Olga Office', { managerId: ids.mona });
    await person('omar', 'Omar Office', { managerId: ids.mona });
    await api().patch(`/api/departments/${deptId}`).set('Cookie', hr).send({ headId: ids.dan }).expect(200);
    await api().patch(`/api/departments/${teamId}`).set('Cookie', hr).send({ headId: ids.lia }).expect(200);
  });

  afterAll(async () => {
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.department.updateMany({ where: { id: { in: [deptId, teamId] } }, data: { headId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: { in: [teamId, deptId] } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.checkInLocation.deleteMany({ where: { id: { in: locations } } });
    if (holidayMade) await prisma.holiday.deleteMany({ where: { date: toDateOnly(holiday) } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: networksBefore.officeNetworks as object[], officeNetworkLock: networksBefore.officeNetworkLock } });
    await api().patch('/api/wfh/settings').set('Cookie', hr).send({ daysPerMonth: 2, minGapDays: 7 }).expect(200);
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Leave Setup', () => {
    it('has the owner’s 2 days a month, 7 days apart; HR changes them, audited; 0 turns asking off', async () => {
      expect((await api().get('/api/wfh/settings').set('Cookie', sessions.ben).expect(200)).body).toEqual({ daysPerMonth: 2, minGapDays: 7 });
      await api().patch('/api/wfh/settings').set('Cookie', sessions.ben).send({ daysPerMonth: 4 }).expect(403);
      expect(said(await api().patch('/api/wfh/settings').set('Cookie', hr).send({ minGapDays: 0 }).expect(400))).toEqual([
        'Enter the days between two work from home days as a whole number from 1 to 31, e.g. 7 (1: any two days).',
      ]);
      expect((await api().patch('/api/wfh/settings').set('Cookie', hr).send({ daysPerMonth: 0 }).expect(200)).body).toEqual({ daysPerMonth: 0, minGapDays: 7 });
      expect(said(await ask('ben', { date: addDays(firstDay(NEXT), 2) }).expect(400))).toEqual([
        'Working from home is turned off in Leave Setup: there are no work from home days a month to ask for.',
      ]);
      await api().patch('/api/wfh/settings').set('Cookie', hr).send({ daysPerMonth: 2 }).expect(200);
      const log = await prisma.auditLog.findFirst({ where: { entityType: 'leave_settings', userId: hrUserId }, orderBy: { id: 'desc' } });
      expect(log?.diff).toEqual({ wfhDaysPerMonth: { from: 0, to: 2 } });
    });
  });

  describe('asking for a day', () => {
    it('goes to the direct manager, then HR, every step logged and the approver told; refused to the wrong people', async () => {
      const day = firstDay(NEXT);
      const sent = (await ask('ben', { date: day, reason: 'A delivery at home' }).expect(201)).body as View;
      expect(sent).toMatchObject({
        kind: 'wfh',
        type: { nameEn: 'Work from home' },
        date: day,
        startDate: day,
        endDate: day,
        reason: 'A delivery at home',
        status: 'with_manager',
        stage: 'manager',
        canCancel: true,
        hrCanCancel: false,
        manager: { id: ids.mona, role: 'direct_manager' },
        source: 'system',
        warnings: [],
        monthUsed: 1,
      });
      expect(kinds(sent)).toEqual(['submitted']);
      // Mona is told, and sees it waiting for her
      expect(await inbox('mona')).toEqual([{ kind: 'wfh_waiting', title: 'A work from home request is waiting for you', body: `Ben Asking ${RUN}, ${shown(day)}`, link: `/attendance/wfh/${sent.id}` }]);
      const waiting = (await api().get('/api/wfh?status=waiting').set('Cookie', sessions.mona).expect(200)).body as View[];
      expect(waiting.map((r) => r.id)).toEqual([sent.id]);
      expect(waiting[0].waitingForYou).toBe(true);
      expect((await api().get('/api/wfh/counts').set('Cookie', sessions.mona).expect(200)).body).toEqual({ waiting: 1 });
      // HR doesn't decide it before the manager; Ben neither, nor a stranger
      await decide(sent.id, hr).expect(409);
      await decide(sent.id, sessions.ben).expect(403);
      await decide(sent.id, sessions.nora).expect(404);

      expect((await decide(sent.id, sessions.mona).expect(200)).body).toMatchObject({ status: 'with_hr', stage: 'hr' });
      // HR is told now
      expect((await inbox({ userId: hrUserId })).map((n) => n.link)).toContain(`/attendance/wfh/${sent.id}`);
      expect(((await api().get('/api/wfh/counts').set('Cookie', hr).expect(200)).body as { waiting: number }).waiting).toBeGreaterThanOrEqual(1);
      const approved = (await decide(sent.id, hr).expect(200)).body as View;
      expect(approved).toMatchObject({ status: 'approved', stage: null, canCancel: false, hrCanCancel: true });
      expect(kinds(approved)).toEqual(['submitted', 'manager_decision:approve', 'hr_decision:approve']);
      // Ben is told it is approved
      expect(await inbox('ben')).toEqual([{ kind: 'wfh_decided', title: 'Work from home request approved', body: shown(day), link: `/attendance/wfh/${sent.id}` }]);
      const log = await prisma.auditLog.findMany({ where: { entityType: 'wfh_request', entityId: sent.id }, orderBy: { id: 'asc' } });
      expect(log.map((l) => l.action)).toEqual(['create', 'approve', 'approve']);

      // in Ben's own, in HR's list, and on the calendar
      expect(((await api().get('/api/me/wfh').set('Cookie', sessions.ben).expect(200)).body as View[]).map((r) => r.id)).toContain(sent.id);
      expect(((await api().get(`/api/wfh?status=approved&employeeId=${ids.ben}`).set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).toEqual([sent.id]);
      const calendar = (await api().get(`/api/wfh/calendar?from=${firstDay(NEXT)}&to=${lastDay(NEXT)}`).set('Cookie', hr).expect(200)).body as { id: string; kind: string }[];
      expect(calendar.find((c) => c.id === sent.id)).toMatchObject({ kind: 'wfh', startDate: day, endDate: day, status: 'approved', type: { nameEn: 'Work from home' } });
    });

    it('allows 2 a calendar month at least 7 days apart: 6 days is too close, 7 fine, a 3rd refused', async () => {
      const first = firstDay(NEXT);
      expect(said(await ask('ben', { date: addDays(first, 6) }).expect(400))).toEqual([
        `Two work from home days must be at least 7 days apart: ${shown(addDays(first, 6))} is 6 days from your day on ${shown(first)}.`,
      ]);
      const second = (await ask('ben', { date: addDays(first, 7) }).expect(201)).body as View;
      expect(second.monthUsed).toBe(2);
      const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toDateOnly(first));
      expect(said(await ask('ben', { date: addDays(first, 14) }).expect(400))).toEqual([`${monthName}'s 2 days of working from home are already asked for: 2 of 2.`]);
      const allowance = (await api().get(`/api/me/wfh/allowance?month=${NEXT}`).set('Cookie', sessions.ben).expect(200)).body;
      expect(allowance).toMatchObject({ month: NEXT, daysPerMonth: 2, minGapDays: 7, used: 2, approved: 1, pending: 1, offered: true, refusal: null });
      expect(allowance.nextPossible >= addDays(TODAY, 1)).toBe(true);
    });

    it('holds the gap across months: two days before the 1st and two after are too close', async () => {
      const before = addDays(firstDay(AFTER), -2);
      await ask('nora', { date: before }).expect(201);
      expect(said(await ask('nora', { date: addDays(firstDay(AFTER), 2) }).expect(400))).toEqual([
        `Two work from home days must be at least 7 days apart: ${shown(addDays(firstDay(AFTER), 2))} is 4 days from your day on ${shown(before)}.`,
      ]);
      await ask('nora', { date: addDays(before, 7) }).expect(201);
    });

    it('needs a day’s notice: today refused, tomorrow fine; cancelled while being decided', async () => {
      expect(said(await ask('nia', { date: TODAY }).expect(400))).toEqual([`${shown(TODAY)} is today: ask for a work from home day a day before it at the latest.`]);
      expect(said(await ask('nia', { date: addDays(TODAY, -3) }).expect(400))).toEqual([
        `${shown(addDays(TODAY, -3))} has gone by: ask for a work from home day a day before it at the latest.`,
      ]);
      const tomorrow = (await ask('nia', { date: addDays(TODAY, 1) }).expect(201)).body as View;
      expect(tomorrow.status).toBe('with_manager');
      // cancelled by Nia while being decided, once; nobody else
      await api().post(`/api/me/wfh/${tomorrow.id}/cancel`).set('Cookie', sessions.ben).expect(404);
      const cancelled = (await api().post(`/api/me/wfh/${tomorrow.id}/cancel`).set('Cookie', sessions.nia).expect(200)).body as View;
      expect(cancelled).toMatchObject({ status: 'cancelled', canCancel: false });
      expect(kinds(cancelled)).toEqual(['submitted', 'cancelled']);
      await api().post(`/api/me/wfh/${tomorrow.id}/cancel`).set('Cookie', sessions.nia).expect(409);
      // a cancelled day frees the day
      await ask('nia', { date: addDays(TODAY, 1) }).expect(201);
    });

    it('for a hybrid arrangement only on its office days; never for Work from home or Outdoor', async () => {
      const sunday = firstOn(NEXT, 0);
      const wednesday = firstOn(NEXT, 3);
      expect(said(await ask('hana', { date: wednesday }).expect(400))).toEqual([`${shown(wednesday)} isn't one of your office days: you work from home that day already.`]);
      await ask('hana', { date: sunday }).expect(201);
      expect(said(await ask('walid', { date: sunday }).expect(400))).toEqual(['You work from home already: no work from home day is needed.']);
      expect(said(await ask('otto', { date: sunday }).expect(400))[0]).toContain('no work from home day is needed');
      // the option is hidden for them: the form's allowance says so
      expect((await api().get('/api/me/wfh/allowance').set('Cookie', sessions.walid).expect(200)).body).toMatchObject({ offered: false, refusal: 'You work from home already: no work from home day is needed.' });
    });

    it('never on a rest day of the shift, an official holiday or a day of leave', async () => {
      const friday = firstOn(NEXT, 5);
      expect(said(await ask('rhea', { date: friday }).expect(400))).toEqual([`${shown(friday)} is a rest day of your shift: there is no work that day.`]);
      expect(said(await ask('omar', { date: holiday }).expect(400))).toEqual([`${shown(holiday)} is an official holiday (${(await prisma.holiday.findUniqueOrThrow({ where: { date: toDateOnly(holiday) } })).nameEn}): there is no work that day.`]);
      const types = Object.fromEntries(((await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
      const leaveDay = addDays(firstDay(NEXT), 10);
      await api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', ids.omar).field('typeId', types.annual).field('startDate', leaveDay).field('endDate', leaveDay).expect(201);
      expect(said(await ask('omar', { date: leaveDay }).expect(400))).toEqual([`You have Annual leave on ${shown(leaveDay)} (approved): no work from home day is needed on a day of leave.`]);
    });

    it('without a direct manager goes to the team lead, else straight to HR; rejected with a comment', async () => {
      const day = addDays(firstDay(NEXT), 3);
      const tom = (await ask('tom', { date: day }).expect(201)).body as View;
      expect(tom).toMatchObject({ status: 'with_manager', manager: { id: ids.lia, role: 'team_lead' } });
      expect((await decide(tom.id, sessions.lia).expect(200)).body).toMatchObject({ status: 'with_hr' });
      const nora = (await ask('nora', { date: day }).expect(201)).body as View;
      expect(nora).toMatchObject({ status: 'with_hr', manager: null });
      expect(kinds(nora)).toEqual(['submitted', 'no_manager']);
      expect(said(await decide(nora.id, hr, { decision: 'reject' }).expect(400))).toEqual(['Write a comment: why working from home is rejected.']);
      expect((await decide(nora.id, hr, { decision: 'reject', comment: 'Client visit that day' }).expect(200)).body).toMatchObject({
        status: 'rejected',
        rejectedStage: 'hr',
        rejectReason: 'Client visit that day',
      });
      expect((await inbox('nora')).at(-1)).toMatchObject({ kind: 'wfh_decided', title: 'Work from home request rejected' });
    });

    it('a C-level person’s HR stage is the CEO’s: HR neither sees, decides nor is told of it', async () => {
      const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
      await person('cleo', 'Cleo Chief', { departmentId: null, gradeId: g9.id }, () => hrSuper);
      const asked = (await ask('cleo', { date: addDays(firstDay(NEXT), 4) }).expect(201)).body as View;
      expect(asked).toMatchObject({ status: 'with_hr', confidential: true });
      await api().get(`/api/wfh/${asked.id}`).set('Cookie', hr).expect(404);
      await decide(asked.id, hr).expect(404);
      expect(((await api().get('/api/wfh').set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).not.toContain(asked.id);
      expect((await inbox({ userId: hrUserId })).map((n) => n.link)).not.toContain(`/attendance/wfh/${asked.id}`);
      expect((await inbox({ userId: ceoUserId })).map((n) => n.link)).toContain(`/attendance/wfh/${asked.id}`);
      expect((await decide(asked.id, ceo).expect(200)).body).toMatchObject({ status: 'approved', confidential: true });
      await record(ids.cleo, { date: addDays(firstDay(NEXT), 20), reason: 'Board day' }).expect(404);
    });

    it('is cancelled by HR once approved, saying why; the employee may not', async () => {
      const [approved] = (await api().get(`/api/wfh?status=approved&employeeId=${ids.ben}`).set('Cookie', hr).expect(200)).body as View[];
      expect(said(await api().post(`/api/me/wfh/${approved.id}/cancel`).set('Cookie', sessions.ben).expect(409))).toEqual([
        'This work from home day is approved, so it can no longer be cancelled here. Ask HR to cancel it.',
      ]);
      expect(said(await api().post(`/api/wfh/${approved.id}/cancel`).set('Cookie', hr).send({ comment: '' }).expect(400))).toEqual(['Write why the work from home day is cancelled.']);
      const cancelled = (await api().post(`/api/wfh/${approved.id}/cancel`).set('Cookie', hr).send({ comment: 'Team day moved' }).expect(200)).body as View;
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.steps.at(-1)).toMatchObject({ kind: 'cancelled', comment: 'Team day moved' });
      expect((await inbox('ben')).at(-1)).toMatchObject({ kind: 'wfh_decided', title: 'Work from home day cancelled by HR' });
      // the day is free again for Ben
      await ask('ben', { date: firstDay(NEXT) }).expect(201);
    });
  });

  describe('HR recording a day', () => {
    it('needs a reason; past the notice and the limits it is recorded with warnings, approved at once and audited', async () => {
      const past = addDays(TODAY, -20);
      expect(said(await record(ids.ben, { date: past }).expect(400))).toEqual(['Write why HR records this day.']);
      await record(ids.ben, { date: past, reason: 'Forgot to ask' }, sessions.mona).expect(403);
      // what it would meet, before it is recorded
      const check = (await api().get(`/api/wfh/check?employeeId=${ids.ben}&date=${past}`).set('Cookie', hr).expect(200)).body;
      expect(check).toMatchObject({ employee: { id: ids.ben }, problems: [], warnings: [`${shown(past)} has gone by: it is recorded after the day.`] });
      const recorded = (await record(ids.ben, { date: past, reason: 'Forgot to ask' }).expect(201)).body as View;
      expect(recorded).toMatchObject({ status: 'approved', recordedByHr: true, reason: 'Forgot to ask', hrCanCancel: true, warnings: [`${shown(past)} has gone by: it is recorded after the day.`] });
      expect(recorded.steps).toMatchObject([{ kind: 'recorded_by_hr', comment: 'Forgot to ask' }]);
      // a 3rd in next month for Ben, too close too: recorded, with both warnings
      const third = (await record(ids.ben, { date: addDays(firstDay(NEXT), 9), reason: 'Plumber' }).expect(201)).body as View;
      expect(third.warnings).toHaveLength(2);
      expect(third.warnings[1]).toContain('must be at least 7 days apart');
      const log = await prisma.auditLog.findFirst({ where: { entityType: 'wfh_request', entityId: third.id } });
      expect(log).toMatchObject({ action: 'record', diff: expect.objectContaining({ warnings: third.warnings }) });
      // the day itself still refuses: a holiday, the same day twice
      expect(said(await record(ids.ben, { date: holiday, reason: 'x' }).expect(400))[0]).toContain('is an official holiday');
      expect(said(await record(ids.ben, { date: past, reason: 'x' }).expect(400))).toEqual([`Ben Asking ${RUN} has a work from home day on ${shown(past)} already.`]);
    });
  });

  describe('an approved day at check-in', () => {
    it('waives the office network’s lock and the "Outside the office" flag; the day shows as working from home', async () => {
      locations.push((await api().post('/api/attendance/check-in-setup/locations').set('Cookie', hr).send(OFFICE).expect(201)).body.id);
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworks: [{ label: 'Main office line', range: '41.33.10.0/24' }], officeNetworkLock: true } });

      // HR records today for Olga (no day's notice: warned)
      const today = (await record(ids.olga, { date: TODAY, reason: 'Internet works only at home today' }).expect(201)).body as View;
      expect(today.warnings).toEqual([`${shown(TODAY)} is today: it is recorded without a day's notice.`]);
      const view = (await api().get('/api/me/attendance/today').set('Cookie', sessions.olga).expect(200)).body;
      expect(view).toMatchObject({ workingFromHome: true, network: { locked: false }, expected: 'anywhere', expectedText: 'Today is your approved work from home day: check in from home.' });

      // off the office network, far from the office: kept, not flagged
      const kept = (await punch('olga', { kind: 'in', ...FAR }).expect(200)).body;
      expect(kept.punches.at(-1)).toMatchObject({ place: 'remote', flags: [] });
      // Omar, without one, is locked out off the network; unlocked, he is flagged outside the office
      expect((await api().get('/api/me/attendance/today').set('Cookie', sessions.omar).expect(200)).body).toMatchObject({ workingFromHome: false, network: { locked: true }, expected: 'office' });
      expect(said(await punch('omar', { kind: 'in', ...FAR }).expect(409))).toEqual([OFF_NETWORK_MESSAGE]);
      await prisma.payrollSettings.update({ where: { id: 1 }, data: { officeNetworkLock: false } });
      expect((await punch('omar', { kind: 'in', ...FAR }).expect(200)).body.punches.at(-1)).toMatchObject({ place: 'remote', flags: ['outside_office'] });

      // Olga's month shows the day as working from home, its day without the office day's flags
      const month = (await api().get(`/api/attendance/employees/${ids.olga}?month=${CURRENT}`).set('Cookie', hr).expect(200)).body;
      expect(month.person.wfhDays).toEqual([TODAY]);
      expect(month.person.days.find((d: { date: string }) => d.date === TODAY)).toMatchObject({ flags: [] });
      expect((await api().get(`/api/attendance/me?month=${CURRENT}`).set('Cookie', sessions.olga).expect(200)).body.person.wfhDays).toEqual([TODAY]);
      // and the team's: Mona sees who is home today
      const home = (await api().get(`/api/wfh?status=approved&from=${TODAY}&to=${TODAY}`).set('Cookie', sessions.mona).expect(200)).body as View[];
      expect(home.map((r) => r.employee.id)).toContain(ids.olga);
    });
  });

  describe('Zoho People’s history', () => {
    it('is recorded approved from Zoho, the limits reported, duplicates and days outside the employment skipped', async () => {
      const wfh = app.get(WfhService);
      const a = addDays(TODAY, -40);
      const b = addDays(a, 2);
      const result = await wfh.recordHistory(
        [
          { employeeId: ids.tom, date: a, reason: 'Working from home (Zoho)' },
          { employeeId: ids.tom, date: a },
          { employeeId: ids.tom, date: b },
          { employeeId: ids.tom, date: '2023-05-01' },
          { employeeId: randomUUID(), date: a },
          { employeeId: ids.tom, date: 'not a date' },
        ],
        { userId: hrUserId },
      );
      expect(result.recorded.map((r) => r.date)).toEqual([a, b]);
      expect(result.recorded[0].warnings).toEqual([]);
      expect(result.recorded[1].warnings).toEqual([`Two work from home days must be at least 7 days apart: ${shown(b)} is 2 days from Tom Team ${RUN}'s day on ${shown(a)}.`]);
      expect(result.skipped.map((s) => s.reason).sort()).toEqual(['duplicate', 'invalid_date', 'no_employment', 'not_found']);
      const made = await one(result.recorded[0].id);
      expect(made).toMatchObject({ status: 'approved', source: 'zoho', recordedByHr: true, reason: 'Working from home (Zoho)' });
      expect(kinds(made)).toEqual(['imported']);
      expect(await prisma.auditLog.count({ where: { entityType: 'wfh_request', action: 'import', entityId: { in: result.recorded.map((r) => r.id) } } })).toBe(2);
      // brought over again: skipped as duplicates, as is a day already asked for on the system
      const [tomsDay] = (await api().get(`/api/wfh?employeeId=${ids.tom}&source=system`).set('Cookie', hr).expect(200)).body as View[];
      const again = await wfh.recordHistory(
        [
          { employeeId: ids.tom, date: a },
          { employeeId: ids.tom, date: tomsDay.date },
        ],
        { userId: hrUserId },
      );
      expect(again.recorded).toEqual([]);
      expect(again.skipped.map((s) => s.reason)).toEqual(['duplicate', 'duplicate']);
      expect(((await api().get(`/api/wfh?source=zoho&employeeId=${ids.tom}`).set('Cookie', hr).expect(200)).body as View[]).map((r) => r.date).sort()).toEqual([a, b]);
      // nobody is told of history
      expect(await inbox('tom')).toEqual([]);
      expect(fromDateOnly(toDateOnly(a))).toBe(a);
    });
  });
});
