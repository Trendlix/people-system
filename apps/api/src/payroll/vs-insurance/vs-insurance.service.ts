import { BadRequestException, Injectable } from '@nestjs/common';
import {
  payrollVsInsurance,
  periodProblem,
  requestedLeavePeriod,
  type PayrollRules,
  type PayrollStatus,
  type PayrollVsInsurance,
  type ReportPeriod,
  type VsInsuranceSourceRun,
} from '@trendlix/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { SessionUser } from '../../auth/session-user.js';
import { toDateOnly, todayInCairo } from '../../common/date-only.js';
import { ConfidentialService } from '../../employees/confidential.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { savedInputs } from '../line-work.js';
import { firstDay } from '../months.js';
import { monthOf, runLawRates } from '../views.js';
import type { VsInsuranceQueryDto } from './vs-insurance.dto.js';
import { vsInsuranceFileName, vsInsuranceWorkbook } from './vs-insurance-workbook.js';

const ENTITY = 'payroll_vs_insurance';

/** What the report reads of each line: who, what it was worked out from and what it came to. */
const LINE_SELECT = {
  id: true,
  employeeId: true,
  employeeCode: true,
  nameEn: true,
  department: true,
  jobTitle: true,
  employmentType: true,
  payBasis: true,
  onHold: true,
  terms: true,
  inputs: true,
  result: true,
} satisfies Prisma.PayrollLineSelect;

/** The report as the API sends it: with the moment it was made and how many C-level people are left out for the caller. */
export type VsInsuranceReport = PayrollVsInsurance & { generatedAt: string; confidentialExcluded: number };

// The Payroll vs Social Insurance report (owner, 26 October 2026: "i want a comparison report between the actual payroll
// run and the social insurance data, and the differences in the social insurance and taxes between the 2 runs"; asked
// which two figures: "actual gross and the whole cycle vs the social insurance gross with the whole cycle"; packages/shared
// payroll-vs-insurance.ts): for a period of months (the latest run's month unless asked; this month when there is no run
// yet), every run of the period whatever its status, each marked with it, and per line the actual cycle as the run
// stored it beside the same month worked out by the same engine on the registered insured wage, with the run's own copied
// rules and rates set by law, and the differences. Salary data, restricted like the register: HR, Finance and the CEO.
// Every workbook downloaded is in the audit log, with its period, its runs and whose lines it has. Without the C-level
// people's lines for anyone but the CEO and a Super Admin (owner, 19 October 2026: "make C level Employees details not
// visible to HR"), the totals too: `confidentialExcluded` says how many are left out. A developer gets the figures masked
// (the interceptor), and never the workbook.
@Injectable()
export class PayrollVsInsuranceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly confidential: ConfidentialService,
  ) {}

  async report(query: VsInsuranceQueryDto, user: SessionUser): Promise<VsInsuranceReport> {
    const today = todayInCairo();
    const { period, defaulted } = await this.period(query, today);
    const problem = periodProblem(period);
    if (problem) throw new BadRequestException(problem);

    const runs = await this.prisma.payrollRun.findMany({
      where: { month: { gte: toDateOnly(firstDay(period.from)), lte: toDateOnly(firstDay(period.to)) } },
      orderBy: { month: 'asc' },
      select: {
        id: true,
        month: true,
        status: true,
        rules: true,
        lawRates: true,
        lines: { select: LINE_SELECT, orderBy: [{ department: { sort: 'asc', nulls: 'last' } }, { nameEn: 'asc' }] },
      },
    });
    const hidden = new Set(await this.confidential.hiddenFrom(user));
    const excluded = new Set(runs.flatMap((r) => r.lines.filter((l) => hidden.has(l.employeeId)).map((l) => l.employeeId)));
    const sources: VsInsuranceSourceRun[] = runs.map((r) => ({
      id: r.id,
      month: monthOf(r),
      status: r.status as PayrollStatus,
      rules: r.rules as unknown as PayrollRules,
      law: runLawRates(r),
      lines: r.lines
        .filter((l) => !hidden.has(l.employeeId))
        .map((l) => ({
          id: l.id,
          employeeId: l.employeeId,
          employeeCode: l.employeeCode,
          nameEn: l.nameEn,
          department: l.department,
          jobTitle: l.jobTitle,
          employmentType: l.employmentType,
          payBasis: l.payBasis as VsInsuranceSourceRun['lines'][number]['payBasis'],
          onHold: l.onHold,
          terms: l.terms as unknown as VsInsuranceSourceRun['lines'][number]['terms'],
          // the grid's figures of a line saved before 17 October 2026 stay with it, as the run reads them
          inputs: { ...savedInputs(l.inputs), ...(l.inputs as object) } as VsInsuranceSourceRun['lines'][number]['inputs'],
          result: l.result as unknown as VsInsuranceSourceRun['lines'][number]['result'],
        })),
    }));
    return { generatedAt: new Date().toISOString(), period, defaulted, ...payrollVsInsurance(sources), confidentialExcluded: excluded.size };
  }

  /** The report as an Excel workbook, named with its period; the download is in the audit log. Without the C-level people, as the report. */
  async workbook(query: VsInsuranceQueryDto, user: SessionUser): Promise<{ fileName: string; data: Buffer }> {
    const report = await this.report(query, user);
    const data = await vsInsuranceWorkbook(report);
    await this.audit.record({
      userId: user.id,
      action: 'payroll_vs_insurance_file',
      entityType: ENTITY,
      diff: {
        from: report.period.from,
        to: report.period.to,
        runs: report.runs.map((r) => r.month),
        employees: [...new Set(report.rows.map((r) => r.employee.employeeCode))],
      },
    });
    return { fileName: vsInsuranceFileName(report.period), data };
  }

  /**
   * The period asked for: the months sent (one of them alone: that month), else the latest run's month, whatever its
   * status ("defaulting to the latest run"), else this month in Cairo when there is no run yet.
   */
  private async period(query: VsInsuranceQueryDto, today: string): Promise<{ period: ReportPeriod; defaulted: PayrollVsInsurance['defaulted'] }> {
    if (query.from || query.to) return { period: requestedLeavePeriod(query, today), defaulted: null };
    const latest = await this.prisma.payrollRun.findFirst({ orderBy: { month: 'desc' }, select: { month: true } });
    const month = latest ? monthOf(latest) : today.slice(0, 7);
    return { period: { from: month, to: month }, defaulted: latest ? 'latest_run' : 'this_month' };
  }
}
