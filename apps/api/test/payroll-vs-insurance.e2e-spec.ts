import type { INestApplication } from '@nestjs/common';
import { DEVELOPER_NO_FILES, type PayrollVsInsurance, type VsInsuranceRow } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// The Payroll vs Social Insurance report (owner, 26 October 2026: "i want a comparison report between the actual payroll
// run and the social insurance data, and the differences in the social insurance and taxes between the 2 runs"): a paid run
// with three people (registered, not registered with Social insurance for everyone on, a freelancer) and a draft the month
// after; the rows and totals, the period defaulting to the latest run, HR not seeing a C-level person, the Excel workbook of
// three sheets in the audit log, a developer's masked money. Other test files leave people with signed contracts in the same
// database, who are on these runs too, so the checks look at this run's own people and at sums over the rows returned.
// Everything made here is deleted at the end. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
/** The paid run's month, and the draft's after it. */
const PAID = monthsLater(CURRENT, -8);
const DRAFT = monthsLater(CURRENT, -7);
const MONTHS = [PAID, DRAFT];
const JOINED = firstDay(monthsLater(CURRENT, -10));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GROSS = 20000;
const ALLOWANCE = 2000;
const REGISTERED_WAGE = 12000;

type Report = PayrollVsInsurance & { generatedAt: string; confidentialExcluded: number };

interface Person {
  id: string;
  employeeCode: string;
  employmentId: string;
}

/** Reads a response body as bytes, whatever its type. */
const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

const cents = (v: number) => Math.round(v * 100);
const sum = (values: number[]) => values.reduce((s, v) => s + cents(v), 0) / 100;
const piasters = (v: number) => Math.round(v * 100) / 100;
const messagesOf = (res: request.Response) => [...new Set([res.body.message].flat() as string[])];

