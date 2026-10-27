import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { attachment } from '../../templates/template-file.js';
import { XLSX_TYPE } from '../bank-files.js';
import { SiContributionsQueryDto, SiDepartmentQueryDto, SiRegisterQueryDto } from './social-insurance.dto.js';
import { SocialInsuranceReportService } from './social-insurance.service.js';

// The Social Insurance report (owner, 27 October 2026: "is there a report for the social insurance? to be filled from the
// social insurance tab"; he chose all three views). The register and the month's contributions are salary data, so HR,
// Finance and the CEO, as the Payroll vs Social Insurance report (an Admin or Super Admin only with one of those roles
// too); the missing data names the employee file's forms and print, so HR and the CEO, as Missing Details. Each view's
// workbook never for a developer. ?departmentId= on each, ?status= on the register, ?month=YYYY-MM on the contributions.
@Controller('payroll/social-insurance')
export class SocialInsuranceReportController {
  constructor(private readonly report: SocialInsuranceReportService) {}

  /** { view, generatedAt, today, filters, rates, insuranceBasicDefault, seesIdentity, seesFile, rows, totals, notRegistered, confidentialExcluded } */
  @Roles('hr', 'finance', 'ceo')
  @Get('register')
  @Header('Cache-Control', 'private, no-store')
  register(@Query() query: SiRegisterQueryDto, @CurrentUser() user: SessionUser) {
    return this.report.register(query, user);
  }

  /** The register as an Excel workbook: "Social insurance register 2026-10-27.xlsx". */
  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get('register/workbook')
  @Header('Cache-Control', 'private, no-store')
  async registerWorkbook(@Query() query: SiRegisterQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.report.workbook('register', query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** { view, generatedAt, month, filters, rates, insureEveryone, rows, totals, notRegistered, confidentialExcluded } */
  @Roles('hr', 'finance', 'ceo')
  @Get('contributions')
  @Header('Cache-Control', 'private, no-store')
  contributions(@Query() query: SiContributionsQueryDto, @CurrentUser() user: SessionUser) {
    return this.report.contributions(query, user);
  }

  /** The month's contributions as an Excel workbook: "Social insurance contributions 2026-10.xlsx". */
  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get('contributions/workbook')
  @Header('Cache-Control', 'private, no-store')
  async contributionsWorkbook(@Query() query: SiContributionsQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.report.workbook('contributions', query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** { view, generatedAt, today, filters, rows, checked, byItem, confidentialExcluded } */
  @Roles('hr', 'ceo')
  @Get('missing')
  @Header('Cache-Control', 'private, no-store')
  missing(@Query() query: SiDepartmentQueryDto, @CurrentUser() user: SessionUser) {
    return this.report.missing(query, user);
  }

  /** The missing data as an Excel workbook: "Social insurance missing data 2026-10-27.xlsx". */
  @Roles('hr', 'ceo')
  @NotForDevelopers()
  @Get('missing/workbook')
  @Header('Cache-Control', 'private, no-store')
  async missingWorkbook(@Query() query: SiDepartmentQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.report.workbook('missing', query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
