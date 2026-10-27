import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { LawRates, PayrollResult, PayrollStatus, PayrollTerms } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { fromDateOnly, toDateOnly } from '../../common/date-only.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { monthName, monthShort } from '../months.js';
import { STATUS_TEXT } from '../status.js';
import { isApproved, monthOf, runLawRates } from '../views.js';
import { etaPeriodOf, etaRow, etaWorkbook, type EtaPerson, type EtaRowResult } from './eta-file.js';
import type { EtaPeriod } from './eta-tax.js';

const RUN = 'payroll_run';

/** Where ETA's tax for the month differs from what the payroll deducted, by a pound or more. */
export interface EtaDifference {
  employeeId: string;
  employeeCode: string;
  name: string;
  payrollTax: number;
  etaTax: number;
}

export interface EtaCheck {
  /** The people in the file: on salary tax (freelancers left out). */
  employees: number;
  /** The earlier months of the year the file's figures are built on: the approved and paid runs before this one. */
  earlierMonths: number;
  differences: EtaDifference[];
}

type Pay = { terms: PayrollTerms; result: PayrollResult };
const pay = (l: { terms: Prisma.JsonValue; result: Prisma.JsonValue }): Pay => ({ terms: l.terms as unknown as PayrollTerms, result: l.result as unknown as PayrollResult });

// The ETA salary-tax file of a month's payroll (eta-file.ts), once the CEO approves it, as the bank files are. It
// reports everyone's pay to the Tax Authority, so it is made complete or not at all: someone who doesn't see the
// C-level people's pay (ConfidentialService) is told who downloads it instead of getting a file with people missing.
// Freelancers pay no salary tax and are left out. ETA's tax is cumulative over the year (eta-tax.ts), so the file is
// built on the year's earlier approved runs too, and `check` says where ETA's tax differs from the payroll's.
@Injectable()
export class EtaFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  async file(id: string, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const { month, rows, codes } = await this.rows(id, user);
    const data = await etaWorkbook(rows.map((r) => r.row));
    await this.audit.record({ userId: user.id, action: 'payroll_eta_file', entityType: RUN, entityId: id, diff: { month, employees: codes } });
    return { fileName: `ETA Salary Tax ${monthShort(month)} ${month.slice(0, 4)}.xlsx`, data };
  }

  async check(id: string, user: SessionUser): Promise<EtaCheck> {
    const { rows, earlierMonths } = await this.rows(id, user);
    const differences = rows
      .filter((r) => Math.abs(r.payrollTax - r.figures.periodTax) >= 1)
      .map((r) => ({ employeeId: r.employeeId, employeeCode: r.employeeCode, name: r.name, payrollTax: r.payrollTax, etaTax: r.figures.periodTax }));
    return { employees: rows.length, earlierMonths, differences };
  }

  private async rows(id: string, user: SessionUser) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      select: {
        id: true,
        month: true,
        status: true,
        lawRates: true,
        lines: {
          select: {
            employeeId: true,
            employeeCode: true,
            nameEn: true,
            terms: true,
            result: true,
            employment: { select: { endDate: true, jobTitle: { select: { titleAr: true, titleEn: true } } } },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll not found.');
    const month = monthOf(run);
    if (!isApproved(run.status)) {
      throw new ConflictException(`The ${monthName(month)} payroll ${STATUS_TEXT[run.status as PayrollStatus]}: the ETA file is made once the CEO approves it.`);
    }
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    if (run.lines.some((l) => hidden.has(l.employeeId))) {
      throw new ForbiddenException("The ETA file reports everyone's pay to the Tax Authority, the C-level's included, so it is downloaded by the CEO or a Super Admin.");
    }
    const lines = run.lines
      .map((l) => ({ ...l, ...pay(l) }))
      .filter((l) => l.terms.statutory)
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, 'en', { numeric: true }));
    if (!lines.length) throw new ConflictException(`Nobody on the ${monthName(month)} payroll pays salary tax.`);

    const ids = lines.map((l) => l.employeeId);
    const yearStart = toDateOnly(`${month.slice(0, 4)}-01-01`);
    const [people, company, earlierLines] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          fullNameAr: true,
          nationality: true,
          mobile: true,
          disability: true,
          insuranceNo: true,
          insuranceStartDate: true,
          insuranceComprehensiveWage: true,
          identity: { select: { nationalId: true } },
        },
      }),
      this.prisma.company.findUnique({ where: { id: 1 }, select: { nameAr: true, nameEn: true } }),
      // the year's earlier months, from the runs the CEO approved, oldest first
      this.prisma.payrollLine.findMany({
        where: { employeeId: { in: ids }, run: { month: { gte: yearStart, lt: run.month }, status: { in: ['approved', 'paid'] } } },
        select: { employeeId: true, terms: true, result: true, run: { select: { month: true, lawRates: true } } },
        orderBy: { run: { month: 'asc' } },
      }),
    ]);
    const personOf = new Map(people.map((p) => [p.id, p]));
    const earlier = new Map<string, EtaPeriod[]>();
    const months = new Set<string>();
    for (const l of earlierLines) {
      const p = pay(l);
      if (!p.terms.statutory) continue;
      months.add(monthOf(l.run));
      const list = earlier.get(l.employeeId) ?? [];
      list.push(etaPeriodOf(p, runLawRates(l.run)));
      earlier.set(l.employeeId, list);
    }
    const law: LawRates = runLawRates(run);
    const inMonth = (ymd: string) => ymd.slice(0, 7) === month;

    const rows = lines.map((l): EtaRowResult & { employeeId: string; employeeCode: string; name: string } => {
      const p = personOf.get(l.employeeId);
      const ended = l.employment.endDate ? fromDateOnly(l.employment.endDate) : null;
      const person: EtaPerson = {
        code: l.employeeCode,
        nameAr: p?.fullNameAr ?? '',
        egyptian: !p?.nationality || /^\s*(egyptian|مصري|مصرية)\s*$/i.test(p.nationality),
        nationalId: p?.identity?.nationalId ?? null,
        mobile: p?.mobile ?? null,
        jobTitle: l.employment.jobTitle?.titleAr ?? l.employment.jobTitle?.titleEn ?? null,
        employer: company?.nameAr ?? company?.nameEn ?? null,
        disability: p?.disability ?? false,
        insuranceNo: p?.insuranceNo ?? null,
        insuranceStart: p?.insuranceStartDate ? fromDateOnly(p.insuranceStartDate) : null,
        comprehensiveWage: p?.insuranceComprehensiveWage?.toNumber() ?? null,
        endOfService: l.terms.leavingOn ?? (ended && inMonth(ended) ? ended : null),
      };
      return { ...etaRow(person, l, earlier.get(l.employeeId) ?? [], law), employeeId: l.employeeId, employeeCode: l.employeeCode, name: l.nameEn };
    });
    return { month, rows, codes: lines.map((l) => l.employeeCode), earlierMonths: months.size };
  }
}
