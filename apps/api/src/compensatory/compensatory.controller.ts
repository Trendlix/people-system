import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import {
  CompensatoryCalendarQueryDto,
  CompensatoryCheckQueryDto,
  CompensatoryFormQueryDto,
  CreateCompensatoryDto,
  DecideCompensatoryDto,
  HrCancelCompensatoryDto,
  ListCompensatoryDto,
  RecordCompensatoryDto,
  UpdateCompensatorySettingsDto,
} from './compensatory.dto.js';
import { CompensatoryService } from './compensatory.service.js';

// Compensatory days (owner, 26 October 2026: "my compensatory is a compensation with another day in the same month";
// packages/shared compensatory.ts). The employee's own: their requests, the form's live checks, a new request and
// cancelling one while it is being decided. Deciding and seeing them: the request's approver in charge and HR in turn,
// the CEO reading them and deciding a C-level person's HR stage (checked by the service, which tells anyone else a
// request isn't there); the counts, the calendar. HR records one for someone and cancels an approved one; the Leave
// Setup's cash rate, read by anyone, changed by HR.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/compensatory')
export class MyCompensatoryController {
  constructor(private readonly compensatory: CompensatoryService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.compensatory.mine(user);
  }

  /** ?around=YYYY-MM-DD: what the request form checks live, two months around the day (today unless sent). */
  @Get('form')
  @Header('Cache-Control', 'private, no-store')
  form(@Query() query: CompensatoryFormQueryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.form(query, user);
  }

  /** { dayWorked, dayOff, reason? }. */
  @Post()
  create(@Body() dto: CreateCompensatoryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.create(dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.compensatory.cancelMine(id, user);
  }
}

@Controller('compensatory')
export class CompensatoryController {
  constructor(private readonly compensatory: CompensatoryService) {}

  /** ?status=<a status, or waiting>&employeeId=&departmentId=&from=&to=: HR and the CEO everyone's; a manager or lead those sent to them and their team's. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListCompensatoryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.list(query, user);
  }

  /** { waiting }: how many wait for the caller's decision. */
  @Get('counts')
  @Header('Cache-Control', 'private, no-store')
  counts(@CurrentUser() user: SessionUser) {
    return this.compensatory.counts(user);
  }

  /** ?from=&to=&departmentId=: the days off on the leave calendar, as far as the caller sees requests. */
  @Get('calendar')
  @Header('Cache-Control', 'private, no-store')
  calendar(@Query() query: CompensatoryCalendarQueryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.calendar(query, user);
  }

  /** The Leave Setup's cash rate: { cashRate }. */
  @Get('settings')
  settings() {
    return this.compensatory.settings();
  }

  /** HR changes the cash rate: { cashRate }. */
  @Roles('hr')
  @Patch('settings')
  updateSettings(@Body() dto: UpdateCompensatorySettingsDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.updateSettings(dto, user);
  }

  /** ?employeeId=&dayWorked=&dayOff=: what refuses a request HR would record for someone, and what it would be recorded past. */
  @Roles('hr')
  @Get('check')
  @Header('Cache-Control', 'private, no-store')
  @ConfidentialOf('employee', { query: 'employeeId' })
  check(@Query() query: CompensatoryCheckQueryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.check(query, user);
  }

  /** HR records one for someone, approved at once: { employeeId, dayWorked, dayOff?, outcome?, reason }. */
  @Roles('hr')
  @Post()
  @ConfidentialOf('employee', { body: 'employeeId' })
  record(@Body() dto: RecordCompensatoryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.record(dto, user);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.compensatory.one(id, user);
  }

  /** { decision: approve | reject, comment? (required to reject), outcome? (HR: day_off | cash), confirmNoCheckIn? }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideCompensatoryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.decide(id, dto, user);
  }

  /** HR cancels an approved one: { comment }. */
  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrCancelCompensatoryDto, @CurrentUser() user: SessionUser) {
    return this.compensatory.hrCancel(id, dto, user);
  }
}
