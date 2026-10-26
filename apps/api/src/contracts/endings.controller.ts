import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ConfidentialOf } from '../employees/confidential.guard.js';
import { AgreedLastDayDto, CreateEndingDto, EndingNoteDto, ListEndingsDto, RejectEndingDto } from './contracts.dto.js';
import { EndingsService } from './endings.service.js';

// How an employment ends: HR records (and so approves) it, the CEO approves or rejects it, HR withdraws or completes
// it. Each answer is the ending. A C-level person's (owner, 19 October 2026) only for the CEO and a Super Admin: 404 for
// anyone else, and left out of the list.
@Controller()
export class EndingsController {
  constructor(private readonly endings: EndingsService) {}

  @ConfidentialOf('employee')
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
  @ConfidentialOf('ending')
  @Roles('ceo')
  @Post('endings/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndingNoteDto, @CurrentUser() user: SessionUser) {
    return this.endings.approve(id, dto, user);
  }

  @ConfidentialOf('ending')
  @Roles('ceo')
  @Post('endings/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectEndingDto, @CurrentUser() user: SessionUser) {
    return this.endings.reject(id, dto, user);
  }

  @ConfidentialOf('ending')
  @Roles('hr')
  @Post('endings/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EndingNoteDto, @CurrentUser() user: SessionUser) {
    return this.endings.withdraw(id, dto, user);
  }

  /**
   * HR or an Admin (a Super Admin counts as one) set, change or clear the agreed last working day, until the ending is
   * completed (owner, 26 October 2026: "only by admin and HR"). Not the CEO, who sees it on the approval.
   */
  @ConfidentialOf('ending')
  @Roles('hr', 'admin')
  @Patch('endings/:id/last-day')
  setLastDay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AgreedLastDayDto, @CurrentUser() user: SessionUser) {
    return this.endings.setLastDay(id, dto, user);
  }

  @ConfidentialOf('ending')
  @Roles('hr')
  @Post('endings/:id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.endings.complete(id, user);
  }
}
