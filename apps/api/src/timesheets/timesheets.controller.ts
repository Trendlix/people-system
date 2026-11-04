import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { DecideTimesheetDto, ListTimesheetsDto, SaveTimesheetDto, TimesheetWeekQueryDto } from './timesheets.dto.js';
import { TimesheetsService } from './timesheets.service.js';

// Timesheets (owner, 4 November 2026: "Timesheet in app/website", "Direct manager, weekly"; packages/shared
// timesheets.ts). One's own week: read, its lines saved, sent; anyone signed in (the service refuses those who don't log
// hours, in words). The weeks to approve and read: the approver theirs, HR and the CEO everyone's (the service checks).

@Controller('me/timesheet')
export class MyTimesheetController {
  constructor(private readonly timesheets: TimesheetsService) {}

  /** ?week=YYYY-MM-DD (any day of it; none: this week). */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@Query() query: TimesheetWeekQueryDto, @CurrentUser() user: SessionUser) {
    return this.timesheets.mine(query.week, user);
  }

  /** { entries: [{ date, clientAccountId?, task?, hours, note? }] }: the week's lines, all of them. */
  @Put()
  save(@Query() query: TimesheetWeekQueryDto, @Body() dto: SaveTimesheetDto, @CurrentUser() user: SessionUser) {
    return this.timesheets.saveMine(query.week, dto, user);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@Query() query: TimesheetWeekQueryDto, @CurrentUser() user: SessionUser) {
    return this.timesheets.submitMine(query.week, user);
  }
}

@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  /** ?status=waiting (the default)|submitted|approved|rejected|all&week=&employeeId=. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListTimesheetsDto, @CurrentUser() user: SessionUser) {
    return this.timesheets.list(query, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.timesheets.one(id, user);
  }

  /** { decision: approve | reject, comment? (needed to reject) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideTimesheetDto, @CurrentUser() user: SessionUser) {
    return this.timesheets.decide(id, dto, user);
  }
}
