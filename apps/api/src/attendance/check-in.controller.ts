import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentActiveSession, CurrentUser, OpenOnHold } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { CheckInSetupService } from './check-in-setup.service.js';
import { PunchDto } from './check-in.dto.js';
import { CheckInService } from './check-in.service.js';

// Checking in on the system (owner, 19 October 2026: "Check-in through the system (phone or web with the office location
// check, or a device) to replace Zoho"): the caller's own today, and a press of Check in or Check out. Anyone signed in
// with an employee profile and a current employment under a shift, not a freelancer (the service says why not to the
// others). A press carries the session's kind (inside the app a location is needed: owner, 20 October 2026, "App only")
// and the visitor's address as the website signed it (check-ins locked to the office network, the same day), or inside
// the Flutter app, which talks to the API itself, the connection's own (signed-ip.ts checkInIp), read for the decision
// and never kept. Open to an account on Hold (owner, 23 October 2026: "Check-in/out only"), so its
// attendance and pay stay right: today's state and the presses, on the website and in the app.
@OpenOnHold()
@Controller('me/attendance')
export class CheckInController {
  constructor(
    private readonly checkIn: CheckInService,
    private readonly setup: CheckInSetupService,
  ) {}

  /** Today's punches and day, whether they check in, where they are expected, and what the next press is. */
  @Get('today')
  @Header('Cache-Control', 'private, no-store')
  today(@CurrentUser() user: SessionUser) {
    return this.checkIn.today(user);
  }

  /** { kind: in | out, latitude?, longitude?, accuracy?, locationError?, mock? }: at the server's time. */
  @Post('punches')
  @HttpCode(200)
  punch(@Body() dto: PunchDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession, @Req() req: Request) {
    return this.checkIn.punch(dto, user, { session: session.kind, signedIp: this.setup.checkInIp(req, session.kind) });
  }
}
