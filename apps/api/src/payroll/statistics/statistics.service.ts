import { BadRequestException, Injectable } from '@nestjs/common';
import { payrollStatistics, periodProblem, requestedPeriod, type PayrollStatistics, type PayrollStatus, type StatisticsRun } from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { toDateOnly, todayInCairo } from '../../common/date-only.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { firstDay } from '../months.js';
import { monthOf } from '../views.js';
import type { StatisticsQueryDto } from './statistics.dto.js';
import { statisticsFileName, statisticsWorkbook } from './statistics-workbook.js';

const ENTITY = 'payroll_statistics';

/** What the statistics read of each line: its totals, its department and whether it was held. */
const LINE_SELECT = {
  employeeId: true,
  department: true,
  onHold: true,
  earned: true,
  allowances: true,
  net: true,
  transfer: true,
  monthlyTax: true,
  employeeInsurance: true,
  employerInsurance: true,
  martyrsFund: true,
  companyCost: true,
} as const;

// Payroll statistics (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Overview -
// Unsettled - Additions / Deductions - Reports (Statistics)"): for a period of months, this calendar year in Cairo unless
// asked, what the runs the CEO approved (approved or paid) paid and cost, by month, department and team, with the
// average and median gross and this year to date (packages/shared payroll-statistics.ts), from the lines' own totals,
// so the figures are the runs' and the register's. Salary data, restricted like the register: HR, Finance and the CEO.
// Every workbook downloaded is in the audit log, with its period and the months in it. Without the C-level people's
// lines for anyone but the CEO and a Super Admin (owner, 19 October 2026: "make C level Employees details not visible to
// HR"), so no total, department or average singles them out: `confidentialExcluded` says how many are left out.
@Injectable()
export class PayrollStatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  async report(query: StatisticsQueryDto, user: SessionUser): Promise<PayrollStatistics & { generatedAt: string; confidentialExcluded: number }> {
    const today = todayInCairo();
    const period = requestedPeriod(query, today);
    const problem = periodProblem(period);
    if (problem) throw new BadRequestException(problem);

    // the period's runs, and this year's to date
    const ytdFrom = `${today.slice(0, 4)}-01`;
    const from = period.from < ytdFrom ? period.from : ytdFrom;
    const to = period.to > today.slice(0, 7) ? period.to : today.slice(0, 7);
    const rows = await this.prisma.payrollRun.findMany({
      where: { month: { gte: toDateOnly(firstDay(from)), lte: toDateOnly(firstDay(to)) } },
      orderBy: { month: 'asc' },
      select: { id: true, month: true, status: true, lines: { select: LINE_SELECT } },
    });
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const excluded = new Set(rows.flatMap((r) => r.lines.filter((l) => hidden.has(l.employeeId)).map((l) => l.employeeId)));
    const runs: StatisticsRun[] = rows.map((r) => ({
      id: r.id,
      month: monthOf(r),
      status: r.status as PayrollStatus,
      lines: r.lines.filter((l) => !hidden.has(l.employeeId)).map((l) => ({
        employeeId: l.employeeId,
        department: l.department,
        onHold: l.onHold,
        earned: l.earned.toNumber(),
        allowances: l.allowances.toNumber(),
        net: l.net.toNumber(),
        transfer: l.transfer.toNumber(),
        monthlyTax: l.monthlyTax.toNumber(),
        employeeInsurance: l.employeeInsurance.toNumber(),
        employerInsurance: l.employerInsurance.toNumber(),
        martyrsFund: l.martyrsFund.toNumber(),
        companyCost: l.companyCost.toNumber(),
      })),
    }));
    return { generatedAt: new Date().toISOString(), ...payrollStatistics(runs, period, today), confidentialExcluded: excluded.size };
  }

  /** The statistics as an Excel workbook, named with its period; the download is in the audit log. Without the C-level people, as the report. */
  async workbook(query: StatisticsQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.report(query, user);
    const data = await statisticsWorkbook(report);
    await this.audit.record({
      userId: user.id,
      action: 'payroll_statistics_file',
      entityType: ENTITY,
      diff: { from: report.period.from, to: report.period.to, months: report.months.map((m) => m.month) },
    });
    return { fileName: statisticsFileName(report.period), data };
  }
}
