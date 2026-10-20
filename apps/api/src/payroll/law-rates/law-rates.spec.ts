import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BUILT_IN_LAW_RATES, lawRatesFor, normalTaxTiers, type LawRates, type Role } from '@trendlix/shared';
import { MONTHLY_TERMS, payslipSource } from '../../../test/fixtures/payslip.js';
import type { AuditEntry, AuditService } from '../../audit/audit.service.js';
import { Prisma, type PayrollLawYear } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { payslipContent } from '../payslip-content.js';
import { roster, type RosterEmployment } from '../roster.js';
import { runLawRates } from '../views.js';
import { LawRatesService, ONLY_SUPER_ADMIN_CHANGES_LAW_RATES } from './law-rates.service.js';

// The rates set by law, by year (owner's request, 16 October 2026): kept by year, changed by the Super Admin only, read
// by the other modules through the service (kept in memory until they change); a payroll run keeps the copy it was
// worked out with, and payslips and the roster use it. Everything here is invented.

const Y2026 = lawRatesFor(2026);

/** A row as the database keeps it. */
function rowOf(r: LawRates, updatedById: string | null = null): PayrollLawYear {
  return {
    year: r.year,
    employeeInsuranceRate: new Prisma.Decimal(r.employeeInsuranceRate),
    employerInsuranceRate: new Prisma.Decimal(r.employerInsuranceRate),
    insurableWageMin: new Prisma.Decimal(r.insurableWageMin),
    insurableWageMax: new Prisma.Decimal(r.insurableWageMax),
    personalExemption: new Prisma.Decimal(r.personalExemption),
    martyrsRate: new Prisma.Decimal(r.martyrsRate),
    healthInsuranceRate: new Prisma.Decimal(r.healthInsuranceRate),
    // as JSONB gives them back: its own key order
    taxTiers: JSON.parse(JSON.stringify(normalTaxTiers(r.taxTiers).map((t) => ({ bands: t.bands.map((b) => ({ rate: b.rate, upTo: b.upTo })), upTo: t.upTo })))),
    minimumWage: typeof r.minimumWage === 'number' ? new Prisma.Decimal(r.minimumWage) : null,
    beforeTaxHealthLimit: typeof r.beforeTaxHealthLimit === 'number' ? new Prisma.Decimal(r.beforeTaxHealthLimit) : null,
    updatedAt: new Date('2026-10-16T10:00:00Z'),
    updatedById,
  };
}

/** The service with a database of `rows` in memory, counting its reads, and the audit entries it records. */
function service(rows: PayrollLawYear[] = BUILT_IN_LAW_RATES.map((r) => rowOf(r))) {
  const db = { rows: [...rows], reads: 0 };
  const audit: AuditEntry[] = [];
  const sorted = () => [...db.rows].sort((a, b) => a.year - b.year);
  const prisma = {
    payrollLawYear: {
      findMany: async (args: { include?: unknown }) => {
        db.reads += 1;
        return sorted().map((r) => (args.include ? { ...r, updatedBy: r.updatedById ? { id: r.updatedById, email: 'Super@Example.com' } : null } : r));
      },
      findUnique: async ({ where }: { where: { year: number } }) => db.rows.find((r) => r.year === where.year) ?? null,
      upsert: async ({ where, create, update }: { where: { year: number }; create: object; update: object }) => {
        const at = db.rows.findIndex((r) => r.year === where.year);
        const data = (at < 0 ? create : { ...db.rows[at], ...update }) as Record<string, unknown>;
        const row = {
          ...data,
          ...Object.fromEntries(['employeeInsuranceRate', 'employerInsuranceRate', 'insurableWageMin', 'insurableWageMax', 'personalExemption', 'martyrsRate', 'healthInsuranceRate'].map((k) => [k, new Prisma.Decimal(data[k] as number)])),
          minimumWage: typeof data.minimumWage === 'number' ? new Prisma.Decimal(data.minimumWage) : (data.minimumWage ?? null),
          beforeTaxHealthLimit: typeof data.beforeTaxHealthLimit === 'number' ? new Prisma.Decimal(data.beforeTaxHealthLimit) : (data.beforeTaxHealthLimit ?? null),
          year: where.year,
          updatedAt: new Date(),
        } as unknown as PayrollLawYear;
        if (at < 0) db.rows.push(row);
        else db.rows[at] = row;
        return row;
      },
      delete: async ({ where }: { where: { year: number } }) => {
        db.rows = db.rows.filter((r) => r.year !== where.year);
      },
    },
    employee: { findMany: async () => [{ workEmail: 'super@example.com', fullNameEn: 'Salma Super' }] },
  };
  const auditService = { record: async (entry: AuditEntry) => void audit.push(entry) };
  return { lawRates: new LawRatesService(prisma as unknown as PrismaService, auditService as unknown as AuditService), db, audit };
}

