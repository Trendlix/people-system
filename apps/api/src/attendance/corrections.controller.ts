import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { DecideLeaveDto } from '../leave/leave.dto.js';
import { CreateCorrectionDto, ListCorrectionsDto, RecordCorrectionDto } from './corrections.dto.js';
import { AttendanceCorrectionsService } from './corrections.service.js';

// Attendance corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"). The
// employee's own: their corrections, a new one and cancelling one. Deciding and seeing them: the correction's direct
// manager (or lead) and HR in turn, the CEO deciding a C-level person's HR stage (checked by the service, which tells
// anyone else a correction isn't there); HR corrects a day directly.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/attendance/corrections')
export class MyCorrectionsController {
  constructor(private readonly corrections: AttendanceCorrectionsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.corrections.mine(user);
  }

  /** { date, kind, checkIn?, checkOut?, reason }. */
  @Post()
  create(@Body() dto: CreateCorrectionDto, @CurrentUser() user: SessionUser) {
    return this.corrections.create(dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.corrections.cancelMine(id, user);
  }
}

@Controller('attendance/corrections')
export class AttendanceCorrectionsController {
  constructor(private readonly corrections: AttendanceCorrectionsService) {}

  /** ?status=<a status, or waiting>&employeeId=&month=: HR and the CEO everyone's; a manager or lead those sent to them and their team's. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListCorrectionsDto, @CurrentUser() user: SessionUser) {
    return this.corrections.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  @Header('Cache-Control', 'private, no-store')
  counts(@CurrentUser() user: SessionUser) {
    return this.corrections.counts(user);
  }

  /** HR corrects a day directly, approved at once: as the employee's request, with employeeId. */
  @Roles('hr')
  @Post()
  @ConfidentialOf('employee', { body: 'employeeId' })
  record(@Body() dto: RecordCorrectionDto, @CurrentUser() user: SessionUser) {
    return this.corrections.record(dto, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.corrections.one(id, user);
  }

  /** { decision: approve | reject, comment? (required to reject) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: SessionUser) {
    return this.corrections.decide(id, dto, user);
  }
}
