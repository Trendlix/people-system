import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { DecideLeaveDto, HrCancelLeaveDto } from './leave.dto.js';
import { CreatePermissionDto, ListPermissionsDto, PermissionMonthQueryDto, RecordPermissionDto } from './permissions.dto.js';
import { PermissionRequestsService } from './permissions.service.js';

// Permission requests (owner, 19 October 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours
// per day", asked "In the system, like leave"). The employee's own: their requests, their month's hours, a new one and
// cancelling one. Deciding and seeing them: the request's direct manager (or lead) and HR in turn, the CEO reading and
// deciding a C-level person's HR stage (checked by the service, which tells anyone else a request isn't there); HR records
// permission on an employee's behalf and cancels approved permission. An employee's month: as their leave (HR, the CEO,
// Finance, the person and their manager now). The menu's counts and the calendar are the leave's (leave.controller.ts),
// with the permissions in them.

/** The employee's own: anyone signed in with an employee profile. */
@Controller('me/permissions')
export class MyPermissionsController {
  constructor(private readonly permissions: PermissionRequestsService) {}

  @Get()
  mine(@CurrentUser() user: SessionUser) {
    return this.permissions.mine(user);
  }

  /** ?month=YYYY-MM: the month's hours, approved, being decided and left, by day (this month unless sent). */
  @Get('allowance')
  allowance(@Query() query: PermissionMonthQueryDto, @CurrentUser() user: SessionUser) {
    return this.permissions.myMonth(query.month, user);
  }

  /** { date, hours, fromTime?, toTime?, reason? }. */
  @Post()
  create(@Body() dto: CreatePermissionDto, @CurrentUser() user: SessionUser) {
    return this.permissions.create(dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.permissions.cancelMine(id, user);
  }
}

@Controller('leave/permissions')
export class PermissionRequestsController {
  constructor(private readonly permissions: PermissionRequestsService) {}

  /** ?status=<a status, or waiting>&employeeId=&from=&to=: HR and the CEO everyone's; a manager those sent to them and their team's. */
  @Get()
  list(@Query() query: ListPermissionsDto, @CurrentUser() user: SessionUser) {
    return this.permissions.list(query, user);
  }

  /** HR records permission on an employee's behalf, approved at once: as the employee's, with employeeId. */
  @Roles('hr')
  @Post()
  @ConfidentialOf('employee', { body: 'employeeId' })
  record(@Body() dto: RecordPermissionDto, @CurrentUser() user: SessionUser) {
    return this.permissions.record(dto, user);
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.permissions.one(id, user);
  }

  /** { decision: approve | reject, comment? (required to reject) }. */
  @Post(':id/decide')
  @HttpCode(200)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideLeaveDto, @CurrentUser() user: SessionUser) {
    return this.permissions.decide(id, dto, user);
  }

  /** HR cancels an approved request: { comment }. */
  @Roles('hr')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HrCancelLeaveDto, @CurrentUser() user: SessionUser) {
    return this.permissions.hrCancel(id, dto, user);
  }
}

@Controller('employees/:id/permissions')
export class EmployeePermissionsController {
  constructor(private readonly permissions: PermissionRequestsService) {}

  /** ?month=YYYY-MM: the month's hours as the employee's own, with their requests on its days. */
  @ConfidentialOf('employee')
  @Get()
  get(@Param('id', ParseUUIDPipe) id: string, @Query() query: PermissionMonthQueryDto, @CurrentUser() user: SessionUser) {
    return this.permissions.employeeMonth(id, query.month, user);
  }
}
