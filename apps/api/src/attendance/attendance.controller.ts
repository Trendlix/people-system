import { Controller, Get, Header, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
import { AttendanceHistoryQueryDto } from './attendance-history.dto.js';
import { AttendanceHistoryService } from './attendance-history.service.js';
import { AttendanceImportsService } from './attendance-imports.service.js';
import { AttendanceImportsQueryDto, AttendanceListQueryDto, AttendanceMonthQueryDto, AttendanceSummaryQueryDto } from './attendance.dto.js';
import { AttendanceService } from './attendance.service.js';

// The Attendance section's reads (owner, 19 October 2026: "the attendance is not active in the side menu"): Daily
// Attendance and a manager's team (GET /attendance), a person's month, the caller's own, the Summary and its workbook,
// and every Zoho import across the runs. HR, the CEO and Finance see everyone's (Finance read only: nothing here
// changes anything), a manager or a lead their team's, everyone their own; a C-level person only the CEO, the Super
// Admin and themself (the service decides each). Importing stays on the month's draft payroll run
// (attendance-imports.controller.ts).
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly imports: AttendanceImportsService,
    private readonly historyOf: AttendanceHistoryService,
  ) {}

  /** ?month=YYYY-MM&departmentId=&employeeId=&only=absences|short_hours|missing_check_outs|remote|zoho_leave: everyone's, or the caller's team. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  month(@Query() query: AttendanceListQueryDto, @CurrentUser() user: SessionUser) {
    return this.attendance.month(query, user);
  }

  /**
   * The caller's own month (?month=), with their attendance rate through it (owner, 31 October 2026: "show the weekly
   * attendance percentage and monthly percentage ongoing through the month"): the month so far and each of its weeks.
   */
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  async mine(@Query() query: AttendanceMonthQueryDto, @CurrentUser() user: SessionUser) {
    const view = await this.attendance.mine(query.month, user);
    return { ...view, rates: await this.historyOf.myRates(user, view.month) };
  }

  /** ?month= or ?from=&to=: by department and team. */
  @Roles('hr', 'ceo', 'finance')
  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  summary(@Query() query: AttendanceSummaryQueryDto, @CurrentUser() user: SessionUser) {
    return this.attendance.summary(query, user);
  }

  /** The Summary as an Excel workbook: "Attendance 2026-10.xlsx". */
  @Roles('hr', 'ceo', 'finance')
  @NotForDevelopers()
  @Get('summary.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async workbook(@Query() query: AttendanceSummaryQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.attendance.workbook(query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** Every import across the runs, the latest first (?month= for one month's). */
  @Roles('hr', 'ceo', 'finance')
  @Get('imports')
  @Header('Cache-Control', 'private, no-store')
  history(@Query() query: AttendanceImportsQueryDto) {
    return this.imports.history(query.month);
  }

  /**
   * One person's attendance history (owner, 23 October 2026: "Attendance history on the profile"; "HR, CEO and Finance
   * only", the Super Admin too; a C-level person's the CEO's and the Super Admin's): ?period=&from=&to=&only=&page=. The
   * service answers anyone else 404.
   */
  @Get('employees/:employeeId/history')
  @Header('Cache-Control', 'private, no-store')
  personHistory(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: AttendanceHistoryQueryDto, @CurrentUser() user: SessionUser) {
    return this.historyOf.history(employeeId, query, user);
  }

  /** The history as an Excel workbook: "Attendance history EMP-0182 2026-01-01 to 2026-10-23.xlsx"; audited. */
  @NotForDevelopers()
  @Get('employees/:employeeId/history.xlsx')
  @Header('Cache-Control', 'private, no-store')
  async personHistoryWorkbook(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: AttendanceHistoryQueryDto, @CurrentUser() user: SessionUser): Promise<StreamableFile> {
    const file = await this.historyOf.workbook(employeeId, query, user);
    return new StreamableFile(file.data, { type: XLSX_TYPE, length: file.data.length, disposition: attachment(file.fileName) });
  }

  /** One person's month (?month=). */
  @Get('employees/:employeeId')
  @Header('Cache-Control', 'private, no-store')
  async person(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: AttendanceMonthQueryDto, @CurrentUser() user: SessionUser) {
    // their month as the caller may see it (refused here otherwise), with their attendance rate through it (31 October 2026)
    const view = await this.attendance.person(employeeId, query.month, user);
    return { ...view, rates: await this.historyOf.ratesOf(employeeId, view.month) };
  }
}
