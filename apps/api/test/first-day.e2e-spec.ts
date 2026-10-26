import type { INestApplication } from '@nestjs/common';
import { readPressPairs, zonedMoment } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { HoursByPairsService } from '../src/attendance/hours-by-pairs.service.js';
import { addDays, fromDateOnly, todayInCairo, toDateOnly, weekday } from '../src/common/date-only.js';
import { toTimeOfDay } from '../src/common/time-of-day.js';
import { firstDay, lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A new employee's first day (owner, 27 October 2026: "a new employee when checked in in his first day move the checkin to
// 9am automatically to prevent delay in instructions"; asked, "Counted from the shift start"): on the first working day of
// an employment the day is counted from the shift's start whatever time they pressed check-in, the press itself kept and
// the check-out real. A Friday joiner's first working day is the Sunday after; a first day kept before the rule is made
// again by the recount on deploy (9 hours, not 7:20, no short hours), the draft line refilled with it, the history never
// calling it late, the second day as it was; a rehire's first day of the new employment counts too; a press today on a
// first day tells the employee and keeps the day from the shift's start. These tests look at their own people (names end
// with RUN) and delete what they made. Every name is invented.

const RUN = `fd${Date.now().toString(36).toLowerCase()}`;
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
const DRAFT = monthsLater(CURRENT, -7); // its days past; a draft run

interface DayView {
  date: string;
  source: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  hoursCounted: number;
  shortHours: number;
  missingCheckOut: boolean;
  pairs: { in: string; out: string }[] | null;
  openAt: string | null;
  breakMinutes: number | null;
}

interface Line {
  employeeId: string;
  inputs: { workedHours: number | null; noShowDays: number | null };
}

interface Today {
  date: string;
  next: 'in' | 'out';
  firstDay: boolean;
  punches: { kind: string; at: string }[];
  day: { checkIn: string | null; checkOut: string | null; hoursCounted: number; pairs: { in: string; out: string }[]; openAt: string | null } | null;
  messages?: string[];
  kept?: boolean;
}

describe('A new employee’s first day, counted from the shift’s start (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let hrUserId: string;
  let deptId: string;
  let emailDomainBefore: string | null;
  let runId: string;
  let joined: string; // a Friday of DRAFT: the join date
  let first: string; // the first working day after it: a Sunday, or the working day after a holiday
  let second: string; // the working day after
  let holidays: Set<string>;
  const shifts: Record<string, string> = {};
  const people: string[] = [];
  const ids: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const employments: Record<string, string> = {};
  const api = () => request(app.getHttpServer());
  const at = (date: string, time: string) => new Date(zonedMoment(date, time));

  async function profile(key: string, name: string) {
    const email = await createUser(prisma, ['employee']);
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', workEmail: email }).expect(201);
    people.push(res.body.id);
    ids[key] = res.body.id;
    sessions[key] = await signIn(app, email);
  }

  /** An employment from `joinDate` on the shift, with a signed contract unless `contract` is false; its id. */
  async function hire(key: string, shiftId: string, joinDate: string, contract = true, more: Record<string, unknown> = {}) {
    const hired = await api()
      .post(`/api/employees/${ids[key]}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate, departmentId: deptId, shiftId, workArrangement: 'office', ...more })
      .expect(201);
    const id = hired.body.employment.id as string;
    if (contract) {
      const draft = (await api().post(`/api/employees/${ids[key]}/employments/${id}/contracts`).set('Cookie', hr).send({ grossSalary: 15000, durationMonths: 36 }).expect(201)).body as { id: string; startDate: string };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    }
    return id;
  }

  /** Presses kept as a press keeps them, and the day as it was kept before the rule: its first check-in to its last check-out. */
  async function pressed(key: string, date: string, presses: [kind: 'in' | 'out', time: string][], old: { hours: number }) {
    await prisma.attendancePunch.createMany({
      data: presses.map(([kind, time]) => ({ employeeId: ids[key], date: toDateOnly(date), kind, at: at(date, time), place: 'office', expected: 'office', flags: [], source: 'system', userId: hrUserId })),
    });
    await prisma.attendanceDay.create({
      data: {
        employeeId: ids[key],
        date: toDateOnly(date),
        status: 'worked',
        checkIn: at(date, presses[0][1]),
        checkOut: at(date, presses.at(-1)![1]),
        place: 'office',
        hoursCounted: old.hours,
        source: 'system',
        importedById: hrUserId,
      },
    });
  }

  const dayOf = async (key: string, date: string) =>
    ((await api().get(`/api/attendance/employees/${ids[key]}?month=${DRAFT}`).set('Cookie', hr).expect(200)).body.person.days as DayView[]).find((d) => d.date === date)!;
  const lineOf = async (key: string) => ((await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body.lines as Line[]).find((l) => l.employeeId === ids[key])!;
  const iso = (date: string, time: string) => at(date, time).toISOString();

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    const hrEmail = await createUser(prisma, ['hr']);
    hr = await signIn(app, hrEmail);
    hrUserId = (await prisma.user.findUniqueOrThrow({ where: { email: hrEmail } })).id;
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    deptId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `First Day Dept ${RUN}` }).expect(201)).body.id;
    // the MORNING shift as the owner set it on 26 October 2026 but for the limit: 9 hours within 8:00 AM–8:00 PM, no grace,
    // Sunday to Thursday; and a shift all day, every day, for a press made now
    shifts.M = (
      await prisma.shift.create({
        data: { code: `M${RUN}`.slice(0, 20), startTime: toTimeOfDay('08:00'), endTime: toTimeOfDay('20:00'), hoursPerDay: 9, graceMinutes: 0, workingDays: [0, 1, 2, 3, 4] },
        select: { id: true },
      })
    ).id;
    shifts.A = (
      await prisma.shift.create({
        data: { code: `A${RUN}`.slice(0, 20), startTime: toTimeOfDay('00:00'), endTime: toTimeOfDay('23:59'), hoursPerDay: 23, graceMinutes: 0, workingDays: [0, 1, 2, 3, 4, 5, 6] },
        select: { id: true },
      })
    ).id;
    holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => fromDateOnly(h.date)));
    // a Friday joiner (the first Friday of DRAFT): the first working day is the Sunday after, or the working day after a holiday
    joined = firstDay(DRAFT);
    while (weekday(joined) !== 5) joined = addDays(joined, 1);
    first = addDays(joined, 1);
    while (weekday(first) > 4 || holidays.has(first)) first = addDays(first, 1);
    second = addDays(first, 1);
    while (weekday(second) > 4 || holidays.has(second)) second = addDays(second, 1);

    await profile('nadia', 'Nadia Newcomer');
    employments.nadia = await hire('nadia', shifts.M, joined);
    // Rami: an earlier employment, ended, and a new one from the same Friday (a rehire)
    await profile('rami', 'Rami Rehired');
    employments.rami1 = await hire('rami', shifts.M, firstDay(monthsLater(DRAFT, -8)), false);
    await prisma.employment.update({ where: { id: employments.rami1 }, data: { endDate: toDateOnly(lastDay(monthsLater(DRAFT, -2))), status: 'resigned' } });
    employments.rami2 = await hire('rami', shifts.M, joined);
    // Lina joins today, on the all-day shift, working from anywhere
    await profile('lina', 'Lina Live');
    employments.lina = await hire('lina', shifts.A, TODAY, false, { workArrangement: 'wfh' });

    // the first day kept before the rule: in at 10:40, out at 18:00, 7:20; the second day in at 11:30, out at 18:00, 6:30
    await pressed('nadia', first, [['in', '10:40'], ['out', '18:00']], { hours: 7 + 20 / 60 });
    await pressed('nadia', second, [['in', '11:30'], ['out', '18:00']], { hours: 6.5 });
    await pressed('rami', first, [['in', '10:40'], ['out', '18:00']], { hours: 7 + 20 / 60 });
    runId = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: DRAFT }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { id: runId } });
    await prisma.attendanceDay.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.attendancePunch.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.contract.deleteMany({ where: { employment: { employeeId: { in: people } } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.shift.deleteMany({ where: { id: { in: Object.values(shifts) } } });
    await prisma.department.deleteMany({ where: { id: deptId } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('the recount on deploy', () => {
    it('counts a Friday joiner’s first working day, the Sunday, from the shift’s start: 9 hours, not 7:20, the press kept, not short', async () => {
      expect(weekday(joined)).toBe(5);
      // the line as the days were kept: 7:20 and 6:30
      expect((await lineOf('nadia')).inputs.workedHours).toBeCloseTo(7.33 + 6.5, 1);
      const result = await app.get(HoursByPairsService).recount({ audit: true });
      expect(result).not.toBeNull();
      expect(result!.months).toContain(DRAFT);

      const d = await dayOf('nadia', first);
      expect(d).toMatchObject({ source: 'system', status: 'worked', hoursCounted: 9, shortHours: 0, missingCheckOut: false, openAt: null, breakMinutes: 0 });
      // the check-in is the press itself, the check-out real; the first pair from the shift's start
      expect(d.checkIn).toBe(iso(first, '10:40'));
      expect(d.checkOut).toBe(iso(first, '18:00'));
      expect(d.pairs).toEqual([{ in: iso(first, '08:00'), out: iso(first, '18:00') }]);
      // the punches themselves are untouched
      const punches = await prisma.attendancePunch.findMany({ where: { employeeId: ids.nadia, date: toDateOnly(first) }, orderBy: { at: 'asc' } });
      expect(punches.map((p) => `${p.kind} ${p.at.toISOString()}`)).toEqual([`in ${iso(first, '10:40')}`, `out ${iso(first, '18:00')}`]);
    });

    it('leaves the second day as it was: 6:30 from its own press, short by 2:30', async () => {
      const d = await dayOf('nadia', second);
      expect(d).toMatchObject({ hoursCounted: 6.5, shortHours: 2.5, checkIn: iso(second, '11:30') });
      expect(d.pairs).toEqual([{ in: iso(second, '11:30'), out: iso(second, '18:00') }]);
    });

    it('refills the draft line with the first day’s 9 hours', async () => {
      expect((await lineOf('nadia')).inputs.workedHours).toBe(15.5);
    });

    it('counts a rehire’s first day of the new employment the same', async () => {
      expect(await dayOf('rami', first)).toMatchObject({ hoursCounted: 9, shortHours: 0, checkIn: iso(first, '10:40') });
      expect((await lineOf('rami')).inputs.workedHours).toBe(9);
    });

    it('a correction over the first day keeps the rule: the check-out moved, the pair still from the shift’s start, the press still the check-in', async () => {
      await api().post('/api/attendance/corrections').set('Cookie', hr).send({ employeeId: ids.rami, date: first, kind: 'wrong_time', checkOut: '17:00', reason: 'Left at 5, seen by HR' }).expect(201);
      const d = await dayOf('rami', first);
      // 8:00 to 17:00: 9 hours still, not 6:20
      expect(d).toMatchObject({ source: 'correction', hoursCounted: 9, shortHours: 0, checkIn: iso(first, '10:40'), checkOut: iso(first, '17:00') });
      expect(d.pairs).toEqual([{ in: iso(first, '08:00'), out: iso(first, '17:00') }]);
      expect((await lineOf('rami')).inputs.workedHours).toBe(9);
    });

    it('is never late on the first day in the history, its check-in out of the check-in times; the second day measured as before', async () => {
      const history = (await api().get(`/api/attendance/employees/${ids.nadia}/history?period=custom&from=${first}&to=${second}`).set('Cookie', hr).expect(200)).body as {
        figures: { lateDays: number; onTimeDays: number; measuredDays: number };
        checkIns: { count: number }[];
        log: { days: { date: string; onTime: boolean | null; lateMinutes: number; firstDay: boolean; hours: number }[] };
      };
      const of = (date: string) => history.log.days.find((d) => d.date === date)!;
      expect(of(first)).toMatchObject({ onTime: true, lateMinutes: 0, firstDay: true, hours: 9 });
      // a flexible shift (9 hours within 8:00 AM–8:00 PM): late past 11:00 AM, so 11:30 is 30 minutes late
      expect(of(second)).toMatchObject({ onTime: false, lateMinutes: 30, firstDay: false });
      expect(history.figures).toMatchObject({ lateDays: 1, onTimeDays: 1, measuredDays: 2 });
      // the first day's check-in isn't among the check-in times: the second day's alone
      expect(history.checkIns.reduce((n, b) => n + b.count, 0)).toBe(1);
    });

    it('run again, finds the first day as it is', async () => {
      await app.get(HoursByPairsService).recount({ audit: true });
      const kept = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.nadia, date: toDateOnly(first), source: 'system' } } });
      expect(kept.hoursCounted.toNumber()).toBe(9);
      expect(readPressPairs(kept.pairs)).toEqual([{ in: iso(first, '08:00'), out: iso(first, '18:00') }]);
      expect(kept.checkIn?.toISOString()).toBe(iso(first, '10:40'));
    });
  });

  describe('a press today, on a first day', () => {
    it('says it is their first day, tells them on checking in, and keeps the day from the shift’s start with the press itself', async () => {
      // today a holiday: the first working day is the next one, and today isn't it
      const holidayToday = holidays.has(TODAY);
      const view = (await api().get('/api/me/attendance/today').set('Cookie', sessions.lina).expect(200)).body as Today;
      expect(view.firstDay).toBe(!holidayToday);
      expect(view.day).toBeNull();
      if (holidayToday) return;

      const checkedIn = (await api().post('/api/me/attendance/punches').set('Cookie', sessions.lina).send({ kind: 'in' }).expect(200)).body as Today;
      expect(checkedIn.kept).toBe(true);
      expect(checkedIn.messages).toContain('Your first day is counted from the shift’s start, 12:00 AM, whatever time you checked in.');
      expect(checkedIn.day).toMatchObject({ checkIn: checkedIn.punches[0].at, checkOut: null, pairs: [], openAt: checkedIn.punches[0].at, hoursCounted: 0 });

      const out = (await api().post('/api/me/attendance/punches').set('Cookie', sessions.lina).send({ kind: 'out' }).expect(200)).body as Today;
      const midnight = iso(out.date, '00:00');
      expect(out.firstDay).toBe(true);
      expect(out.day?.checkIn).toBe(out.punches[0].at);
      expect(out.day?.checkOut).toBe(out.punches[1].at);
      expect(out.day?.pairs).toEqual([{ in: midnight, out: out.punches[1].at }]);
      expect(Date.parse(out.day!.checkIn!)).toBeGreaterThan(Date.parse(midnight));
      // a second check-in isn't told it again
      expect(out.messages?.some((m) => m.startsWith('Your first day'))).toBe(false);

      const kept = await prisma.attendanceDay.findUniqueOrThrow({ where: { employeeId_date_source: { employeeId: ids.lina, date: toDateOnly(out.date), source: 'system' } } });
      expect(kept.checkIn?.toISOString()).toBe(out.punches[0].at);
      expect(readPressPairs(kept.pairs)).toEqual([{ in: midnight, out: out.punches[1].at }]);
      expect(kept.hoursCounted.toNumber()).toBeGreaterThanOrEqual(0);
      // read again: the same day
      const again = (await api().get('/api/me/attendance/today').set('Cookie', sessions.lina).expect(200)).body as Today;
      expect(again.day?.pairs).toEqual([{ in: midnight, out: out.punches[1].at }]);
    });
  });
});
