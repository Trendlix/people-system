import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentActiveSession, CurrentSession, CurrentUser, ViewAsControl } from './decorators.js';
import { setSessionCookie } from './session-cookie.js';
import type { Me, SessionUser } from './session-user.js';
import type { ActiveSession } from './sessions.service.js';
import { ViewAsActDto, ViewAsDto } from './view-as.dto.js';
import type { SessionClaims } from './view-as.js';
import { ViewAsService, type NewSession } from './view-as.service.js';

// The view-as switcher (owner's decisions, 17 October 2026). Each endpoint sets the new session cookie and answers it
// as GET /auth/me would. They can be reached while viewing only (ViewAsControl); the service checks who may call each.
@Controller('auth/view-as')
export class ViewAsController {
  constructor(
    private readonly viewAs: ViewAsService,
    private readonly auth: AuthService,
  ) {}

  @ViewAsControl()
  @Post()
  @HttpCode(200)
  async start(
    @Body() dto: ViewAsDto,
    @CurrentUser() user: SessionUser,
    @CurrentSession() session: SessionClaims,
    @CurrentActiveSession() active: ActiveSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    return this.answer(res, await this.viewAs.start(user, session, dto.userId), active);
  }

  @ViewAsControl()
  @Post('act')
  @HttpCode(200)
  async act(
    @Body() dto: ViewAsActDto,
    @CurrentUser() user: SessionUser,
    @CurrentSession() session: SessionClaims,
    @CurrentActiveSession() active: ActiveSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    return this.answer(res, await this.viewAs.act(user, session, dto.act), active);
  }

  @ViewAsControl()
  @Post('stop')
  @HttpCode(200)
  async stop(
    @CurrentUser() user: SessionUser,
    @CurrentSession() session: SessionClaims,
    @CurrentActiveSession() active: ActiveSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    return this.answer(res, await this.viewAs.stop(user, session), active);
  }

  /** The new token as the cookie, and the answer as GET /auth/me gives it: the same session (the Super Admin's own). */
  private answer(res: Response, session: NewSession, active: ActiveSession): Promise<Me> {
    setSessionCookie(res, session.token, session.maxAgeMs);
    return this.auth.me(session.user, active);
  }
}
