import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OPEN_RAISE_REQUEST_STATUSES,
  payEvents,
  periodDays,
  periodProblem,
  requestedPeriod,
  SALARY_REVIEW_MONTHS_DEFAULT,
  salaryRaisesReport,
  type RaiseRequestStatus,
  type ReportEmployment,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, toDateOnly, todayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { PLACE } from '../employees/employees.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SalaryRaisesQueryDto } from './raises.dto.js';
import { approverNames, PAY_VERSIONS, payVersion } from './salary-history.service.js';
import { salaryRaisesFileName, salaryRaisesWorkbook } from './salary-raises-workbook.js';

const ENTITY = 'salary_raises_report';

/**
 * What the report reads of each employment: its person and place now, an ending in progress, and its versions as the
 * Salary History reads them.
 */
const EMPLOYMENT = {
  id: true,
  joinDate: true,
  endDate: true,
  employee: { select: { id: true, employeeCode: true, fullNameEn: true, fullNameAr: true } },
  department: PLACE.department,
  jobTitle: { select: { titleEn: true } },
  endings: { where: { status: { in: ['pending_ceo', 'approved'] } }, select: { id: true } },
  contracts: PAY_VERSIONS,
} satisfies Prisma.EmploymentSelect;

// The Salary Raises report (owner's decision, 16 October 2026: the salary raises tracked both on each profile's Salary
// History and in a company-wide report; packages/shared salary-raises.ts): for a period of months, this calendar year in
// Cairo unless asked, every signed pay change that took effect in it, the totals, by department, and who is due for a
// salary review after the payroll settings' "Salary review due after" months. Each employment's versions are read as
// the Salary History reads them (PAY_VERSIONS, payVersion, payEvents), so its figures are each person's. Salary data:
// HR, Finance and the CEO. Every workbook downloaded is in the audit log, with its period and whose raises it has. The
// C-level people (owner, 19 October 2026: "make C level Employees details not visible to HR") only for the CEO and a
// Super Admin: left out for anyone else, totals and departments too, `confidentialExcluded` saying how many.
@Injectable()
export class SalaryRaisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  async report(query: SalaryRaisesQueryDto, user: SessionUser) {
    const today = todayInCairo();
    const period = requestedPeriod(query, today);
    const problem = periodProblem(period);
    if (problem) throw new BadRequestException(problem);
    const { start, end } = periodDays(period);

    const hidden = await this.confidential.hiddenFrom(user);
    const inReport: Prisma.EmploymentWhereInput = { OR: [{ endDate: null }, { contracts: { some: { approval: { not: null }, startDate: { gte: toDateOnly(start), lte: toDateOnly(end) } } } }] };
    // the current employments (who may be due for review), and the ended ones with a change of pay in the period
    const [rows, settings, requests, excluded] = await Promise.all([
      this.prisma.employment.findMany({
        where: { ...inReport, ...(hidden.length && { employeeId: { notIn: hidden } }) },
        orderBy: [{ employee: { employeeCode: 'asc' } }, { joinDate: 'asc' }],
        select: EMPLOYMENT,
      }),
      // the one settings row, added by the payroll migration and the seed; its default if it is missing
      this.prisma.payrollSettings.findUnique({ where: { id: 1 }, select: { salaryReviewMonths: true } }),
      // the requests asked for: one prepared directly by HR is its raise, open already (19 October 2026)
      this.prisma.raiseRequest.findMany({ where: { origin: 'request', status: { in: [...OPEN_RAISE_REQUEST_STATUSES] } }, select: { id: true, employmentId: true, status: true } }),
      // the C-level people the report would have, left out for the caller
      hidden.length ? this.prisma.employment.findMany({ where: { ...inReport, employeeId: { in: hidden } }, select: { employeeId: true }, distinct: ['employeeId'] }) : [],
    ]);
    const names = await approverNames(this.prisma, rows.flatMap((e) => e.contracts));
    const open = new Map(requests.map((r) => [r.employmentId, { id: r.id, status: r.status as RaiseRequestStatus }]));

    const employments: ReportEmployment[] = rows.map((e) => ({
      employee: e.employee,
      employmentId: e.id,
      department: e.department && { id: e.department.id, nameEn: e.department.nameEn, parent: e.department.parent && { id: e.department.parent.id, nameEn: e.department.parent.nameEn } },
      jobTitle: e.jobTitle?.titleEn ?? null,
      joinDate: fromDateOnly(e.joinDate),
      endDate: fromDateOnly(e.endDate),
      ending: e.endings.length > 0,
      events: payEvents(e.contracts.map((c) => payVersion(c, names))),
      signedJobTitles: Object.fromEntries(e.contracts.map((c) => [c.id, c.jobTitleEn])),
      openRequest: open.get(e.id) ?? null,
    }));
    return {
      generatedAt: new Date().toISOString(),
      ...salaryRaisesReport(employments, period, today, settings?.salaryReviewMonths ?? SALARY_REVIEW_MONTHS_DEFAULT),
      confidentialExcluded: excluded.length,
    };
  }

  /** The report as an Excel workbook, named with its period; the download is in the audit log. Without the C-level people, as the report. */
  async workbook(query: SalaryRaisesQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.report(query, user);
    const data = await salaryRaisesWorkbook(report);
    await this.audit.record({
      userId: user.id,
      action: 'salary_raises_file',
      entityType: ENTITY,
      diff: {
        from: report.period.from,
        to: report.period.to,
        raises: report.raises.length,
        employees: [...new Set(report.raises.map((r) => r.employee.employeeCode))],
        dueForReview: report.dueForReview.length,
      },
    });
    return { fileName: salaryRaisesFileName(report.period), data };
  }
}
