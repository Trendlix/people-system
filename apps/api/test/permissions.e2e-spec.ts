import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day"; asked how, "In the system, like leave"; the limits "Yes, in Leave Setup"): the Leave Setup's 4 hours a month
// and 2 a day; asking (the day, the hours in half hours, the times), refused over the day's or the month's hours, on a
// rest day, an official holiday or a day of leave; decided as leave is (the direct manager, else the team lead, else the
// department's head, then HR; a C-level person's HR stage by the CEO), every step logged; cancelled; HR recording on an
// employee's behalf; the counts, the lists and the calendar; and the payroll: the month's approved hours counted as worked
// on the draft line. These tests look at their own people (names end with RUN) and delete what they made. Every name and
// amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const NEXT = monthsLater(CURRENT, 1);

interface View {
  id: string;
  kind: 'permission';
  employee: { id: string; fullNameEn: string };
  type: { nameEn: string };
  date: string;
  startDate: string;
  endDate: string;
  hours: number;
  fromTime: string | null;
  toTime: string | null;
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
  steps: { kind: string; decision: string | null; comment: string | null; actor: string | null }[];
  monthLeft: number | null;
}

interface Month {
  month: string;
  hoursPerMonth: number;
  maxHoursPerDay: number;
  approved: number;
  pending: number;
  left: number;
  days: { date: string; hours: number }[];
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
const kinds = (v: View) => v.steps.map((s) => (s.decision ? `${s.kind}:${s.decision}` : s.kind));
const shown = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('Permission requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let hrSuper: string;
  let emailDomainBefore: string | null;
  let deptId: string;
  let teamId: string;
  let holidayMade: string | null = null;
  const sessions: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const people: string[] = [];
  const madeRuns: string[] = [];
  const days: string[] = []; // next month's working days (Sunday to Thursday), none of them a holiday
  let restDay: string; // a Friday of next month
  let holiday: string; // an official holiday made for these tests, on a working day of next month
  const api = () => request(app.getHttpServer());

  /** A profile with a sign-in account, hired from 2024 into `employment`'s department (none: the test department). */
  async function person(key: string, who: string, employment: Record<string, unknown> = {}, session = () => hr) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${who} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', session())
      .send({ employmentType: 'full_time', joinDate: '2024-01-01', departmentId: deptId, ...employment })
      .expect(201);
    employments[key] = hired.body.employment.id;
    return res.body.id as string;
  }

  async function sign(key: string, grossSalary: number, session = hr) {
    const draft = (await api().post(`/api/employees/${ids[key]}/employments/${employments[key]}/contracts`).set('Cookie', session).send({ grossSalary, durationMonths: 24 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session).send({ signedOn: draft.startDate }).expect(200);
  }

  const ask = (key: string, body: Record<string, unknown>) => api().post('/api/me/permissions').set('Cookie', sessions[key]).send(body);
  const record = (employeeId: string, body: Record<string, unknown>, session = hr) => api().post('/api/leave/permissions').set('Cookie', session).send({ employeeId, ...body });
  const decide = (id: string, session: string, body: object = { decision: 'approve' }) => api().post(`/api/leave/permissions/${id}/decide`).set('Cookie', session).send(body);
  const one = async (id: string, session = hr) => (await api().get(`/api/leave/permissions/${id}`).set('Cookie', session).expect(200)).body as View;
  const month = async (key: string, m = NEXT) => (await api().get(`/api/me/permissions/allowance?month=${m}`).set('Cookie', sessions[key]).expect(200)).body as Month;
  const recordLeave = (employeeId: string, typeId: string, startDate: string) =>
    api().post('/api/leave/requests').set('Cookie', hr).field('employeeId', employeeId).field('typeId', typeId).field('startDate', startDate).field('endDate', startDate);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Permissions ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Desk', parentId: deptId }).expect(201)).body.id;
    // the owner's limits, whatever an earlier test left
    await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionHoursPerMonth: 4, permissionMaxHoursPerDay: 2 }).expect(200);

