import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { lawRatesFor, lawRatesProblems, normalLawRates, type LawRates, type TaxTier } from '@trendlix/shared';
import { AuditService, changes } from '../../audit/audit.service.js';
import { assertDeletes, isSuperAdmin } from '../../auth/roles.js';
import type { SessionUser } from '../../auth/session-user.js';
import type { PayrollLawYear, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { namesByAccountEmail } from '../../users/employee-accounts.js';
import { ratesSent, type PutLawRatesDto } from './law-rates.dto.js';

const ENTITY = 'payroll_law_rates';

/** The tax brackets are "editable by superadmin" (owner, 16 October 2026), and so is the rest of the section. */
export const ONLY_SUPER_ADMIN_CHANGES_LAW_RATES = 'Only a Super Admin can change the rates set by law.';

/**
 * How long the rates are kept in memory before they are read again: changes made here clear them at once, and another
 * instance of the API reads a change within this time.
 */
const KEPT_MS = 60_000;

/** A year's rates as the API sends them, with who changed them last and when. */
export interface LawRatesView extends LawRates {
  updatedAt: Date;
  /** Null for the rows the law rates migration added, and for an account since deleted. */
  updatedBy: { id: string; name: string } | null;
}

/** A row's rates, in the shape packages/shared has them (law-rates.ts). */
export const lawRatesOf = (row: PayrollLawYear): LawRates =>
  normalLawRates({
    year: row.year,
    employeeInsuranceRate: row.employeeInsuranceRate.toNumber(),
    employerInsuranceRate: row.employerInsuranceRate.toNumber(),
    insurableWageMin: row.insurableWageMin.toNumber(),
    insurableWageMax: row.insurableWageMax.toNumber(),
    personalExemption: row.personalExemption.toNumber(),
    martyrsRate: row.martyrsRate.toNumber(),
    healthInsuranceRate: row.healthInsuranceRate.toNumber(),
    taxTiers: row.taxTiers as unknown as TaxTier[],
    minimumWage: row.minimumWage?.toNumber() ?? null,
    beforeTaxHealthLimit: row.beforeTaxHealthLimit?.toNumber() ?? null,
  });

/** What a row keeps of a year's rates (all but the year); the minimum wage and the before-tax limit null when not set. */
const rowData = (r: LawRates) => {
  const { year: _year, taxTiers, minimumWage, beforeTaxHealthLimit, ...rates } = normalLawRates(r);
  return { ...rates, minimumWage: minimumWage ?? null, beforeTaxHealthLimit: beforeTaxHealthLimit ?? null, taxTiers: taxTiers as unknown as Prisma.InputJsonValue };
};

// The rates set by law, by year (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
// variables that might affect the sheet"): the social insurance shares and insurable wage limits, the personal
// exemption, the Martyrs' Fund, health insurance and the salary tax's tiers; and (owner, 20 October 2026, on the
// employee's medical share: "Before Tax i think") the before-tax health insurance limit a year, empty for none. HR, Finance, the CEO and Admin read them;
// the Super Admin alone adds, changes or deletes a year (the tax brackets "editable by superadmin, to modify it if the
// law changed"), every change in the audit log with what it was and what it became. The other modules ask here for a
// year's rates: payroll runs (the run's year, a copy kept on the run), contracts and offers (the year they start), the
// Social Insurance tab and the documents (this year in Cairo). Kept in memory, cleared when they change.
@Injectable()
export class LawRatesService {
  private kept: { at: number; years: Promise<LawRates[]> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every year's rates, oldest first: none kept means the built-in ones (lawRatesFor). */
  years(): Promise<LawRates[]> {
    if (!this.kept || Date.now() - this.kept.at > KEPT_MS) {
      const years = this.prisma.payrollLawYear.findMany({ orderBy: { year: 'asc' } }).then((rows) => rows.map(lawRatesOf));
      const kept = { at: Date.now(), years };
      this.kept = kept;
      // a failed read isn't kept: the next ask reads again
      void years.catch(() => {
        if (this.kept === kept) this.kept = null;
      });
    }
    return this.kept.years;
  }

  /** The rates that apply in `year`: its own, else the latest earlier year's, else the earliest's. */
  async forYear(year: number): Promise<LawRates> {
    return lawRatesFor(year, await this.years());
  }

  /** Every year's rates with who changed them last, oldest first. */
  async list(): Promise<LawRatesView[]> {
    const rows = await this.prisma.payrollLawYear.findMany({ orderBy: { year: 'asc' }, include: { updatedBy: { select: { id: true, email: true } } } });
    // named by the profile each account is linked to (22 October 2026: never by email)
    const names = await namesByAccountEmail(this.prisma, rows.flatMap((r) => (r.updatedBy ? [r.updatedBy.email] : [])));
    return rows.map((r) => ({
      ...lawRatesOf(r),
      // always there for the page: null when not set (owner, 18 October 2026)
      minimumWage: r.minimumWage?.toNumber() ?? null,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy && { id: r.updatedBy.id, name: names.get(r.updatedBy.email.toLowerCase()) ?? r.updatedBy.email },
    }));
  }

  /**
   * Adds a year's rates or replaces them (the Super Admin only), checked as the page checks them (lawRatesProblems).
   * Runs made or refreshed from now on take them; an approved run keeps its copy.
   */
  async put(year: number, dto: PutLawRatesDto, user: SessionUser): Promise<LawRatesView> {
    if (!isSuperAdmin(user)) throw new ForbiddenException(ONLY_SUPER_ADMIN_CHANGES_LAW_RATES);
    const before = await this.prisma.payrollLawYear.findUnique({ where: { year } });
    // the minimum wage, or the before-tax health insurance limit (20 October 2026), left out keeps the year's (a page
    // from before it came sends none)
    const sent = ratesSent(year, dto);
    const rates = normalLawRates({
      ...sent,
      ...(dto.minimumWage === undefined && { minimumWage: before?.minimumWage?.toNumber() ?? null }),
      ...(dto.beforeTaxHealthLimit === undefined && { beforeTaxHealthLimit: before?.beforeTaxHealthLimit?.toNumber() ?? null }),
    });
    const problems = lawRatesProblems(rates);
    if (problems.length) throw new BadRequestException(problems);

    const data = { ...rowData(rates), updatedById: user.id };
    await this.prisma.payrollLawYear.upsert({ where: { year }, create: { year, ...data }, update: data });
    this.kept = null;

    const { year: _year, ...after } = rates;
    if (!before) {
      await this.audit.record({ userId: user.id, action: 'create', entityType: ENTITY, diff: { year, ...after } });
    } else {
      const { year: _was, ...was } = lawRatesOf(before);
      // the minimum wage and the before-tax limit as null when not set, so clearing them is recorded too
      const diff = changes({ ...was, minimumWage: was.minimumWage ?? null, beforeTaxHealthLimit: was.beforeTaxHealthLimit ?? null } as unknown as Record<string, unknown>, {
        ...after,
        minimumWage: after.minimumWage ?? null,
        beforeTaxHealthLimit: after.beforeTaxHealthLimit ?? null,
      } as unknown as Record<string, unknown>);
      if (Object.keys(diff).length) await this.audit.record({ userId: user.id, action: 'update', entityType: ENTITY, diff: { year, ...diff } });
    }
    return (await this.list()).find((r) => r.year === year)!;
  }

  /**
   * Deletes a year's rates (the Super Admin only, like every deletion): the years it covered then use the year before.
   * Never the earliest year, which the years before it use: there is always one. Runs keep their copies.
   */
  async remove(year: number, user: SessionUser): Promise<void> {
    assertDeletes(user);
    const rows = await this.prisma.payrollLawYear.findMany({ orderBy: { year: 'asc' } });
    const row = rows.find((r) => r.year === year);
    if (!row) throw new NotFoundException(`There are no rates set by law for ${year}.`);
    if (row.year === rows[0].year) {
      throw new ConflictException(`${year} is the earliest year: it can't be deleted, as the years before it use its rates.`);
    }
    await this.prisma.payrollLawYear.delete({ where: { year } });
    this.kept = null;
    const { year: _year, ...was } = lawRatesOf(row);
    await this.audit.record({ userId: user.id, action: 'delete', entityType: ENTITY, diff: { year, ...was } });
  }
}
