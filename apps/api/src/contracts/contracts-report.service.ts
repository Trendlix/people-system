import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CONTRACTS_REPORT_SHOW_DEFAULT,
  CONTRACTS_REPORT_STATUS_DEFAULT,
  contractsReport,
  periodDays,
  periodProblem,
  requestedPeriod,
  type ContractsReport,
  type ContractsReportEmployment,
  type ContractsReportFilters,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ContractsReportQueryDto } from './contracts-report.dto.js';
import { contractsReportFileName, contractsReportWorkbook } from './contracts-report-workbook.js';

const ENTITY = 'contracts_report';

const PLACE = { select: { id: true, nameEn: true, parent: { select: { id: true, nameEn: true } } } } satisfies Prisma.DepartmentDefaultArgs;

/**
 * What the report reads of each employment: its person (and whether they are employed now), its place, job title and
 * type now, and every one of its versions' dates and status; nothing of their pay.
 */
const EMPLOYMENT = {
  id: true,
  employmentType: true,
  employee: {
    select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true, employments: { where: { endDate: null }, select: { id: true }, take: 1 } },
  },
  department: PLACE,
  jobTitle: { select: { titleEn: true } },
  contracts: {
    orderBy: { version: 'asc' },
    select: { id: true, number: true, version: true, kind: true, form: true, convertsTo: true, status: true, startDate: true, endDate: true, signedOn: true, probationEnd: true },
  },
} satisfies Prisma.EmploymentSelect;

type EmploymentRow = Prisma.EmploymentGetPayload<{ select: typeof EMPLOYMENT }>;

function employmentOf(e: EmploymentRow): ContractsReportEmployment {
  return {
    employmentId: e.id,
    employee: { id: e.employee.id, employeeCode: e.employee.employeeCode, fullNameEn: e.employee.fullNameEn, fullNameAr: e.employee.fullNameAr },
    current: e.employee.employments.length > 0,
    department: e.department && { id: e.department.id, nameEn: e.department.nameEn, parent: e.department.parent && { id: e.department.parent.id, nameEn: e.department.parent.nameEn } },
    jobTitle: e.jobTitle?.titleEn ?? null,
    employmentType: e.employmentType,
    versions: e.contracts.map((c) => ({
      id: c.id,
      number: c.number,
      version: c.version,
      kind: c.kind,
      form: c.form,
      convertsTo: c.convertsTo,
      status: c.status,
      startDate: fromDateOnly(c.startDate),
      endDate: fromDateOnly(c.endDate),
      signedOn: fromDateOnly(c.signedOn),
      probationEnd: fromDateOnly(c.probationEnd),
    })),
  };
}

// The Contracts report (owner, 25 October 2026: "if i want to export a contracts report, status, start and end dates,
// how?"; asked, "A report under Reports" and "Dates and status"; packages/shared contracts-report.ts): for a period of
// months, this calendar year in Cairo unless asked, every contract version whose term touches it, filtered as the
// Contracts page filters (status, employment type, length, ending within, a search) and by department or team, one row
// per employment or every version, and the totals; no pay. HR, Finance and the CEO, as the Contracts page (GET
// /contracts). Every workbook downloaded is in the audit log, with its period and whose contracts it has, as the Salary
// Raises report's. The C-level people (owner, 19 October 2026: "make C level Employees details not visible to HR") only
// for the CEO and a Super Admin: left out for anyone else, the totals too, `confidentialExcluded` saying how many.
@Injectable()
export class ContractsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  async report(query: ContractsReportQueryDto, user: SessionUser): Promise<ContractsReport & { generatedAt: string; confidentialExcluded: number }> {
    const today = todayInCairo();
    const period = requestedPeriod(query, today);
    const problem = periodProblem(period);
    if (problem) throw new BadRequestException(problem);
    const { start, end } = periodDays(period);
    const filters: ContractsReportFilters = {
      period,
      status: query.status ?? CONTRACTS_REPORT_STATUS_DEFAULT,
      show: query.show ?? CONTRACTS_REPORT_SHOW_DEFAULT,
      employmentType: query.type ?? null,
      form: query.form ?? null,
      departmentId: query.departmentId ?? null,
      endingWithin: query.endingWithin ?? null,
      q: query.q ?? null,
    };

    // the employments with a version in the period: its term touching it, or signed in it (a renewal signed ahead of
    // its start, for the totals); the filters themselves are applied to each version by the shared code
    const inPeriod: Prisma.EmploymentWhereInput = {
      contracts: {
        some: {
          OR: [
            { startDate: { lte: toDateOnly(end) }, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(start) } }] },
            { signedOn: { gte: toDateOnly(start), lte: toDateOnly(end) } },
          ],
        },
      },
    };
    const inPlace: Prisma.EmploymentWhereInput = filters.departmentId ? { OR: [{ departmentId: filters.departmentId }, { department: { parentId: filters.departmentId } }] } : {};
    const text = filters.q ? { contains: filters.q, mode: 'insensitive' as const } : null;
    const hidden = await this.confidential.hiddenFrom(user);
    const [rows, confidentialRows, department] = await Promise.all([
      this.prisma.employment.findMany({
        where: {
          AND: [
            inPeriod,
            inPlace,
            hidden.length ? { employeeId: { notIn: hidden } } : {},
            query.type ? { employmentType: query.type } : {},
            text ? { OR: [{ employee: { OR: [{ fullNameEn: text }, { fullNameAr: text }, { employeeCode: text }] } }, { contracts: { some: { number: text } } }] } : {},
          ],
        },
        select: EMPLOYMENT,
      }),
      // the C-level people the report would have, left out for the caller
      hidden.length ? this.prisma.employment.findMany({ where: { AND: [inPeriod, inPlace, { employeeId: { in: hidden } }] }, select: EMPLOYMENT }) : [],
      filters.departmentId ? this.prisma.department.findUnique({ where: { id: filters.departmentId }, ...PLACE }) : null,
    ]);
    if (filters.departmentId && !department) throw new BadRequestException('Choose the department or team from the list.');

    const report = contractsReport(rows.map(employmentOf), filters, today);
    // counted by the period, the status and the place only (a C-level person's department is on their directory card):
    // a search, the length, the type or "ending within" would tell what their contract says
    const confidential = contractsReport(confidentialRows.map(employmentOf), { ...filters, q: null, form: null, employmentType: null, endingWithin: null, show: 'every' }, today);
    const { departmentId: _id, ...used } = filters;
    return {
      generatedAt: new Date().toISOString(),
      filters: { ...used, department },
      rows: report.rows,
      totals: report.totals,
      confidentialExcluded: new Set(confidential.rows.map((r) => r.employee.id)).size,
    };
  }

  /** The report as an Excel workbook, named with its period; the download is in the audit log. Without the C-level people, as the report. */
  async workbook(query: ContractsReportQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.report(query, user);
    const data = await contractsReportWorkbook(report);
    const f = report.filters;
    await this.audit.record({
      userId: user.id,
      action: 'contracts_report_file',
      entityType: ENTITY,
      diff: {
        from: f.period.from,
        to: f.period.to,
        status: f.status,
        show: f.show,
        contracts: report.rows.length,
        employees: [...new Set(report.rows.map((r) => r.employee.employeeCode))],
      },
    });
    return { fileName: contractsReportFileName(f.period), data };
  }
}
