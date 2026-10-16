import type { INestApplication } from '@nestjs/common';
import { calendarYear, monthsBetween, type DueForReviewRow, type SalaryRaiseRow, type SalaryRaisesReport } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// The Salary Raises report (owner's decision, 16 October 2026: the salary raises tracked on each profile's Salary History
// and in a company-wide report): the raises of a period with their totals and departments, who is due for a salary
// review after the payroll settings' months, and the same as an Excel workbook; HR, Finance and the CEO only. The
// raises are made here as HR and the CEO make them (send, approve, sign), in 2021 and 2022, years no other test file
// has contracts in, so the report's totals are these alone; who is due for review is looked at for these people only.
// Everything made here is deleted at the end. Every name and amount is invented.

const RUN = Date.now().toString(36).toLowerCase();
const today = todayInCairo();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Hired three months ago: not due for a review after 12 months. */
const RECENT = firstDay(monthsLater(today.slice(0, 7), -3));
const REVIEW_MESSAGE = 'Enter after how many months without a raise a salary review is due, a whole number from 1 to 60, e.g. 12.';

type Report = SalaryRaisesReport & { generatedAt: string };

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

/** A refusal's messages, each once. */
const messagesOf = (res: request.Response) => [...new Set([res.body.message].flat() as string[])];

