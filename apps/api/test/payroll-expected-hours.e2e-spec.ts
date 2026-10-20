import type { INestApplication } from '@nestjs/common';
import {
  EMPTY_PAYROLL_INPUTS,
  EXPECTED_HOURS_NOT_TYPED,
  NO_SHIFT_NO_EXPECTED_HOURS,
  payrollLine,
  type LawRates,
  type PayrollInputs,
  type PayrollResult,
  type PayrollRules,
  type PayrollTerms,
} from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { ExpectedHoursService } from '../src/payroll/expected-hours.service.js';
import { json, worked } from '../src/payroll/line-work.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The expected hours locked (owner, 20 October 2026, on the inputs grid's Expected hours cell, "153:00 · from the
// shift": "expected hours to be locked based on shifts and attendance data"): always worked out from the shift, the
// holidays and the no-show and leave days, never typed. The API refuses any sent; a draft's line saved with HR's figure
// before then has it cleared when the API starts (ExpectedHoursService) and is worked out again with the shift's; a run
// with the CEO keeps it until the CEO returns it to HR, an approved or paid one for good. Lines saved before then are
// made here as they were (with the hours typed), as the API can't type them any more. These tests look at their own
// people (names end with RUN), and delete everything they made. Every name and figure is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const DRAFT = monthsLater(CURRENT, -6);
const WITH_CEO = monthsLater(CURRENT, -7);
const APPROVED = monthsLater(CURRENT, -8);
const PAID = monthsLater(CURRENT, -5);
const MONTHS = [DRAFT, WITH_CEO, APPROVED, PAID];
const JOINED = firstDay(monthsLater(CURRENT, -12));

/** What HR typed on the grid before 20 October 2026: the expected hours with the worked hours, a no-show day, a release. */
const TYPED: Partial<PayrollInputs> = { workedHours: 150, expectedHours: 200, noShowDays: 1, released: 500 };

interface Line {
  id: string;
  employeeId: string;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
}

interface Run {
  id: string;
  status: string;
  rules: PayrollRules;
  lawRates: LawRates;
  lines: Line[];
}

interface Person {
  id: string;
  employeeCode: string;
}

const monthDate = (m: string) => new Date(`${m}-01T00:00:00Z`);