    // next month's working days, an official holiday on one of them, and a Friday
    const known = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (let d = firstDay(NEXT); d <= lastDay(NEXT); d = addDays(d, 1)) if (weekday(d) <= 4 && !known.has(d)) days.push(d);
    restDay = [...Array(31).keys()].map((n) => addDays(firstDay(NEXT), n)).find((d) => weekday(d) === 5)!;
    holiday = days.pop()!;
    await prisma.holiday.create({ data: { date: toDateOnly(holiday), nameEn: `Test Day ${RUN}` } });
    holidayMade = holiday;

    // everyone hired before the leads are chosen, so none of them gets a lead as their direct manager
    await person('mona', 'Mona Manager');
    await person('ben', 'Ben Asking', { managerId: ids.mona });
    await person('nora', 'Nora Alone', { departmentId: null });
    await person('dan', 'Dan Head');
    await person('lia', 'Lia Lead', { departmentId: teamId });
    await person('tom', 'Tom Team', { departmentId: teamId });
    await person('hal', 'Hal Headed');
    await api().patch(`/api/departments/${deptId}`).set('Cookie', hr).send({ headId: ids.dan }).expect(200);
    await api().patch(`/api/departments/${teamId}`).set('Cookie', hr).send({ headId: ids.lia }).expect(200);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: madeRuns } } });
    await prisma.permissionRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.department.updateMany({ where: { id: { in: [deptId, teamId] } }, data: { headId: null } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.department.deleteMany({ where: { id: { in: [teamId, deptId] } } });
    if (holidayMade) await prisma.holiday.deleteMany({ where: { date: toDateOnly(holidayMade) } });
    await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionHoursPerMonth: 4, permissionMaxHoursPerDay: 2 }).expect(200);
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('Leave Setup', () => {
    it('has the owner’s 4 hours a month and 2 a day; HR changes them, a day never more than a month', async () => {
      expect((await api().get('/api/leave/settings').set('Cookie', sessions.ben).expect(200)).body).toMatchObject({ permissionHoursPerMonth: 4, permissionMaxHoursPerDay: 2 });
      expect(said(await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionMaxHoursPerDay: 5 }).expect(400))).toEqual([
        "The most hours a day (5 hours) can't be more than the hours a month (4 hours).",
      ]);
      expect(said(await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionHoursPerMonth: 4.25 }).expect(400))).toEqual([
        'Enter the permission hours a month from 0 to 40, in half hours, e.g. 4 (0: no permission).',
      ]);
      await api().patch('/api/leave/settings').set('Cookie', sessions.ben).send({ permissionHoursPerMonth: 8 }).expect(403);
      // 0 turns permission off
      expect((await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionHoursPerMonth: 0 }).expect(200)).body).toMatchObject({ permissionHoursPerMonth: 0 });
      expect(said(await ask('ben', { date: days[0], hours: 1 }).expect(400))).toEqual(['Permission is turned off in Leave Setup: there are no permission hours a month to ask for.']);
      await api().patch('/api/leave/settings').set('Cookie', hr).send({ permissionHoursPerMonth: 4 }).expect(200);
      const log = await prisma.auditLog.findFirst({ where: { entityType: 'leave_settings' }, orderBy: { at: 'desc' } });
      expect(log?.diff).toMatchObject({ permissionHoursPerMonth: { from: 0, to: 4 } });
    });
  });

  describe('asking for permission', () => {
    it('goes to the direct manager, then HR, every step logged; what is left of the month shows', async () => {
      const sent = (await ask('ben', { date: days[0], hours: 2, fromTime: '17:00', reason: 'A doctor’s appointment' }).expect(201)).body as View;
      expect(sent).toMatchObject({
        kind: 'permission',
        type: { nameEn: 'Permission' },
        date: days[0],
        startDate: days[0],
        endDate: days[0],
        hours: 2,
        fromTime: '17:00',
        toTime: '19:00',
        status: 'with_manager',
        stage: 'manager',
        canCancel: true,
        manager: { id: ids.mona, role: 'direct_manager' },
        monthLeft: 2,
      });
      expect(kinds(sent)).toEqual(['submitted']);
      expect(await month('ben')).toMatchObject({ hoursPerMonth: 4, maxHoursPerDay: 2, approved: 0, pending: 2, left: 2, days: [{ date: days[0], hours: 2 }] });

      // Mona sees it waiting for her, and the counts have it
      const waiting = (await api().get('/api/leave/permissions?status=waiting').set('Cookie', sessions.mona).expect(200)).body as View[];
      expect(waiting.map((r) => r.id)).toEqual([sent.id]);
      expect(waiting[0].waitingForYou).toBe(true);
      const counts = (await api().get('/api/leave/requests/counts').set('Cookie', sessions.mona).expect(200)).body;
      expect(counts).toMatchObject({ permissions: 1, leave: 0, waiting: 1 });
      // HR doesn't decide it before the manager; Ben neither, nor a stranger
      await decide(sent.id, hr).expect(409);
      await decide(sent.id, sessions.ben).expect(403);
      await decide(sent.id, sessions.nora).expect(404);

      expect((await decide(sent.id, sessions.mona).expect(200)).body).toMatchObject({ status: 'with_hr', stage: 'hr' });
      const approved = (await decide(sent.id, hr).expect(200)).body as View;
      expect(approved).toMatchObject({ status: 'approved', stage: null, canCancel: false, hrCanCancel: true });
      // Ben may still cancel it: its day is still to come
      expect(await one(sent.id, sessions.ben)).toMatchObject({ canCancel: true, hrCanCancel: false });
      expect(kinds(approved)).toEqual(['submitted', 'manager_decision:approve', 'hr_decision:approve']);
      expect(await month('ben')).toMatchObject({ approved: 2, pending: 0, left: 2 });
      const log = await prisma.auditLog.findMany({ where: { entityType: 'permission_request', entityId: sent.id }, orderBy: { at: 'asc' } });
      expect(log.map((l) => l.action)).toEqual(['create', 'approve', 'approve']);

      // in My Requests, in Leave Requests' permissions for HR, and on the calendar as hours
      expect(((await api().get('/api/me/permissions').set('Cookie', sessions.ben).expect(200)).body as View[]).map((r) => r.id)).toContain(sent.id);
      expect(((await api().get('/api/leave/permissions?status=approved').set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).toContain(sent.id);
      const calendar = (await api().get(`/api/leave/calendar?from=${firstDay(NEXT)}&to=${lastDay(NEXT)}`).set('Cookie', hr).expect(200)).body as { id: string; kind: string; hours?: number }[];
      expect(calendar.find((c) => c.id === sent.id)).toMatchObject({ kind: 'permission', hours: 2, startDate: days[0], endDate: days[0], status: 'approved' });
    });

    it('is refused over the day’s 2 hours and the month’s 4, in half hours, the times matching the hours', async () => {
      expect(said(await ask('ben', { date: days[1], hours: 2.5 }).expect(400))).toEqual(['Permission is at most 2 hours a day; this is 2 hours 30 minutes.']);
      expect(said(await ask('ben', { date: days[1], hours: 1.25 }).expect(400))).toEqual(['Enter the hours in half hours, e.g. 1.5 or 2.']);
      expect(said(await ask('ben', { date: days[0], hours: 0.5 }).expect(400))).toEqual([`The 2 hours a day on ${shown(days[0])} are already asked for.`]);
      expect(said(await ask('ben', { date: days[1], hours: 1, fromTime: '10:00', toTime: '12:00' }).expect(400))).toEqual([
        'From 10:00 to 12:00 is 2 hours, not 1 hour: change the hours or the times.',
      ]);
      await ask('ben', { date: days[1], hours: 1.5 }).expect(201);
      const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toDateOnly(firstDay(NEXT)));
      expect(said(await ask('ben', { date: days[2], hours: 1 }).expect(400))).toEqual([`Only 30 minutes left of ${monthName}'s 4 hours of permission.`]);
      expect(await month('ben')).toMatchObject({ approved: 2, pending: 1.5, left: 0.5 });
    });

    it('is refused on a rest day, an official holiday, a day of leave, and outside the employment', async () => {
      expect(said(await ask('nora', { date: restDay, hours: 1 }).expect(400))).toEqual([`${shown(restDay)} is a rest day of your shift: there is no work to ask permission from.`]);
      expect(said(await ask('nora', { date: holiday, hours: 1 }).expect(400))).toEqual([`${shown(holiday)} is an official holiday (Test Day ${RUN}): there is no work to ask permission from.`]);
      const types = Object.fromEntries(((await api().get('/api/leave/types').set('Cookie', hr).expect(200)).body as { id: string; key: string }[]).map((t) => [t.key, t.id]));
      await recordLeave(ids.nora, types.annual, days[3]).expect(201);
      expect(said(await ask('nora', { date: days[3], hours: 1 }).expect(400))).toEqual([`You have Annual leave on ${shown(days[3])} (approved): no permission is needed on a day of leave.`]);
      // nor leave on a day with permission asked for
      await ask('nora', { date: days[4], hours: 1 }).expect(201);
      expect((await recordLeave(ids.nora, types.annual, days[4]).expect(409)).body.message).toMatch(/has permission for 1 hour on .* \(with HR\): cancel it first, or choose other days\./);
      expect(said(await record(ids.nora, { date: '2023-12-31', hours: 1 }).expect(400))).toEqual([`Choose a day within one of Nora Alone ${RUN}'s employments.`]);
    });

    it('without a direct manager goes to the team lead, else the department’s head, else straight to HR', async () => {
      const tom = (await ask('tom', { date: days[5], hours: 1 }).expect(201)).body as View;
      expect(tom).toMatchObject({ status: 'with_manager', manager: { id: ids.lia, role: 'team_lead' } });
      // Lia leads the team: her own goes to the department's head
      const lia = (await ask('lia', { date: days[5], hours: 1 }).expect(201)).body as View;
      expect(lia.manager).toMatchObject({ id: ids.dan, role: 'department_head' });
      const hal = (await ask('hal', { date: days[5], hours: 1 }).expect(201)).body as View;
      expect(hal.manager).toMatchObject({ id: ids.dan, role: 'department_head' });
      expect(((await api().get('/api/leave/permissions?status=waiting').set('Cookie', sessions.dan).expect(200)).body as View[]).map((r) => r.id).sort()).toEqual([lia.id, hal.id].sort());
      expect((await decide(tom.id, sessions.lia).expect(200)).body).toMatchObject({ status: 'with_hr' });
      // nobody in charge: straight to HR, said so
      const nora = (await ask('nora', { date: days[5], hours: 2 }).expect(201)).body as View;
      expect(nora).toMatchObject({ status: 'with_hr', manager: null });
      expect(kinds(nora)).toEqual(['submitted', 'no_manager']);
      // rejected with a comment
      expect(said(await decide(nora.id, hr, { decision: 'reject' }).expect(400))).toEqual(['Write a comment: why the permission is rejected.']);
      expect((await decide(nora.id, hr, { decision: 'reject', comment: 'Busy day' }).expect(200)).body).toMatchObject({ status: 'rejected', rejectedStage: 'hr', rejectReason: 'Busy day' });
    });

    it('a C-level person’s HR stage is the CEO’s: HR neither sees nor decides it', async () => {
      const g9 = ((await api().get('/api/grades').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((g) => g.code === 'G9')!;
      await person('cleo', 'Cleo Chief', { departmentId: null, gradeId: g9.id }, () => hrSuper);
      const asked = (await ask('cleo', { date: days[6], hours: 1 }).expect(201)).body as View;
      expect(asked).toMatchObject({ status: 'with_hr', confidential: true });
      await api().get(`/api/leave/permissions/${asked.id}`).set('Cookie', hr).expect(404);
      await decide(asked.id, hr).expect(404);
      expect(((await api().get('/api/leave/permissions').set('Cookie', hr).expect(200)).body as View[]).map((r) => r.id)).not.toContain(asked.id);
      const calendar = (await api().get(`/api/leave/calendar?from=${days[6]}&to=${days[6]}`).set('Cookie', hr).expect(200)).body as { id: string }[];
      expect(calendar.map((c) => c.id)).not.toContain(asked.id);
      expect(((await api().get('/api/leave/requests/counts').set('Cookie', ceo).expect(200)).body as { permissions: number }).permissions).toBeGreaterThanOrEqual(1);
      expect((await decide(asked.id, ceo).expect(200)).body).toMatchObject({ status: 'approved', confidential: true });
      await record(ids.cleo, { date: days[7], hours: 1 }).expect(404);
    });

    it('is cancelled by its employee while being decided or before its day, by HR once approved, saying why', async () => {
      const open = (await ask('mona', { date: days[8], hours: 1 }).expect(201)).body as View;
      expect((await api().post(`/api/me/permissions/${open.id}/cancel`).set('Cookie', sessions.mona).expect(200)).body).toMatchObject({ status: 'cancelled', canCancel: false });
      await api().post(`/api/me/permissions/${open.id}/cancel`).set('Cookie', sessions.mona).expect(409);
      await api().post(`/api/me/permissions/${open.id}/cancel`).set('Cookie', sessions.ben).expect(404);
      const recorded = (await record(ids.mona, { date: days[8], hours: 2 }).expect(201)).body as View;
      expect(recorded).toMatchObject({ status: 'approved', recordedByHr: true, hrCanCancel: true });
      expect(kinds(recorded)).toEqual(['recorded_by_hr']);
      expect(said(await api().post(`/api/leave/permissions/${recorded.id}/cancel`).set('Cookie', hr).send({ comment: '' }).expect(400))).toEqual(['Write why the leave is cancelled.']);
      const cancelled = (await api().post(`/api/leave/permissions/${recorded.id}/cancel`).set('Cookie', hr).send({ comment: 'Recorded on the wrong day' }).expect(200)).body as View;
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.steps.at(-1)).toMatchObject({ kind: 'cancelled', comment: 'Recorded on the wrong day' });
    });
  });

  describe('payroll: the month’s permission hours count as worked', () => {
    it('fills in the line’s permission hours from those approved, added to the worked hours; HR’s typed hours win, within the month’s', async () => {
      const shift = await prisma.shift.findUniqueOrThrow({ where: { code: 'A' }, select: { id: true } });
      // under a contract that runs through next month
      await person('pat', 'Pat Payroll', { departmentId: null, shiftId: shift.id, joinDate: firstDay(monthsLater(CURRENT, -3)) });
      await sign('pat', 12000);
      await record(ids.pat, { date: days[9], hours: 2 }).expect(201);
      await record(ids.pat, { date: days[10], hours: 1.5 }).expect(201);

      await prisma.payrollRun.deleteMany({ where: { month: toDateOnly(firstDay(NEXT)) } });
      const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: NEXT }).expect(201)).body as { id: string };
      madeRuns.push(run.id);
      type Line = { id: string; employeeId: string; terms: { permissionHours?: number; expectedHours: number }; inputs: { permissionHours: number | null }; result: { permissionHours?: number; attendanceCut: number; attendanceRatio: number | null } };
      const lineOf = async () => ((await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids.pat)!;
      let line = await lineOf();
      expect(line.terms.permissionHours).toBe(3.5);
      expect(line.inputs.permissionHours).toBeNull();

      // worked hours just short of the 90% grace: the permission hours bring them over it
      const expected = line.terms.expectedHours;
      const worked = Math.floor(expected * 0.9) - 2;
      line = (
        (await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: line.id, inputs: { workedHours: worked } }] }).expect(200)).body.lines as Line[]
      ).find((l) => l.employeeId === ids.pat)!;
      expect(line.result).toMatchObject({ permissionHours: 3.5, attendanceCut: 0 });
      expect(line.result.attendanceRatio).toBeCloseTo((worked + 3.5) / expected, 6);

      // another approved while the run is a draft: the line is worked out again at once
      await record(ids.pat, { date: days[11], hours: 0.5 }).expect(201);
      line = await lineOf();
      expect(line.terms.permissionHours).toBe(4);
      expect(line.result.permissionHours).toBe(4);

      // HR's typed hours win; never more than the month's 4
      await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: line.id, inputs: { permissionHours: 0 } }] }).expect(200);
      line = await lineOf();
      expect(line.result.attendanceCut).toBeGreaterThan(0);
      expect(line.result).not.toHaveProperty('permissionHours');
      const over = await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: line.id, inputs: { permissionHours: 5 } }] }).expect(400);
      expect(said(over)).toEqual([`Pat Payroll ${RUN}: the permission hours (5:00) can't be more than the 4 hours a month Leave Setup allows.`]);
    });
  });
});
