import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';

// Payroll statistics (owner, 17 October 2026: "Reports (Statistics)" under Payroll): from the runs the CEO approved, by
// month, department and team, the average and median gross, this year to date, and the Excel workbook; salary data,
// restricted like the register. Other test files leave people with signed contracts in the same database, who are on
// these runs too: so the months are checked against the runs' own lines, and the department against these tests' own
// people. Everything made here is deleted. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const TODAY = todayInCairo();
const CURRENT = TODAY.slice(0, 7);
/** Two months paid and approved, and one left a draft. */
const FIRST = monthsLater(CURRENT, -6);
const SECOND = monthsLater(CURRENT, -5);
const DRAFT = monthsLater(CURRENT, -3);
const MONTHS = [FIRST, SECOND, DRAFT];
const JOINED = firstDay(monthsLater(CURRENT, -9));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Line {
  employeeId: string;
  department: string | null;
  onHold: boolean;
  result: Record<string, number>;
}

const bytes = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const cents = (n: number) => Math.round(n * 100);
const sum = (values: number[]) => values.reduce((s, v) => s + cents(v), 0) / 100;

describe('Payroll statistics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let finance: string;
  let ceo: string;
  let admin: string;
  let staff: string;
  const people: string[] = [];
  let departmentId: string;
  let teamId: string;
  const lines: Record<string, Line[]> = {};
  const api = () => request(app.getHttpServer());

  async function hire(name: string, gross: number, placeId: string) {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId: placeId })
      .expect(201);
    people.push(person.body.id);
    const draft = (await api().post(`/api/employees/${person.body.id}/employments/${hired.body.employment.id}/contracts`).set('Cookie', hr).send({ grossSalary: gross }).expect(201))
      .body as { id: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
  }

  async function run(month: string, approve: boolean) {
    const made = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month }).expect(201)).body as { id: string };
    if (approve) {
      await api().post(`/api/payroll/runs/${made.id}/submit`).set('Cookie', hr).send({}).expect(200);
      await api().post(`/api/payroll/runs/${made.id}/approve`).set('Cookie', ceo).send({}).expect(200);
    }
    lines[month] = (await api().get(`/api/payroll/runs/${made.id}`).set('Cookie', hr).expect(200)).body.lines as Line[];
  }

  const report = (query: string, session = hr) => api().get(`/api/payroll/statistics${query}`).set('Cookie', session);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((m) => new Date(`${m}-01T00:00:00Z`)) } } });

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Stats ${RUN}` }).expect(201)).body.id;
    teamId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Team ${RUN}`, parentId: departmentId }).expect(201)).body.id;
    await hire('Senior', 20000, departmentId);
    await hire('Junior', 8000, teamId);
    await run(FIRST, true);
    await run(SECOND, true);
    await run(DRAFT, false);
  });

  afterAll(async () => {
    await prisma.payrollRun.deleteMany({ where: { month: { in: MONTHS.map((m) => new Date(`${m}-01T00:00:00Z`)) } } });
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    if (teamId) await prisma.department.deleteMany({ where: { id: teamId } });
    if (departmentId) await prisma.department.deleteMany({ where: { id: departmentId } });
    await app.close();
  });

  it('HR, Finance and the CEO see them; nobody else', async () => {
    for (const session of [hr, finance, ceo]) await report(`?from=${FIRST}&to=${DRAFT}`, session).expect(200);
    for (const session of [admin, staff]) {
      await report('', session).expect(403);
      await api().get('/api/payroll/statistics/workbook').set('Cookie', session).expect(403);
    }
  });

  it('counts the approved runs of the period, month by month, from their lines; the draft’s month is without one', async () => {
    const s = (await report(`?from=${FIRST}&to=${DRAFT}`).expect(200)).body;
    expect(s.period).toEqual({ from: FIRST, to: DRAFT });
    expect(s.months.map((m: { month: string; status: string }) => [m.month, m.status])).toEqual([
      [FIRST, 'approved'],
      [SECOND, 'approved'],
    ]);
    for (const [i, month] of [FIRST, SECOND].entries()) {
      const ls = lines[month];
      expect(s.months[i]).toMatchObject({
        employees: ls.length,
        held: 0,
        gross: sum(ls.map((l) => l.result.earned + l.result.allowances)),
        net: sum(ls.map((l) => l.result.net)),
        transfer: sum(ls.map((l) => l.result.transfer)),
        salaryTax: sum(ls.map((l) => l.result.monthlyTax)),
        employeeInsurance: sum(ls.map((l) => l.result.employeeInsurance)),
        companyInsurance: sum(ls.map((l) => l.result.employerInsurance)),
        martyrsFund: sum(ls.map((l) => l.result.martyrsFund)),
        companyCost: sum(ls.map((l) => l.result.companyCost)),
      });
    }
    expect(s.without).toEqual(
      expect.arrayContaining([{ month: DRAFT, status: 'draft' }, { month: monthsLater(CURRENT, -4), status: null }]),
    );
    expect(s.totals).toMatchObject({ months: 2, personMonths: lines[FIRST].length + lines[SECOND].length, companyCost: sum(s.months.map((m: { companyCost: number }) => m.companyCost)) });
  });

  it('by department and team: these tests’ own people, the team counted in its department', async () => {
    const s = (await report(`?from=${FIRST}&to=${SECOND}`).expect(200)).body;
    const ours = [...lines[FIRST], ...lines[SECOND]].filter((l) => people.includes(l.employeeId));
    const department = s.byDepartment.find((d: { name: string }) => d.name === `Stats ${RUN}`);
    expect(department).toMatchObject({
      employees: 2,
      personMonths: 4,
      gross: sum(ours.map((l) => l.result.earned + l.result.allowances)),
      companyCost: sum(ours.map((l) => l.result.companyCost)),
      averageGross: 14000, // 20,000 and 8,000, two months each
      teams: [{ name: `Team ${RUN}`, employees: 1, personMonths: 2, gross: 16000 }],
    });
  });

  it('adds this year to date, January to this month', async () => {
    const s = (await report(`?from=${FIRST}&to=${FIRST}`).expect(200)).body;
    const year = CURRENT.slice(0, 4);
    expect(s.yearToDate).toMatchObject({ year: Number(year), from: `${year}-01`, to: CURRENT });
    const thisYear = [FIRST, SECOND].filter((m) => m.startsWith(year));
    expect(s.yearToDate.months).toBeGreaterThanOrEqual(thisYear.length);
  });

  it('refuses a period it can’t read', async () => {
    expect((await report('?from=2026-13').expect(400)).body.message).toEqual(['Choose the months as YYYY-MM, e.g. 2026-01.']);
    expect((await report(`?from=${SECOND}&to=${FIRST}`).expect(400)).body.message).toBe('The period ends before it starts: choose a "to" month on or after the "from" month.');
  });

  it('downloads them as a workbook, each download in the audit log', async () => {
    const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const res = await api().get(`/api/payroll/statistics/workbook?from=${FIRST}&to=${SECOND}`).set('Cookie', finance).buffer(true).parse(bytes).expect(200);
    expect(res.headers['content-type']).toContain(XLSX);
    expect(res.headers['content-disposition']).toContain(`Payroll statistics ${FIRST} to ${SECOND}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['By Month', 'By Department', 'Summary']);
    const byMonth = wb.getWorksheet('By Month')!;
    expect((byMonth.getRow(1).values as unknown[]).slice(1, 6)).toEqual(['Month', 'Status', 'Employees', 'On hold', 'Gross']);
    expect(byMonth.getRow(4).getCell(1).value).toBe('Total');
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_statistics', id: { gt: since } } });
    expect(audit.map((a) => [a.action, a.diff])).toEqual([['payroll_statistics_file', { from: FIRST, to: SECOND, months: [FIRST, SECOND] }]]);
  });
});
