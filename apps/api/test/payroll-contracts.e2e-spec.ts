import type { INestApplication } from '@nestjs/common';
import { EXPECTED_HOURS_NOT_TYPED, type PayrollInputs, type PayrollResult, type PayrollTerms } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { addDays, todayInCairo } from '../src/common/date-only.js';
import { lastDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// A month's pay by its contracts' dates (owner, 17 October 2026: "take into consideration the start and end date of
// the contract if it is in the middle of the billing period"), and the expected hours without the no-show and leave
// days (owner, 17 October 2026: "prefill the expected hours, and dont count abcent days or leave days, as they already
// have their own deduction and fields"). The run is for last month, counted from today in Cairo; everyone is on the
// seeded shift A (Sunday to Thursday, 09:00 to 18:00). Other test files leave people with signed contracts in the same
// database, so these tests look at their own people (names end with RUN). Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month: last month, and its number of days. */
const MONTH = monthsLater(CURRENT, -1);
const LAST = Number(lastDay(MONTH).slice(8));
const day = (n: number) => `${MONTH}-${String(n).padStart(2, '0')}`;
/** Two months before the run's month, on the given day: a contract of 2 months from then ends the day before in it. */
const twoMonthsBefore = (n: number) => `${monthsLater(MONTH, -2)}-${String(n).padStart(2, '0')}`;

interface Line {
  id: string;
  employeeId: string;
  payBasis: string;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
}

interface Run {
  id: string;
  lines: Line[];
}

interface Person {
  id: string;
  employmentId: string;
}

interface Contract {
  id: string;
  number: string;
  version: number;
}

/** The days from `from` to `to` (YYYY-MM-DD, both included) on one of `weekdays` (0 = Sunday … 6 = Saturday). */
function daysOn(weekdays: readonly number[], from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) out.push(d);
  return out;
}

