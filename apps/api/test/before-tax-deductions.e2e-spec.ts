import type { INestApplication } from '@nestjs/common';
import { payrollLine, type LawRates, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import { ETA, NO_DATE } from '../src/payroll/eta/eta-file.js';
import { etaTax } from '../src/payroll/eta/eta-tax.js';
import { REGISTER_COLUMNS } from '../src/payroll/register.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Deductions before tax (owner, 20 October 2026, asked whether the employee's medical share, a recurring deduction, is
// taken before or after tax: "Before Tax i think"): HR ticks a recurring deduction "Deducted before tax (lowers taxable
// pay)", off by default; its month's Recurring deduction carries it, and the run lowers the line's taxable pay by it
// before the income tax, then takes it from the net as every deduction; one not ticked is after tax as before. Unticked
// or ticked again, the draft's line is worked out again; a change of amount keeps it; Payroll Setup's before-tax health
// insurance limit a year (the Super Admin's, empty for none) caps what lowers the taxable pay; the register shows them;
// an approved run keeps its figures. Other test files leave people with signed contracts in the same database, who are
// on the run too: these tests look at their own people (names end with RUN), and delete everything they made. Every
// name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month, and its year (the rates set by law it takes). */
const MONTH = monthsLater(CURRENT, -6);
const YEAR = Number(MONTH.slice(0, 4));
const JOINED = firstDay(monthsLater(CURRENT, -9));
const MEDICAL = 'Medical subscription (family)';

interface Item {
  id: string;
  kind: string;
  type: string;
  amount: number | null;
  reason: string;
  beforeTax?: boolean;
}

interface Line {
  id: string;
  employeeId: string;
  employeeCode: string;
  terms: PayrollTerms & { adjustments?: Item[] };
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

interface Recurring {
  id: string;
  name: string;
  amount: number;
  beforeTax: boolean;
  deducted: { month: string; amount: number; status: string }[];
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

describe('Deductions before tax (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let superAdmin: string;
  let before: Person; // a medical share before tax
  let after: Person; // the same share after tax
  let beforeShare: Recurring;
  let runId: string;
  /** The year's row of the rates set by law as it was: put back at the end. */
  let lawYearBefore: { beforeTaxHealthLimit: unknown; updatedById: string | null } | null;
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  async function hire(name: string): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api().post(`/api/employees/${person.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate: JOINED }).expect(201);
    const p = { id: person.body.id as string, employeeCode: person.body.employeeCode as string, employmentId: hired.body.employment.id as string };
    people.push(p.id);
    const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary: 12_000 }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    return p;
  }

  const recurring = (body: object) => api().post('/api/payroll/recurring-deductions').set('Cookie', hr).send({ consentOnFile: true, ...body });
  const edit = (id: string, body: object) => api().patch(`/api/payroll/recurring-deductions/${id}`).set('Cookie', hr).send(body);
  const getRun = async () => (await api().get(`/api/payroll/runs/${runId}`).set('Cookie', hr).expect(200)).body as Run;
  const refresh = async () => (await api().post(`/api/payroll/runs/${runId}/refresh`).set('Cookie', hr).send({}).expect(200)).body as Run;
  const lineOf = (run: Run, p: Person) => run.lines.find((l) => l.employeeId === p.id)!;
  const recurringOn = (line: Line) => (line.terms.adjustments ?? []).filter((a) => a.type === 'recurring');
  /** The line as payrollLine works it out with the run's rules and rates: what the API kept. */
  const workedOut = (run: Run, line: Line) => payrollLine(line.terms, line.inputs, run.rules, run.lawRates);
  /** The line worked out with its Recurring deductions after tax. */
  const afterTax = (run: Run, line: Line) =>
    payrollLine({ ...line.terms, adjustments: (line.terms.adjustments ?? []).map(({ beforeTax: _b, ...a }) => a) as PayrollTerms['adjustments'] }, line.inputs, run.rules, run.lawRates);
  const rowsOf = (p: Person) => prisma.payrollAdjustment.findMany({ where: { employeeId: p.id, type: 'recurring' }, orderBy: { createdAt: 'asc' }, select: { status: true, beforeTax: true, amount: true } });
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  /** PUT's body for the run's year: its rates as they are, with `change`. */
  async function lawBody(change: object) {
    const years = (await api().get('/api/payroll/law-rates').set('Cookie', hr).expect(200)).body as (LawRates & { updatedAt: string; updatedBy: unknown })[];
    const row = [...years].filter((y) => y.year <= YEAR).at(-1) ?? years[0];
    const { year: _year, updatedAt: _at, updatedBy: _by, ...rates } = row;
    return { ...rates, ...change };
  }
  const round = (n: number) => Math.round(n * 100) / 100;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    lawYearBefore = await prisma.payrollLawYear.findUnique({ where: { year: YEAR }, select: { beforeTaxHealthLimit: true, updatedById: true } });
    before = await hire('Before');
    after = await hire('After');
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: new Date(`${MONTH}-01T00:00:00Z`) } });
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.recurringDeduction.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    // the rates set by law as they were: no limit, changed by nobody here
    if (lawYearBefore) await prisma.payrollLawYear.update({ where: { year: YEAR }, data: { beforeTaxHealthLimit: null, updatedById: lawYearBefore.updatedById } });
    else await prisma.payrollLawYear.deleteMany({ where: { year: YEAR } });
    await app.close();
  });

  it('HR ticks a recurring deduction "Deducted before tax"; off by default', async () => {
    // as the page sends it: a form (multipart), the tick as its text
    const form = api()
      .post('/api/payroll/recurring-deductions')
      .set('Cookie', hr)
      .field('employeeId', before.id)
      .field('name', MEDICAL)
      .field('amount', '1000.00')
      .field('startMonth', MONTH)
      .field('endMonth', MONTH)
      .field('consentOnFile', 'true')
      .field('beforeTax', 'true');
    beforeShare = (await form.expect(201)).body as Recurring;
    expect(beforeShare).toMatchObject({ name: MEDICAL, amount: 1000, beforeTax: true });
    const afterShare = (await recurring({ employeeId: after.id, name: MEDICAL, amount: 1000, startMonth: MONTH, endMonth: MONTH }).expect(201)).body as Recurring;
    expect(afterShare.beforeTax).toBe(false);
    expect((await recurring({ employeeId: after.id, name: 'Invented', amount: 10, startMonth: MONTH, beforeTax: 1 }).expect(400)).body.message).toEqual([
      'Send whether it is deducted before tax as true or false.',
    ]);
    // in the audit log only when ticked
    expect((await auditOf('recurring_deduction', beforeShare.id))[0].diff).toMatchObject({ name: MEDICAL, amount: 'set', beforeTax: true });
    expect((await auditOf('recurring_deduction', afterShare.id))[0].diff).not.toHaveProperty('beforeTax');
    const listed = (await api().get(`/api/payroll/recurring-deductions?employeeId=${before.id}`).set('Cookie', hr).expect(200)).body as Recurring[];
    expect(listed.map((r) => [r.id, r.beforeTax])).toEqual([[beforeShare.id, true]]);
  });

  it('the month’s run lowers the taxable pay by it before the income tax; after tax, the tax is unchanged', async () => {
    const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
    runId = run.id;
    const [b, a] = [lineOf(run, before), lineOf(run, after)];
    expect(recurringOn(b).map((x) => [x.amount, x.reason, x.beforeTax])).toEqual([[1000, MEDICAL, true]]);
    expect(recurringOn(a).map((x) => [x.amount, x.reason, x.beforeTax])).toEqual([[1000, MEDICAL, undefined]]);
    expect((await rowsOf(before)).map((r) => [r.status, r.beforeTax])).toEqual([['pending', true]]);
    expect((await rowsOf(after)).map((r) => [r.status, r.beforeTax])).toEqual([['pending', false]]);
    // as payrollLine works them out
    expect(b.result).toEqual(workedOut(run, b));
    expect(a.result).toEqual(workedOut(run, a));

    // before tax: the taxable pay 1,000 lower, so less tax; the insurance and the Fund as they were, the 1,000 off the net
    const plain = afterTax(run, b);
    expect(b.result).toMatchObject({ beforeTaxDeductions: 1000, taxableLowered: 1000, adjustmentDeductions: 1000 });
    expect(b.result.monthlyTaxable).toBe(round(plain.monthlyTaxable - 1000));
    expect(b.result.monthlyTax).toBeLessThan(plain.monthlyTax);
    expect([b.result.employeeInsurance, b.result.martyrsFund, b.result.earned]).toEqual([plain.employeeInsurance, plain.martyrsFund, plain.earned]);
    expect(round(b.result.net - plain.net)).toBe(round(plain.monthlyTax - b.result.monthlyTax));
    // after tax: as before, the tax a line without it would pay
    expect(a.result).not.toHaveProperty('beforeTaxDeductions');
    expect(a.result.monthlyTax).toBe(payrollLine({ ...a.terms, adjustments: undefined }, a.inputs, run.rules, run.lawRates).monthlyTax);
    expect(a.result.adjustmentDeductions).toBe(1000);
    expect(a.result.monthlyTax).toBe(plain.monthlyTax);

    // Additions / Deductions lists it before tax
    const listed = (await api().get(`/api/payroll/adjustments?month=${MONTH}&employeeId=${before.id}`).set('Cookie', hr).expect(200)).body as { type: string; beforeTax: boolean }[];
    expect(listed.map((x) => [x.type, x.beforeTax])).toEqual([['recurring', true]]);
  });

  it('HR unticks it: the pending month after tax, the draft’s line worked out again; ticked again, before tax', async () => {
    const taxAfter = lineOf(await getRun(), after).result.monthlyTax;
    expect((await edit(beforeShare.id, { beforeTax: false }).expect(200)).body).toMatchObject({ id: beforeShare.id, beforeTax: false });
    let b = lineOf(await getRun(), before);
    expect(recurringOn(b).map((x) => x.beforeTax)).toEqual([undefined]);
    expect(b.result.monthlyTax).toBe(taxAfter);
    expect(b.result).not.toHaveProperty('taxableLowered');
    expect((await rowsOf(before)).map((r) => r.beforeTax)).toEqual([false]);
    expect((await auditOf('recurring_deduction', beforeShare.id)).at(-1)).toMatchObject({ action: 'update', diff: { beforeTax: { from: true, to: false } } });
    // the same again: nothing changes
    await edit(beforeShare.id, { beforeTax: false }).expect(200);
    expect((await auditOf('recurring_deduction', beforeShare.id)).filter((x) => x.action === 'update')).toHaveLength(1);

    expect((await edit(beforeShare.id, { beforeTax: true }).expect(200)).body.beforeTax).toBe(true);
    b = lineOf(await getRun(), before);
    expect(b.result).toMatchObject({ beforeTaxDeductions: 1000, taxableLowered: 1000 });
    expect(b.result.monthlyTax).toBeLessThan(taxAfter);
    const [pending] = await prisma.payrollAdjustment.findMany({ where: { employeeId: before.id, type: 'recurring' }, select: { id: true } });
    expect((await auditOf('payroll_adjustment', pending.id)).at(-1)).toMatchObject({ action: 'update', diff: { beforeTax: { from: false, to: true }, recurringId: beforeShare.id } });
  });

  it('a change of amount keeps it before tax, as the one it replaces', async () => {
    const changed = (await api().post(`/api/payroll/recurring-deductions/${beforeShare.id}/change`).set('Cookie', hr).send({ amount: 1200, fromMonth: MONTH, consentOnFile: true }).expect(200))
      .body as Recurring;
    expect(changed).toMatchObject({ amount: 1200, beforeTax: true });
    beforeShare = changed;
    const b = lineOf(await getRun(), before);
    expect(recurringOn(b).map((x) => [x.amount, x.beforeTax])).toEqual([[1200, true]]);
    expect(b.result).toMatchObject({ beforeTaxDeductions: 1200, taxableLowered: 1200, adjustmentDeductions: 1200 });
  });

  it("Payroll Setup's before-tax health insurance limit a year caps what lowers the taxable pay: the Super Admin's", async () => {
    const limited = await lawBody({ beforeTaxHealthLimit: 6000 });
    await api().put(`/api/payroll/law-rates/${YEAR}`).set('Cookie', hr).send(limited).expect(403);
    const set = (await api().put(`/api/payroll/law-rates/${YEAR}`).set('Cookie', superAdmin).send(limited).expect(200)).body as LawRates;
    expect(set.beforeTaxHealthLimit).toBe(6000);
    // a draft refreshed takes the year's rates afresh: 6,000 a year is 500 a month
    let run = await refresh();
    expect(run.lawRates.beforeTaxHealthLimit).toBe(6000);
    let b = lineOf(run, before);
    const plain = afterTax(run, b);
    expect(b.result).toEqual(workedOut(run, b));
    expect(b.result).toMatchObject({ beforeTaxDeductions: 1200, taxableLowered: 500, adjustmentDeductions: 1200 });
    expect(b.result.monthlyTaxable).toBe(round(plain.monthlyTaxable - 500));

    // cleared: no limit
    const none = await lawBody({ beforeTaxHealthLimit: null });
    const cleared = (await api().put(`/api/payroll/law-rates/${YEAR}`).set('Cookie', superAdmin).send(none).expect(200)).body as LawRates;
    expect(cleared.beforeTaxHealthLimit).toBeUndefined();
    run = await refresh();
    b = lineOf(run, before);
    expect(run.lawRates).not.toHaveProperty('beforeTaxHealthLimit');
    expect(b.result).toMatchObject({ beforeTaxDeductions: 1200, taxableLowered: 1200 });
  });

  it('the register shows them before tax; the approved run keeps its figures', async () => {
    const res = await api().get(`/api/payroll/runs/${runId}/files/register`).set('Cookie', hr).buffer(true).parse(bytes).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const col = (header: string) => REGISTER_COLUMNS.findIndex((c) => c.header === header) + 1;
    const rowOf = (p: Person) => {
      let found = 0;
      ws.eachRow((r, n) => {
        if (r.getCell(3).value === p.employeeCode) found = n;
      });
      return ws.getRow(found);
    };
    const cells = (p: Person) => ['Deductions (before tax)', 'Deductions (after tax)'].map((h) => rowOf(p).getCell(col(h)).value);
    expect(cells(before)).toEqual([1200, 0]);
    expect(cells(after)).toEqual([0, 1000]);
    expect(rowOf(before).getCell(col('Additions and deductions')).value).toBe(`Recurring deduction: −1,200.00, before tax (${MEDICAL})`);
    expect(rowOf(after).getCell(col('Additions and deductions')).value).toBe(`Recurring deduction: −1,000.00 (${MEDICAL})`);

    const approvedBefore = lineOf(await getRun(), before);
    // the ETA file is made once the CEO approves the run, as the bank files are
    expect((await api().get(`/api/payroll/runs/${runId}/files/eta`).set('Cookie', ceo).expect(409)).body.message).toContain('once the CEO approves it');
    await api().post(`/api/payroll/runs/${runId}/submit`).set('Cookie', hr).send({}).expect(200);
    await api().post(`/api/payroll/runs/${runId}/approve`).set('Cookie', ceo).send({}).expect(200);
    expect((await rowsOf(before)).filter((r) => r.status !== 'cancelled').map((r) => [r.status, r.beforeTax, r.amount?.toNumber()])).toEqual([['applied', true, 1200]]);
    // unticked once the month is approved: the approved line and its deduction as they were
    expect((await edit(beforeShare.id, { beforeTax: false }).expect(200)).body.beforeTax).toBe(false);
    const kept = lineOf(await getRun(), before);
    expect(kept.result).toEqual(approvedBefore.result);
    expect(kept.terms).toEqual(approvedBefore.terms);
    expect((await rowsOf(before)).filter((r) => r.status !== 'cancelled').map((r) => r.beforeTax)).toEqual([true]);
  });
  it("the ETA file: ETA's template with the approved run's rows, the medical share before tax in its column", async () => {
    const res = await api().get(`/api/payroll/runs/${runId}/files/eta`).set('Cookie', ceo).buffer(true).parse(bytes).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/ETA Salary Tax [A-Z]{3} \d{4}\.xlsx/);
    // read the cells from the XML (ExcelJS can't open ETA's template: its input checks span whole columns)
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const sst = await zip.file('xl/sharedStrings.xml')!.async('string');
    const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    const cellIn = (row: string, col: string): string | number | null => {
      const m = new RegExp(`<c r="${col}\\d+"([^>]*)>(?:<v>([^<]*)</v>)?</c>`).exec(row);
      if (!m?.[2]) return null;
      return /t="s"/.test(m[1]) ? strings[Number(m[2])] : Number(m[2]);
    };
    const rows = [...sheet.matchAll(/<row r="(\d+)"[\s\S]*?<\/row>/g)].map((m) => m[0]);
    const rowOf = (p: Person) => rows.find((r) => cellIn(r, ETA.code) === p.employeeCode)!;
    expect(cellIn(rows[0], 'C')).toBe('اسم الموظف'); // ETA's header rows, as they are
    expect(cellIn(rows[1], 'AZ')).toBe('DTE295');

    const run = await getRun();
    for (const p of [before, after]) {
      const line = lineOf(run, p);
      const row = rowOf(p);
      expect(row, p.employeeCode).toBeDefined();
      expect(cellIn(row, ETA.name)).toBe('موظف تجريبي');
      expect(cellIn(row, ETA.daysWorked)).toBe(30); // a full month, whatever the days paid
      expect(cellIn(row, ETA.endOfService)).toBe(NO_DATE);
      expect(cellIn(row, ETA.totalEarnings)).toBe(round(line.result.earned + line.result.taxableAllowances));
      // the tax ETA's way: its cumulative method on the period's base, this run the year's first for these people
      const base = cellIn(row, ETA.periodBase) as number;
      expect(base).toBe(round(round(line.result.earned + line.result.taxableAllowances) - (cellIn(row, ETA.totalDeductions) as number)));
      const figures = etaTax([], { base }, run.lawRates);
      expect(cellIn(row, ETA.earlierTax)).toBe(0);
      expect(cellIn(row, ETA.annualBase)).toBe(figures.annualBase);
      expect(cellIn(row, ETA.cumulativeTax)).toBe(figures.cumulativeTax);
      expect(cellIn(row, ETA.periodTax)).toBe(figures.periodTax);
      expect(Math.abs(figures.periodTax - line.result.monthlyTax)).toBeLessThan(1); // within piasters of the payroll's
      expect(cellIn(row, ETA.netPay)).toBe(round(line.result.net + line.result.monthlyTax - figures.periodTax));
      expect(cellIn(row, ETA.transferred)).toBe(line.result.transfer);
      expect(cellIn(row, ETA.martyrsContribution)).toBe(line.result.martyrsFund);
    }
    // the medical share: before tax, in أقساط التأمين الصحي (BL); after tax, in the other deductions (CO)
    expect(cellIn(rowOf(before), ETA.healthPremiums)).toBe(1200);
    expect(cellIn(rowOf(before), ETA.otherDeductions)).toBe(0);
    expect(cellIn(rowOf(after), ETA.healthPremiums)).toBe(0);
    expect(cellIn(rowOf(after), ETA.otherDeductions)).toBe(1000);
    // the check the page shows: both in, no earlier month this year, nobody's tax a pound off the payroll's
    const check = (await api().get(`/api/payroll/runs/${runId}/files/eta/check`).set('Cookie', ceo).expect(200)).body;
    expect(check).toMatchObject({ earlierMonths: 0, differences: [] });
    expect(check.employees).toBeGreaterThanOrEqual(2);
    const made = await prisma.auditLog.findMany({ where: { entityType: 'payroll_run', entityId: runId, action: 'payroll_eta_file' } });
    expect(made).toHaveLength(1);
  });
});