const user = (...roles: Role[]) => ({ id: 'user-1', email: 'super@example.com', roles });
const superAdmin = user('super_admin');
/** What PUT sends: every value but the year. */
const body = (r: LawRates) => {
  const { year: _year, ...rest } = r;
  return { ...rest, taxTiers: normalTaxTiers(rest.taxTiers) };
};

describe('LawRatesService', () => {
  it("gives a year's rates from the rows, in the shared shape: the latest earlier year's for a year without its own", async () => {
    const { lawRates } = service();
    expect(await lawRates.years()).toEqual([...BUILT_IN_LAW_RATES].map((r) => ({ ...r, taxTiers: normalTaxTiers(r.taxTiers) })));
    expect(await lawRates.forYear(2026)).toEqual({ ...Y2026, taxTiers: normalTaxTiers(Y2026.taxTiers) });
    expect((await lawRates.forYear(2031)).year).toBe(2026);
    expect((await lawRates.forYear(2019)).insurableWageMax).toBe(14_500);
  });

  it('keeps them in memory, and reads them again once they change', async () => {
    const { lawRates, db } = service();
    await lawRates.forYear(2026);
    await lawRates.forYear(2025);
    await lawRates.years();
    expect(db.reads).toBe(1);
    await lawRates.put(2027, body({ ...Y2026, insurableWageMax: 18_000 }), superAdmin);
    expect((await lawRates.forYear(2027)).insurableWageMax).toBe(18_000);
    expect((await lawRates.forYear(2026)).insurableWageMax).toBe(16_700);
    await lawRates.remove(2027, superAdmin);
    expect((await lawRates.forYear(2027)).year).toBe(2026);
  });

  it('uses the built-in rates when no year is kept', async () => {
    const { lawRates } = service([]);
    expect(await lawRates.forYear(2026)).toBe(lawRatesFor(2026));
  });

  it('lists the years with who changed them last, by their name on the profile', async () => {
    const { lawRates } = service([rowOf(BUILT_IN_LAW_RATES[0]), rowOf(Y2026, 'user-1')]);
    const [y2025, y2026] = await lawRates.list();
    expect(y2025).toMatchObject({ year: 2025, updatedBy: null });
    expect(y2026).toMatchObject({ year: 2026, insurableWageMax: 16_700, updatedBy: { id: 'user-1', name: 'Salma Super' } });
    expect(y2026.updatedAt).toBeInstanceOf(Date);
  });

  it('lets only a Super Admin change them, checked as the page checks them', async () => {
    const { lawRates, db } = service();
    for (const roles of [['hr'], ['admin'], ['ceo', 'finance']] as Role[][]) {
      await expect(lawRates.put(2026, body(Y2026), user(...roles))).rejects.toThrow(new ForbiddenException(ONLY_SUPER_ADMIN_CHANGES_LAW_RATES));
    }
    const refused = lawRates.put(2026, body({ ...Y2026, employeeInsuranceRate: 1.2, taxTiers: [] }), superAdmin);
    await expect(refused).rejects.toBeInstanceOf(BadRequestException);
    await expect(refused).rejects.toMatchObject({
      response: { message: ["The employee's social insurance share must be a percent from 0 to 100, with up to 4 decimals.", 'Add at least one tax tier.'] },
    });
    await expect(lawRates.put(1999, body(Y2026), superAdmin)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.rows.map((r) => r.employeeInsuranceRate.toNumber())).toEqual([0.11, 0.11]);
  });

  it('records each change in the audit log with what it was and what it became', async () => {
    const { lawRates, audit } = service();
    const tiers = [{ upTo: null, bands: [{ upTo: 50_000, rate: 0 }, { upTo: null, rate: 0.2 }] }];
    const changed = await lawRates.put(2026, body({ ...Y2026, employeeInsuranceRate: 0.12, taxTiers: tiers }), superAdmin);
    expect(changed).toMatchObject({ year: 2026, employeeInsuranceRate: 0.12, taxTiers: tiers, updatedBy: { id: 'user-1', name: 'Salma Super' } });
    // the same again: nothing to record
    await lawRates.put(2026, body({ ...Y2026, employeeInsuranceRate: 0.12, taxTiers: tiers }), superAdmin);
    await lawRates.put(2028, body(Y2026), superAdmin);
    expect(audit).toEqual([
      {
        userId: 'user-1',
        action: 'update',
        entityType: 'payroll_law_rates',
        diff: { year: 2026, employeeInsuranceRate: { from: 0.11, to: 0.12 }, taxTiers: { from: normalTaxTiers(Y2026.taxTiers), to: tiers } },
      },
      { userId: 'user-1', action: 'create', entityType: 'payroll_law_rates', diff: { year: 2028, ...body(Y2026) } },
    ]);
  });

  it('keeps the minimum wage a year has, set, cleared, or kept when left out (owner, 18 October 2026)', async () => {
    const { lawRates, db, audit } = service();
    // not built in: none until the Super Admin sets one, and the page always gets the field
    expect((await lawRates.list()).map((r) => r.minimumWage)).toEqual([null, null]);
    expect((await lawRates.put(2026, { ...body(Y2026), minimumWage: 7000 }, superAdmin)).minimumWage).toBe(7000);
    expect((await lawRates.forYear(2026)).minimumWage).toBe(7000);
    // a page from before it came sends none: the year keeps it
    expect((await lawRates.put(2026, body({ ...Y2026, personalExemption: 21_000 }), superAdmin)).minimumWage).toBe(7000);
    // null clears it
    expect((await lawRates.put(2026, { ...body(Y2026), minimumWage: null }, superAdmin)).minimumWage).toBeNull();
    expect(db.rows.find((r) => r.year === 2026)!.minimumWage).toBeNull();
    await expect(lawRates.put(2026, { ...body(Y2026), minimumWage: 0 }, superAdmin)).rejects.toMatchObject({
      response: { message: ['Enter the minimum wage as an amount above 0, to the piaster, or leave it empty.'] },
    });
    expect(audit.map((a) => (a.diff as Record<string, unknown>).minimumWage)).toEqual([{ from: null, to: 7000 }, undefined, { from: 7000, to: null }]);
  });

  it('keeps the before-tax health insurance limit a year has, set, cleared, or kept when left out (owner, 20 October 2026)', async () => {
    const { lawRates, db, audit } = service();
    // not built in (the accountant gives it): none until the Super Admin sets one, and none is no limit
    expect((await lawRates.list()).map((r) => r.beforeTaxHealthLimit)).toEqual([undefined, undefined]);
    expect((await lawRates.put(2026, { ...body(Y2026), beforeTaxHealthLimit: 6000 }, superAdmin)).beforeTaxHealthLimit).toBe(6000);
    expect((await lawRates.forYear(2026)).beforeTaxHealthLimit).toBe(6000);
    // a page from before it came sends none: the year keeps it, and the minimum wage is kept apart
    expect((await lawRates.put(2026, { ...body(Y2026), minimumWage: 7000 }, superAdmin)).beforeTaxHealthLimit).toBe(6000);
    // null clears it
    expect((await lawRates.put(2026, { ...body(Y2026), beforeTaxHealthLimit: null }, superAdmin)).beforeTaxHealthLimit).toBeUndefined();
    expect(db.rows.find((r) => r.year === 2026)!.beforeTaxHealthLimit).toBeNull();
    expect(db.rows.find((r) => r.year === 2026)!.minimumWage!.toNumber()).toBe(7000);
    await expect(lawRates.put(2026, { ...body(Y2026), beforeTaxHealthLimit: 0 }, superAdmin)).rejects.toMatchObject({
      response: { message: ['Enter the before-tax health insurance limit a year as an amount above 0, to the piaster, or leave it empty for no limit.'] },
    });
    expect(audit.map((a) => (a.diff as Record<string, unknown>).beforeTaxHealthLimit)).toEqual([{ from: null, to: 6000 }, undefined, { from: 6000, to: null }]);
    // a run made from then keeps it with its copy
    await lawRates.put(2026, { ...body(Y2026), beforeTaxHealthLimit: 6000 }, superAdmin);
    const copy = JSON.parse(JSON.stringify(await lawRates.forYear(2026))) as Prisma.JsonValue;
    expect(runLawRates({ month: new Date('2026-11-01T00:00:00Z'), lawRates: copy }).beforeTaxHealthLimit).toBe(6000);
  });

  it('deletes a year for a Super Admin only, never the earliest', async () => {
    const { lawRates, audit } = service();
    await expect(lawRates.remove(2026, user('admin'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(lawRates.remove(2025, superAdmin)).rejects.toThrow(new ConflictException("2025 is the earliest year: it can't be deleted, as the years before it use its rates."));
    await expect(lawRates.remove(2030, superAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await lawRates.remove(2026, superAdmin);
    expect((await lawRates.years()).map((r) => r.year)).toEqual([2025]);
    expect(audit).toEqual([{ userId: 'user-1', action: 'delete', entityType: 'payroll_law_rates', diff: { year: 2026, ...body(Y2026) } }]);
  });
});

describe("a payroll run's rates set by law", () => {
  const month = new Date('2026-09-01T00:00:00Z');

  it('are its copy, in the shared shape; a run made before the copies has the built-in ones of its year', () => {
    const copy = { ...Y2026, employeeInsuranceRate: 0.12 };
    // kept with its keys in another order, as JSONB may give them back
    const kept = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(copy).reverse()))) as Prisma.JsonValue;
    expect(runLawRates({ month, lawRates: kept })).toEqual({ ...copy, taxTiers: normalTaxTiers(copy.taxTiers) });
    expect(runLawRates({ month, lawRates: null })).toBe(lawRatesFor(2026));
    expect(runLawRates({ month: new Date('2025-03-01T00:00:00Z'), lawRates: null }).insurableWageMax).toBe(14_500);
  });

  it("keep the roster's insured wage within the run's insurable limits", () => {
    const e: RosterEmployment = {
      id: 'employment-1',
      employmentType: 'full_time',
      joinDate: '2025-01-01',
      endDate: null,
      department: null,
      jobTitle: null,
      shift: null,
      employee: { id: 'employee-1', employeeCode: 'EMP-0001', fullNameEn: 'Nour Invented', socialInsured: true, insuranceComprehensiveWage: null },
      contracts: [{ id: 'contract-1', number: 'CON-2025-0001', version: 1, startDate: '2025-01-01', endDate: null, payBasis: 'monthly', grossSalary: 20_000, basicPercent: 80, hourlyRate: null, allowances: [] }],
    };
    expect(roster('2026-09', [e], { dayDivisor: 30 }).lines[0].terms.insuredWage).toBe(16_700);
    expect(roster('2026-09', [e], { dayDivisor: 30 }, [], { ...Y2026, insurableWageMax: 18_000 }).lines[0].terms.insuredWage).toBe(18_000);
    expect(roster('2026-09', [e], { dayDivisor: 30 }, [], { ...Y2026, insurableWageMax: 19_500 }).lines[0].terms.insuredWage).toBe(19_500);
  });

  it("are the payslip's: the insurance shares and the Fund's rate it prints", () => {
    const law = { ...Y2026, employeeInsuranceRate: 0.12, employerInsuranceRate: 0.2, martyrsRate: 0.001 };
    const builtIn = payslipSource('monthly');
    const source = { ...builtIn, run: { ...builtIn.run, lawRates: law } };
    const notes = (c: ReturnType<typeof payslipContent>) => [c.earnings, c.deductions].flatMap((s) => s?.rows.map((r) => r.note) ?? []);
    expect(notes(payslipContent(builtIn, 'en'))).toEqual(expect.arrayContaining([expect.stringContaining('11% of the insured wage'), '0.05% of the pay']));
    const changed = payslipContent(source, 'en');
    expect(notes(changed)).toEqual(expect.arrayContaining([expect.stringContaining('12% of the insured wage'), '0.1% of the pay']));
    expect(changed.companyShare).toContain('20% of the insured wage');
    expect(MONTHLY_TERMS.year).toBe(2026);
  });
});
