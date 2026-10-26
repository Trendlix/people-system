import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { KpiAttendanceService } from '../src/kpis/kpi-attendance.service.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { WfhFullDaysService } from '../src/wfh/wfh-full-days.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// An approved work from home day without a check-in counts the shift's full hours (owner, 26 October 2026, asked how it
// should count after September's payroll: Lamiaa's Sunday 27/09/2026, "Recorded by HR", gave 0 hours and an attendance
// cut: "Full day, always"). A month with one approved work from home day and a check-in every other working day: the
// line's worked hours include the day's 9 hours and no day is a no-show; HR recording or cancelling a day refills the
// draft line; the pass on deploy refills the draft lines already affected, once (a second run changes nothing, writes
// nothing) and never a run that is approved; the history shows the day attended, on time, working from home. These tests
// look at their own people (names end with RUN) and delete what they made. Every name is invented.

const RUN = `wf${Date.now().toString(36).toLowerCase()}`;
const CURRENT = todayInCairo().slice(0, 7);
const DRAFT = monthsLater(CURRENT, -5); // its days past; a draft run
const APPROVED = monthsLater(CURRENT, -6); // its days past; an approved run

interface Line {
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
  result: { attendanceRatio: number | null };
}

interface DayView {
  date: string;
  status: string;
  checkIn: string | null;
  hoursCounted: number;
  shortHours: number;
  missingCheckOut: boolean;
  wfhDay?: boolean;
}

