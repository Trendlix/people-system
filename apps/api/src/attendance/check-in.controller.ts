import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { PunchDto } from './check-in.dto.js';
import { CheckInService } from './check-in.service.js';

// Checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"): the caller's own today, and a press of Check in or Check out. Anyone signed in
// with an employee profile and a current employment under a shift, not a freelancer (the service says why not to the
// others).
@Controller('me/attendance')
export class CheckInController {
  constructor(private readonly checkIn: CheckInService) {}

  /** Today's punches and day, whether they check in, where they are expected, and what the next press is. */
  @Get('today')
  @Header('Cache-Control', 'private, no-store')
  today(@CurrentUser() user: SessionUser) {
    return this.checkIn.today(user);
  }

  /** { kind: in | out, latitude?, longitude?, accuracy?, locationError? }: at the server's time. */
  @Post('punches')
  @HttpCode(200)
  punch(@Body() dto: PunchDto, @CurrentUser() user: SessionUser) {
    return this.checkIn.punch(dto, user);
  }
}
