import { Controller, Get, Header, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { XLSX_TYPE } from '../payroll/bank-files.js';
import { attachment } from '../templates/template-file.js';
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
  ) {}

  /** ?month=YYYY-MM&departmentId=&employeeId=&only=absences|short_hours|missing_check_outs|remote|zoho_leave: everyone's, or the caller's team. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  month(@Query() query: AttendanceListQueryDto, @CurrentUser() user: SessionUser) {
    return this.attendance.month(query, user);
  }

  /** The caller's own month (?month=). */
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  mine(@Query() query: AttendanceMonthQueryDto, @CurrentUser() user: SessionUser) {
    return this.attendance.mine(query.month, user);
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

  /** One person's month (?month=). */
  @Get('employees/:employeeId')
  @Header('Cache-Control', 'private, no-store')
  person(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: AttendanceMonthQueryDto, @CurrentUser() user: SessionUser) {
    return this.attendance.person(employeeId, query.month, user);
  }
}
