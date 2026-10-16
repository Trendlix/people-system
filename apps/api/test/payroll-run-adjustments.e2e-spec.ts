import type { INestApplication } from '@nestjs/common';
import { payrollLine, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthName, monthsLater } from '../src/payroll/months.js';
import { REGISTER_COLUMNS } from '../src/payroll/register.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The month's additions and deductions on its payroll run (owner, 17 October 2026: Additions / Deductions, one-off
// amounts per employee and month, added to that month's run): taken when the run is made or refreshed, a draft's line
// worked out again whenever one changes, locked from the CEO's step on, applied to their lines on approval (an advance
// or loan they recover settled once nothing of it is left), shown on the register; one left on a month approved without
// it moved to a later month. Other test files leave people with signed contracts in the same database, who are on the
// run too: these tests look at their own people (names end with RUN), and delete everything they made. Every name and
// amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month, and the one after it. */
const MONTH = monthsLater(CURRENT, -8);
const NEXT = monthsLater(MONTH, 1);
const JOINED = firstDay(monthsLater(CURRENT, -11));

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
  lines: Line[];
  adjustmentsNotOnRun: { employeeId: string; employeeCode: string; name: string; count: number }[];
}

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Payroll run with additions and deductions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  const people: string[] = [];
  let alpha: Person; // on the run, with a bonus, a reimbursement and a loan's installment
  let beta: Person; // on the run
  let gamma: Person; // employed, no contract: not on the run
  let loanId: string;
  let bonusId: string;
  let gammaBonusId: string;
  let run: Run;
  const api = () => request(app.getHttpServer());

  async function hire(name: string, contract: boolean): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED }).expect(201);
    const p = { id: person.body.id as string, employeeCode: person.body.employeeCode as string, employmentId: hired.body.employment.id as string };
    people.push(p.id);
    if (contract) {
      const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: 10000 }).expect(201)).body as {
        id: string;
        startDate: string;
      };
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    }
    return p;
  }

  const add = (body: object) => api().post('/api/payroll/adjustments').set('Cookie', hr).send({ month: MONTH, kind: 'addition', type: 'bonus', amount: 1000, reason: 'Invented', ...body });
  const getRun = async () => (run = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run);
  const lineOf = (p: Person) => run.lines.find((l) => l.employeeId === p.id)!;
  const act = (step: string, session: string, body: object = {}) => api().post(`/api/payroll/runs/${run.id}/${step}`).set('Cookie', session).send(body);
  const move = (ids: string[], month: string, session = hr) => api().post('/api/payroll/adjustments/move').set('Cookie', session).send({ ids, month });
  const choices = async (month: string) => (await api().get(`/api/payroll/adjustments/choices?month=${month}`).set('Cookie', hr).expect(200)).body;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    await prisma.payrollRun.deleteMany({ where: { month: { in: [MONTH, NEXT].map((m) => new Date(`${m}-01T00:00:00Z`)) } } });
    alpha = await hire('Alpha', true);
    beta = await hire('Beta', true);
    gamma = await hire('Gamma', false);

    loanId = (
      await api().post('/api/payroll/advances').set('Cookie', hr).send({ employeeId: alpha.id, kind: 'loan', amount: 500, givenOn: firstDay(MONTH), reason: 'Invented loan' }).expect(201)
    ).body.id;
    bonusId = (await add({ employeeId: alpha.id, reason: 'Target met' }).expect(201)).body.id;
    await add({ employeeId: alpha.id, type: 'reimbursement', amount: 200, reason: 'Taxi' }).expect(201);
    await add({ employeeId: alpha.id, kind: 'deduction', type: 'loan_installment', amount: 500, reason: 'Loan, 1 of 1', advanceId: loanId }).expect(201);
    gammaBonusId = (await add({ employeeId: gamma.id, amount: 300 }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: { in: [MONTH, NEXT].map((m) => new Date(`${m}-01T00:00:00Z`)) } } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.payrollAdvance.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await app.close();
  });

  it('a run takes each person’s pending ones with their terms when it is made', async () => {
    run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
    const a = lineOf(alpha);
    expect(a.terms.adjustments?.map((x) => [x.kind, x.type, x.taxed, x.amount, x.reason])).toEqual([
      ['addition', 'bonus', true, 1000, 'Target met'],
      ['addition', 'reimbursement', false, 200, 'Taxi'],
      ['deduction', 'loan_installment', false, 500, 'Loan, 1 of 1'],
    ]);
    expect(a.result).toEqual(payrollLine(a.terms, a.inputs, run.rules));
    expect(a.result).toMatchObject({ additionsTaxed: 1000, additionsUntaxed: 200, adjustmentDeductions: 500 });
    // the taxed bonus is pay earned, on the contract's 10,000
    expect(a.result.earned).toBe(11000);
    // someone without any: no adjustments on their terms
    expect(lineOf(beta).terms.adjustments).toBeUndefined();
    expect(lineOf(beta).result).toMatchObject({ additionsTaxed: 0, additionsUntaxed: 0, adjustmentDeductions: 0 });
    // the month's one for someone not on the run, so HR can see it
    expect(run.adjustmentsNotOnRun).toEqual([{ employeeId: gamma.id, employeeCode: gamma.employeeCode, name: `Gamma ${RUN}`, count: 1 }]);
    expect((await choices(MONTH)).notOnRun).toBe(1);
    expect((await prisma.auditLog.findFirst({ where: { entityType: 'payroll_run', entityId: run.id, action: 'create' } }))?.diff).toMatchObject({ adjustments: 3 });
  });

  it('a draft’s line is worked out again when one of its person’s is added, changed or cancelled', async () => {
    const penalty = (await add({ employeeId: beta.id, kind: 'deduction', type: 'penalty', amount: 100, reason: 'Late' }).expect(201)).body.id as string;
    await getRun();
    const b = lineOf(beta);
    expect(b.terms.adjustments?.map((x) => x.id)).toEqual([penalty]);
    expect(b.result.adjustmentDeductions).toBe(100);
    expect(b.result).toEqual(payrollLine(b.terms, b.inputs, run.rules));
    expect((await prisma.auditLog.findMany({ where: { entityType: 'payroll_line', entityId: b.id }, orderBy: { id: 'asc' } })).at(-1)?.diff).toMatchObject({
      employeeCode: beta.employeeCode,
      adjustments: 'changed',
    });

    await api().post(`/api/payroll/adjustments/${penalty}/cancel`).set('Cookie', hr).send({}).expect(200);
    await getRun();
    expect(lineOf(beta).terms.adjustments).toBeUndefined();
    expect(lineOf(beta).result.adjustmentDeductions).toBe(0);

    await api().patch(`/api/payroll/adjustments/${bonusId}`).set('Cookie', hr).send({ amount: 1500 }).expect(200);
    await getRun();
    expect(lineOf(alpha).result).toMatchObject({ additionsTaxed: 1500, earned: 11500 });
    // the inputs typed stay, and a refresh takes them again too
    await api().patch(`/api/payroll/runs/${run.id}/lines`).set('Cookie', hr).send({ lines: [{ id: lineOf(alpha).id, inputs: { bonusDays: 1 } }] }).expect(200);
    await act('refresh', hr).expect(200);
    await getRun();
    expect(lineOf(alpha).inputs.bonusDays).toBe(1);
    expect(lineOf(alpha).result.additionsTaxed).toBe(1500);
  });

  it('the register has them in columns of their own', async () => {
    const res = await api().get(`/api/payroll/runs/${run.id}/files/register`).set('Cookie', finance).buffer(true).parse(bytes).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const col = (header: string) => REGISTER_COLUMNS.findIndex((c) => c.header === header) + 1;
    let row = 0;
    ws.eachRow((r, n) => {
      if (r.getCell(3).value === alpha.employeeCode) row = n;
    });
    expect(row).toBeGreaterThan(0);
    expect(['Additions (taxed)', 'Deductions (after tax)', 'Additions (not taxed)'].map((h) => ws.getRow(row).getCell(col(h)).value)).toEqual([1500, 500, 200]);
  });

  it('locked from the CEO’s step on; the CEO’s approval applies them, and settles the loan they recover', async () => {
    await act('submit', hr).expect(200);
    expect((await add({ employeeId: alpha.id, amount: 1 }).expect(409)).body.message).toMatch(/is with the CEO, so its additions and deductions can't be changed/);
    await act('approve', ceo).expect(200);

    const alphaLine = lineOf(alpha).id;
    const mine = await prisma.payrollAdjustment.findMany({ where: { employeeId: alpha.id, month: new Date(`${MONTH}-01T00:00:00Z`) }, orderBy: { createdAt: 'asc' } });
    expect(mine.map((a) => [a.status, a.lineId])).toEqual([
      ['applied', alphaLine],
      ['applied', alphaLine],
      ['applied', alphaLine],
    ]);
    expect(mine.every((a) => a.appliedAt !== null)).toBe(true);
    expect((await prisma.auditLog.findMany({ where: { entityType: 'payroll_adjustment', entityId: bonusId, action: 'apply' } })).map((a) => a.diff)).toEqual([
      { runId: run.id, lineId: alphaLine, month: MONTH, employeeCode: alpha.employeeCode, status: { from: 'pending', to: 'applied' } },
    ]);
    // the cancelled one stays cancelled; the loan is recovered
    const loan = (await api().get(`/api/payroll/advances/${loanId}`).set('Cookie', hr).expect(200)).body;
    expect(loan).toMatchObject({ status: 'settled', recovered: 500, outstanding: 0, settledBy: null });
    // applied: the run's, never changed again
    expect((await api().patch(`/api/payroll/adjustments/${bonusId}`).set('Cookie', hr).send({ amount: 1 }).expect(409)).body.message).toBe(
      "This addition is applied, so it can't be changed.",
    );
    const approved = (await api().get(`/api/payroll/runs/${run.id}`).set('Cookie', hr).expect(200)).body as Run;
    expect(approved.lines.find((l) => l.employeeId === alpha.id)!.result.additionsTaxed).toBe(1500);
  });

  it('one left on a month approved without it is moved to a later month', async () => {
    const left = (await choices(CURRENT)).leftBehind as { month: string; count: number }[];
    expect(left.find((l) => l.month === MONTH)?.count).toBe(1);
    await move([gammaBonusId], NEXT, finance).expect(403);
    // not to the approved month itself, nor to one before it
    expect((await move([gammaBonusId], MONTH).expect(409)).body.message).toBe(
      `The ${monthName(MONTH)} payroll is approved, so its additions and deductions can't be changed. Enter it for a later month.`,
    );
    expect((await move([gammaBonusId], monthsLater(MONTH, -1)).expect(400)).body.message).toBe(
      `The ${monthName(MONTH)} payroll is approved without it: move it to a month after ${monthName(MONTH)}.`,
    );
    expect((await move([], NEXT).expect(400)).body.message).toContain('Choose the additions or deductions to move.');
    // an applied one isn't moved
    expect((await move([bonusId], NEXT).expect(409)).body.message).toBe("This addition is applied, so it can't be moved.");

    const moved = (await move([gammaBonusId], NEXT).expect(200)).body as { id: string; month: string; status: string }[];
    expect(moved).toMatchObject([{ id: gammaBonusId, month: NEXT, status: 'pending' }]);
    expect(((await choices(CURRENT)).leftBehind as { month: string }[]).some((l) => l.month === MONTH)).toBe(false);
    expect((await prisma.auditLog.findMany({ where: { entityType: 'payroll_adjustment', entityId: gammaBonusId, action: 'move' } })).map((a) => a.diff)).toEqual([
      { employeeCode: gamma.employeeCode, kind: 'addition', type: 'bonus', month: { from: MONTH, to: NEXT } },
    ]);
  });
});