describe('Payroll by the contracts’ dates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let departmentId: string;
  let shiftA: { id: string; startTime: string; endTime: string; workingDays: number[] };
  let hoursPerDay: number;
  /** The official holidays on file in the run's month. */
  let holidays: string[];
  let run: Run;
  const hired: string[] = [];
  const api = () => request(app.getHttpServer());

  // renewed on the 15th with new pay; between two contracts from the 11th to the 19th; a contract ending on the 10th;
  // joined on the 12th, under contract from the 15th; by the hour to the 14th, then a monthly salary
  let renewed: Person;
  let gap: Person;
  let ending: Person;
  let lateStart: Person;
  let toMonthly: Person;
  const contracts: Record<string, Contract[]> = {};

  async function hire(name: string, joinDate: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const made = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate, departmentId, shiftId: shiftA.id })
      .expect(201);
    hired.push(person.body.id);
    return { id: person.body.id, employmentId: made.body.employment.id };
  }

  /** A contract version as HR enters it, signed; one with new pay sent to the CEO and approved first. */
  async function signed(p: Person, body: Record<string, unknown>): Promise<Contract> {
    const made = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send(body).expect(201)).body as Contract & {
      startDate: string;
    };
    if (body.raiseReason) {
      await api().post(`/api/raises/${made.id}/send`).set('Cookie', hr).send({}).expect(200);
      await api().post(`/api/raises/${made.id}/approve`).set('Cookie', ceo).send({ comment: 'Invented approval' }).expect(200);
    }
    await api().post(`/api/contracts/${made.id}/sign`).set('Cookie', hr).send({ signedOn: made.startDate }).expect(200);
    (contracts[p.id] ??= []).push(made);
    return made;
  }

  const lineOf = (p: Person) => run.lines.find((l) => l.employeeId === p.id)!;
  const parts = (p: Person) => lineOf(p).terms.segments!.map((s) => [s.contractId, s.from, s.to, s.days]);
  /** Shift A's working days from `from` to `to`, and the holidays on them. */
  const shiftDays = (...spans: [string, string][]) => {
    const days = spans.flatMap(([from, to]) => daysOn(shiftA.workingDays, from, to));
    return { workingDays: days.length, holidays: days.filter((d) => holidays.includes(d)).length };
  };
  const patchLine = async (p: Person, inputs: object) =>
    (run = (await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: lineOf(p).id, inputs }] }).expect(200)).body as Run);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    await prisma.payrollRun.deleteMany();
    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Contracts ${RUN}` }).expect(201)).body.id;
    const shifts = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as (typeof shiftA & { code: string; hoursPerDay: number | null })[];
    const a = shifts.find((s) => s.code === 'A')!;
    shiftA = a;
    const [h, m] = [a.startTime, a.endTime].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    hoursPerDay = a.hoursPerDay ?? (m - h) / 60;
    holidays = ((await api().get(`/api/payroll/holidays?year=${MONTH.slice(0, 4)}`).set('Cookie', hr).expect(200)).body as { date: string }[]).map((x) => x.date);

    // 2 months from the 15th two months back: to the 14th; renewed from the 15th at 15,000
    renewed = await hire('Renewed', twoMonthsBefore(15));
    await signed(renewed, { grossSalary: 12000, durationMonths: 2, probationMonths: 0 });
    await signed(renewed, { grossSalary: 15000, durationMonths: 12, raiseReason: 'annual' });

    // to the 10th, then again from the 20th at the same pay
    gap = await hire('Gap', twoMonthsBefore(11));
    await signed(gap, { grossSalary: 12000, durationMonths: 2, probationMonths: 0 });
    await signed(gap, { grossSalary: 12000, durationMonths: 12, startDate: day(20) });

    // to the 10th, and no renewal
    ending = await hire('Ending', twoMonthsBefore(11));
    await signed(ending, { grossSalary: 12000, durationMonths: 2, probationMonths: 0 });

    lateStart = await hire('Late Start', day(12));
    await signed(lateStart, { grossSalary: 12000, startDate: day(15) });

    // by the hour (100 an hour, 20 hours a week) to the 14th, then 12,000 a month
    toMonthly = await hire('To Monthly', twoMonthsBefore(15));
    await signed(toMonthly, { payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 20, durationMonths: 2, probationMonths: 0 });
    await signed(toMonthly, { payBasis: 'monthly', grossSalary: 12000, durationMonths: 12, raiseReason: 'annual' });

    run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany();
    await prisma.employee.deleteMany({ where: { id: { in: hired } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  it('a renewal mid-month with new pay splits the month by days, each part on its own contract’s pay', async () => {
    const [v1, v2] = contracts[renewed.id];
    // 14 days on the contract before, 30 − 14 = 16 on the renewal, whatever the month's length
    expect(parts(renewed)).toEqual([
      [v1.id, day(1), day(14), 14],
      [v2.id, day(15), lastDay(MONTH), 16],
    ]);
    expect(lineOf(renewed).terms.segments!.map((s) => [s.number, s.version, s.gross])).toEqual([
      [v1.number, 1, 12000],
      [v2.number, 2, 15000],
    ]);
    const days = shiftDays([day(1), lastDay(MONTH)]);
    expect(lineOf(renewed).terms).toMatchObject({
      gross: 15000,
      paidDays: 30,
      // the whole month's, on the pay before the renewal until the next January
      insuredWage: 12000,
      expectedHours: (days.workingDays - days.holidays) * hoursPerDay,
      expectedDays: days,
    });
    expect(lineOf(renewed).terms.insuredWageAsBefore).toMatch(/-01-01$/);
    // fixed 9,600 × 14 ÷ 30 = 4,480 and 12,000 × 16 ÷ 30 = 6,400; variable 1,120 and 1,600
    expect(lineOf(renewed).result).toMatchObject({
      fixed: 10880,
      variable: 2720,
      earned: 13600,
      parts: [
        { contractId: v1.id, fixed: 4480, variable: 1120, allowances: 0 },
        { contractId: v2.id, fixed: 6400, variable: 1600, allowances: 0 },
      ],
    });
  });

  it('days between two contracts are not paid, and their working days are not expected', async () => {
    const days = shiftDays([day(1), day(10)], [day(20), lastDay(MONTH)]);
    expect(parts(gap).map(([, from, to, n]) => [from, to, n])).toEqual([
      [day(1), day(10), 10],
      [day(20), lastDay(MONTH), LAST - 19],
    ]);
    expect(lineOf(gap).terms).toMatchObject({ paidDays: 10 + LAST - 19, expectedHours: (days.workingDays - days.holidays) * hoursPerDay, expectedDays: days });
    // 12,000 for the days paid
    expect(lineOf(gap).result.earned).toBe(Math.round((12000 * (10 + LAST - 19) * 100) / 30) / 100);
    expect(lineOf(gap).result.warnings).toEqual([`Paid for ${10 + LAST - 19} of 30 days: employed or under contract for part of the month`]);
  });

  it('a contract ending mid-month with no renewal is paid to its end', async () => {
    const days = shiftDays([day(1), day(10)]);
    expect(parts(ending)).toEqual([[contracts[ending.id][0].id, day(1), day(10), 10]]);
    expect(lineOf(ending).terms).toMatchObject({ paidDays: 10, expectedHours: (days.workingDays - days.holidays) * hoursPerDay });
    // 12,000 × 10 ÷ 30
    expect(lineOf(ending).result.earned).toBe(4000);
  });

  it('a joiner whose contract starts after the join date is paid from the contract’s start', async () => {
    const days = shiftDays([day(15), lastDay(MONTH)]);
    expect(parts(lateStart).map(([, from, to, n]) => [from, to, n])).toEqual([[day(15), lastDay(MONTH), LAST - 14]]);
    expect(lineOf(lateStart).terms).toMatchObject({ paidDays: LAST - 14, expectedHours: (days.workingDays - days.holidays) * hoursPerDay });
  });

  it('by the hour, then a monthly salary: the month paid on the latest alone, with a warning', async () => {
    const [, v2] = contracts[toMonthly.id];
    const line = lineOf(toMonthly);
    expect(line.terms.segments!.map((s) => [s.payBasis, s.days])).toEqual([
      ['hourly', 14],
      ['monthly', 16],
    ]);
    expect(line).toMatchObject({ payBasis: 'monthly', terms: { payBasis: 'monthly', gross: 12000, paidDays: 30 } });
    // the whole month on the salary: 9,600 and 2,400
    expect(line.result).toMatchObject({ fixed: 9600, variable: 2400, parts: [{ contractId: v2.id, fixed: 9600, variable: 2400, allowances: 0 }] });
    expect(line.result.warnings).toEqual([
      `2 contracts this month, one paid by the hour: the whole month is paid on the latest, ${v2.number} v2, as hours can't be split between contracts without attendance`,
    ]);
  });

  it('the expected hours are the shift’s less the no-show and leave days, never typed (20 October 2026)', async () => {
    const shift = lineOf(renewed).terms.expectedHours!;
    // 1 no-show day and 2 of leave, a shift's day each, out of the shift's hours; 90% of what is left worked
    const left = shift - 3 * hoursPerDay;
    await patchLine(renewed, { workedHours: left * 0.9, noShowDays: 1, leaveDays: 2 });
    expect(lineOf(renewed).inputs).toMatchObject({ noShowDays: 1, leaveDays: 2, expectedHours: null });
    expect(lineOf(renewed).result).toMatchObject({ absentHours: hoursPerDay, leaveHours: 2 * hoursPerDay, expectedHours: left, attendanceRatio: 0.9, attendanceCut: 0 });
    // a no-show day is 2 × 15,000 ÷ 30 at the month-end contract's pay; a leave day costs nothing
    expect(lineOf(renewed).result.noShowCut).toBe(1000);
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: lineOf(renewed).id }, orderBy: { id: 'asc' } });
    expect(audit.at(-1)!.diff).toMatchObject({ noShowDays: { from: null, to: 1 }, leaveDays: { from: null, to: 2 } });

    // HR can't type a figure of its own (owner, 20 October 2026: "expected hours to be locked based on shifts and
    // attendance data"): refused with why, the shift's less the days off kept
    const refused = await api()
      .patch(`/api/payroll/runs/${run.id}/lines`)
      .set('Cookie', hr)
      .send({ lines: [{ id: lineOf(renewed).id, inputs: { expectedHours: left } }] })
      .expect(400);
    expect(refused.body.message).toEqual([EXPECTED_HOURS_NOT_TYPED]);
    // null is nothing typed: no change
    await patchLine(renewed, { expectedHours: null });
    expect(lineOf(renewed).result).toMatchObject({ absentHours: hoursPerDay, leaveHours: 2 * hoursPerDay, expectedHours: left, attendanceRatio: 0.9 });
  });

  it('refuses leave days that aren’t whole or half days, or more than the days paid', async () => {
    const refused = async (p: Person, inputs: object) => (await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: lineOf(p).id, inputs }] }).expect(400)).body.message;
    expect(await refused(ending, { leaveDays: 1.25 })).toEqual(['Enter the days from 0 to 31, in whole or half days, e.g. 2 or 1.5.']);
    expect(await refused(ending, { leaveDays: 32 })).toEqual(['Enter the days from 0 to 31, in whole or half days, e.g. 2 or 1.5.']);
    expect(await refused(ending, { leaveDays: 10.5 })).toBe(`Ending ${RUN}: the leave days (10.5) can't be more than the 10 days paid this month.`);
    // all of them may be leave
    await patchLine(ending, { leaveDays: 10 });
    expect(lineOf(ending).result).toMatchObject({ earned: 4000, expectedHours: 0 });
  });

  it('refresh keeps the leave days typed; a draft’s inputs saved before they existed read as none', async () => {
    const before = lineOf(gap);
    await prisma.payrollLine.update({ where: { id: before.id }, data: { inputs: { workedHours: 100 } } });
    const read = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run;
    expect(read.lines.find((l) => l.id === before.id)!.inputs).toMatchObject({ workedHours: 100, leaveDays: null, noShowDays: null });
    run = (await api().post(`/api/payroll/runs/${run.id}/refresh`).set('Cookie', hr).expect(200)).body as Run;
    expect(lineOf(renewed).inputs).toMatchObject({ noShowDays: 1, leaveDays: 2 });
    expect(lineOf(gap).inputs).toMatchObject({ workedHours: 100, leaveDays: null });
    expect(parts(renewed)).toHaveLength(2);
  });
});
