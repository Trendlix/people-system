import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { AccessLinksService } from './access-links.service.js';
import { AccessLinkDto, CheckPasswordLinkDto, ForgotPasswordDto, InvitationsDto, SetPasswordWithLinkDto, SignInEmailDto } from './employee-access.dto.js';
import { AccessStandingService } from './access-standing.service.js';
import { EmployeeAccessService } from './employee-access.service.js';

// An employee's access, on their profile's Access tab (owner, 22 October 2026: "On the employee profile"): who may is
// checked by the service (HR, an Admin, a Super Admin; the CEO for a C-level person; the person themself reads their
// own). A developer is refused every change by the guard, as everywhere.
@Controller('employees')
export class EmployeeAccessController {
  constructor(
    private readonly access: EmployeeAccessService,
    private readonly standings: AccessStandingService,
  ) {}

  /** How many people are on Hold and on Grace now (23 October 2026), for HR's sidebar: HR, an Admin, a Super Admin. */
  @Get('access/counts')
  counts(@CurrentUser() user: SessionUser) {
    return this.standings.counts(user);
  }

  /** Everyone not invited yet, or those chosen, invited by email at once (the Employees list's Send invitations). */
  @Post('access/invitations')
  @HttpCode(200)
  invite(@Body() dto: InvitationsDto, @CurrentUser() user: SessionUser) {
    return this.access.inviteMany(dto, user);
  }

  @Get(':id/access')
  view(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.access.view(id, user);
  }

  /** Give access now: the account made at once (else the sweep makes it within minutes). */
  @Post(':id/access/account')
  @HttpCode(200)
  giveNow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.access.giveNow(id, user);
  }

  /**
   * Give 7 days' grace to someone on Hold (owner, 23 October 2026: "a 7 days grace period one time granted by the hr";
   * "Once per contract gap"): refused with the reason when not on Hold or used in this gap, and for oneself.
   */
  @Post(':id/access/grace')
  @HttpCode(200)
  grace(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.access.giveGrace(id, user);
  }

  @Put(':id/access/sign-in-email')
  signInEmail(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SignInEmailDto, @CurrentUser() user: SessionUser) {
    return this.access.setSignInEmail(id, dto.choice, user);
  }

  @Post(':id/access/invite')
  @HttpCode(200)
  inviteOne(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AccessLinkDto, @CurrentUser() user: SessionUser) {
    return this.access.makeLink(id, 'invite', dto.mode, user);
  }

  @Post(':id/access/reset')
  @HttpCode(200)
  reset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AccessLinkDto, @CurrentUser() user: SessionUser) {
    return this.access.makeLink(id, 'reset', dto.mode, user);
  }
}

// The set-password links' public pages and Forgot password (22 October 2026): no session, the token is the proof.
@Public()
@Controller('auth')
export class AccessLinksController {
  constructor(private readonly links: AccessLinksService) {}

  /** What a link is, asked by its page: the token in the body, never in a path a log keeps. */
  @Post('password-link/check')
  @HttpCode(200)
  check(@Body() dto: CheckPasswordLinkDto, @Req() req: Request) {
    return this.links.check(dto.token, { ip: req.ip ?? null, headers: req.headers });
  }

  @Post('password-link')
  @HttpCode(200)
  set(@Body() dto: SetPasswordWithLinkDto, @Req() req: Request) {
    return this.links.setPassword(dto.token, dto.password, { ip: req.ip ?? null, headers: req.headers });
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.links.forgot(dto.email, { ip: req.ip ?? null, headers: req.headers });
  }
}