describe('Payroll: the expected hours worked out, never typed (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  const people: string[] = [];
  let alpha: Person; // on the seeded shift A
  let beta: Person; // no shift
  const runs: Record<string, Run> = {};
  const api = () => request(app.getHttpServer());

  async function hire(name: string, shiftId: string | null): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, ...(shiftId && { shiftId }) })
      .expect(201);
    people.push(person.body.id);
    const draft = (await api().post(`/api/employees/${person.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 10000 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    return { id: person.body.id as string, employeeCode: person.body.employeeCode as string };
  }

  const getRun = async (month: string) => (runs[month] = (await api().get(`/api/payroll/runs/${runs[month].id}`).set('Cookie', hr).expect(200)).body as Run);
  const lineOf = (month: string, p: Person) => runs[month].lines.find((l) => l.employeeId === p.id)!;
  const auditOf = (lineId: string) => prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: lineId }, orderBy: { id: 'asc' } });

  /** A line as it was saved before 20 October 2026: the expected hours typed, worked out with them. */
  async function typedBefore(month: string, p: Person) {
    const line = lineOf(month, p);
    const inputs = { ...EMPTY_PAYROLL_INPUTS, ...TYPED } as PayrollInputs;
    await prisma.payrollLine.update({ where: { id: line.id }, data: { inputs: json(inputs), ...worked(line.terms, inputs, runs[month].rules, runs[month].lawRates) } });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map(monthDate) } } });
    const shiftA = ((await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[]).find((s) => s.code === 'A')!.id;
    alpha = await hire('Alpha', shiftA);
    beta = await hire('Beta', null);
    for (const month of MONTHS) {
      runs[month] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body as Run;
      await typedBefore(month, alpha);
      await typedBefore(month, beta);
    }
    // one sent to the CEO, one approved and one paid before the change, as they were
    await prisma.payrollRun.update({ where: { id: runs[WITH_CEO].id }, data: { status: 'pending_ceo', submittedAt: new Date() } });
    await prisma.payrollRun.update({ where: { id: runs[APPROVED].id }, data: { status: 'approved', submittedAt: new Date(), approvedAt: new Date() } });
    await prisma.payrollRun.update({ where: { id: runs[PAID].id }, data: { status: 'paid', submittedAt: new Date(), approvedAt: new Date(), paidOn: new Date(`${PAID}-28T00:00:00Z`) } });
    for (const month of MONTHS) await getRun(month);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map(monthDate) } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  it('a draft’s line saved with the expected hours typed has them cleared and is worked out with the shift’s; done once', async () => {
    const before = lineOf(DRAFT, alpha);
    // as it was: the 200 typed, taken as already without the no-show day: 150 of 200 is 75%
    expect(before.inputs.expectedHours).toBe(200);
    expect(before.result).toMatchObject({ expectedHours: 200, absentHours: 0, attendanceRatio: 0.75 });
    const shift = before.terms.expectedHours!;
    expect(shift).toBeGreaterThan(0);
    const kept = MONTHS.filter((m) => m !== DRAFT).map((m) => [lineOf(m, alpha), lineOf(m, beta)]);

    const cleared = await app.get(ExpectedHoursService).clear();
    expect(cleared).toBeGreaterThanOrEqual(2);
    await getRun(DRAFT);

    // only the expected hours go: the other inputs as typed
    const a = lineOf(DRAFT, alpha);
    expect(a.inputs).toEqual({ ...EMPTY_PAYROLL_INPUTS, ...TYPED, expectedHours: null });
    expect(a.result).toEqual(payrollLine(a.terms, a.inputs, runs[DRAFT].rules, runs[DRAFT].lawRates));
    // the shift's less the no-show day's 9:00 (shift A's 09:00 to 18:00)
    expect(a.result).toMatchObject({ expectedHours: shift - 9, absentHours: 9 });
    expect(a.result.attendanceRatio).toBeCloseTo(150 / (shift - 9), 9);
    // without a shift there are none: attendance isn't counted, and the line says so
    const b = lineOf(DRAFT, beta);
    expect(b.inputs.expectedHours).toBeNull();
    expect(b.result).toMatchObject({ expectedHours: null, attendanceRatio: null, attendanceCut: 0 });
    expect(b.result.warnings).toContain(NO_SHIFT_NO_EXPECTED_HOURS);

    // in the audit log, by nobody (the system), with the hours it had
    expect((await auditOf(a.id)).map((x) => [x.action, x.userId, x.diff])).toEqual([
      ['update', null, { runId: runs[DRAFT].id, month: DRAFT, employeeCode: alpha.employeeCode, expectedHours: { from: 200, to: null }, workedOut: 'from the shift' }],
    ]);

    // with the CEO, approved and paid: as they were
    for (const month of MONTHS.filter((m) => m !== DRAFT)) await getRun(month);
    expect(MONTHS.filter((m) => m !== DRAFT).map((m) => [lineOf(m, alpha), lineOf(m, beta)])).toEqual(kept);
    for (const month of [WITH_CEO, APPROVED, PAID]) {
      expect(lineOf(month, alpha)).toMatchObject({ inputs: { expectedHours: 200 }, result: { expectedHours: 200, attendanceRatio: 0.75 } });
      expect(await auditOf(lineOf(month, alpha).id)).toEqual([]);
    }

    // done once: nothing more the next time the API starts
    expect(await app.get(ExpectedHoursService).clear()).toBe(0);
    expect(await auditOf(a.id)).toHaveLength(1);
  });

  it('refuses expected hours typed on the draft, with why', async () => {
    const res = await api()
      .patch(`/api/payroll/runs/${runs[DRAFT].id}/lines`)
      .set('Cookie', hr)
      .send({ lines: [{ id: lineOf(DRAFT, alpha).id, inputs: { expectedHours: 200 } }] })
      .expect(400);
    expect(res.body.message).toEqual([EXPECTED_HOURS_NOT_TYPED]);
    await getRun(DRAFT);
    expect(lineOf(DRAFT, alpha).inputs.expectedHours).toBeNull();
  });

  it('a run with the CEO keeps them, the CEO’s waiver working the line out with them, until the CEO returns it to HR', async () => {
    // 150 of the 200 typed: a 25% cut of the fixed 8,000, waived as it was worked out
    const waived = (
      await api().post(`/api/payroll/runs/${runs[WITH_CEO].id}/lines/${lineOf(WITH_CEO, alpha).id}/attendance-waiver`).set('Cookie', ceo).send({ waived: true }).expect(200)
    ).body as Run;
    expect(waived.lines.find((l) => l.employeeId === alpha.id)!.result).toMatchObject({ expectedHours: 200, attendanceCut: 0, attendanceWaived: 2000 });

    await api().post(`/api/payroll/runs/${runs[WITH_CEO].id}/return`).set('Cookie', ceo).send({ reason: 'Invented reason' }).expect(200);
    await getRun(WITH_CEO);
    const a = lineOf(WITH_CEO, alpha);
    expect(a.inputs).toEqual({ ...EMPTY_PAYROLL_INPUTS, ...TYPED, expectedHours: null, attendanceWaived: true });
    expect(a.result).toEqual(payrollLine(a.terms, a.inputs, runs[WITH_CEO].rules, runs[WITH_CEO].lawRates));
    expect(a.result.expectedHours).toBe(a.terms.expectedHours! - 9);
    expect(lineOf(WITH_CEO, beta).result).toMatchObject({ expectedHours: null, attendanceRatio: null });
    expect((await auditOf(a.id)).at(-1)!.diff).toEqual({
      runId: runs[WITH_CEO].id,
      month: WITH_CEO,
      employeeCode: alpha.employeeCode,
      expectedHours: { from: 200, to: null },
      workedOut: 'from the shift',
    });
  });
});
