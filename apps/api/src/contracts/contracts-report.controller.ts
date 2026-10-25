import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { ContractsReportQueryDto } from './contracts-report.dto.js';
import { ContractsReportService } from './contracts-report.service.js';

// The Contracts report (owner, 25 October 2026: "A report under Reports", "Dates and status"): HR, Finance and the CEO,
// as the Contracts page (an Admin or Super Admin only with one of those roles too). ?from=YYYY-MM&to=YYYY-MM, this
// calendar year unless sent; ?status=, ?show=, ?type=, ?form=, ?departmentId=, ?endingWithin= and ?q= filter.
@Controller('reports')
export class ContractsReportController {
  constructor(private readonly contractsReport: ContractsReportService) {}

  /** { generatedAt, filters, rows, totals, confidentialExcluded } (packages/shared contracts-report.ts). */
  @Roles('hr', 'finance', 'ceo')
  @Get('contracts')
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: ContractsReportQueryDto, @CurrentUser() user: SessionUser) {
    return this.contractsReport.report(query, user);
  }

  /** The same as an Excel workbook: "Contracts 2026-01 to 2026-12.xlsx". Never for a developer. */
  @Roles('hr', 'finance', 'ceo')
  @NotForDevelopers()
  @Get('contracts.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: ContractsReportQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.contractsReport.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
