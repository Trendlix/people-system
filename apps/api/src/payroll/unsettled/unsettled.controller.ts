import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators.js';
import type { SessionUser } from '../../auth/session-user.js';
import { PaidOutDto, ReopenFinalDto, SettleFinalDto } from './unsettled.dto.js';
import { UnsettledService } from './unsettled.service.js';

// Unsettled (owner, 17 October 2026): salary data, so HR, Finance and the CEO see it, like the payroll lines; HR marks a
// final settlement settled or reopens it, and records held pay as paid out.
@Controller('payroll')
export class UnsettledController {
  constructor(private readonly unsettled: UnsettledService) {}

  /** { runs, held, settlements, advances }: each with its count, its total and its rows. */
  @Roles('hr', 'finance', 'ceo')
  @Get('unsettled')
  @Header('Cache-Control', 'private, no-store')
  list() {
    return this.unsettled.unsettled();
  }

  /** An ended employment's final settlement. */
  @Roles('hr', 'finance', 'ceo')
  @Get('final-settlements/:employmentId')
  settlement(@Param('employmentId', ParseUUIDPipe) employmentId: string) {
    return this.unsettled.settlement(employmentId);
  }

  @Roles('hr')
  @Post('final-settlements/:employmentId/settle')
  @HttpCode(200)
  settle(@Param('employmentId', ParseUUIDPipe) employmentId: string, @Body() dto: SettleFinalDto, @CurrentUser() user: SessionUser) {
    return this.unsettled.settle(employmentId, dto, user);
  }

  @Roles('hr')
  @Post('final-settlements/:employmentId/reopen')
  @HttpCode(200)
  reopen(@Param('employmentId', ParseUUIDPipe) employmentId: string, @Body() dto: ReopenFinalDto, @CurrentUser() user: SessionUser) {
    return this.unsettled.reopen(employmentId, dto, user);
  }

  /** A line held on an approved or paid run, paid out since: { paidOn, method, note? }. */
  @Roles('hr')
  @Post('held-lines/:lineId/paid-out')
  @HttpCode(200)
  paidOut(@Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: PaidOutDto, @CurrentUser() user: SessionUser) {
    return this.unsettled.paidOut(lineId, dto, user);
  }
}
