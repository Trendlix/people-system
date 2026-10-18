import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CreateEndingDto, EndingNoteDto, ListEndingsDto, RejectEndingDto } from './contracts.dto.js';
import { EndingsService } from './endings.service.js';

// How an employment ends: HR records (and so approves) it, the CEO approves or rejects it, HR withdraws or completes
// it. Each answer is the ending.
@Controller()
export class EndingsController {
  constructor(private readonly endings: EndingsService) {}

  @Roles('hr')
  @Post('employees/:id/employments/:employmentId/endings')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employmentId', ParseUUIDPipe) employmentId: string,
    @Body() dto: CreateEndingDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.endings.create(id, employmentId, dto, user);
  }

  /** The CEO's queue is ?status=pending_ceo. */
  @Roles('hr', 'ceo')
  @Get('endings')
  list(@Query() query: ListEndingsDto, @CurrentUser() user: SessionUser) {
    return this.endings.list(query.status, user);
  }

  /** The CEO only: HR's approval is recording the ending. */
  @Roles('ceo')
  @Post('endings/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndingNoteDto, @CurrentUser() user: SessionUser) {
    return this.endings.approve(id, dto, user);
  }

  @Roles('ceo')
  @Post('endings/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectEndingDto, @CurrentUser() user: SessionUser) {
    return this.endings.reject(id, dto, user);
  }

  @Roles('hr')
  @Post('endings/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndingNoteDto, @CurrentUser() user: SessionUser) {
    return this.endings.withdraw(id, dto, user);
  }

  @Roles('hr')
  @Post('endings/:id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.endings.complete(id, user);
  }
}
