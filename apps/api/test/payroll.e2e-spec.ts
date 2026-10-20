import type { INestApplication } from '@nestjs/common';
import { EXPECTED_HOURS_NOT_TYPED, payrollLine, PAYROLL_RULE_DEFAULTS, type PayrollInputs, type PayrollResult, type PayrollRules, type PayrollTerms } from '@trendlix/shared';
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { firstDay, lastDay, monthName, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// Monthly payroll (owner's decisions, 16 October 2026): who is on a month's run, the inputs HR types, the CEO's
// approval, the bank files and the register, and who may do what. Other test files leave people with signed contracts
// in the same database, so these tests look at their own people (names end with RUN) and check totals against the
// run's own lines. Months are counted from today in Cairo: the run is for last month. Every name, account and amount
// is invented.

const RUN = Date.now().toString(36).toLowerCase();
const ONLY_SUPER_ADMIN_DELETES = 'Only a Super Admin can delete records.';
const NO_CONTRACT = 'No signed contract for this month';
const CURRENT = todayInCairo().slice(0, 7);
/** The run's month: last month. */
const MONTH = monthsLater(CURRENT, -1);
/** Employed well before the run's month. */
const JOINED = firstDay(monthsLater(CURRENT, -3));
/** Joined on the 12th of the run's month: paid for the days from then. */
const JOINER = `${MONTH}-12`;
const JOINER_DAYS = Math.min(30, Number(lastDay(MONTH).slice(8)) - 11);
/** The seeded shift A's working days in the run's month, Sunday to Thursday: its expected hours' days (16 October 2026). */
const SHIFT_A_DAYS = Array.from({ length: Number(lastDay(MONTH).slice(8)) }, (_, i) => new Date(`${MONTH}-${String(i + 1).padStart(2, '0')}T00:00:00Z`).getUTCDay()).filter(
  (day) => day <= 4,
).length;
/**
 * The shift A's hours for the run's month, 9:00 a day: the regular employee's expected hours, worked out and never typed
 * (owner, 20 October 2026: "expected hours to be locked based on shifts and attendance data").
 */
const SHIFT_A_HOURS = SHIFT_A_DAYS * 9;
/** 90% of them, to the minute's hundredth: the regular employee's hours worked, at the grace percent. */
const WORKED_90 = Math.round(SHIFT_A_HOURS * 0.9 * 100) / 100;

const CIB_ACCOUNT = '100012345678';
const QNB_ACCOUNT = '12345678901';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface LineBank {
  file: 'cib' | 'ach' | null;
  bankShort: string | null;
  problem: string | null;
}

interface Line {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  jobTitle: string | null;
  employmentType: string;
  payBasis: string;
  onHold: boolean;
  comments: string | null;
  terms: PayrollTerms;
  inputs: PayrollInputs;
  result: PayrollResult;
  bank: LineBank;
}

interface Run {
  id: string;
  month: string;
  status: string;
  rules: PayrollRules;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  returnedReason: string | null;
  paidOn: string | null;
  totals: Record<string, number>;
  lines: Line[];
  exclusions: { employeeId: string; employeeCode: string; name: string; reason: string }[];
  bankCheck: { cib: number; ach: number; problems: number };
}

/** Someone hired for these tests. */
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

async function workbook(data: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  return wb;
}

/** A sheet's rows as their values, A to the last column. */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe('Payroll (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let ceoId: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let staff: string;
  let departmentId: string;
  let transportId: string;
  let emailDomainBefore: string | null;
  const api = () => request(app.getHttpServer());

  // the people on the run
  let regular: Person; // monthly, all month, CIB, insured, on the seeded shift A (09:00 to 18:00)
  let joiner: Person; // joined on the 12th, QNB
  let freelancer: Person; // no bank details
  let hourly: Person; // by the hour, CIB, put on hold
  let noContract: Person;
  let draftOnly: Person; // a contract not signed yet
  let regularContract: { id: string; number: string };

  async function hire(name: string, employment: Record<string, unknown> = {}): Promise<Person> {
    const person = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const hired = await api()
      .post(`/api/employees/${person.body.id}/employments`)
      .set('Cookie', hr)
      .send({ employmentType: 'full_time', joinDate: JOINED, departmentId, ...employment })
      .expect(201);
    return { id: person.body.id, employeeCode: person.body.employeeCode, employmentId: hired.body.employment.id };
  }

  const postContract = (p: Person, body: object) => api().post(`/api/employees/${p.id}/employments/${p.employmentId}/contracts`).set('Cookie', hr).send(body);

  async function signed(p: Person, body: object = {}) {
    const draft = (await postContract(p, { grossSalary: 12000, ...body }).expect(201)).body as { id: string; number: string; startDate: string };
    await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
    return draft;
  }

  const bank = (p: Person, body: object) => api().patch(`/api/employees/${p.id}/bank`).set('Cookie', hr).send(body).expect(200);
  const employee = (p: Person, body: object, session = hr) => api().patch(`/api/employees/${p.id}`).set('Cookie', session).send(body);

  const runs = (session = hr) => api().get('/api/payroll/runs').set('Cookie', session);
  const getRun = (id: string, session = hr) => api().get(`/api/payroll/runs/${id}`).set('Cookie', session);
  const createRun = (month: string, session = hr) => api().post('/api/payroll/runs').set('Cookie', session).send({ month });
  const act = (id: string, step: 'refresh' | 'submit' | 'return' | 'approve' | 'paid', session: string, body: object = {}) =>
    api().post(`/api/payroll/runs/${id}/${step}`).set('Cookie', session).send(body);
  const patchLines = (id: string, lines: object[], session = hr) => api().patch(`/api/payroll/runs/${id}/lines`).set('Cookie', session).send({ lines });
  const file = (id: string, kind: string, session = hr) => api().get(`/api/payroll/runs/${id}/files/${kind}`).set('Cookie', session).buffer(true).parse(bytes);
  const settings = (body: object, session = hr) => api().patch('/api/payroll/settings').set('Cookie', session).send(body);

  const lineOf = (run: Run, p: Person) => run.lines.find((l) => l.employeeId === p.id);
  const auditOf = (entityType: string, entityId: string) => prisma.auditLog.findMany({ where: { entityType, entityId }, orderBy: { id: 'asc' } });
  const message = (res: request.Response) => JSON.parse((res.body as Buffer).toString('utf8')).message as string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    const ceoEmail = await createUser(prisma, ['ceo']);
    ceo = await signIn(app, ceoEmail);
    ceoId = (await prisma.user.findUniqueOrThrow({ where: { email: ceoEmail } })).id;
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    superAdmin = await signIn(app, await createUser(prisma, ['super_admin']));
    staff = await signIn(app, await createUser(prisma, ['employee']));
    await prisma.payrollRun.deleteMany();

    // sign-in accounts here are @test.local: no company email domain while these tests run
    emailDomainBefore = (await api().get('/api/company').set('Cookie', hr).expect(200)).body.emailDomain;
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: '' }).expect(200);
    // the CEO's own profile, so the approval names them
    await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `Chief Officer ${RUN}`, fullNameAr: 'مدير تنفيذي', workEmail: ceoEmail }).expect(201);

    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Payroll ${RUN}` }).expect(201)).body.id;
    transportId = (await api().post('/api/allowance-types').set('Cookie', hr).send({ nameEn: `Transport ${RUN}`, nameAr: 'بدل انتقال', taxable: true }).expect(201)).body.id;

    const shifts = (await api().get('/api/shifts').set('Cookie', hr).expect(200)).body as { id: string; code: string }[];
    regular = await hire('Regular', { shiftId: shifts.find((s) => s.code === 'A')!.id });
    regularContract = await signed(regular, { allowances: [{ allowanceTypeId: transportId, amount: 1000 }] });
    await bank(regular, { bankName: 'CIB', accountNo: CIB_ACCOUNT, holderName: `REGULAR HOLDER ${RUN}` });
    await employee(regular, { socialInsured: true }).expect(200);

    joiner = await hire('Joiner', { joinDate: JOINER });
    await signed(joiner, { grossSalary: 9000 });
    await bank(joiner, { bankName: 'QNB', accountNo: QNB_ACCOUNT });

    freelancer = await hire('Freelancer', { employmentType: 'freelance' });
    await signed(freelancer, { grossSalary: 5000 });

    hourly = await hire('Hourly', { employmentType: 'part_time' });
    await signed(hourly, { payBasis: 'hourly', hourlyRate: 100, hoursPerWeek: 20 });
    await bank(hourly, { bankName: 'CIB', accountNo: '200012345678' });

    noContract = await hire('No Contract');
    draftOnly = await hire('Draft Only');
    await postContract(draftOnly, { grossSalary: 7000 }).expect(201);
  });

  afterAll(async () => {
    // runs keep their people on record: remove them so other test files can delete theirs
    await prisma.payrollRun.deleteMany();
    await prisma.payrollSettings.update({ where: { id: 1 }, data: { ...PAYROLL_RULE_DEFAULTS, cibDebitAccount: null, cibDebitAccountName: null, achPurpose: 'CASH' } });
    await api().patch('/api/company').set('Cookie', hr).send({ emailDomain: emailDomainBefore ?? '' }).expect(200);
    await app.close();
  });

  describe('settings', () => {
    it('HR, Finance, the CEO and Admin read them: the sheet’s rules to start with', async () => {
      for (const session of [hr, finance, ceo, admin, superAdmin]) {
        expect((await api().get('/api/payroll/settings').set('Cookie', session).expect(200)).body).toEqual({
          dayDivisor: 30,
          attendanceGracePercent: 90,
          kpiGracePercent: 80,
          // off from 16 October 2026 (owner: "No overtime for now")
          payOvertime: false,
          overtimeAbovePercent: 110,
          overtimeRate: 1.5,
          noShowDayMultiplier: 2,
          cibDebitAccount: null,
          cibDebitAccountName: null,
          achPurpose: 'CASH',
          payday: null,
          // the Salary Raises report: a review is due after a year without a raise (owner's decision, 16 October 2026)
          salaryReviewMonths: 12,
          // the most a month's installments may take of the wage: the law's 10% (owner, 18 October 2026: "Block above 10%")
          installmentLimitPercent: 10,
          // the office's addresses as Zoho People writes a check-in's location (owner, 19 October 2026)
          officeAddresses: ['Trendlix', '13, Al Doctor Al Mahrouqi Street', '15, Al Doctor Al Mahrouqi Street', '17, Al Doctor Al Mahrouqi Street'],
          // the office's point for checking in on the system (19 October 2026): not set, 150 metres to start with
          officeLatitude: null,
          officeLongitude: null,
          officeRadiusMetres: 150,
        });
      }
      await api().get('/api/payroll/settings').set('Cookie', staff).expect(403);
    });

    it('HR and Admin change them, each change in the audit log; the CIB account is 12 digits', async () => {
      const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
      for (const session of [finance, ceo, staff]) await settings({ dayDivisor: 26 }, session).expect(403);
      expect((await settings({ kpiGracePercent: 75.5 }, admin).expect(200)).body.kpiGracePercent).toBe(75.5);
      const changed = await settings({ kpiGracePercent: 80, cibDebitAccount: '1234-5678 9012', cibDebitAccountName: ' Invented Company LLC ', achPurpose: ' cash ' }).expect(200);
      expect(changed.body).toMatchObject({ kpiGracePercent: 80, cibDebitAccount: '123456789012', cibDebitAccountName: 'Invented Company LLC', achPurpose: 'CASH' });

      const refused = async (body: object) => (await settings(body).expect(400)).body.message as string[];
      expect(await refused({ dayDivisor: 32 })).toEqual(['Enter the days a month counts as, a whole number from 20 to 31 (the sheet: 30).']);
      expect(await refused({ dayDivisor: 30.5 })).toEqual(['Enter the days a month counts as, a whole number from 20 to 31 (the sheet: 30).']);
      expect(await refused({ cibDebitAccount: '12345' })).toEqual(["Enter the company's CIB account number: 12 digits."]);
      expect(await refused({ overtimeAbovePercent: 90 })).toEqual(['Enter the attendance percent overtime starts above, from 100 to 200, e.g. 110.']);
      expect(await refused({ achPurpose: 'SAL ARY' })).toEqual(['Enter the ACH transaction purpose in capital letters and digits, up to 20, e.g. CASH.']);
      await settings({ dayDivisor: null }).expect(400);
      await settings({ unknown: 1 }).expect(400);

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_settings', id: { gt: since } }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.diff)).toEqual([
        { kpiGracePercent: { from: 80, to: 75.5 } },
        {
          kpiGracePercent: { from: 75.5, to: 80 },
          cibDebitAccount: { from: null, to: '123456789012' },
          cibDebitAccountName: { from: null, to: 'Invented Company LLC' },
        },
      ]);
    });
  });

  describe('registered with social insurance', () => {
    it('is off for a new profile; HR turns it on in the same change as the other Social Insurance tab fields', async () => {
      const p = await hire('Insured');
      expect((await api().get(`/api/employees/${p.id}`).set('Cookie', hr).expect(200)).body.socialInsured).toBe(false);
      const insuranceNo = String(Date.now()).slice(-9);
      const on = await employee(p, { socialInsured: true, insuranceNo }).expect(200);
      expect(on.body).toMatchObject({ socialInsured: true, insuranceNo });
      // seen by whoever sees the profile
      expect((await api().get(`/api/employees/${p.id}`).set('Cookie', finance).expect(200)).body.socialInsured).toBe(true);
      expect((await auditOf('employee', p.id)).at(-1)?.diff).toEqual({ socialInsured: { from: false, to: true }, insuranceNo: { from: null, to: insuranceNo } });

      expect((await employee(p, { socialInsured: null }).expect(400)).body.message).toEqual(['Send whether the employee is registered with social insurance as true or false.']);
      await employee(p, { socialInsured: 'yes' }).expect(400);
      for (const session of [finance, ceo, admin]) await employee(p, { socialInsured: false }, session).expect(403);
      expect((await employee(p, { socialInsured: false }).expect(200)).body.socialInsured).toBe(false);
    });
  });

  describe('a month’s run', () => {
    let run: Run;

    it('HR makes it: everyone with a signed contract in force, worked out with the settings’ rules; the others left out', async () => {
      for (const session of [finance, ceo, admin, superAdmin, staff]) await createRun(MONTH, session).expect(403);
      run = (await createRun(MONTH).expect(201)).body as Run;
      expect(run).toMatchObject({
        month: MONTH,
        status: 'draft',
        rules: PAYROLL_RULE_DEFAULTS,
        submittedAt: null,
        approvedAt: null,
        approvedBy: null,
        returnedReason: null,
        paidOn: null,
      });

      const r = lineOf(run, regular)!;
      expect(r).toMatchObject({
        employeeCode: regular.employeeCode,
        name: `Regular ${RUN}`,
        department: `Payroll ${RUN}`,
        employmentType: 'full_time',
        payBasis: 'monthly',
        onHold: false,
        comments: null,
        bank: { file: 'cib', bankShort: 'CIB', problem: null },
      });
      expect(r.terms).toEqual({
        year: Number(MONTH.slice(0, 4)),
        payBasis: 'monthly',
        gross: 12000,
        basicPercent: 80,
        hourlyRate: null,
        allowances: [{ name: `Transport ${RUN}`, amount: 1000, taxable: true, insured: false }],
        paidDays: 30,
        statutory: true,
        insured: true,
        insuredWage: 13000, // the gross and the allowances, as the Social Insurance tab shows it
        hoursPerDay: 9, // the shift's 09:00 to 18:00: what a no-show day takes out of the expected hours
        // the shift's working days in the month, no holidays: the expected hours, never typed (Payroll Setup; 20 October 2026)
        expectedHours: SHIFT_A_HOURS,
        expectedDays: { workingDays: SHIFT_A_DAYS, holidays: 0 },
        // the whole month under its one contract (owner, 17 October 2026: the contracts' dates)
        segments: [
          {
            contractId: regularContract.id,
            number: regularContract.number,
            version: 1,
            from: firstDay(MONTH),
            to: lastDay(MONTH),
            days: 30,
            payBasis: 'monthly',
            gross: 12000,
            basicPercent: 80,
            hourlyRate: null,
            allowances: [{ name: `Transport ${RUN}`, amount: 1000, taxable: true, insured: false }],
          },
        ],
      });
      expect(r.inputs).toEqual({
        workedHours: null,
        expectedHours: null,
        softSkills: null,
        performance: null,
        clientSatisfaction: null,
        noShowDays: null,
        leaveDays: null,
        // unpaid leave (18 October 2026: the Leave module), filled in from the approved leave unless typed
        unpaidLeaveDays: null,
        // permission (19 October 2026), filled in from the approved permission requests unless typed
        permissionHours: null,
        released: null,
        // the CEO's waiver (17 October 2026); no bonus or penalty days, commission or settlements: they are on
        // Additions / Deductions since then
        attendanceWaived: false,
      });
      expect(r.result).toEqual(payrollLine(r.terms, r.inputs, run.rules));
      expect(r.result).toMatchObject({ earned: 12000, allowances: 1000, employeeInsurance: 1430, employerInsurance: 2437.5 });

      // the joiner is paid for the days from the 12th
      const j = lineOf(run, joiner)!;
      expect(j.terms).toMatchObject({ paidDays: JOINER_DAYS, gross: 9000, insured: false, hoursPerDay: null }); // no shift
      expect(j.result.employeeInsurance).toBe(0); // not registered with social insurance
      expect(j.result.warnings.join(' ')).toContain(`${JOINER_DAYS} of 30`);
      expect(j.bank).toEqual({ file: 'ach', bankShort: 'QNB', problem: null });

      const f = lineOf(run, freelancer)!;
      expect(f.terms.statutory).toBe(false);
      expect(f.result).toMatchObject({ monthlyTax: 0, martyrsFund: 0, employeeInsurance: 0 });
      expect(f.bank).toEqual({ file: null, bankShort: null, problem: 'No bank details on file.' });

      expect(lineOf(run, hourly)!.terms).toMatchObject({ payBasis: 'hourly', hourlyRate: 100 });

      // left out, with the reason
      expect(lineOf(run, noContract)).toBeUndefined();
      expect(lineOf(run, draftOnly)).toBeUndefined();
      const mine = run.exclusions.filter((x) => [noContract.id, draftOnly.id].includes(x.employeeId));
      expect(mine).toEqual([
        { employeeId: draftOnly.id, employeeCode: draftOnly.employeeCode, name: `Draft Only ${RUN}`, reason: NO_CONTRACT },
        { employeeId: noContract.id, employeeCode: noContract.employeeCode, name: `No Contract ${RUN}`, reason: NO_CONTRACT },
      ]);

      // the totals are the lines' sums; the bank details themselves are never sent
      const sum = (key: keyof PayrollResult) => Math.round(run.lines.reduce((s, l) => s + Math.round((l.result[key] as number) * 100), 0)) / 100;
      expect(run.totals).toMatchObject({ employees: run.lines.length, net: sum('net'), transfer: sum('transfer'), companyCost: sum('companyCost') });
      expect(JSON.stringify(run)).not.toContain(CIB_ACCOUNT);
      expect(JSON.stringify(run)).not.toContain(QNB_ACCOUNT);
      expect(run.bankCheck.problems).toBeGreaterThanOrEqual(1);

      const audit = await auditOf('payroll_run', run.id);
      expect(audit.map((a) => [a.action, (a.diff as { month: string }).month])).toEqual([['create', MONTH]]);
    });

    it('one run a month, from 12 months back to next month', async () => {
      expect((await createRun(MONTH).expect(409)).body.message).toBe(`There is already a payroll for ${monthName(MONTH)}.`);
      const earliest = monthsLater(CURRENT, -12);
      const latest = monthsLater(CURRENT, 1);
      const outside = `Choose a month from ${monthName(earliest)} to ${monthName(latest)}.`;
      expect((await createRun(monthsLater(CURRENT, -13)).expect(400)).body.message).toBe(outside);
      expect((await createRun(monthsLater(CURRENT, 2)).expect(400)).body.message).toBe(outside);
      expect((await createRun('2026-13').expect(400)).body.message).toEqual(['Choose the month, as YYYY-MM.']);
      await createRun('2026-9').expect(400);
    });

    it('HR, Finance and the CEO see the runs, newest month first; nobody else', async () => {
      for (const session of [hr, finance, ceo]) {
        const list = (await runs(session).expect(200)).body as { id: string; month: string; status: string; totals: Record<string, number> }[];
        expect(list.find((x) => x.id === run.id)).toMatchObject({ month: MONTH, status: 'draft', totals: run.totals, approvedAt: null, paidOn: null });
        expect((await getRun(run.id, session).expect(200)).body.id).toBe(run.id);
      }
      for (const session of [admin, superAdmin, staff]) {
        await runs(session).expect(403);
        await getRun(run.id, session).expect(403);
      }
      await getRun('00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('HR types the month’s inputs: each changed line is worked out again, and the audit log has what changed', async () => {
      const r = lineOf(run, regular)!;
      const res = await patchLines(run.id, [
        { id: r.id, inputs: { workedHours: WORKED_90, softSkills: 70, released: 1000 }, comments: '  Invented note ' },
      ]).expect(200);
      run = res.body as Run;
      const after = lineOf(run, regular)!;
      // the expected hours the shift's, never typed (20 October 2026): 90% of them worked
      expect(after.inputs).toMatchObject({ workedHours: WORKED_90, expectedHours: null, softSkills: 70, released: 1000, performance: null });
      expect(after.result.expectedHours).toBe(SHIFT_A_HOURS);
      expect(after.comments).toBe('Invented note');
      expect(after.result).toEqual(payrollLine(after.terms, after.inputs, run.rules));
      expect(after.result.attendanceRatio).toBe(0.9);
      expect(after.result.transfer).toBe(Math.round((after.result.net - 1000) * 100) / 100);

      const audit = await auditOf('payroll_line', r.id);
      expect(audit.map((a) => [a.action, a.diff])).toEqual([
        [
          'update',
          {
            runId: run.id,
            month: MONTH,
            employeeCode: regular.employeeCode,
            workedHours: { from: null, to: WORKED_90 },
            softSkills: { from: null, to: 70 },
            released: 'changed', // money: only that it changed
            comments: { from: null, to: 'Invented note' },
          },
        ],
      ]);

      // null clears an input; the others stay; a line sent unchanged leaves no audit entry
      run = (await patchLines(run.id, [{ id: r.id, inputs: { softSkills: null } }, { id: lineOf(run, joiner)!.id, inputs: {} }]).expect(200)).body as Run;
      expect(lineOf(run, regular)!.inputs).toMatchObject({ softSkills: null, workedHours: WORKED_90, released: 1000 });
      expect(await auditOf('payroll_line', lineOf(run, joiner)!.id)).toEqual([]);

      // by the hour: the hours worked are the pay; on hold, the bank files leave it out
      const h = lineOf(run, hourly)!;
      run = (await patchLines(run.id, [{ id: h.id, inputs: { workedHours: 80.5 }, onHold: true }]).expect(200)).body as Run;
      expect(lineOf(run, hourly)).toMatchObject({ onHold: true, inputs: { workedHours: 80.5 } });
      expect(lineOf(run, hourly)!.result.earned).toBe(8050);
    });

    it('refuses inputs out of range, unknown fields and lines not on the run', async () => {
      const id = lineOf(run, regular)!.id;
      const refused = async (inputs: object) => (await patchLines(run.id, [{ id, inputs }]).expect(400)).body.message as string[];
      expect(await refused({ workedHours: 745 })).toEqual(['Enter the hours from 0 to 744, e.g. 270 or 270:30.']);
      expect(await refused({ softSkills: 201 })).toEqual(['Enter the percent from 0 to 200, e.g. 95.']);
      expect(await refused({ noShowDays: 1.25 })).toEqual(['Enter the days from 0 to 31, in whole or half days, e.g. 2 or 1.5.']);
      expect(await refused({ leaveDays: 0.3 })).toEqual(['Enter the days from 0 to 31, in whole or half days, e.g. 2 or 1.5.']);
      expect(await refused({ released: -1 })).toEqual(['Enter what was already paid out this month: 0 or more, up to 10,000,000.']);
      // the bonus and penalty days, the commission and the settlements are on Additions / Deductions (owner, 17 October
      // 2026: "instead of there, i think earnings and deductions will be enough"): refused as any unknown field is
      for (const field of ['bonusDays', 'penaltyDays', 'commission', 'settlements']) {
        expect(await refused({ [field]: 1 })).toEqual([`property ${field} should not exist`]);
      }
      // nor is the CEO's waiver typed with HR's inputs
      expect(await refused({ attendanceWaived: true })).toEqual(['property attendanceWaived should not exist']);
      // nor the expected hours, worked out from the shift (owner, 20 October 2026: "expected hours to be locked based on
      // shifts and attendance data"): any figure, 0 too, with the reason; null is nothing typed
      for (const hours of [200, 0, '200:00']) expect(await refused({ expectedHours: hours })).toEqual([EXPECTED_HOURS_NOT_TYPED]);
      expect(EXPECTED_HOURS_NOT_TYPED).toBe("Expected hours are worked out from the shift, the holidays, leave and absent days; they can't be typed.");
      const unchanged = lineOf((await patchLines(run.id, [{ id, inputs: { expectedHours: null } }]).expect(200)).body as Run, regular)!;
      expect(unchanged.inputs.expectedHours).toBeNull();
      expect(unchanged.result.expectedHours).toBe(SHIFT_A_HOURS);
      await patchLines(run.id, [{ id, inputs: { overtime: 5 } }]).expect(400);
      // no medical subscription any more (owner's decision, 16 October 2026): refused as any unknown field is
      expect(await refused({ medical: 100 })).toEqual(['property medical should not exist']);
      await patchLines(run.id, [{ id, onHold: 'yes' }]).expect(400);
      await patchLines(run.id, []).expect(400);
      expect((await patchLines(run.id, [{ id, inputs: { noShowDays: 0.5 } }, { id }]).expect(400)).body.message).toBe('Send each line once.');
      expect((await patchLines(run.id, [{ id: '00000000-0000-4000-8000-000000000000', inputs: {} }]).expect(400)).body.message).toBe(
        'Some of these lines are not on this payroll. Reload it and try again.',
      );
      run = (await patchLines(run.id, [{ id, inputs: { noShowDays: 0.5 } }]).expect(200)).body as Run;
      const corrected = lineOf(run, regular)!;
      // half a day off: its 4:30 come out of the shift's hours (owner, 17 October 2026: "dont count abcent days or leave
      // days, as they already have their own deduction and fields"), so the 90% worked is more of what is left
      expect(corrected.result).toMatchObject({ absentHours: 4.5, expectedHours: SHIFT_A_HOURS - 4.5, attendanceScore: 1, attendanceCut: 0, noShowCut: 400 });
      expect(corrected.result.attendanceRatio).toBeCloseTo(WORKED_90 / (SHIFT_A_HOURS - 4.5), 9);
      expect(corrected.result).toEqual(payrollLine(corrected.terms, corrected.inputs, run.rules));
      // paid leave: no cut, its 13:30 out of the shift's hours too, in the audit log as the other inputs
      run = (await patchLines(run.id, [{ id, inputs: { leaveDays: 1.5 } }]).expect(200)).body as Run;
      expect(lineOf(run, regular)!.result).toMatchObject({ leaveHours: 13.5, expectedHours: SHIFT_A_HOURS - 18, attendanceCut: 0, noShowCut: 400 });
      expect((await auditOf('payroll_line', id)).at(-1)!.diff).toMatchObject({ leaveDays: { from: null, to: 1.5 } });
      // no more than the days paid: the joiner's
      const j = lineOf(run, joiner)!;
      expect((await patchLines(run.id, [{ id: j.id, inputs: { leaveDays: JOINER_DAYS + 1 } }]).expect(400)).body.message).toBe(
        `Joiner ${RUN}: the leave days (${JOINER_DAYS + 1}) can't be more than the ${JOINER_DAYS} days paid this month.`,
      );
      for (const session of [finance, ceo, admin]) await patchLines(run.id, [{ id, inputs: { workedHours: 100 } }], session).expect(403);
    });

    it('refresh takes the people, contracts and insured wages again; the inputs stay', async () => {
      // the draft contract is signed, and the regular employee is no longer registered with social insurance
      const draft = (await api().get(`/api/employees/${draftOnly.id}/employments/${draftOnly.employmentId}/contracts`).set('Cookie', hr).expect(200)).body[0];
      await api().post(`/api/contracts/${draft.id}/sign`).set('Cookie', hr).send({ signedOn: draft.startDate }).expect(200);
      await employee(regular, { socialInsured: false }).expect(200);
      // and a rule changes: the run takes the settings' rules again
      await settings({ noShowDayMultiplier: 3 }).expect(200);
      const before = lineOf(run, regular)!;

      for (const session of [finance, ceo]) await act(run.id, 'refresh', session).expect(403);
      run = (await act(run.id, 'refresh', hr).expect(200)).body as Run;
      const after = lineOf(run, regular)!;
      expect(after.id).toBe(before.id);
      expect(after.inputs).toEqual(before.inputs);
      expect(after.comments).toBe('Invented note');
      expect(after.terms.insured).toBe(false);
      expect(after.result.employeeInsurance).toBe(0);
      expect(lineOf(run, hourly)!.onHold).toBe(true);
      expect(lineOf(run, draftOnly)!.terms.gross).toBe(7000);
      expect(run.exclusions.map((x) => x.employeeId)).not.toContain(draftOnly.id);
      expect(run.exclusions.map((x) => x.employeeId)).toContain(noContract.id);

      const audit = (await auditOf('payroll_run', run.id)).at(-1)!;
      expect(audit.action).toBe('refresh');
      expect(audit.diff).toEqual({ month: MONTH, added: [draftOnly.employeeCode], removed: [], rules: { noShowDayMultiplier: { from: 2, to: 3 } } });
      expect(run.rules.noShowDayMultiplier).toBe(3);
      expect(after.result).toEqual(payrollLine(after.terms, after.inputs, run.rules));

      await employee(regular, { socialInsured: true }).expect(200);
      await settings({ noShowDayMultiplier: 2 }).expect(200);
      run = (await act(run.id, 'refresh', hr).expect(200)).body as Run;
      expect(run.rules).toEqual(PAYROLL_RULE_DEFAULTS);
      expect(lineOf(run, regular)!.result.employeeInsurance).toBe(1430);
      // nobody added or taken off, the rules as they were: nothing else to say
      expect((await auditOf('payroll_run', run.id)).at(-1)!.diff).toEqual({ month: MONTH, added: [], removed: [], rules: { noShowDayMultiplier: { from: 3, to: 2 } } });
      run = (await act(run.id, 'refresh', hr).expect(200)).body as Run;
      expect((await auditOf('payroll_run', run.id)).at(-1)!.diff).toEqual({ month: MONTH, added: [], removed: [] });
    });

    it('drops a medical subscription saved before it was taken off (16 October 2026) when a line is refreshed or changed', async () => {
      const before = lineOf(run, regular)!;
      const saveMedical = () => prisma.payrollLine.update({ where: { id: before.id }, data: { inputs: { ...before.inputs, medical: 350 } } });
      await saveMedical();
      expect(lineOf((await getRun(run.id).expect(200)).body as Run, regular)!.inputs).toMatchObject({ medical: 350 });
      run = (await act(run.id, 'refresh', hr).expect(200)).body as Run;
      expect(lineOf(run, regular)!.inputs).toEqual(before.inputs);
      expect(lineOf(run, regular)!.result).toEqual(before.result);

      await saveMedical();
      run = (await patchLines(run.id, [{ id: before.id, onHold: true }]).expect(200)).body as Run;
      expect(lineOf(run, regular)!.inputs).toEqual(before.inputs);
      expect(lineOf(run, regular)!.result).toEqual(before.result);
      run = (await patchLines(run.id, [{ id: before.id, onHold: false }]).expect(200)).body as Run;
    });

    it('the register downloads whatever the status; the bank files only once approved', async () => {
      const register = await file(run.id, 'register', finance).expect(200);
      expect(register.headers['content-type']).toBe(XLSX);
      expect(register.headers['content-disposition']).toContain('attachment;');
      const ws = (await workbook(register.body as Buffer)).worksheets[0];
      expect(ws.getCell('A1').value).toBe(`Payroll — ${monthName(MONTH)} — DRAFT`);
      expect(rowsOf(ws).some((row) => row.includes(`Regular ${RUN}`))).toBe(true);
      // the leave days typed, in their column (17 October 2026)
      const headers = rowsOf(ws)[2];
      const mine = rowsOf(ws).find((row) => row.includes(`Regular ${RUN}`))!;
      expect(mine[headers.indexOf('Leave days')]).toBe(1.5);

      for (const kind of ['cib', 'ach']) {
        expect(message(await file(run.id, kind).expect(409))).toBe(`The ${monthName(MONTH)} payroll is a draft: the bank files are made once the CEO approves it.`);
      }
      await file(run.id, 'register', staff).expect(403);
    });

    it('HR sends it to the CEO, who returns it with a reason or approves it; nobody else does', async () => {
      await act(run.id, 'submit', finance).expect(403);
      await act(run.id, 'submit', ceo).expect(403);
      await act(run.id, 'approve', hr).expect(403);
      expect((await act(run.id, 'approve', ceo).expect(409)).body.message).toBe(`The ${monthName(MONTH)} payroll is a draft, so it can't be approved.`);

      run = (await act(run.id, 'submit', hr).expect(200)).body as Run;
      expect(run.status).toBe('pending_ceo');
      expect(run.submittedAt).not.toBeNull();
      // locked while with the CEO
      expect((await patchLines(run.id, [{ id: lineOf(run, regular)!.id, inputs: { workedHours: 50 } }]).expect(409)).body.message).toBe(
        `The ${monthName(MONTH)} payroll is with the CEO, so it can't be changed.`,
      );
      await act(run.id, 'refresh', hr).expect(409);
      await act(run.id, 'submit', hr).expect(409);

      await act(run.id, 'return', hr, { reason: 'Check it' }).expect(403);
      expect((await act(run.id, 'return', ceo, { reason: '  ' }).expect(400)).body.message).toEqual(['Say why the payroll goes back to HR.']);
      run = (await act(run.id, 'return', ceo, { reason: ' Check the joiner’s days. ' }).expect(200)).body as Run;
      expect(run).toMatchObject({ status: 'draft', returnedReason: 'Check the joiner’s days.' });

      run = (await act(run.id, 'submit', hr).expect(200)).body as Run;
      expect(run).toMatchObject({ status: 'pending_ceo', returnedReason: null });

      // the joiner's bank details change before the approval: the approval copies them as they are then
      await bank(joiner, { bankName: 'National Bank of Egypt', accountNo: '1234567890123456789' });
      run = (await act(run.id, 'approve', ceo).expect(200)).body as Run;
      expect(run).toMatchObject({ status: 'approved', approvedBy: { id: ceoId, name: `Chief Officer ${RUN}` } });
      expect(run.approvedAt).not.toBeNull();
      expect(lineOf(run, joiner)!.bank).toEqual({ file: 'ach', bankShort: 'NBE', problem: null });
      // later changes don't reach the approved run
      await bank(joiner, { bankName: 'QNB', accountNo: QNB_ACCOUNT });
      expect(lineOf((await getRun(run.id).expect(200)).body as Run, joiner)!.bank).toEqual({ file: 'ach', bankShort: 'NBE', problem: null });

      expect((await patchLines(run.id, [{ id: lineOf(run, regular)!.id, inputs: { workedHours: 50 } }]).expect(409)).body.message).toBe(
        `The ${monthName(MONTH)} payroll is approved, so it can't be changed.`,
      );
      await act(run.id, 'return', ceo, { reason: 'Too late' }).expect(409);

      const audit = await auditOf('payroll_run', run.id);
      expect(audit.filter((a) => ['submit', 'return', 'approve'].includes(a.action)).map((a) => [a.action, (a.diff as { status: unknown }).status])).toEqual([
        ['submit', { from: 'draft', to: 'pending_ceo' }],
        ['return', { from: 'pending_ceo', to: 'draft' }],
        ['submit', { from: 'draft', to: 'pending_ceo' }],
        ['approve', { from: 'pending_ceo', to: 'approved' }],
      ]);
      expect(audit.find((a) => a.action === 'return')!.diff).toMatchObject({ reason: 'Check the joiner’s days.' });
    });

    it('the CIB file pays the CIB accounts from the company’s account, as approved; on hold and problems left out', async () => {
      // without the company's account it can't be made
      await settings({ cibDebitAccount: null }).expect(200);
      expect(message(await file(run.id, 'cib').expect(409))).toBe(
        "Enter the company's CIB account and its name in the payroll settings first: the CIB file pays the salaries from it.",
      );
      await settings({ cibDebitAccount: '123456789012' }).expect(200);

      const valueDate = todayInCairo();
      const res = await file(run.id, `cib?valueDate=${valueDate}`, finance).expect(200);
      expect(res.headers['content-type']).toBe(XLSX);
      const wb = await workbook(res.body as Buffer);
      expect(wb.worksheets.map((s) => s.name)).toEqual(['Payroll']);
      const ws = wb.worksheets[0];
      const us = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;
      expect([ws.getCell('A2').value, ws.getCell('B2').value, ws.getCell('F2').value, ws.getCell('G2').value]).toEqual([
        us(todayInCairo()),
        us(valueDate),
        123456789012,
        'Invented Company LLC',
      ]);
      const rows = rowsOf(ws);
      const mine = rows.find((row) => row[6] === `REGULAR HOLDER ${RUN}`)!;
      expect(mine.slice(4, 9)).toEqual(['CIBEEGCXXXX', Number(CIB_ACCOUNT), `REGULAR HOLDER ${RUN}`, undefined, lineOf(run, regular)!.result.transfer]);
      // on hold: not paid
      expect(rows.some((row) => row[5] === 200012345678)).toBe(false);
      // the check row's total is the credits'
      const credits = rows.slice(2, -1).reduce((cents, row) => cents + Math.round((row[8] as number) * 100), 0) / 100;
      expect((ws.getCell(`I${rows.length}`).value as { result: number }).result).toBe(credits);
      expect(ws.getCell('H2').value).toEqual({ formula: `I${rows.length}`, result: credits });

      await file(run.id, 'cib?valueDate=2026-02-30').expect(400);
      await file(run.id, 'cib', staff).expect(403);
    });

    it('the ACH file pays every other bank, with the details copied at the approval', async () => {
      const res = await file(run.id, 'ach', ceo).expect(200);
      const wb = await workbook(res.body as Buffer);
      expect(wb.worksheets).toHaveLength(1);
      const rows = rowsOf(wb.worksheets[0]);
      expect(rows[0]).toEqual(['TransactionID', 'CreditorName', 'CreditorAccountNumber', 'CreditorBank', 'CreditorBankBranch', 'TransactionAmount', 'TransactionPurpose', 'Comments', 'ReceiverEmail', 'SMSMobileNumber']);
      const mine = rows.find((row) => row[1] === `Joiner ${RUN}`)!; // no holder name: the English name
      expect(mine.slice(1, 8)).toEqual([`Joiner ${RUN}`, '1234567890123456789', 'NBE', undefined, lineOf(run, joiner)!.result.transfer, 'CASH', `${monthName(MONTH)} Salary`]);
      expect(rows.slice(1).map((row) => row[0])).toEqual(rows.slice(1).map((_, i) => String(i + 1)));
      // no bank details: in neither file
      expect(rows.some((row) => row[1] === `Freelancer ${RUN}`)).toBe(false);

      const downloads = (await auditOf('payroll_run', run.id)).filter((a) => a.action === 'payroll_bank_file');
      expect(downloads.map((a) => (a.diff as { file: string }).file)).toEqual(['cib', 'ach']);
      expect(downloads[0].diff).toMatchObject({ month: MONTH, file: 'cib', valueDate: todayInCairo() });
      expect((downloads[1].diff as { employees: string[] }).employees).toContain(joiner.employeeCode);
    });

    it('HR marks it paid: not in the future, nor before the month began', async () => {
      await act(run.id, 'paid', ceo, { paidOn: todayInCairo() }).expect(403);
      await act(run.id, 'paid', finance, { paidOn: todayInCairo() }).expect(403);
      expect((await act(run.id, 'paid', hr, { paidOn: '2099-01-01' }).expect(400)).body.message).toBe("The payment date can't be in the future.");
      expect((await act(run.id, 'paid', hr, { paidOn: lastDay(monthsLater(MONTH, -1)) }).expect(400)).body.message).toContain("salaries can't have been paid before");
      await act(run.id, 'paid', hr, { paidOn: 'soon' }).expect(400);
      run = (await act(run.id, 'paid', hr, { paidOn: todayInCairo() }).expect(200)).body as Run;
      expect(run).toMatchObject({ status: 'paid', paidOn: todayInCairo() });
      await act(run.id, 'paid', hr, { paidOn: todayInCairo() }).expect(409);
      // still downloadable
      await file(run.id, 'ach').expect(200);
      const ws = (await workbook((await file(run.id, 'register').expect(200)).body as Buffer)).worksheets[0];
      expect(ws.getCell('A1').value).toBe(`Payroll — ${monthName(MONTH)}`);
      expect(ws.getCell('A2').value as string).toMatch(/^Status: Paid, on \d\d\/\d\d\/\d{4}$/);
    });

    it('a Super Admin deletes a draft made by mistake; nothing else is deleted', async () => {
      const del = (id: string, session: string) => api().delete(`/api/payroll/runs/${id}`).set('Cookie', session);
      expect((await del(run.id, hr).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_DELETES);
      expect((await del(run.id, superAdmin).expect(409)).body.message).toBe(`The ${monthName(MONTH)} payroll is marked paid: only a draft can be deleted.`);

      const draft = (await createRun(CURRENT).expect(201)).body as Run;
      for (const session of [hr, ceo, admin]) expect((await del(draft.id, session).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_DELETES);
      await del(draft.id, superAdmin).expect(204);
      await getRun(draft.id).expect(404);
      expect(await prisma.payrollLine.count({ where: { runId: draft.id } })).toBe(0);
      expect((await auditOf('payroll_run', draft.id)).map((a) => a.action)).toEqual(['create', 'delete']);
      // its month is free again
      await createRun(CURRENT).expect(201);
    });

    it('someone on a run stays on record: their profile can’t be deleted', async () => {
      const res = await api().delete(`/api/employees/${joiner.id}`).set('Cookie', superAdmin).expect(409);
      expect(res.body.message).toBe('This record is linked to other records, so it cannot be changed or deleted.');
    });
  });

  describe('the payroll migration', () => {
    const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    const SCHEMA = 'payroll_migration_check';
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

    it('registers everyone with a social insurance number, and adds the settings row with the sheet’s rules', async () => {
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_payroll'))!;
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((x) => /^\d{14}_/.test(x) && x < migration).sort()) {
        await db.query(readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8'));
      }
      await db.query(`
        INSERT INTO employees (id, employee_code, full_name_en, full_name_ar, insurance_no, updated_at) VALUES
          ('00000000-0000-4000-8000-0000000000e1', 'EMP-0001', 'Omar', 'عمر', '1234567', now()),
          ('00000000-0000-4000-8000-0000000000e2', 'EMP-0002', 'Nour', 'نور', NULL, now());
      `);
      await db.query(readFileSync(`${MIGRATIONS}${migration}/migration.sql`, 'utf8'));

      const { rows } = await db.query('SELECT employee_code AS code, social_insured AS insured FROM employees ORDER BY employee_code');
      expect(rows).toEqual([
        { code: 'EMP-0001', insured: true },
        { code: 'EMP-0002', insured: false },
      ]);
      const { rows: settingsRows } = await db.query(
        'SELECT id, day_divisor, attendance_grace_percent::float AS attendance, kpi_grace_percent::float AS kpi, overtime_above_percent::float AS above, overtime_rate::float AS rate, no_show_day_multiplier::float AS no_show, cib_debit_account, ach_purpose FROM payroll_settings',
      );
      expect(settingsRows).toEqual([{ id: 1, day_divisor: 30, attendance: 90, kpi: 80, above: 110, rate: 1.5, no_show: 2, cib_debit_account: null, ach_purpose: 'CASH' }]);
      await expect(db.query("UPDATE payroll_settings SET cib_debit_account = '12345'")).rejects.toThrow(/payroll_settings_cib_debit_account_check/);
      await expect(db.query('INSERT INTO payroll_settings (id, updated_at) VALUES (2, now())')).rejects.toThrow(/payroll_settings_one_row/);
      await expect(db.query("INSERT INTO payroll_runs (id, month, rules, updated_at) VALUES (gen_random_uuid(), '2026-09-15', '{}', now())")).rejects.toThrow(
        /payroll_runs_month_check/,
      );
    });
  });
});
