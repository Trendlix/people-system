import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { attachment } from '../../templates/template-file.js';
import { XLSX_TYPE } from '../bank-files.js';
import { VsInsuranceQueryDto } from './vs-insurance.dto.js';
import { PayrollVsInsuranceService } from './vs-insurance.service.js';

// The Payroll vs Social Insurance report (owner, 26 October 2026: "i want a comparison report between the actual payroll
// run and the social insurance data, and the differences in the social insurance and taxes between the 2 runs"): salary
// data, restricted like the payroll register and the statistics, so HR, Finance and the CEO (an Admin or Super Admin only
// with one of those roles too). ?from=YYYY-MM&to=YYYY-MM, the latest run's month unless sent.
@Controller('payroll/vs-insurance')
export class PayrollVsInsuranceController {
  constructor(private readonly report: PayrollVsInsuranceService) {}

  /** { generatedAt, period, defaulted, runs, rows, totals, confidentialExcluded } (packages/shared payroll-vs-insurance.ts). */
  @Roles('hr', 'finance', 'ceo')
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@Query() query: VsInsuranceQueryDto, @CurrentUser() user: SessionUser) {
    return this.report.report(query, user);
  }

  /** The same as an Excel workbook of three sheets: "Payroll vs social insurance 2026-09.xlsx". Never for a developer. */
  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get('workbook')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: VsInsuranceQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.report.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
