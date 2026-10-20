import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { readToken } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentActiveSession, CurrentUser, Public } from './decorators.js';
import { LoginDto } from './login.dto.js';
import { ChangePasswordDto } from './password.dto.js';
import { setSessionCookie } from './session-cookie.js';
import { idleMsLeft } from './session-rules.js';
import { SESSION_COOKIE, SESSION_HOURS, type Me, type SessionUser } from './session-user.js';
import { SessionsService, type ActiveSession, type SessionStatus, type SessionView } from './sessions.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  /** The website signs in for the person and passes on their browser's user agent and IP address (else the request's). */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const origin = { userAgent: dto.userAgent ?? req.headers['user-agent'] ?? null, ip: dto.ip ?? req.ip ?? null };
    const { token, user } = await this.auth.login(dto.email, dto.password, origin);
    setSessionCookie(res, token, SESSION_HOURS * 60 * 60 * 1000);
    return user;
  }

  // Signing out also ends viewing as someone: the switched session is the Super Admin's own (see view-as.ts). It ends
  // the session on the server too (20 October 2026). Public, so a session already over can still sign out.
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readToken(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<Me> {
    return this.auth.me(user, session);
  }

  /**
   * The request's session and how long it has left before 15 minutes without activity end it (HR, Admin, Super Admin).
   * Asked with the x-background header (the web's idle warning, checking), it doesn't count as activity; asked without
   * (Stay signed in), it does.
   */
  @Get('session')
  status(@CurrentActiveSession() session: ActiveSession): SessionStatus {
    const { id, kind, createdAt, lastActiveAt, expiresAt, idleTimeoutMs } = session;
    return { id, kind, createdAt, lastActiveAt, expiresAt, idleTimeoutMs, idleMsLeft: idleMsLeft(lastActiveAt, idleTimeoutMs, new Date()) };
  }

  /** Your Sessions: the signed-in user's sessions still open (the one viewed as, while a Super Admin views as someone). */
  @Get('sessions')
  list(@CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<SessionView[]> {
    return this.sessions.list(user.id, session.id);
  }

  /** Sign out beside one of one's own sessions: it ends ('signed_out'), on whichever device it is. */
  @Post('sessions/:id/end')
  @HttpCode(204)
  end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.sessions.endOwn(user, id);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: SessionUser): Promise<void> {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