describe('Payroll vs Social Insurance report (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let hrSuper: string; // HR and Super Admin: gives the C-level grade
  let staff: string;
  let developer: string;
  let g9: string;
  let g9WasConfidential: boolean;
  let insureEveryoneBefore: boolean;
  let departmentId: string;
  let teamId: string;
  let transportId: string;
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  let rana: Person; // registered: a comprehensive wage of 12,000 on the Social Insurance tab, gross 20,000 and a 2,000 allowance
  let nour: Person; // not registered, with Social insurance for everyone on
  let fady: Person; // a freelancer
  let clara: Person; // C-level

  async function hire(name: string, employment: Record<string, unknown>, placeId: string, session = hr): Promise<Person> {
    const e = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تقرير التأمينات' }).expect(201);
    people.push(e.body.id);
    const hired = await api()
      .post(`/api/employees/${e.body.id}/employments`)
      .set('Cookie', session)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId: placeId, ...employment })
      .expect(201);
    return { id: e.body.id, employeeCode: e.body.employeeCode, employmentId: hired.body.employment.id };
  }

  async function signed(p: Person, body: Record<string, unknown>, session = hr) {
    const draft = (await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', session).send({ grossSalary: 12000, ...body }).expect(201)).body as {
      id: string;
      startDate: string;
    };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', session).send({ signedOn: draft.startDate }).expect(200);
  }

  const get = (query: Record<string, string> = {}, session = hr) => api().get('/api/payroll/vs-insurance').query(query).set('Cookie', session);
  const report = async (query: Record<string, string> = {}, session = hr) => (await get(query, session).expect(200)).body as Report;
  const workbookFile = (query: Record<string, string>, session = hr) => api().get('/api/payroll/vs-insurance/workbook').query(query).set('Cookie', session).buffer(true).parse(bytes);
  const rowOf = (r: Report, p: Person, month = PAID) => r.rows.find((x) => x.employee.id === p.id && x.month === month);
  const settings = (body: object, session: string) => api().patch('/api/payroll/settings').set('Cookie', session).send(body);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    hrSuper = await signIn(app, await createUser(prisma, ['hr', 'super_admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    developer = await signIn(app, await createUser(prisma, ['developer']));
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((m) => new Date(`${m}-01T00:00:00Z`)) } } });

    // Social insurance for everyone on (owner, 26 October 2026), as the runs are made; put back at the end
    insureEveryoneBefore = (await api().get('/api/payroll/settings').set('Cookie', hr).expect(200)).body.insureEveryone as boolean;
    await settings({ insureEveryone: true }, superAdmin).expect(200);

    // G9 · Executive is C-level (owner, 19 October 2026), as the migration marks it
    const grade = await prisma.grade.findFirstOrThrow({ where: { code: 'G9' }, select: { id: true, confidential: true } });
    g9 = grade.id;
    g9WasConfidential = grade.confidential;
    await prisma.grade.update({ where: { id: g9 }, data: { confidential: true } });

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Insurance Report ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Field', parentId: departmentId }).expect(201)).body.id;
    transportId = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;

    rana = await hire('Rana Registered', {}, teamId);
    await signed(rana, { grossSalary: GROSS, allowances: [{ allowanceTypeId: transportId, amount: ALLOWANCE }] });
    await api().patch(`/api/employees/${rana.id}`).set('Cookie', hr).send({ socialInsured: true, insuranceComprehensiveWage: REGISTERED_WAGE }).expect(200);

    nour = await hire('Nour Notyet', {}, departmentId);
    await signed(nour, { grossSalary: 9000 });

    fady = await hire('Fady Free', { employmentType: 'freelance' }, departmentId);
    await signed(fady, { grossSalary: 5000 });

    // HR alone can't give the C-level grade: HR with Super Admin hires Clara and signs her contract
    clara = await hire('Clara Chief', { gradeId: g9 }, departmentId, hrSuper);
    await signed(clara, { grossSalary: 30000 }, hrSuper);

    const paid = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: PAID }).expect(201)).body as { id: string };
    await api().post(`/api/payroll/runs/${paid.id}/submit`).set('Cookie', hr).send({}).expect(200);
    await api().post(`/api/payroll/runs/${paid.id}/approve`).set('Cookie', ceo).send({}).expect(200);
    await api().post(`/api/payroll/runs/${paid.id}/paid`).set('Cookie', hr).send({ paidOn: TODAY }).expect(200);
    await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: DRAFT }).expect(201);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((m) => new Date(`${m}-01T00:00:00Z`)) } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    if (teamId) await prisma.department.deleteMany({ where: { id: teamId } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    if (transportId) await prisma.allowanceType.deleteMany({ where: { id: transportId } });
    if (g9) await prisma.grade.update({ where: { id: g9 }, data: { confidential: g9WasConfidential } });
    if (superAdmin) await settings({ insureEveryone: insureEveryoneBefore }, superAdmin);
    await app.close();
  });

  describe('who sees it', () => {
    it('HR, Finance and the CEO; not an Admin, a Super Admin or an employee as such', async () => {
      for (const session of [hr, finance, ceo]) {
        await get({ from: PAID }, session).expect(200).expect('Cache-Control', 'private, no-store');
        await workbookFile({ from: PAID }, session).expect(200);
      }
      for (const session of [admin, superAdmin, staff]) {
        await get({}, session).expect(403);
        await workbookFile({}, session).expect(403);
      }
      await api().get('/api/payroll/vs-insurance').expect(401);
    });
  });

  describe('the period', () => {
    it('is the latest run’s month unless asked; one month alone is that month; a range takes every run in it, each with its status', async () => {
      const latest = await prisma.payrollRun.findFirstOrThrow({ orderBy: { month: 'desc' }, select: { month: true } });
      const month = latest.month.toISOString().slice(0, 7);
      const byDefault = await report();
      expect(byDefault).toMatchObject({ period: { from: month, to: month }, defaulted: 'latest_run' });

      const one = await report({ from: PAID });
      expect(one).toMatchObject({ period: { from: PAID, to: PAID }, defaulted: null });
      expect(one.runs.map((r) => [r.month, r.status, r.insureEveryone])).toEqual([[PAID, 'paid', true]]);
      expect(one.runs[0].lines).toBe(one.rows.length);
      expect(one.rows.every((r) => r.month === PAID && r.status === 'paid')).toBe(true);

      const range = await report({ from: PAID, to: DRAFT });
      expect(range.runs.map((r) => [r.month, r.status])).toEqual([
        [PAID, 'paid'],
        [DRAFT, 'draft'],
      ]);
      expect(rowOf(range, rana, DRAFT)).toMatchObject({ status: 'draft', standing: 'registered' });
    });

    it('refuses months it can’t read and a period ending before it starts', async () => {
      expect(messagesOf(await get({ from: '2026-13' }).expect(400))).toEqual(['Choose the months as YYYY-MM, e.g. 2026-01.']);
      expect(messagesOf(await get({ from: DRAFT, to: PAID }).expect(400))).toEqual(['The period ends before it starts: choose a "to" month on or after the "from" month.']);
    });
  });

  describe('the rows', () => {
    let r: Report;
    let employeeRate: number;
    let employerRate: number;

    beforeAll(async () => {
      r = await report({ from: PAID });
      employeeRate = r.runs[0].law.employeeInsuranceRate;
      employerRate = r.runs[0].law.employerInsuranceRate;
      expect(REGISTERED_WAGE).toBeGreaterThanOrEqual(r.runs[0].law.insurableWageMin);
      expect(REGISTERED_WAGE).toBeLessThanOrEqual(r.runs[0].law.insurableWageMax);
    });

    it('someone registered: A as paid, B the same engine on the registered wage, the differences B − A', () => {
      const row = rowOf(r, rana)!;
      expect(row).toMatchObject({ standing: 'registered', department: `Insurance Report ${RUN} › Field`, payBasis: 'monthly', onHold: false });
      const employeeSi = piasters(REGISTERED_WAGE * employeeRate);
      const employerSi = piasters(REGISTERED_WAGE * employerRate);
      expect(row.actual).toMatchObject({
        gross: GROSS,
        earned: GROSS,
        allowances: ALLOWANCE,
        insuredWage: REGISTERED_WAGE,
        employeeInsurance: employeeSi,
        employerInsurance: employerSi,
        monthlyTaxable: GROSS + ALLOWANCE - employeeSi,
        paidDays: 30,
      });
      expect(row.actual.companyCost).toBe(GROSS + ALLOWANCE + employerSi);
      expect(row.insurance).toMatchObject({
        gross: REGISTERED_WAGE,
        earned: REGISTERED_WAGE,
        allowances: 0,
        insuredWage: REGISTERED_WAGE,
        employeeInsurance: employeeSi,
        employerInsurance: employerSi,
        monthlyTaxable: REGISTERED_WAGE - employeeSi,
        paidDays: 30,
      });
      expect(row.insurance!.companyCost).toBe(REGISTERED_WAGE + employerSi);
      expect(row.insurance!.monthlyTax).toBeLessThan(row.actual.monthlyTax);
      expect(row.difference).toEqual({
        employeeInsurance: 0,
        employerInsurance: 0,
        monthlyTax: piasters(row.insurance!.monthlyTax - row.actual.monthlyTax),
        martyrsFund: piasters(row.insurance!.martyrsFund - row.actual.martyrsFund),
        net: piasters(row.insurance!.net - row.actual.net),
        companyCost: -(GROSS + ALLOWANCE - REGISTERED_WAGE),
      });
      expect(row.difference!.monthlyTax).toBeLessThan(0);
      expect(row.difference!.net).toBeLessThan(0);
    });

    it('someone not registered while the switch is on: A has the shares on the computed insured wage, flagged; no B', () => {
      const row = rowOf(r, nour)!;
      expect(row.standing).toBe('counted_as_insured');
      expect(row.actual).toMatchObject({ gross: 9000, insuredWage: 9000, employeeInsurance: piasters(9000 * employeeRate), employerInsurance: piasters(9000 * employerRate) });
      expect(row.insurance).toBeNull();
      expect(row.difference).toBeNull();
    });

    it('a freelancer: outside the labour law, no insurance or tax in A, no B', () => {
      const row = rowOf(r, fady)!;
      expect(row).toMatchObject({ standing: 'outside_law', employmentType: 'freelance' });
      expect(row.actual).toMatchObject({ gross: 5000, insuredWage: 0, employeeInsurance: 0, employerInsurance: 0, monthlyTax: 0, martyrsFund: 0, net: 5000 });
      expect(row.insurance).toBeNull();
    });

    it('the totals: A over every row, B and the differences over the registered rows, the counts by standing', () => {
      const t = r.totals;
      const registered = r.rows.filter((x): x is VsInsuranceRow & { insurance: NonNullable<VsInsuranceRow['insurance']>; difference: NonNullable<VsInsuranceRow['difference']> } => x.insurance !== null);
      expect(t.rows).toBe(r.rows.length);
      expect(t.people).toBe(new Set(r.rows.map((x) => x.employee.id)).size);
      expect(t.registered).toBe(r.rows.filter((x) => x.standing === 'registered').length);
      expect(t.registered).toBeGreaterThanOrEqual(1);
      expect(t.countedAsInsured).toBeGreaterThanOrEqual(1);
      expect(t.notRegistered).toBeGreaterThanOrEqual(t.countedAsInsured);
      expect(t.outsideLaw).toBeGreaterThanOrEqual(1);
      expect(t.actual.net).toBe(sum(r.rows.map((x) => x.actual.net)));
      expect(t.actual.companyCost).toBe(sum(r.rows.map((x) => x.actual.companyCost)));
      expect(t.actualRegistered.companyCost).toBe(sum(registered.map((x) => x.actual.companyCost)));
      expect(t.insurance.companyCost).toBe(sum(registered.map((x) => x.insurance.companyCost)));
      expect(t.difference.companyCost).toBe(sum(registered.map((x) => x.difference.companyCost)));
      expect(t.difference.employeeInsurance).toBe(sum(registered.map((x) => x.difference.employeeInsurance)));
    });
  });

  describe('C-level people', () => {
    it('are left out for HR and Finance and counted; the CEO sees them', async () => {
      for (const session of [hr, finance]) {
        const r = await report({ from: PAID }, session);
        expect(rowOf(r, clara)).toBeUndefined();
        expect(r.confidentialExcluded).toBe(1);
        expect(r.runs[0].lines).toBe(r.rows.length);
      }
      const full = await report({ from: PAID }, ceo);
      expect(rowOf(full, clara)).toMatchObject({ standing: 'counted_as_insured' });
      expect(full.confidentialExcluded).toBe(0);
      const forHr = await report({ from: PAID }, hr);
      expect(full.totals.rows).toBe(forHr.totals.rows + 1);
      expect(full.totals.actual.net).toBe(sum([forHr.totals.actual.net, rowOf(full, clara)!.actual.net]));
    });
  });

  describe('the workbook', () => {
    it('downloads the report as three sheets, the figures as numbers, each download in the audit log', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      const json = await report({ from: PAID });
      const res = await workbookFile({ from: PAID }).expect(200);
      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain(`Payroll vs social insurance ${PAID}.xlsx`);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Comparison', 'Actual run', 'SI cycle']);
      const [comparison, actual, insurance] = wb.worksheets;
      const rows = rowsOf(comparison);
      const heads = rows[0] as string[];
      expect(heads.slice(0, 7)).toEqual(['Employee code', 'Employee name (English)', 'Department', 'Team', 'Month', 'Run status', 'Standing']);
      expect(heads[7]).toBe('Actual: Gross');
      expect(heads[19]).toBe('SI cycle: Gross');
      expect(heads[36]).toBe('Difference: Company cost (SI cycle − actual)');
      const ranaRow = rows.find((r) => r[0] === rana.employeeCode)!;
      expect(ranaRow[1]).toBe(`Rana Registered ${RUN}`);
      expect(ranaRow.slice(2, 7)).toEqual([`Insurance Report ${RUN}`, 'Field', expect.any(String), 'Paid', 'Registered']);
      expect(ranaRow[7]).toBe(GROSS);
      expect(ranaRow[19]).toBe(REGISTERED_WAGE);
      expect(ranaRow[36]).toBe(-(GROSS + ALLOWANCE - REGISTERED_WAGE));
      const nourRow = rows.find((r) => r[0] === nour.employeeCode)!;
      expect(nourRow[6]).toBe('Counted as insured (not registered)');
      expect(nourRow[19]).toBeUndefined();
      // the groups are rows: the department, its team, their subtotals and the grand total
      const texts = rows.map((r) => r[0]);
      expect(texts).toContain(`Insurance Report ${RUN}`);
      expect(texts).toContain(`Insurance Report ${RUN} › Field`);
      expect(texts).toContain('Total · Field');
      expect(texts).toContain(`Total · Insurance Report ${RUN}`);
      expect(texts).toContain('Total · everyone');
      const grand = rows.find((r) => r[0] === 'Total · everyone')!;
      expect(grand[36]).toBe(json.totals.difference.companyCost);
      expect(comparison.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 1 });

      const codesIn = (ws: ExcelJS.Worksheet) => rowsOf(ws).slice(1).map((r) => r[0]);
      expect(codesIn(actual)).toEqual(expect.arrayContaining([rana.employeeCode, nour.employeeCode, fady.employeeCode]));
      expect(codesIn(actual)).not.toContain(clara.employeeCode);
      expect(codesIn(insurance)).toContain(rana.employeeCode);
      expect(codesIn(insurance)).not.toContain(nour.employeeCode);
      expect(codesIn(insurance)).not.toContain(fady.employeeCode);
      expect(actual.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

      const audit = await prisma.auditLog.findMany({ where: { action: 'payroll_vs_insurance_file', id: { gt: since } } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityType: 'payroll_vs_insurance', diff: { from: PAID, to: PAID, runs: [PAID] } });
      expect((audit[0].diff as { employees: string[] }).employees).toEqual(expect.arrayContaining([rana.employeeCode, nour.employeeCode, fady.employeeCode]));
      expect((audit[0].diff as { employees: string[] }).employees).not.toContain(clara.employeeCode);
    });

    it('is named for the range when the period is one', async () => {
      const res = await workbookFile({ from: PAID, to: DRAFT }).expect(200);
      expect(res.headers['content-disposition']).toContain(`Payroll vs social insurance ${PAID} to ${DRAFT}.xlsx`);
    });
  });

  describe('a developer', () => {
    it('gets the report with every amount masked and the people as pseudonyms, and never the workbook', async () => {
      const r = await report({ from: PAID }, developer);
      const row = rowOf(r, rana)!;
      expect(row.employee.fullNameEn).not.toContain('Rana');
      expect(row.actual).toMatchObject({ gross: 0, allowances: 0, insuredWage: 0, employeeInsurance: 0, net: 0, companyCost: 0 });
      expect(row.insurance).toMatchObject({ gross: 0, employeeInsurance: 0, net: 0 });
      expect(row.difference).toMatchObject({ monthlyTax: 0, net: 0, companyCost: 0 });
      expect(row.actual.paidDays).toBe(30);
      expect(r.totals.actual.companyCost).toBe(0);
      expect(JSON.stringify(r)).not.toContain(rana.employeeCode);
      const refused = await workbookFile({ from: PAID }, developer).expect(403);
      expect(JSON.parse((refused.body as Buffer).toString('utf8')).message).toBe(DEVELOPER_NO_FILES);
    });
  });
});
