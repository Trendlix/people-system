import type { INestApplication } from '@nestjs/common';
import { zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { HoursByPairsService } from '../src/attendance/hours-by-pairs.service.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { KpiAttendanceService } from '../src/kpis/kpi-attendance.service.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A day's hours as the sum of its check-in → check-out pairs (owner, 25 October 2026: "on checkin and out several
// ttimes, the working hours to be calculated between the checkin and out only, not the first and last"; asked, "Count
// the closed pairs, flag the open one" and "Months not yet paid"; then "Not short until corrected"). The days kept before
// (first check-in to last check-out) recounted by the pass on deploy in a draft month, its line refilled; an approved
// month and Zoho People's days left alone; an open last check-in a missing check-out counted as half the shift until
// corrected (owner, 27 October 2026: "open check ins with half day"; asked, "Half the shift (4.5 h) until corrected"),
// the line warning about such days and Send to the CEO answering with them, never blocked; short and extra time by the
// pairs; part of a day of official duty joined to the pairs once; lateness still by the first check-in; a correction
// closing the open check-in; a press today keeping the pairs. These tests look at their own people (names end with RUN)
// and delete what they made. Every name is invented.

const RUN = `hp${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const DRAFT = monthsLater(CURRENT, -5); // its days past; a draft run
const APPROVED = monthsLater(CURRENT, -6); // its days past; an approved run

interface DayView {
  date: string;
  source: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  hoursCounted: number;
  shortHours: number;
  extraHours: number;
  missingCheckOut: boolean;
  openHalfDay: boolean;
  pairs: { in: string; out: string }[] | null;
  openAt: string | null;
  breakMinutes: number | null;
}

interface Line {
  id: string;
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
  result: { attendanceRatio: number | null; attendanceScore: number; warnings: string[] };
  attendanceImport: { source: string; openCheckIns?: string[] } | null;
}

const said = (res: { body: { message: string | string[] } }) => ([] as string[]).concat(res.body.message);
/** A date as the line's warning shows it: DD/MM. */
const shown = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

describe('A day’s hours as the sum of its check-in → check-out pairs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let deptId: string;
  let emailDomainBefore: string | null;
  const shifts: Record<string, string> = {};
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const runs: Record<string, string> = {};
  const work: Record<string, string[]> = { [DRAFT]: [], [APPROVED]: [] };
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  async function person(key: string, name: string, shiftId: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
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

  /** Presses kept as a press keeps them, and the day as it was kept before 25 October 2026: its first check-in to its last check-out. */
  async function pressed(key: string, date: string, presses: [kind: 'in' | 'out', time: string][], old?: { hours: number }) {
    await prisma.attendancePunch.createMany({
      data: presses.map(([kind, time]) => ({ employeeId: ids[key], date: toDateOnly(date), kind, at: at(date, time), place: 'office', expected: 'office', flags: [], source: 'system', userId: hrUserId })),
    });
    if (!old) return;
    const ins = presses.filter((p) => p[0] === 'in');
    const outs = presses.filter((p) => p[0] === 'out');
    await prisma.attendanceDay.create({
      data: {
        employeeId: ids[key],
        date: toDateOnly(date),
        status: 'worked',
        checkIn: at(date, ins[0][1]),
        checkOut: outs.length ? at(date, outs.at(-1)![1]) : null,
        place: 'office',
        hoursCounted: old.hours,
        source: 'system',
        importedById: hrUserId,
      },
    });
  }

  const monthOf = async (key: string, month: string) => (await api().get(`/api/attendance/employees/${ids[key]}?month=${month}`).set('Cookie', hr).expect(200)).body as { person: { days: DayView[]; figures: { missingCheckOuts: number; shortHours: number; extraHours: number } } };
  const dayOf = async (key: string, month: string, date: string) => (await monthOf(key, month)).person.days.find((d) => d.date === date)!;
  const lineOf = async (month: string, key: string) => ((await api().get(`/api/payroll/runs/${runs[month]}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Pairs Dept ${RUN}` }).expect(201)).body.id;
    const shift = async (key: string, data: { startTime: string; endTime: string; hoursPerDay: number; countUntil?: string }) => {
      shifts[key] = (
        await prisma.shift.create({
          data: {
            code: `${key}${RUN}`.slice(0, 20),
            startTime: toTimeOfDay(data.startTime),
            endTime: toTimeOfDay(data.endTime),
            hoursPerDay: data.hoursPerDay,
            graceMinutes: 15,
            workingDays: [0, 1, 2, 3, 4, 5, 6],
            ...(data.countUntil && { countUntil: toTimeOfDay(data.countUntil) }),
          },
          select: { id: true },
        })
      ).id;
    };
    // the MORNING shift (9 hours within 9:00–19:00, 15 minutes' grace), the same counting until 8:00 PM, and one all day
    // (for a press made now), every day a working day
    await shift('M', { startTime: '09:00', endTime: '19:00', hoursPerDay: 9 });
    await shift('U', { startTime: '09:00', endTime: '19:00', hoursPerDay: 9, countUntil: '20:00' });
    await shift('A', { startTime: '00:00', endTime: '23:59', hoursPerDay: 23 });
    await person('pia', 'Pia Pairs', shifts.M);
    await person('mako', 'Mako Makeup', shifts.U);
    await person('odin', 'Odin Duty', shifts.M);
    await person('liv', 'Liv Live', shifts.A);
    await person('ola', 'Ola Open', shifts.M);
    const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    for (const month of [DRAFT, APPROVED]) for (let d = firstDay(month); d <= lastDay(month); d = addDays(d, 1)) if (weekday(d) <= 4 && !holidays.has(d)) work[month].push(d);

    const [d0, d1, d2, d3] = work[DRAFT];
    // the owner's example, kept before as 9 hours
    await pressed('pia', d0, [['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00']], { hours: 9 });
    // a third check-in with no check-out after it: kept before as 9 hours
    await pressed('pia', d1, [['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00'], ['in', '18:30']], { hours: 9 });
    // in late at 10:30: 2:30 and 5:00, 7:30, short by 1:30 (kept before as 8:30)
    await pressed('pia', d2, [['in', '10:30'], ['out', '13:00'], ['in', '14:00'], ['out', '19:00']], { hours: 8.5 });
    // Zoho's day, its presses beside it: never touched
    await pressed('pia', d3, [['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00']]);
    await prisma.attendanceDay.create({
      data: { employeeId: ids.pia, date: toDateOnly(d3), status: 'worked', checkIn: at(d3, '09:00'), checkOut: at(d3, '18:00'), place: 'office', hoursCounted: 9, source: 'zoho', importedById: hrUserId },
    });
    // counting until 8:00 PM: 3:00 and 7:30 (12:30 to 8:00 PM), 10:30, 1:30 of extra time
    await pressed('mako', d0, [['in', '09:00'], ['out', '12:00'], ['in', '12:30'], ['out', '20:30']], { hours: 11 });
    // part of a day of official duty, 10:00–15:00, between pairs 9:00–11:00 and 14:00–16:00: 9:00–16:00, 7 hours once
    await pressed('odin', d0, [['in', '09:00'], ['out', '11:00'], ['in', '14:00'], ['out', '16:00']], { hours: 7 });
    await prisma.odRequest.create({
      data: {
        employeeId: ids.odin,
        employmentId: employments.odin,
        startDate: toDateOnly(d0),
        endDate: toDateOnly(d0),
        fullDay: false,
        fromTime: toTimeOfDay('10:00'),
        toTime: toTimeOfDay('15:00'),
        place: 'Client site',
        reason: 'Shoot',
        status: 'approved',
        createdById: hrUserId,
      },
    });
    // open check-ins (owner, 27 October 2026: "open check ins with half day"): a check-in alone, and 3 hours of pairs
    // then an open check-in, both kept before as 9 hours
    await pressed('ola', d0, [['in', '09:00']], { hours: 9 });
    await pressed('ola', d1, [['in', '09:00'], ['out', '12:00'], ['in', '13:00']], { hours: 9 });
    // the approved month: kept before as 9 hours, left so
    await pressed('pia', work[APPROVED][0], [['in', '09:00'], ['out', '13:00'], ['in', '14:00'], ['out', '18:00']], { hours: 9 });

    for (const month of [APPROVED, DRAFT]) runs[month] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body.id;
    await prisma.payrollRun.update({ where: { id: runs[APPROVED] }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: { in: Object.values(runs) } } });
    await prisma.attendanceCorrection.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.odRequest.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: Object.values(shifts) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the pass on deploy', () => {
    let before: Line;

    it('recounts a draft month’s days by their pairs, audited once with its counts, the line refilled', async () => {
      before = await lineOf(DRAFT, 'pia');
      // first check-in to last check-out, as kept before: 9 + 9 + 8:30, and Zoho's 9
      expect(before.inputs.workedHours).toBe(35.5);
      const audits = await prisma.auditLog.count({ where: { action: 'recount_hours' } });
      const result = await app.get(HoursByPairsService).recount({ audit: true });
      expect(result).not.toBeNull();
      expect(result!.months).toContain(DRAFT);
      expect(result!.monthsLocked).toContain(APPROVED);
      expect(result!.daysChanged).toBeGreaterThanOrEqual(4);
      const logged = await prisma.auditLog.findMany({ where: { action: 'recount_hours' }, orderBy: { at: 'desc' } });
      expect(logged).toHaveLength(audits + 1);
      expect(logged[0]).toMatchObject({ entityType: 'attendance_day', userId: null });
      expect(logged[0].diff).toMatchObject({ rule: 'hours_by_pairs', daysChanged: result!.daysChanged, hoursBefore: result!.hoursBefore, hoursAfter: result!.hoursAfter });
      expect(result!.hoursAfter).toBeLessThan(result!.hoursBefore);
    });

    it('in 9:00, out 13:00, in 14:00, out 18:00 counts 8 hours, not 9, with its pairs and the break', async () => {
      const d = await dayOf('pia', DRAFT, work[DRAFT][0]);
      expect(d).toMatchObject({ source: 'system', hoursCounted: 8, shortHours: 1, missingCheckOut: false, breakMinutes: 60, openAt: null, checkIn: at(work[DRAFT][0], '09:00').toISOString(), checkOut: at(work[DRAFT][0], '18:00').toISOString() });
      expect(d.pairs).toEqual([
        { in: at(work[DRAFT][0], '09:00').toISOString(), out: at(work[DRAFT][0], '13:00').toISOString() },
        { in: at(work[DRAFT][0], '14:00').toISOString(), out: at(work[DRAFT][0], '18:00').toISOString() },
      ]);
    });

    it('an open third check-in: a missing check-out counted as half a day until corrected, its pairs’ 8 hours and the half within the shift’s 9', async () => {
      const d = await dayOf('pia', DRAFT, work[DRAFT][1]);
      expect(d).toMatchObject({ hoursCounted: 9, missingCheckOut: true, openHalfDay: true, shortHours: 0, extraHours: 0, openAt: at(work[DRAFT][1], '18:30').toISOString() });
      expect(d.pairs).toHaveLength(2);
      const listed = (await api().get(`/api/attendance?month=${DRAFT}&departmentId=${deptId}&only=missing_check_outs`).set('Cookie', hr).expect(200)).body.people as { employee: { id: string } }[];
      expect(listed.map((p) => p.employee.id)).toContain(ids.pia);
    });

    it('short and extra time follow the pairs', async () => {
      expect(await dayOf('pia', DRAFT, work[DRAFT][2])).toMatchObject({ hoursCounted: 7.5, shortHours: 1.5 });
      expect(await dayOf('mako', DRAFT, work[DRAFT][0])).toMatchObject({ hoursCounted: 10.5, extraHours: 1.5, shortHours: 0 });
    });

    it('counts part of a day of official duty with the pairs once', async () => {
      expect(await dayOf('odin', DRAFT, work[DRAFT][0])).toMatchObject({ hoursCounted: 7, od: { fullDay: false } });
    });

    it('refills the draft line: the open day its pairs’ hours and half the shift, within the shift’s hours', async () => {
      const after = await lineOf(DRAFT, 'pia');
      // 8 + 9 (the open day: 8 of pairs and half of 9, at most 9) + 7:30, and Zoho's 9; the other working days absent as before
      expect(after.inputs.workedHours).toBe(33.5);
      expect(after.inputs.noShowDays).toBe(before.inputs.noShowDays);
      // the KPIs' Attendance metric reads the payroll's
      const read = (await app.get(KpiAttendanceService).readMonth(DRAFT, [ids.pia])).get(ids.pia)!;
      expect(read).toMatchObject({ source: 'payroll', ratio: after.result.attendanceRatio });
      // a line refilled, in the audit log as every fill is
      expect(await prisma.auditLog.count({ where: { entityType: 'payroll_line', action: 'update', diff: { path: ['runId'], equals: runs[DRAFT] } } })).toBeGreaterThan(0);
    });

    it('counts an open check-in as half the shift until corrected (owner, 27 October 2026: "open check ins with half day"): the line’s hours, its warning and its mark', async () => {
      const [d0, d1] = work[DRAFT];
      // a check-in alone: 4:30 of 9, short by the other half; 3 hours of pairs and an open check-in: 7:30, short by 1:30
      expect(await dayOf('ola', DRAFT, d0)).toMatchObject({ hoursCounted: 4.5, shortHours: 4.5, missingCheckOut: true, openHalfDay: true });
      expect(await dayOf('ola', DRAFT, d1)).toMatchObject({ hoursCounted: 7.5, shortHours: 1.5, missingCheckOut: true, openHalfDay: true });
      // the payroll takes the same: 12 hours, the mark keeping the days, the warning naming them
      const line = await lineOf(DRAFT, 'ola');
      expect(line.inputs.workedHours).toBe(12);
      expect(line.attendanceImport).toMatchObject({ source: 'attendance', openCheckIns: [d0, d1] });
      expect(line.result.warnings).toContain(`2 days with no check-out counted as half a day each until corrected: ${shown(d0)}, ${shown(d1)}.`);
      // the run says who, for Send to the CEO to ask HR first
      const run = (await api().get(`/api/payroll/runs/${runs[DRAFT]}`).set('Cookie', hr).expect(200)).body as { openCheckIns: { lineId: string; employeeId: string; name: string; dates: string[] }[] };
      expect(run.openCheckIns).toContainEqual({ lineId: line.id, employeeId: ids.ola, name: `Ola Open ${RUN}`, dates: [d0, d1] });
    });

    it('leaves the approved month and Zoho People’s days as they were', async () => {
      const approvedDay = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.pia, date: toDateOnly(work[APPROVED][0]), source: 'system' } } });
      expect(approvedDay).toMatchObject({ pairs: null, openAt: null });
      expect(approvedDay.hoursCounted.toNumber()).toBe(9);
      const zoho = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.pia, date: toDateOnly(work[DRAFT][3]), source: 'zoho' } } });
      expect(zoho).toMatchObject({ pairs: null });
      expect(zoho.hoursCounted.toNumber()).toBe(9);
      expect(await dayOf('pia', DRAFT, work[DRAFT][3])).toMatchObject({ source: 'zoho', hoursCounted: 9 });
    });

    it('is idempotent: run again it changes nothing, and writes no audit entry', async () => {
      const audits = await prisma.auditLog.count({ where: { action: 'recount_hours' } });
      const again = await app.get(HoursByPairsService).recount({ audit: true });
      expect(again).toMatchObject({ daysWritten: 0, daysChanged: 0, linesRefilled: 0 });
      expect(await prisma.auditLog.count({ where: { action: 'recount_hours' } })).toBe(audits);
    });

    it('measures lateness by the first check-in still', async () => {
      const history = (await api().get(`/api/attendance/employees/${ids.pia}/history?period=custom&from=${firstDay(DRAFT)}&to=${lastDay(DRAFT)}`).set('Cookie', hr).expect(200)).body as {
        log: { days: { date: string; onTime: boolean | null; lateMinutes: number; pairs: unknown[] | null; openAt: string | null }[] };
      };
      const of = (date: string) => history.log.days.find((d) => d.date === date)!;
      // a flexible shift (9 hours within 9:00 AM–7:15 PM): late past 10:15 AM, the latest check-in that fits its hours
      // (owner, 26 October 2026: "After the latest that fits 9 hours"), so 10:30 is 15 minutes late
      expect(of(work[DRAFT][2])).toMatchObject({ onTime: false, lateMinutes: 15 });
      expect(of(work[DRAFT][0])).toMatchObject({ onTime: true, lateMinutes: 0 });
      expect(of(work[DRAFT][0]).pairs).toHaveLength(2);
      expect(of(work[DRAFT][1]).openAt).toBe(at(work[DRAFT][1], '18:30').toISOString());
    });
  });

  describe('a correction of the open check-in', () => {
    it('is the check-out forgotten: it closes the open check-in, the day counted by all its pairs', async () => {
      const day = work[DRAFT][1];
      const body = { employeeId: ids.pia, date: day, kind: 'forgot_check_out', reason: 'Left for the client, seen by HR' };
      expect(said(await api().post('/api/attendance/corrections').set('Cookie', hr).send({ ...body, checkOut: '18:15' }).expect(400))).toEqual([
        'The check-out (6:15 PM) must be after the last check-in (6:30 PM), the one without a check-out.',
      ]);
      await api().post('/api/attendance/corrections').set('Cookie', hr).send({ ...body, checkOut: '19:00' }).expect(201);
      // 9:00–13:00, 14:00–18:00 and 18:30–19:00: 8:30, short by 0:30 now
      const d = await dayOf('pia', DRAFT, day);
      expect(d).toMatchObject({ source: 'correction', hoursCounted: 8.5, shortHours: 0.5, missingCheckOut: false, openAt: null, checkOut: at(day, '19:00').toISOString() });
      expect(d.pairs).toHaveLength(3);
      // the line refilled: the day's 8:30 now, not the shift's 9
      expect((await lineOf(DRAFT, 'pia')).inputs.workedHours).toBe(33);
    });
  });

  describe('open check-ins on Send to the CEO (owner, 27 October 2026: "Half the shift (4.5 h) until corrected")', () => {
    it('a correction closing one takes it off the line’s hours, its warning and its mark', async () => {
      const [d0, d1] = work[DRAFT];
      await api().post('/api/attendance/corrections').set('Cookie', hr).send({ employeeId: ids.ola, date: d0, kind: 'forgot_check_out', reason: 'Left with the crew, seen by HR', checkOut: '18:00' }).expect(201);
      // 9:00–18:00 by its pair: 9 hours; the other open day still half
      expect(await dayOf('ola', DRAFT, d0)).toMatchObject({ source: 'correction', hoursCounted: 9, missingCheckOut: false, openHalfDay: false });
      const line = await lineOf(DRAFT, 'ola');
      expect(line.inputs.workedHours).toBe(16.5);
      expect(line.attendanceImport).toMatchObject({ openCheckIns: [d1] });
      expect(line.result.warnings).toContain(`1 day with no check-out counted as half a day until corrected: ${shown(d1)}.`);
      expect(line.result.warnings.some((w) => w.includes(shown(d0)))).toBe(false);
    });

    it('never blocks the send: the answer lists who still has one, and the audit log keeps it', async () => {
      const [, d1] = work[DRAFT];
      const line = await lineOf(DRAFT, 'ola');
      const sent = (await api().post(`/api/payroll/runs/${runs[DRAFT]}/submit`).set('Cookie', hr).expect(200)).body as {
        status: string;
        openCheckIns: { lineId: string; employeeId: string; name: string; dates: string[] }[];
      };
      expect(sent.status).toBe('pending_ceo');
      expect(sent.openCheckIns).toEqual([{ lineId: line.id, employeeId: ids.ola, name: `Ola Open ${RUN}`, dates: [d1] }]);
      const audit = await prisma.auditLog.findFirst({ where: { action: 'submit', entityType: 'payroll_run', entityId: runs[DRAFT] }, orderBy: { at: 'desc' } });
      expect(audit?.diff).toMatchObject({ openCheckIns: [{ dates: [d1] }] });
    });
  });

  describe('a press today', () => {
    it('keeps the day’s pairs so far, its hours the finished pairs’, and an open last check-in', async () => {
      const date = (await api().get('/api/me/attendance/today').set('Cookie', sessions.liv).expect(200)).body.date as string;
      const now = Date.now();
      await prisma.attendancePunch.createMany({
        data: [
          { employeeId: ids.liv, date: toDateOnly(date), kind: 'in', at: new Date(now - 10 * 60_000), place: 'office', expected: 'office', flags: [], source: 'system' },
          { employeeId: ids.liv, date: toDateOnly(date), kind: 'out', at: new Date(now - 8 * 60_000), place: 'office', expected: 'office', flags: [], source: 'system' },
        ],
      });
      const inView = (await api().post('/api/me/attendance/punches').set('Cookie', sessions.liv).send({ kind: 'in' }).expect(200)).body as { next: string; day: { pairs: unknown[]; openAt: string | null; breakMinutes: number } };
      expect(inView.next).toBe('out');
      expect(inView.day.pairs).toHaveLength(1);
      expect(inView.day.openAt).not.toBeNull();
      const out = (await api().post('/api/me/attendance/punches').set('Cookie', sessions.liv).send({ kind: 'out' }).expect(200)).body as { day: { pairs: unknown[]; openAt: string | null } };
      expect(out.day.pairs).toHaveLength(2);
      expect(out.day.openAt).toBeNull();
      const kept = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.liv, date: toDateOnly(date), source: 'system' } } });
      expect(kept.pairs).toHaveLength(2);
      expect(kept.openAt).toBeNull();
    });
  });
});
