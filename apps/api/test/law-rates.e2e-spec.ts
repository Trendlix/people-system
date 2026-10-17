import type { INestApplication } from '@nestjs/common';
import {
  BUILT_IN_LAW_RATES,
  lawRatesFor,
  normalLawRates,
  normalTaxTiers,
  payrollLine,
  type LawRates,
  type PayrollInputs,
  type PayrollResult,
  type PayrollRules,
  type PayrollTerms,
  type TaxTier,
} from '@trendlix/shared';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { todayInCairo } from '../src/common/date-only.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { firstDay, monthsLater } from '../src/payroll/months.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createUser, signIn } from './helpers.js';
import { assertTestDatabase } from './test-env.js';

// The rates set by law, by year (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
// variables that might affect the sheet"; the tax brackets "editable by superadmin, to modify it if the law changed"):
// the migration's and the seed's rows are the constants they replace; HR, Finance, the CEO and Admin read them, the
// Super Admin alone changes them; a payroll run keeps the copy it was worked out with until a draft is refreshed, and
// an approved run never changes; contracts and the Social Insurance tab follow the year's rates. Other test files leave
// people with signed contracts in the same database, so these tests look at their own people (names end with RUN).
// Every name and amount is invented. The rows are put back as they were at the end.

const RUN = Date.now().toString(36).toLowerCase();
const CURRENT = todayInCairo().slice(0, 7);
const THIS_YEAR = Number(CURRENT.slice(0, 4));
/** The run's month: last month, and its year, whose rates the run copies. */
const MONTH = monthsLater(CURRENT, -1);
const YEAR = Number(MONTH.slice(0, 4));
/** A run for the month before, made "before the copies" (its copy is cleared). */
const OLD_MONTH = monthsLater(CURRENT, -2);
const JOINED = firstDay(monthsLater(CURRENT, -3));
const ONLY_SUPER_ADMIN_CHANGES = 'Only a Super Admin can change the rates set by law.';
const ONLY_SUPER_ADMIN_DELETES = 'Only a Super Admin can delete records.';
const MIGRATIONS = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
const SCHEMA = 'law_rates_migration_check';

/** A year's rates as the API sends them. */
type View = LawRates & { updatedAt: string; updatedBy: { id: string; name: string } | null };

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

/** What PUT sends for a year: every value but the year. */
const body = (r: LawRates) => {
  const { year: _year, ...rest } = normalLawRates(r);
  return rest;
};

/** The rates without who changed them. */
const ratesOf = ({ updatedAt: _at, updatedBy: _by, ...r }: View): LawRates => r;

/** A flat table: nothing up to 50,000 a year, 20% above. */
const FLAT: TaxTier[] = [
  {
    upTo: null,
    bands: [
      { upTo: 50_000, rate: 0 },
      { upTo: null, rate: 0.2 },
    ],
  },
];

