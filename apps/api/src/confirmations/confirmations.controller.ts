import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfirmDto, CreateChangeRequestDto, DecisionNoteDto, ListChangeRequestsDto } from './confirmations.dto.js';
import { ConfirmationsService } from './confirmations.service.js';

// The employee's own check of their details (owner's decision, 15 October 2026): the employee confirms them or asks
// for a change (checked by the service: only the employee themself); HR or an Admin approves or rejects the change;
// the employee may cancel it while it waits. Each change request answer is the request.
@Controller()
export class ConfirmationsController {
  constructor(private readonly confirmations: ConfirmationsService) {}

  /** Answers where the confirmation stands, as the profile shows it. */
  @Post('employees/:id/confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDto, @CurrentUser() user: SessionUser) {
    return this.confirmations.confirm(id, dto, user);
  }

  @Post('employees/:id/change-requests')
  request(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateChangeRequestDto, @CurrentUser() user: SessionUser) {
    return this.confirmations.request(id, dto, user);
  }

  /** HR's queue is the default: the requests waiting (status pending); `?status=all` lists every request. */
  @Roles('hr', 'admin')
  @Get('change-requests')
  list(@Query() query: ListChangeRequestsDto) {
    return this.confirmations.list(query.status);
  }

  @Roles('hr', 'admin')
  @Post('change-requests/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionNoteDto, @CurrentUser() user: SessionUser) {
    return this.confirmations.approve(id, dto, user);
  }

  @Roles('hr', 'admin')
  @Post('change-requests/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionNoteDto, @CurrentUser() user: SessionUser) {
    return this.confirmations.reject(id, dto, user);
  }

  /** The employee who asked, while it waits. */
  @Post('change-requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.confirmations.cancel(id, user);
  }
}