describe('An approved work from home day without a check-in counts full (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let deptId: string;
  let shiftId: string;
  let emailDomainBefore: string | null;
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const runs: Record<string, string> = {};
  const work: Record<string, string[]> = { [DRAFT]: [], [APPROVED]: [] };
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  async function person(key: string, name: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    const hired = await api()
      .post(`/api/employees/${res.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: firstDay(monthsLater(APPROVED, -2)), departmentId: deptId, shiftId, workArrangement: 'office' })
      .expect(201);
    employments[key] = hired.body.employment.id;
    const draft = (await api().post(`/api/employees/${res.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 15000, durationMonths: 36 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  /** Every working day of the month checked in 9:00–18:00 (9 hours) but `off`. */
  async function present(key: string, month: string, off: string) {
    await prisma.attendanceDay.createMany({
      data: work[month]
        .filter((d) => d !== off)
        .map((date) => ({ employeeId: ids[key], date: toDateOnly(date), status: 'worked', checkIn: at(date, '09:00'), checkOut: at(date, '18:00'), place: 'office', hoursCounted: 9, source: 'system', importedById: hrUserId })),
    });
  }

  /** An approved work from home day written as it was before the change: nothing refilled. */
  async function approvedBefore(key: string, date: string) {
    await prisma.wfhRequest.create({
      data: { employeeId: ids[key], employmentId: employments[key], date: toDateOnly(date), reason: 'Recorded by HR', status: 'approved', recordedByHr: true, createdById: hrUserId },
    });
  }

  const monthOf = async (key: string, month: string) => (await api().get(`/api/attendance/employees/${ids[key]}?month=${month}`).set('Cookie', hr).expect(200)).body as { person: { days: DayView[]; wfhDays: string[] } };
  const lineOf = async (month: string, key: string) => ((await api().get(`/api/payroll/runs/${runs[month]}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const filled = () => prisma.auditLog.count({ where: { action: 'refill_wfh_days' } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Home Dept ${RUN}` }).expect(201)).body.id;
    // 9 hours within 9:00–19:00, Sunday to Thursday
    shiftId = (
      await prisma.shift.create({
        data: { code: `W${RUN}`.slice(0, 20), startTime: toTimeOfDay('09:00'), endTime: toTimeOfDay('19:00'), hoursPerDay: 9, graceMinutes: 15, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    await person('lam', 'Lam Lamiaa');
    await person('sam', 'Sam Sunday');
    await person('ola', 'Ola Approved');
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (const month of [DRAFT, APPROVED]) for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work[month].push(d);
    const off = work[DRAFT][5];
    await present('lam', DRAFT, off);
    await present('sam', DRAFT, off);
    await present('ola', APPROVED, work[APPROVED][5]);
    for (const month of [APPROVED, DRAFT]) runs[month] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body.id;
    await prisma.payrollRun.update({ where: { id: runs[APPROVED] }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.wfhRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: shiftId } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('HR records an approved day for someone who did not check in that day', () => {
    let hours: number;
    let wfhId: string;

    it('starts as September did: the day a no-show, nothing counted for it', async () => {
      const before = await lineOf(DRAFT, 'lam');
      expect(before.inputs.noShowDays).toBe(1);
      hours = before.inputs.workedHours!;
      expect(hours).toBe(9 * (work[DRAFT].length - 1));
      expect(await monthOf('lam', DRAFT).then((m) => m.person.days.find((d) => d.date === work[DRAFT][5]))).toMatchObject({ status: 'absent', hoursCounted: 0 });
    });

    it('refills the draft line: the day’s 9 hours counted, no no-show, no attendance cut', async () => {
      const made = await api().post('/api/wfh').set('Cookie', hr).send({ employeeId: ids.lam, date: work[DRAFT][5], reason: 'Recorded by HR' }).expect(201);
      wfhId = made.body.id;
      const after = await lineOf(DRAFT, 'lam');
      expect(after.inputs.workedHours).toBe(hours + 9);
      expect(after.inputs.workedHours).toBe(9 * work[DRAFT].length);
      expect(after.inputs.noShowDays).toBe(0);
      expect(after.result.attendanceRatio).toBeGreaterThanOrEqual(1);
      // the line change is in the audit log as every fill is
      expect(await prisma.auditLog.count({ where: { entityType: 'payroll_line', action: 'update', diff: { path: ['runId'], equals: runs[DRAFT] } } })).toBeGreaterThan(0);
      // the KPIs' Attendance metric reads the payroll's
      const read = (await app.get(KpiAttendanceService).readMonth(DRAFT, [ids.lam])).get(ids.lam)!;
      expect(read).toMatchObject({ source: 'payroll', ratio: after.result.attendanceRatio });
    });

    it('shows the day worked for 9 hours, never short, with no check-in, as working from home', async () => {
      const month = await monthOf('lam', DRAFT);
      const day = month.person.days.find((d) => d.date === work[DRAFT][5])!;
      expect(day).toMatchObject({ status: 'worked', hoursCounted: 9, shortHours: 0, missingCheckOut: false, checkIn: null, wfhDay: true });
      expect(month.person.wfhDays).toContain(work[DRAFT][5]);
    });

    it('is attended and on time in the history, mode working from home, its hours as counted', async () => {
      const history = (await api().get(`/api/attendance/employees/${ids.lam}/history?period=custom&from=${firstDay(DRAFT)}&to=${lastDay(DRAFT)}`).set('Cookie', hr).expect(200)).body as {
        log: { days: { date: string; mode: string; attended: boolean; onTime: boolean | null; hours: number; expected: boolean; counted: boolean }[] };
      };
      expect(history.log.days.find((d) => d.date === work[DRAFT][5])).toMatchObject({ mode: 'wfh', attended: true, onTime: true, hours: 9, expected: true, counted: true });
    });

    it('cancelled by HR, the day is a no-show again and the draft line follows', async () => {
      await api().post(`/api/wfh/${wfhId}/cancel`).set('Cookie', hr).send({ comment: 'Recorded by mistake' }).expect(200);
      const after = await lineOf(DRAFT, 'lam');
      expect(after.inputs.workedHours).toBe(hours);
      expect(after.inputs.noShowDays).toBe(1);
    });
  });

  describe('the pass on deploy', () => {
    it('refills a draft line made before, audited once with its counts', async () => {
      await approvedBefore('sam', work[DRAFT][5]);
      // approved and paid months never change: this one’s day is approved, its line left as it was
      await approvedBefore('ola', work[APPROVED][5]);
      const stale = await lineOf(DRAFT, 'sam');
      expect(stale.inputs.noShowDays).toBe(1);
      const approvedLine = await lineOf(APPROVED, 'ola');
      const audits = await filled();
      const result = await app.get(WfhFullDaysService).refill();
      expect(result).not.toBeNull();
      expect(result!.months).toContain(DRAFT);
      expect(result!.linesRefilled).toBeGreaterThanOrEqual(1);
      const after = await lineOf(DRAFT, 'sam');
      expect(after.inputs.workedHours).toBe(9 * work[DRAFT].length);
      expect(after.inputs.noShowDays).toBe(0);
      expect(await filled()).toBe(audits + 1);
      const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: 'refill_wfh_days' }, orderBy: { at: 'desc' } });
      expect(logged).toMatchObject({ entityType: 'wfh_request', userId: null });
      expect(logged.diff).toMatchObject({ rule: 'wfh_full_day', linesRefilled: result!.linesRefilled });
      // the approved run is unchanged
      expect(await lineOf(APPROVED, 'ola')).toEqual(approvedLine);
      expect((await lineOf(APPROVED, 'ola')).inputs.noShowDays).toBe(1);
    });

    it('is idempotent: run again it changes nothing and writes no audit entry', async () => {
      const audits = await filled();
      const lines = await prisma.payrollLine.findMany({ where: { employeeId: { in: people } }, orderBy: { id: 'asc' }, select: { id: true, inputs: true, updatedAt: true } });
      const again = await app.get(WfhFullDaysService).refill();
      expect(again).toMatchObject({ linesRefilled: 0 });
      expect(await filled()).toBe(audits);
      expect(await prisma.payrollLine.findMany({ where: { employeeId: { in: people } }, orderBy: { id: 'asc' }, select: { id: true, inputs: true, updatedAt: true } })).toEqual(lines);
    });
  });
});