describe('Salary raises (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let manager: string;
  let staff: string;
  let emailDomainBefore: string | null;
  let accounts: string; // a department, with the Payroll team under it
  let payrollTeam: string;
  let sales: string;
  let transport: string;
  const titles: string[] = [];
  const people: string[] = [];
  const api = () => request(app.getHttpServer());

  // Dina: two amendment raises in 2021 (the first with a promotion), renewed with the same pay; HR asks for another
  let dina: Person;
  // Eli: a new contract with a raise in 2021, a renewal with new pay in 2022, a raise drafted since
  let eli: Person;
  // Fay: renewed with the same pay, never a raise
  let fay: Person;
  // Gus: a raise from 2021 with the CEO, never decided
  let gus: Person;
  // Hana: hired three months ago
  let hana: Person;

  async function employee(name: string, profile: Record<string, unknown> = {}) {
    const res = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي', ...profile }).expect(201);
    people.push(res.body.id);
    return res.body as { id: string; employeeCode: string };
  }

  async function hire(name: string, employment: Record<string, unknown>): Promise<Person> {
    const e = await employee(name);
    const hired = await api().post(`/api/employees/${e.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', ...employment }).expect(201);
    return { id: e.id, employeeCode: e.employeeCode, employmentId: hired.body.employment.id };
  }

  const sign = (id: string) => api().post(`/api/contracts/${id}/sign`).set('Cookie', hr).send({ signedOn: today }).expect(200);
  // the CEO approves with a comment (owner, 17 October 2026)
  const step = (id: string, action: 'send' | 'approve', session: string) =>
    api()
      .post(`/api/raises/${id}/${action}`)
      .set('Cookie', session)
      .send(action === 'approve' ? { comment: 'Approved' } : {})
      .expect(200);

  /** A contract version as HR enters it (the first, or a renewal), signed; one with new pay sent and approved first. */
  async function contract(p: Person, body: Record<string, unknown>): Promise<string> {
    const made = await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send({ durationMonths: 12, ...body }).expect(201);
    if (body.raiseReason) {
      await step(made.body.id, 'send', hr);
      await step(made.body.id, 'approve', ceo);
    }
    await sign(made.body.id);
    return made.body.id as string;
  }

  /** A raise as HR enters it; sent, approved and signed unless it stops before. */
  async function raise(p: Person, body: Record<string, unknown>, until: 'draft' | 'sent' | 'signed' = 'signed'): Promise<string> {
    const made = await api().post(`/api/employees/${p.id}/employments/${p.employmentId}/raises`).set('Cookie', hr).send(body).expect(201);
    if (until === 'draft') return made.body.id as string;
    await step(made.body.id, 'send', hr);
    if (until === 'sent') return made.body.id as string;
    await step(made.body.id, 'approve', ceo);
    await sign(made.body.id);
    return made.body.id as string;
  }

  const report = async (query = '', session = hr) => (await api().get(`/api/reports/salary-raises${query}`).set('Cookie', session).expect(200)).body as Report;
  const workbookFile = (query = '', session = hr) => api().get(`/api/reports/salary-raises.xlsx${query}`).set('Cookie', session).buffer(true).parse(bytes);
  const settings = (body: object, session = hr) => api().patch('/api/payroll/settings').set('Cookie', session).send(body);
  /** Who is due for review among the people made here, in the report's order. */
  const dueHere = (r: Report) => r.dueForReview.filter((d) => people.includes(d.employee.id));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    manager = await signIn(app, await createUser(prisma, ['manager']));
    staff = await signIn(app, await createUser(prisma, ['employee']));

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    // the CEO's own profile, so the approvals name them
    await employee('Chief Officer', { workEmail: ceoEmail });

    accounts = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Accounts ${RUN}` }).expect(201)).body.id;
    payrollTeam = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: 'Payroll', parentId: accounts }).expect(201)).body.id;
    sales = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Sales ${RUN}` }).expect(201)).body.id;
    const title = async (departmentId: string, titleEn: string) => {
      const id = (await api().post('/api/job-titles').set('Cookie', hr).send({ departmentId, titleEn }).expect(201)).body.id as string;
      titles.push(id);
      return id;
    };
    const analyst = await title(payrollTeam, 'Analyst');
    const senior = await title(payrollTeam, 'Senior Analyst');
    const coordinator = await title(sales, 'Coordinator');
    transport = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;
    const allowance = (amount: number) => [{ allowanceTypeId: transport, amount }];

    dina = await hire('Dina Raised', { joinDate: '2021-01-01', departmentId: payrollTeam, jobTitleId: analyst });
    await contract(dina, { grossSalary: 10000, allowances: allowance(500) });
    await raise(dina, { way: 'amendment', effectiveDate: '2021-07-01', reason: 'annual', grossSalary: 12000, allowances: allowance(700), newJobTitleId: senior });
    await raise(dina, { way: 'amendment', effectiveDate: '2021-11-01', reason: 'adjustment', grossSalary: 12600 });
    await contract(dina, { grossSalary: 12600 }); // renewed from 2022 with the same pay: no raise
    await api().post(`/api/employees/${dina.id}/raise-requests`).set('Cookie', hr).send({ raiseReason: 'annual', comment: 'Due for review' }).expect(201);

    eli = await hire('Eli Renewed', { joinDate: '2021-01-01', departmentId: sales, jobTitleId: coordinator });
    await contract(eli, { grossSalary: 8000 });
    await raise(eli, { way: 'contract', effectiveDate: '2021-04-01', reason: 'promotion', grossSalary: 10000 });
    await contract(eli, { grossSalary: 11000, raiseReason: 'annual' }); // renewed from April 2022 with new pay
    await raise(eli, { way: 'amendment', effectiveDate: '2022-06-01', reason: 'annual', grossSalary: 11500 }, 'draft');

    fay = await hire('Fay Same', { joinDate: '2021-01-01', departmentId: payrollTeam, jobTitleId: analyst });
    await contract(fay, { grossSalary: 20000 });
    await contract(fay, { grossSalary: 20000 });

    gus = await hire('Gus Waiting', { joinDate: '2021-03-01', departmentId: payrollTeam, jobTitleId: analyst });
    await contract(gus, { grossSalary: 5000 });
    await raise(gus, { way: 'amendment', effectiveDate: '2021-10-01', reason: 'annual', grossSalary: 5500 }, 'sent');

    hana = await hire('Hana Recent', { joinDate: RECENT, departmentId: sales, jobTitleId: coordinator });
    await contract(hana, { grossSalary: 9000 });
  });

  afterAll(async () => {
    // the employments first (their contracts and raise requests go with them), then the people and what they used
    await prisma.employment.deleteMany({ where: { employeeId: { in: people } } });
    await prisma.employee.deleteMany({ where: { id: { in: people } } });
    await prisma.jobTitle.deleteMany({ where: { id: { in: titles } } });
    await prisma.department.deleteMany({ where: { id: { in: [payrollTeam, accounts, sales].filter(Boolean) } } });
    if (transport) await prisma.allowanceType.deleteMany({ where: { id: transport } });
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { salaryReviewMonths: 12 } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('who sees it', () => {
    it('HR, Finance and the CEO; not an Admin, a Super Admin, a manager or an employee as such', async () => {
      for (const session of [hr, finance, ceo]) {
        await api().get('/api/reports/salary-raises?from=2021-01&to=2021-12').set('Cookie', session).expect(200).expect('Cache-Control', 'private, no-store');
        await workbookFile('?from=2021-01&to=2021-12', session).expect(200);
      }
      for (const session of [admin, superAdmin, manager, staff]) {
        await api().get('/api/reports/salary-raises').set('Cookie', session).expect(403);
        await workbookFile('', session).expect(403);
      }
      await api().get('/api/reports/salary-raises').expect(401);
    });
  });

  describe('the period', () => {
    it('is this calendar year unless asked; one month alone takes its year', async () => {
      expect((await report()).period).toEqual(calendarYear(today));
      expect((await report('?from=2021-04')).period).toEqual({ from: '2021-04', to: '2021-12' });
      expect((await report('?to=2022-03')).period).toEqual({ from: '2022-01', to: '2022-03' });
    });

    it('refuses months it can’t read, and a period that ends before it starts', async () => {
      expect(messagesOf(await api().get('/api/reports/salary-raises?from=2021-13').set('Cookie', hr).expect(400))).toEqual([
        'Choose the month the period starts in, as YYYY-MM, e.g. 2026-01.',
      ]);
      expect(messagesOf(await api().get('/api/reports/salary-raises?to=2021-1').set('Cookie', hr).expect(400))).toEqual(['Choose the month the period ends in, as YYYY-MM, e.g. 2026-12.']);
      expect(messagesOf(await api().get('/api/reports/salary-raises?from=2022-01&to=2021-12').set('Cookie', hr).expect(400))).toEqual([
        'The period ends before it starts: choose a "to" month on or after the "from" month.',
      ]);
    });
  });

  describe('the raises of 2021', () => {
    let r: Report;
    beforeAll(async () => {
      r = await report('?from=2021-01&to=2021-12', finance);
    });

    it('each signed raise that took effect in it: not the first contracts, the renewals with the same pay, nor a raise with the CEO', () => {
      expect(r.raises.map((x) => [x.employee.employeeCode, x.effectiveDate, x.kind, x.reason])).toEqual([
        [eli.employeeCode, '2021-04-01', 'new_contract', 'promotion'],
        [dina.employeeCode, '2021-07-01', 'amendment', 'annual'],
        [dina.employeeCode, '2021-11-01', 'amendment', 'adjustment'],
      ]);
    });

    it('with the person, the job title it was given in and the promotion, the pay from → to, the change and its cost, and the CEO’s approval', () => {
      const promoted = r.raises[1];
      expect(promoted).toMatchObject({
        employee: { id: dina.id, employeeCode: dina.employeeCode, fullNameEn: `Dina Raised ${RUN}`, fullNameAr: 'موظف تجريبي' },
        employmentId: dina.employmentId,
        department: { id: payrollTeam, nameEn: 'Payroll', parent: { id: accounts, nameEn: `Accounts ${RUN}` } },
        jobTitle: 'Analyst',
        promotion: { jobTitle: 'Senior Analyst', grade: null },
        upcoming: false,
        gross: { from: 10000, to: 12000 },
        allowances: { from: 500, to: 700 },
        change: { amount: 2000, percent: 20 },
        monthlyCost: 2200,
        approvedBy: `Chief Officer ${RUN}`,
        signedOn: today,
      } satisfies Partial<SalaryRaiseRow>);
      expect(promoted.number).toMatch(/^CON-2021-\d{4}-A1$/);
      expect(promoted.approvedAt).toBeTruthy();
      // the next one in the title the promotion gave
      expect(r.raises[2]).toMatchObject({ jobTitle: 'Senior Analyst', promotion: null, gross: { from: 12000, to: 12600 }, allowances: { from: 700, to: 700 }, change: { amount: 600, percent: 5 }, monthlyCost: 600 });
      expect(r.raises[0]).toMatchObject({ jobTitle: 'Coordinator', gross: { from: 8000, to: 10000 }, change: { amount: 2000, percent: 25 }, monthlyCost: 2000 });
    });

    it('in total and by department (a team’s under its department), from the same figures', () => {
      expect(r.totals).toEqual({ count: 3, people: 2, averagePercent: 16.7, medianPercent: 20, monthlyCostIncrease: 4800, yearlyCostIncrease: 57600 });
      expect(r.byDepartment.map((d) => [d.department?.nameEn, d.count, d.averagePercent, d.monthlyCostIncrease])).toEqual([
        [`Accounts ${RUN}`, 2, 12.5, 2800],
        [`Sales ${RUN}`, 1, 25, 2000],
      ]);
    });

    it('agrees with each person’s Salary History', async () => {
      const history = (await api().get(`/api/employees/${dina.id}/salary-history`).set('Cookie', finance).expect(200)).body as {
        employments: { events: { contractId: string; difference: unknown; raise: boolean }[] }[];
      };
      const raises = history.employments[0].events.filter((e) => e.raise);
      expect(raises.map((e) => [e.contractId, e.difference])).toEqual(
        r.raises.filter((x) => x.employee.id === dina.id).map((x) => [x.contractId, x.change]),
      );
    });
  });

  it('2022: a renewal with new pay counts; renewals with the same pay don’t', async () => {
    const r = await report('?from=2022-01&to=2022-12', ceo);
    expect(r.raises.map((x) => [x.employee.employeeCode, x.effectiveDate, x.kind, x.change])).toEqual([[eli.employeeCode, '2022-04-01', 'renewal', { amount: 1000, percent: 10 }]]);
    expect(r.totals).toMatchObject({ count: 1, people: 1, averagePercent: 10, medianPercent: 10, monthlyCostIncrease: 1000, yearlyCostIncrease: 12000 });
  });

  describe('due for review', () => {
    it('a year without a raise, or since joining without one, longest first; with what is open for each', async () => {
      const r = await report();
      expect(r.reviewMonths).toBe(12);
      const since = (ymd: string) => monthsBetween(ymd, today);
      expect(dueHere(r).map((d) => [d.employee.employeeCode, d.lastRaise, d.monthsSince, d.currentGross])).toEqual([
        [fay.employeeCode, null, since('2021-01-01'), 20000],
        [gus.employeeCode, null, since('2021-03-01'), 5000],
        [dina.employeeCode, '2021-11-01', since('2021-11-01'), 12600],
        [eli.employeeCode, '2022-04-01', since('2022-04-01'), 11000],
      ]);
      const [f, g, d, e] = dueHere(r);
      expect(f).toMatchObject({ openRaise: null, openRequest: null, joinDate: '2021-01-01', jobTitle: 'Analyst' } satisfies Partial<DueForReviewRow>);
      expect(g.openRaise).toMatchObject({ stage: 'pending_ceo', effectiveDate: '2021-10-01' });
      expect(d).toMatchObject({ openRaise: null, openRequest: { status: 'with_hr' }, jobTitle: 'Senior Analyst' });
      expect(e.openRaise).toMatchObject({ stage: 'draft', effectiveDate: '2022-06-01' });
    });

    it('after the setting’s months: HR and Admin change it, from 1 to 60, each change in the audit log', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      expect((await api().get('/api/payroll/settings').set('Cookie', finance).expect(200)).body.salaryReviewMonths).toBe(12);
      for (const session of [finance, ceo, staff]) await settings({ salaryReviewMonths: 2 }, session).expect(403);
      for (const bad of [0, 61, 1.5, '12', null]) expect(messagesOf(await settings({ salaryReviewMonths: bad }).expect(400))).toEqual([REVIEW_MESSAGE]);
      expect((await settings({ salaryReviewMonths: 3 }, admin).expect(200)).body.salaryReviewMonths).toBe(3);
      expect((await settings({ salaryReviewMonths: 2 }).expect(200)).body.salaryReviewMonths).toBe(2);
      // leaving it out leaves it as it is
      expect((await settings({ dayDivisor: 30 }).expect(200)).body.salaryReviewMonths).toBe(2);
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([{ salaryReviewMonths: { from: 12, to: 3 } }, { salaryReviewMonths: { from: 3, to: 2 } }]);
      // a run never copies it: it isn't a rule of the pay
      const r = await report();
      expect(r.reviewMonths).toBe(2);
      // Hana, three months in, is due too now
      expect(dueHere(r).map((d) => d.employee.employeeCode)).toContain(hana.employeeCode);
      await settings({ salaryReviewMonths: 12 }).expect(200);
      expect(dueHere(await report()).map((d) => d.employee.employeeCode)).not.toContain(hana.employeeCode);
    });
  });

  describe('the workbook', () => {
    it('has the raises, by department and due for review, named with its period; every download in the audit log', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      const res = await workbookFile('?from=2021-01&to=2021-12').expect(200);
      expect(res.headers['content-type']).toBe(XLSX);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain('Salary raises 2021-01 to 2021-12.xlsx');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      expect(wb.worksheets.map((ws) => ws.name)).toEqual(['Raises', 'By Department', 'Due for Review']);
      const [raises, departments, due] = wb.worksheets;
      const raiseRows = rowsOf(raises);
      expect(raiseRows[0].slice(0, 3)).toEqual(['Code', 'Name (English)', 'Name (Arabic)']);
      expect(raiseRows.slice(1).map((row) => [row[0], row[6], row[8], row[10], row[11], row[12], row[13], row[16]])).toEqual([
        [eli.employeeCode, '01/04/2021', 'New contract', 8000, 10000, 2000, 0.25, 2000],
        [dina.employeeCode, '01/07/2021', 'Amendment', 10000, 12000, 2000, 0.2, 2200],
        [dina.employeeCode, '01/11/2021', 'Amendment', 12000, 12600, 600, 0.05, 600],
      ]);
      expect(raiseRows[2][5]).toBe('Senior Analyst');
      expect(raises.getCell('K2').numFmt).toBe('#,##0.00');
      expect(rowsOf(departments)).toEqual([
        ['Department', 'Raises', 'People', 'Average change %', 'Median change %', 'Monthly cost increase', 'Yearly cost increase'],
        [`Accounts ${RUN}`, 2, 1, 0.125, 0.125, 2800, 33600],
        [`Sales ${RUN}`, 1, 1, 0.25, 0.25, 2000, 24000],
        ['All departments', 3, 2, 0.167, 0.2, 4800, 57600],
      ]);
      const dueCodes = rowsOf(due)
        .slice(1)
        .map((row) => row[0]);
      expect(dueCodes.filter((code) => [fay, gus, dina, eli, hana].some((p) => p.employeeCode === code))).toEqual([fay, gus, dina, eli].map((p) => p.employeeCode));

      const audit = await prisma.auditLog.findMany({ where: { action: 'salary_raises_file', id: { gt: since } } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ entityType: 'salary_raises_report', diff: { from: '2021-01', to: '2021-12', raises: 3, employees: [eli.employeeCode, dina.employeeCode] } });
    });
  });

  describe('the salary review migration', () => {
    const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const SCHEMA = 'salary_review_migration_check';
    let db: pg.Client;

    beforeAll(async () => {
      db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name');
      assertTestDatabase(rows[0].name);
    });

    afterAll(async () => {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await db.end();
    });

    it('a review is due after 12 months to start with; 1 to 60', async () => {
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_salary_review'))!;
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{14}_/.test(x) && x < migration).sort()) {
        await db.query(readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8'));
      }
      await db.query(readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8'));

      expect((await db.query('SELECT salary_review_months FROM payroll_settings')).rows).toEqual([{ salary_review_months: 12 }]);
      for (const bad of [0, 61]) {
        await expect(db.query(`UPDATE payroll_settings SET salary_review_months = ${bad}`)).rejects.toThrow(/payroll_settings_salary_review_months_check/);
      }
      await db.query('UPDATE payroll_settings SET salary_review_months = 60');
    });
  });
});
