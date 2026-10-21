import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { DecideLeaveDto } from '../leave/leave.dto.js';
import { CreateWfhDto, HrCancelWfhDto, ListWfhDto, RecordWfhDto, UpdateWfhSettingsDto, WfhCalendarQueryDto, WfhCheckQueryDto, WfhMonthQueryDto } from './wfh.dto.js';
import { WfhService } from './wfh.service.js';

// Working from home (owner, 21 October 2026: "think about how should we handle the working from home in out erp";
// packages/shared wfh.ts). The employee's own: their days, their month as the form shows it, a new request and
// cancelling one while it is being decided. Deciding and seeing them: the request's approver in charge and HR in turn,
// the CEO reading them and deciding a C-level person's HR stage (checked by the service, which tells anyone else a
// request isn't there); the counts, the calendar. HR records a day for someone (with a reason, past the notice and the
// limits, with the warnings) and cancels an approved one; the Leave Setup's limits, read by anyone, changed by HR.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/wfh')
export class MyWfhController {
  constructor(private readonly wfh: WfhService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.wfh.mine(user);
  }

  /** ?month=YYYY-MM: the month's days taken of the Leave Setup's, the days around it, the next day possible. */
  @Get('allowance')
  @Header('Cache-Control', 'private, no-store')
  allowance(@Query() query: WfhMonthQueryDto, @CurrentUser() user: SessionUser) {
    return this.wfh.allowance(query.month, user);
  }

  /** { date, reason? }. */
  @Post()
  create(@Body() dto: CreateWfhDto, @CurrentUser() user: SessionUser) {
    return this.wfh.create(dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.wfh.cancelMine(id, user);
  }
}

@Controller('wfh')
export class WfhController {
  constructor(private readonly wfh: WfhService) {}

  /**
   * ?status=<a status, or waiting>&employeeId=&departmentId=&source=&from=&to=: HR and the CEO everyone's; a manager or
   * lead those sent to them and their team's.
   */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListWfhDto, @CurrentUser() user: SessionUser) {
    return this.wfh.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  @Header('Cache-Control', 'private, no-store')
  counts(@CurrentUser() user: SessionUser) {
    return this.wfh.counts(user);
  }

  /** ?from=&to=&departmentId=: the days on the leave calendar, as far as the caller sees requests. */
  @Get('calendar')
  @Header('Cache-Control', 'private, no-store')
  calendar(@Query() query: WfhCalendarQueryDto, @CurrentUser() user: SessionUser) {
    return this.wfh.calendar(query, user);
  }

  /** The Leave Setup's limits: { daysPerMonth, minGapDays }. */
  @Get('settings')
  settings() {
    return this.wfh.settings();
  }

  /** HR changes the limits: { daysPerMonth?, minGapDays? }. */
  @Roles('hr')
  @Patch('settings')
  updateSettings(@Body() dto: UpdateWfhSettingsDto, @CurrentUser() user: SessionUser) {
    return this.wfh.updateSettings(dto, user);
  }

  /** ?employeeId=&date=: what refuses a day HR would record for someone, and what it would be recorded past. */
  @Roles('hr')
  @Get('check')
  @Header('Cache-Control', 'private, no-store')
  @ConfidentialOf('employee', { query: 'employeeId' })
  check(@Query() query: WfhCheckQueryDto, @CurrentUser() user: SessionUser) {
    return this.wfh.check(query, user);
  }

  /** HR records a day for someone, approved at once: { employeeId, date, reason }. */
  @Roles('hr')
  @Post()
  @ConfidentialOf('employee', { body: 'employeeId' })
  record(@Body() dto: RecordWfhDto, @CurrentUser() user: SessionUser) {
    return this.wfh.record(dto, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.wfh.one(id, user);
  }

  /** { decision: approve | reject, comment? (required to reject) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: SessionUser) {
    return this.wfh.decide(id, dto, user);
  }

  /** HR cancels an approved day: { comment }. */
  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrCancelWfhDto, @CurrentUser() user: SessionUser) {
    return this.wfh.hrCancel(id, dto, user);
  }
}
