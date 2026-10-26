import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { DecideLeaveDto } from '../leave/leave.dto.js';
import { CreateOdDto, HrCancelOdDto, ListOdDto, OdCalendarQueryDto, OdCheckQueryDto, RecordOdDto } from './od.dto.js';
import { OdService } from './od.service.js';

// Official duty (owner, 23 October 2026: "Official duty (OD) requests"; packages/shared official-duty.ts). The
// employee's own: their requests, what the form reads first, a new request and cancelling one while it is being decided.
// Deciding and seeing them: the request's approver in charge and HR in turn, the CEO reading them and deciding a C-level
// person's HR stage (checked by the service, which tells anyone else a request isn't there); the counts, the calendar.
// HR cancels an approved one, saying why. HR records one for someone (owner, 26 October 2026: "HR records it"), approved
// at once and past the 3-day limit too, a C-level person's the CEO (checked by the service): what it would meet first.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/official-duty')
export class MyOdController {
  constructor(private readonly od: OdService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.od.mine(user);
  }

  /** Today, the earliest first day (3 days ago), their shift and why they can't ask. */
  @Get('form')
  @Header('Cache-Control', 'private, no-store')
  form(@CurrentUser() user: SessionUser) {
    return this.od.form(user);
  }

  /** { startDate, endDate?, fullDay?, fromTime?, toTime?, place, reason }. */
  @Post()
  create(@Body() dto: CreateOdDto, @CurrentUser() user: SessionUser) {
    return this.od.create(dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.od.cancelMine(id, user);
  }
}

@Controller('official-duty')
export class OdController {
  constructor(private readonly od: OdService) {}

  /**
   * ?status=<a status, or waiting>&employeeId=&departmentId=&from=&to=&late=: HR and the CEO everyone's; a manager or
   * lead those sent to them and their team's.
   */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListOdDto, @CurrentUser() user: SessionUser) {
    return this.od.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  @Header('Cache-Control', 'private, no-store')
  counts(@CurrentUser() user: SessionUser) {
    return this.od.counts(user);
  }

  /** ?from=&to=&departmentId=: the official duties on the leave calendar, as far as the caller sees requests. */
  @Get('calendar')
  @Header('Cache-Control', 'private, no-store')
  calendar(@Query() query: OdCalendarQueryDto, @CurrentUser() user: SessionUser) {
    return this.od.calendar(query, user);
  }

  /** ?employeeId=&startDate=&endDate=&fullDay=&fromTime=&toTime=: what refuses official duty HR would record, and what it would be recorded past. */
  @Roles('hr', 'ceo')
  @Get('check')
  @Header('Cache-Control', 'private, no-store')
  @ConfidentialOf('employee', { query: 'employeeId' })
  check(@Query() query: OdCheckQueryDto, @CurrentUser() user: SessionUser) {
    return this.od.check(query, user);
  }

  /** HR records an official duty for someone, approved at once: { employeeId, startDate, endDate?, fullDay?, fromTime?, toTime?, place, reason }. */
  @Roles('hr', 'ceo')
  @Post()
  @ConfidentialOf('employee', { body: 'employeeId' })
  record(@Body() dto: RecordOdDto, @CurrentUser() user: SessionUser) {
    return this.od.record(dto, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.od.one(id, user);
  }

  /** { decision: approve | reject, comment? (required to reject) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: SessionUser) {
    return this.od.decide(id, dto, user);
  }

  /** HR cancels an approved official duty: { comment }. */
  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrCancelOdDto, @CurrentUser() user: SessionUser) {
    return this.od.hrCancel(id, dto, user);
  }
}