describe('Rates set by law (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let hr: string;
  let ceo: string;
  let finance: string;
  let admin: string;
  let superAdmin: string;
  let superAdminId: string;
  let staff: string;
  let manager: string;
  let departmentId: string;
  let person: { id: string; employmentId: string };
  /** Everyone hired here, taken off at the end so other test files' lists aren't longer for them. */
  const hiredIds: string[] = [];
  const api = () => request(app.getHttpServer());

  const list = (session = hr) => api().get('/api/payroll/law-rates').set('Cookie', session);
  const put = (year: number | string, sent: object, session = superAdmin) => api().put(`/api/payroll/law-rates/${year}`).set('Cookie', session).send(sent);
  const remove = (year: number, session = superAdmin) => api().delete(`/api/payroll/law-rates/${year}`).set('Cookie', session);
  const getRun = async (id: string) => (await api().get(`/api/payroll/runs/${id}`).set('Cookie', hr).expect(200)).body as Run;
  const lineOf = (run: Run) => run.lines.find((l) => l.employeeId === person.id)!;
  /** The line as payrollLine works it out with the run's rules and rates. */
  const expected = (run: Run, line: Line) => payrollLine(line.terms, line.inputs, run.rules, run.lawRates);

  async function hire(name: string, joinDate = JOINED, grossSalary = 12_000) {
    const p = await api().post('/api/employees').set('Cookie', hr).send({ fullNameEn: `${name} ${RUN}`, fullNameAr: 'موظف تجريبي' }).expect(201);
    const e = await api().post(`/api/employees/${p.body.id}/employments`).set('Cookie', hr).send({ employmentType: 'full_time', joinDate, departmentId }).expect(201);
    const hired = { id: p.body.id as string, employmentId: e.body.employment.id as string };
    hiredIds.push(hired.id);
    const draft = (await api().post(`/api/employees/${hired.id}/employments/${hired.employmentId}/contracts`).set('Cookie', hr).send({ grossSalary }).expect(201)).body as {
      id: string;
      startDate: string;
      insuredSalary: number;
    };
    return { ...hired, draft };
  }

  /** Puts every year back as the migration added it. */
  async function restore() {
    await prisma.payrollLawYear.deleteMany({ where: { year: { notIn: BUILT_IN_LAW_RATES.map((r) => r.year) } } });
    for (const r of BUILT_IN_LAW_RATES) {
      const data = { ...body(r), taxTiers: normalTaxTiers(r.taxTiers) as unknown as Prisma.InputJsonValue, updatedById: null };
      await prisma.payrollLawYear.upsert({ where: { year: r.year }, create: { year: r.year, ...data }, update: data });
    }
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    hr = await signIn(app, await createUser(prisma, ['hr']));
    ceo = await signIn(app, await createUser(prisma, ['ceo']));
    finance = await signIn(app, await createUser(prisma, ['finance']));
    admin = await signIn(app, await createUser(prisma, ['admin']));
    const superEmail = await createUser(prisma, ['super_admin']);
    superAdmin = await signIn(app, superEmail);
    superAdminId = (await prisma.user.findUniqueOrThrow({ where: { email: superEmail } })).id;
    staff = await signIn(app, await createUser(prisma, ['employee']));
    manager = await signIn(app, await createUser(prisma, ['manager']));
    await prisma.payrollRun.deleteMany();
    departmentId = (await api().post('/api/departments').set('Cookie', hr).send({ nameEn: `Law Rates ${RUN}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    // runs keep their people on record: remove them, then the people hired here and their department
    await prisma.payrollRun.deleteMany();
    await prisma.payrollAdjustment.deleteMany({ where: { employeeId: { in: hiredIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: hiredIds } } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
    await restore();
    await app.close();
  });

  it('adds 2025 and 2026 in the migration exactly as the constants were', async () => {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      assertTestDatabase((await db.query<{ name: string }>('SELECT current_database() AS name')).rows[0].name);
      const migration = readdirSync(MIGRATIONS).find((m) => m.endsWith('_law_rates'))!;
      const sql = (m: string) => readFileSync(`${MIGRATIONS}${m}/migration.sql`, 'utf8');
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA}`);
      for (const m of readdirSync(MIGRATIONS).filter((m) => /^\d{14}_/.test(m) && m < migration).sort()) await db.query(sql(m));
      await db.query(sql(migration));
      const { rows } = await db.query<Record<string, string | number | null | TaxTier[]>>(`
        SELECT year, employee_insurance_rate, employer_insurance_rate, insurable_wage_min, insurable_wage_max, personal_exemption,
          martyrs_rate, health_insurance_rate, tax_tiers, updated_by FROM payroll_law_years ORDER BY year`);
      expect(
        rows.map((r) =>
          normalLawRates({
            year: Number(r.year),
            employeeInsuranceRate: Number(r.employee_insurance_rate),
            employerInsuranceRate: Number(r.employer_insurance_rate),
            insurableWageMin: Number(r.insurable_wage_min),
            insurableWageMax: Number(r.insurable_wage_max),
            personalExemption: Number(r.personal_exemption),
            martyrsRate: Number(r.martyrs_rate),
            healthInsuranceRate: Number(r.health_insurance_rate),
            taxTiers: r.tax_tiers as TaxTier[],
          }),
        ),
      ).toEqual(BUILT_IN_LAW_RATES.map(normalLawRates));
      expect(rows.map((r) => r.updated_by)).toEqual([null, null]);
      // runs made before have no copy of their own
      const { rows: runs } = await db.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'payroll_runs' AND column_name = 'law_rates'", [SCHEMA]);
      expect(runs).toEqual([{ is_nullable: 'YES' }]);
      // the database refuses rates out of their limits
      await expect(db.query("UPDATE payroll_law_years SET employee_insurance_rate = 1.5 WHERE year = 2026")).rejects.toThrow(/payroll_law_years_rates_check/);
      await expect(db.query("UPDATE payroll_law_years SET insurable_wage_max = 100 WHERE year = 2026")).rejects.toThrow(/payroll_law_years_insurable_wage_check/);
      await expect(db.query("UPDATE payroll_law_years SET tax_tiers = '[]' WHERE year = 2026")).rejects.toThrow(/payroll_law_years_tax_tiers_check/);
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await db.end();
    }
  });

  it('gives the seeded years, the same as the constants, to HR, Finance, the CEO and Admin', async () => {
    for (const session of [hr, finance, ceo, admin, superAdmin]) {
      const years = (await list(session).expect(200)).body as View[];
      expect(years.map(ratesOf)).toEqual(BUILT_IN_LAW_RATES.map(normalLawRates));
      expect(years.map((y) => y.updatedBy)).toEqual([null, null]);
    }
    for (const session of [staff, manager]) await list(session).expect(403);
  });

  it('lets only the Super Admin add or change a year, each change in the audit log with what it was and became', async () => {
    const since = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const next = { ...lawRatesFor(2026), insurableWageMin: 3_000, insurableWageMax: 19_000 };
    for (const session of [hr, finance, ceo, admin, staff]) {
      const refused = await put(2031, body(next), session).expect(403);
      if (session !== staff) expect(refused.body.message).toBe(ONLY_SUPER_ADMIN_CHANGES);
    }
    const added = (await put(2031, body(next)).expect(200)).body as View;
    expect(ratesOf(added)).toEqual(normalLawRates({ ...next, year: 2031 }));
    expect(added.updatedBy).toMatchObject({ id: superAdminId });
    expect(((await list().expect(200)).body as View[]).map((y) => y.year)).toEqual([2025, 2026, 2031]);

    const changed = (await put(2031, body({ ...next, martyrsRate: 0.001 })).expect(200)).body as View;
    expect(changed.martyrsRate).toBe(0.001);
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'payroll_law_rates', id: { gt: since } }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => [a.action, a.userId, a.diff])).toEqual([
      ['create', superAdminId, { year: 2031, ...body(next) }],
      ['update', superAdminId, { year: 2031, martyrsRate: { from: 0.0005, to: 0.001 } }],
    ]);
  });

  it("checks what is sent, with the page's messages", async () => {
    const good = body(lawRatesFor(2026));
    const refused = async (year: number | string, sent: object) => [(await put(year, sent).expect(400)).body.message].flat() as string[];
    expect(await refused('next', good)).toEqual(['The year must be a whole number, e.g. 2027.']);
    expect(await refused(1999, good)).toEqual(['Enter the year from 2000 to 2100.']);
    expect(await refused(2032, { ...good, employerInsuranceRate: 18.75 })).toEqual(["The company's social insurance share must be a percent from 0 to 100, with up to 4 decimals."]);
    expect(await refused(2032, { ...good, insurableWageMax: 1_000 })).toEqual(["The maximum insurable wage (1,000.00) can't be below the minimum (2,700.00)."]);
    expect(
      await refused(2032, {
        ...good,
        taxTiers: [
          { upTo: 600_000, bands: [{ upTo: 40_000, rate: 0 }, { upTo: null, rate: 0.1 }] },
          { upTo: 700_000, bands: [{ upTo: null, rate: 2 }] },
        ],
      }),
    ).toEqual(['The last tier must have no income limit, so that every income falls in a tier.', 'Tier 2, band 1: enter its rate as a percent from 0 to 100, with up to 4 decimals.']);
    expect(await refused(2032, { ...good, taxTiers: 'none' })).toEqual(['Send the tax tiers as a list.']);
    const { martyrsRate: _m, ...missing } = good;
    expect(await refused(2032, missing)).toEqual(["Enter the Martyrs' Fund rate as a number."]);
    await put(2032, { ...good, unknown: 1 }).expect(400);
    expect(((await list().expect(200)).body as View[]).map((y) => y.year)).not.toContain(2032);
  });

  it('deletes a year for the Super Admin only, never the earliest', async () => {
    expect((await remove(2031, admin).expect(403)).body.message).toBe(ONLY_SUPER_ADMIN_DELETES);
    await remove(2031, hr).expect(403);
    expect((await remove(2025).expect(409)).body.message).toBe("2025 is the earliest year: it can't be deleted, as the years before it use its rates.");
    await remove(2040).expect(404);
    await remove(2031).expect(204);
    expect(((await list().expect(200)).body as View[]).map((y) => y.year)).toEqual([2025, 2026]);
    const deleted = await prisma.auditLog.findFirst({ where: { entityType: 'payroll_law_rates', action: 'delete' }, orderBy: { id: 'desc' } });
    expect(deleted?.diff).toMatchObject({ year: 2031, martyrsRate: 0.001 });
  });

  describe('a payroll run', () => {
    let runId: string;

    beforeAll(async () => {
      const hired = await hire('Payee');
      person = hired;
      await api().post(`/api/contracts/${hired.draft.id}/sign`).set('Cookie', hr).send({ signedOn: hired.draft.startDate }).expect(200);
      await api().patch(`/api/employees/${hired.id}`).set('Cookie', hr).send({ socialInsured: true }).expect(200);
    });

    it("copies its year's rates when it is made, and works its lines out with them", async () => {
      const run = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: MONTH }).expect(201)).body as Run;
      runId = run.id;
      expect(run.lawRates).toEqual(normalLawRates(lawRatesFor(YEAR)));
      const line = lineOf(run);
      expect(line.result).toMatchObject({ insuredWage: 12_000, employeeInsurance: 1_320, employerInsurance: 2_250 });
      expect(line.result).toEqual(expected(run, line));
    });

    it('keeps its copy while the rates change, also when a line is worked out again', async () => {
      await put(YEAR, body({ ...lawRatesFor(YEAR), employeeInsuranceRate: 0.12, taxTiers: FLAT })).expect(200);
      const run = await getRun(runId);
      expect(run.lawRates.employeeInsuranceRate).toBe(0.11);
      expect(lineOf(run).result.employeeInsurance).toBe(1_320);

      // a commission on Additions / Deductions (owner, 17 October 2026): the draft's line worked out again with it
      await api()
        .post('/api/payroll/adjustments')
        .set('Cookie', hr)
        .send({ employeeId: person.id, month: MONTH, kind: 'addition', type: 'commission', amount: 1_000, reason: 'Invented commission' })
        .expect(201);
      const patched = await getRun(runId);
      const line = lineOf(patched);
      expect(line.result).toMatchObject({ additionsTaxed: 1_000, employeeInsurance: 1_320 });
      expect(line.result).toEqual(payrollLine(line.terms, line.inputs, patched.rules, normalLawRates(lawRatesFor(YEAR))));
    });

    it("takes the year's new rates when the draft is refreshed, saying so in the audit log", async () => {
      const run = (await api().post(`/api/payroll/runs/${runId}/refresh`).set('Cookie', hr).expect(200)).body as Run;
      // the year's own row now
      expect(run.lawRates).toMatchObject({ year: YEAR, employeeInsuranceRate: 0.12, taxTiers: FLAT });
      const line = lineOf(run);
      expect(line.terms.adjustments?.map((a) => [a.type, a.amount])).toEqual([['commission', 1_000]]);
      expect(line.result).toMatchObject({ employeeInsurance: 1_440, employerInsurance: 2_250 });
      expect(line.result).toEqual(expected(run, line));
      // 13,000 less 1,440, × 12, less 20,000, rounded down to ten pounds: 118,720 a year, 20% above 50,000
      expect(line.result).toMatchObject({ annualNetIncome: 118_720, monthlyTax: 1_145.33 });
      const refreshed = await prisma.auditLog.findFirst({ where: { entityType: 'payroll_run', entityId: runId, action: 'refresh' }, orderBy: { id: 'desc' } });
      expect(refreshed?.diff).toMatchObject({
        lawRates: { employeeInsuranceRate: { from: 0.11, to: 0.12 }, taxTiers: { from: normalTaxTiers(lawRatesFor(YEAR).taxTiers), to: FLAT } },
      });
    });

    it('never changes once approved', async () => {
      await api().post(`/api/payroll/runs/${runId}/submit`).set('Cookie', hr).expect(200);
      await api().post(`/api/payroll/runs/${runId}/approve`).set('Cookie', ceo).expect(200);
      const approved = await getRun(runId);
      await put(YEAR, body({ ...lawRatesFor(YEAR), employeeInsuranceRate: 0.13, martyrsRate: 0.002 })).expect(200);
      const after = await getRun(runId);
      expect(after.lawRates).toEqual(approved.lawRates);
      expect(lineOf(after).result).toEqual(lineOf(approved).result);
      await api().post(`/api/payroll/runs/${runId}/refresh`).set('Cookie', hr).expect(409);
    });

    it('works a run made before the copies out with the built-in rates of its year', async () => {
      const made = (await api().post('/api/payroll/runs').set('Cookie', hr).send({ month: OLD_MONTH }).expect(201)).body as Run;
      await prisma.payrollRun.update({ where: { id: made.id }, data: { lawRates: Prisma.DbNull } });
      const old = await getRun(made.id);
      const builtIn = lawRatesFor(Number(OLD_MONTH.slice(0, 4)));
      expect(old.lawRates).toEqual(normalLawRates(builtIn));
      const patched = (await api().patch(`/api/payroll/runs/${made.id}/lines`).set('Cookie', hr).send({ lines: [{ id: lineOf(old).id, inputs: { noShowDays: 1 } }] }).expect(200))
        .body as Run;
      const line = lineOf(patched);
      expect(line.result.employeeInsurance).toBe(1_320);
      expect(line.result).toEqual(payrollLine(line.terms, line.inputs, patched.rules, builtIn));
    });
  });

  describe('contracts and the Social Insurance tab', () => {
    it("keep a new contract's insured salary within the insurable limits of the year it starts", async () => {
      await put(THIS_YEAR, body({ ...lawRatesFor(THIS_YEAR), insurableWageMax: 20_000 })).expect(200);
      const hired = await hire('Insured', firstDay(CURRENT), 25_000);
      expect(hired.draft.insuredSalary).toBe(20_000);
      await api().post(`/api/contracts/${hired.draft.id}/sign`).set('Cookie', hr).send({ signedOn: hired.draft.startDate }).expect(200);

      // the Social Insurance tab: within this year's limits, the year's own
      const profile = (await api().get(`/api/employees/${hired.id}`).set('Cookie', hr).expect(200)).body;
      expect(profile.insurableLimits).toEqual({ year: THIS_YEAR, min: lawRatesFor(THIS_YEAR).insurableWageMin, max: 20_000 });
      expect(profile.insuredWage).toMatchObject({ amount: 20_000, comprehensive: 25_000, adjusted: 'max' });
    });
  });
});
