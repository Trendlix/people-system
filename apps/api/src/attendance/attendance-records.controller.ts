import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, DeletesRecords, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ChooseDaySourceDto, DayRecordsQueryDto, RemoveRecordDto } from './attendance-records.dto.js';
import { AttendanceRecordsService } from './attendance-records.service.js';

// A person's attendance records (owner, 31 October 2026: "is there a way to check the checkin records? even if imported
// from zoho and delete one of them?" — "as a super admin"; "zoho or system"): a day's records for those who see the
// person's month; removing one, putting it back and choosing which source a day uses, a Super Admin's only (as every
// deletion is), with a reason, never in a month whose payroll is with the CEO, approved or paid.
@Controller('attendance')
export class AttendanceRecordsController {
  constructor(private readonly records: AttendanceRecordsService) {}

  /** A day's records (?date=), the system's and Zoho's, and which source counts; the removed ones a Super Admin's. */
  @Get('employees/:employeeId/records')
  @Header('Cache-Control', 'private, no-store')
  day(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: DayRecordsQueryDto, @CurrentUser() user: SessionUser) {
    return this.records.day(employeeId, query.date, user);
  }

  /** { date, source: system | zoho, recordId, reason }: one record removed, the day made again without it. */
  @DeletesRecords()
  @Post('employees/:employeeId/records/remove')
  @HttpCode(200)
  remove(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: RemoveRecordDto, @CurrentUser() user: SessionUser) {
    return this.records.remove(employeeId, dto, user);
  }

  /** A record removed put back as it was. */
  @Roles('super_admin')
  @Post('records/removals/:id/restore')
  @HttpCode(200)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.records.restore(id, user);
  }

  /** { date, source: zoho | system, reason }: the source a day with both uses. */
  @Roles('super_admin')
  @Put('employees/:employeeId/day-source')
  choose(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: ChooseDaySourceDto, @CurrentUser() user: SessionUser) {
    return this.records.choose(employeeId, dto.date, dto, user);
  }

  /** ?date=: back to the usual source for the day. */
  @Roles('super_admin')
  @Delete('employees/:employeeId/day-source')
  clear(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() query: DayRecordsQueryDto, @CurrentUser() user: SessionUser) {
    return this.records.clearChoice(employeeId, query.date, user);
  }
}
