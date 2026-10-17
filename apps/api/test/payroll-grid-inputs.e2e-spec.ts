import type { INestApplication } from '@nestjs/common';
import { EMPTY_PAYROLL_INPUTS, payrollLine, type LawRates, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms, type SavedPayrollInputs } from '@trendlix/shared';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { FROM_THE_GRID, GridInputsService } from '../src/payroll/adjustments/grid-inputs.service.js';
import { json, worked } from '../src/payroll/line-work.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The run grid's bonus and penalty days, commission and settlements moved to Additions / Deductions (owner, 17 October
// 2026, pointing at those columns: "instead of there, i think earnings and deductions will be enough"; he chose "Yes,
// as proposed"). Nothing typed is lost: when the API starts, a draft run's typed ones become pending additions and
// deductions for that person and month ("From the run's grid", entered by nobody), the inputs are cleared and the line
// is worked out again; a run with the CEO keeps them until the CEO returns it, an approved one for good. Lines saved
// before then are made here as they were (with the inputs typed), as the API can't type them any more. These tests look
// at their own people (names end with RUN), and delete everything they made. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const DRAFT = monthsLater(CURRENT, -9);
const WITH_CEO = monthsLater(CURRENT, -10);
const APPROVED = monthsLater(CURRENT, -11);
const MONTHS = [DRAFT, WITH_CEO, APPROVED];
const JOINED = firstDay(monthsLater(CURRENT, -12));

interface Line {
  id: string;
  employeeId: string;
  terms: PayrollTerms;
  inputs: SavedPayrollInputs;
  result: PayrollResult;
}

interface Run {
  id: string;
  status: string;
  rules: PayrollRules;
  lawRates: LawRates;
  lines: Line[];
}

interface Adjustment {
  id: string;
  kind: string;
  type: string;
  taxed: boolean;
  amount: number | null;
  days: number | null;
  reason: string;
  status: string;
  createdBy: unknown;
}

interface Person {
  id: string;
  employeeCode: string;
}

/** What alpha typed on the grid before 17 October 2026, and beta (a negative commission, a settlement added). */
const ALPHA: Partial<SavedPayrollInputs> = { noShowDays: 0.5, released: 500, bonusDays: 2, penaltyDays: 1, commission: 1500, settlements: -250 };
const BETA: Partial<SavedPayrollInputs> = { bonusDays: null, penaltyDays: 0, commission: -100, settlements: 300 };

const monthDate = (m: string) => new Date(`${m}-01T00:00:00Z`);

describe('Payroll: the grid’s figures moved to Additions / Deductions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  const people: string[] = [];
  let alpha: Person;
  let beta: Person;
  const runs: Record<string, Run> = {};
  const api = () => request(app.getHttpServer());

  async function hire(name: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED }).expect(201);
    people.push(person.body.id);
    const draft = (await api().post(`/api/employees/${person.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: 10000 }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    return { id: person.body.id as string, employeeCode: person.body.employeeCode as string };
  }

  const getRun = async (month: string) => (runs[month] = (await api().get(`/api/payroll/runs/${runs[month].id}`).set('Cookie', hr).expect(200)).body as Run);
  const lineOf = (month: string, p: Person) => runs[month].lines.find((l) => l.employeeId === p.id)!;
  const itemsOf = (p: Person, month: string) =>
    prisma.payrollAdjustment.findMany({ where: { employeeId: p.id, month: monthDate(month) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  /** A line as it was saved before 17 October 2026: the grid's figures typed, worked out with them. */
  async function typedBefore(month: string, p: Person, typed: Partial<SavedPayrollInputs>) {
    const line = lineOf(month, p);
    const inputs = { ...EMPTY_PAYROLL_INPUTS, penaltyDays: null, bonusDays: null, commission: null, settlements: null, ...typed } as SavedPayrollInputs;
    await prisma.payrollLine.update({ where: { id: line.id }, data: { inputs: json(inputs), ...worked(line.terms, inputs, runs[month].rules, runs[month].lawRates) } });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map(monthDate) } } });
    alpha = await hire('Alpha');
    beta = await hire('Beta');
    for (const month of MONTHS) {
      runs[month] = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body as Run;
      await typedBefore(month, alpha, ALPHA);
      await typedBefore(month, beta, BETA);
    }
    // one sent to the CEO and one approved before the change, as they were
    await prisma.payrollRun.update({ where: { id: runs[WITH_CEO].id }, data: { status: 'pending_ceo', submittedAt: new Date() } });
    await prisma.payrollRun.update({ where: { id: runs[APPROVED].id }, data: { status: 'approved', approvedAt: new Date() } });
    for (const month of MONTHS) await getRun(month);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map(monthDate) } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  it('makes a draft’s typed figures pending additions and deductions, clears them, and works the line out again', async () => {
    const before = lineOf(DRAFT, alpha);
    // as it was: earned 10,000 − 333.33 (half a no-show day) + 533.33 (2 bonus days of 8,000 ÷ 30) + 1,500 − 250
    expect(before.result).toMatchObject({ bonus: 533.33, commission: 1500, settlements: -250, earned: 11_450 });
    const withCeo = lineOf(WITH_CEO, alpha);
    const approved = lineOf(APPROVED, alpha);

    const done = await app.get(GridInputsService).convert();
    expect(done.lines).toBeGreaterThanOrEqual(2);
    await getRun(DRAFT);

    // alpha's: a Bonus (days) and a Penalty (days) with their days, a commission, and the negative settlement a correction
    // taken off; in the grid's order, pending, entered by nobody
    const mine = await itemsOf(alpha, DRAFT);
    expect(mine.map((a) => [a.kind, a.type, a.taxed, a.amount?.toNumber() ?? null, a.days?.toNumber() ?? null, a.reason, a.status, a.createdById])).toEqual([
      ['addition', 'bonus_days', true, null, 2, FROM_THE_GRID, 'pending', null],
      ['deduction', 'penalty_days', false, null, 1, FROM_THE_GRID, 'pending', null],
      ['addition', 'commission', true, 1500, null, FROM_THE_GRID, 'pending', null],
      ['deduction', 'correction', false, 250, null, FROM_THE_GRID, 'pending', null],
    ]);
    // beta's: the negative commission a correction taken off, the settlement a correction added; nothing for 0 days
    expect((await itemsOf(beta, DRAFT)).map((a) => [a.kind, a.type, a.amount?.toNumber()])).toEqual([
      ['deduction', 'correction', 100],
      ['addition', 'correction', 300],
    ]);

    // the inputs without them; the rest kept
    const a = lineOf(DRAFT, alpha);
    expect(a.inputs).toEqual({ ...EMPTY_PAYROLL_INPUTS, noShowDays: 0.5, released: 500 });
    expect(a.terms.adjustments?.map((x) => x.id)).toEqual(mine.map((x) => x.id));
    expect(a.result).toEqual(payrollLine(a.terms, a.inputs as PayrollInputs, runs[DRAFT].rules, runs[DRAFT].lawRates));
    // the same days pay the same; the correction is after tax now: earned 10,000 − 333.33 + 533.33 + 1,500 = 11,700. A
    // penalty day is a day of the contract's net: 10,000 less 1,100 insurance, 592.50 tax and 5 for the Fund, 8,302.50 ÷
    // 30 = 276.75
    expect(a.result).toMatchObject({ bonus: 533.33, additionsTaxed: 1500, adjustmentDeductions: 250, penaltyCut: 276.75, earned: 11_700 });
    expect(a.result).not.toHaveProperty('commission');
    expect(a.result.adjustments?.map((x) => x.amount)).toEqual([533.33, 276.75, 1500, 250]);
    expect(lineOf(DRAFT, beta).result).toMatchObject({ additionsTaxed: 300, adjustmentDeductions: 100, earned: 10_300 });

    // with the CEO, and approved: as they were
    await getRun(WITH_CEO);
    await getRun(APPROVED);
    expect(lineOf(WITH_CEO, alpha)).toMatchObject({ inputs: withCeo.inputs, result: withCeo.result });
    expect(lineOf(APPROVED, alpha)).toMatchObject({ inputs: approved.inputs, result: approved.result });
    expect(lineOf(APPROVED, alpha).inputs).toMatchObject({ bonusDays: 2, commission: 1500 });
    expect(await itemsOf(alpha, WITH_CEO)).toEqual([]);
    expect(await itemsOf(alpha, APPROVED)).toEqual([]);

    // in the audit log: each one made, by nobody, the amount only as set; and the line
    const made = await prisma.auditLog.findMany({ where: { entityType: 'payroll_adjustment', entityId: { in: mine.map((x) => x.id) } }, orderBy: { id: 'asc' } });
    expect(made.map((x) => [x.action, x.userId])).toEqual(mine.map(() => ['create', null]));
    expect(made[0].diff).toEqual({ employeeCode: alpha.employeeCode, month: DRAFT, kind: 'addition', type: 'bonus_days', taxed: true, days: 2, reason: FROM_THE_GRID, fromLine: a.id });
    expect(made[2].diff).toMatchObject({ type: 'commission', amount: 'set' });
    expect(JSON.stringify(made.map((x) => x.diff))).not.toContain('1500');
    expect((await prisma.auditLog.findFirst({ where: { entityType: 'payroll_line', entityId: a.id }, orderBy: { id: 'desc' } }))?.diff).toEqual({
      runId: runs[DRAFT].id,
      month: DRAFT,
      employeeCode: alpha.employeeCode,
      movedToAdjustments: ['penaltyDays', 'bonusDays', 'commission', 'settlements'],
      adjustments: 'changed',
    });

    // done once: nothing more the next time the API starts
    expect(await app.get(GridInputsService).convert()).toEqual({ lines: 0, items: 0 });
    expect(await itemsOf(alpha, DRAFT)).toHaveLength(4);
  });

  it('shows a Bonus (days) and a Penalty (days) on Additions / Deductions with what the draft’s line worked them out to', async () => {
    const list = (await api().get(`/api/payroll/adjustments?month=${DRAFT}&employeeId=${alpha.id}`).set('Cookie', hr).expect(200)).body as Adjustment[];
    expect(list.map((x) => [x.type, x.days, x.amount])).toEqual([
      ['bonus_days', 2, 533.33],
      ['penalty_days', 1, 276.75],
      ['commission', null, 1500],
      ['correction', null, 250],
    ]);
    expect(list[0]).toMatchObject({ reason: FROM_THE_GRID, createdBy: null });
    // changing the days works the line out again: 3 days of 8,000 ÷ 30 = 800
    await api().patch(`/api/payroll/adjustments/${list[0].id}`).set('Cookie', hr).send({ days: 3 }).expect(200);
    await getRun(DRAFT);
    expect(lineOf(DRAFT, alpha).result.bonus).toBe(800);
    expect((await api().get(`/api/payroll/adjustments/${list[0].id}`).set('Cookie', hr).expect(200)).body).toMatchObject({ days: 3, amount: 800 });
  });

  it('a run with the CEO keeps its figures until the CEO returns it; then they move', async () => {
    const was = lineOf(WITH_CEO, alpha);
    await api().post(`/api/payroll/runs/${runs[WITH_CEO].id}/return`).set('Cookie', ceo).send({ reason: 'Invented reason' }).expect(200);
    await getRun(WITH_CEO);
    const a = lineOf(WITH_CEO, alpha);
    expect(a.inputs).toEqual({ ...EMPTY_PAYROLL_INPUTS, noShowDays: 0.5, released: 500 });
    expect((await itemsOf(alpha, WITH_CEO)).map((x) => [x.type, x.days?.toNumber() ?? x.amount?.toNumber()])).toEqual([
      ['bonus_days', 2],
      ['penalty_days', 1],
      ['commission', 1500],
      ['correction', 250],
    ]);
    // the correction now after tax: 250 more earned than as it was
    expect(a.result.earned).toBe(Math.round((was.result.earned + 250) * 100) / 100);
  });

  it('the CEO’s approval applies a Bonus (days) and a Penalty (days) with what the line paid for them', async () => {
    await api().post(`/api/payroll/runs/${runs[DRAFT].id}/submit`).set('Cookie', hr).expect(200);
    await api().post(`/api/payroll/runs/${runs[DRAFT].id}/approve`).set('Cookie', ceo).expect(200);
    await getRun(DRAFT);
    const line = lineOf(DRAFT, alpha);
    const applied = await itemsOf(alpha, DRAFT);
    expect(applied.map((x) => [x.type, x.status, x.lineId, x.amount?.toNumber(), x.days?.toNumber() ?? null])).toEqual([
      ['bonus_days', 'applied', line.id, 800, 3],
      ['penalty_days', 'applied', line.id, 276.75, 1],
      ['commission', 'applied', line.id, 1500, null],
      ['correction', 'applied', line.id, 250, null],
    ]);
    const list = (await api().get(`/api/payroll/adjustments?month=${DRAFT}&employeeId=${alpha.id}`).set('Cookie', hr).expect(200)).body as Adjustment[];
    expect(list.map((x) => x.amount)).toEqual([800, 276.75, 1500, 250]);
  });
});
