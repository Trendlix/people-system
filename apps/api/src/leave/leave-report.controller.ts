import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { LeaveReportQueryDto } from './leave-report.dto.js';
import { LeaveReportService } from './leave-report.service.js';

// The Leave report (owner, 26 October 2026: "can i get a report for the monthly leaves with all types?"): HR and the CEO,
// who see everyone's leave on Leave Requests (an Admin or Super Admin only with one of those roles too).
// ?from=YYYY-MM&to=YYYY-MM, this month unless sent; ?departmentId= and ?employeeId= filter.
@Controller('reports')
export class LeaveReportController {
  constructor(private readonly leaveReport: LeaveReportService) {}

  /** { generatedAt, balanceAsOf, filters, types, people, leaves, totals, confidentialExcluded } (packages/shared leave-report.ts). */
  @Roles('hr', 'ceo')
  @Get('leave')
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: LeaveReportQueryDto, @CurrentUser() user: SessionUser) {
    return this.leaveReport.report(query, user);
  }

  /** The same as an Excel workbook: "Leave 2026-10.xlsx". Never for a developer. */
  @Roles('hr', 'ceo')
  @NotForDevelopers()
  @Get('leave.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: LeaveReportQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.leaveReport.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }
}
