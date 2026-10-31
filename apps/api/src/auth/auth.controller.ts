import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { ModeChoice } from '@trendlix/shared';
import type { Request, Response } from 'express';
import { readToken } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CurrentActiveSession, CurrentUser, DeveloperMayCall, DeveloperMaySee, OpenOnHold, Public } from './decorators.js';
import { DeviceCredentialsService, type DeviceView, type NewDevice } from './device-credentials.service.js';
import { CreateDeviceDto, DeviceSignInDto } from './device.dto.js';
import { EmailCodeDto, EmailCodeSignInDto } from './login-code.dto.js';
import { LoginCodesService } from './login-codes.service.js';
import { LoginDto } from './login.dto.js';
import { ChangePasswordDto } from './password.dto.js';
import { SessionModeDto } from './session-mode.dto.js';
import { setSessionCookie } from './session-cookie.js';
import { idleMsLeft } from './session-rules.js';
import { SESSION_COOKIE, SESSION_HOURS, type Me, type SessionUser } from './session-user.js';
import { SessionsService, type ActiveSession, type SessionStatus, type SessionView } from './sessions.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly devices: DeviceCredentialsService,
    private readonly codes: LoginCodesService,
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

  // Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
  // remember his password", "via app and web"; login-codes.service.ts): asking, then trading the code for a session.

  /** { email }: a 6-digit code emailed to an active account with it; the same answer whether or not there is one. */
  @Public()
  @Post('email-code')
  @HttpCode(200)
  requestCode(@Body() dto: EmailCodeDto, @Req() req: Request): Promise<{ message: string }> {
    return this.codes.request(dto.email, { ip: req.ip ?? null, headers: req.headers });
  }

  /** { email, code }: signed in as with a password (the session's cookie; the app reads it); refused with a 401 saying so. */
  @Public()
  @Post('email-code/sign-in')
  @HttpCode(200)
  async codeSignIn(@Body() dto: EmailCodeSignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const origin = { userAgent: dto.userAgent ?? req.headers['user-agent'] ?? null, ip: dto.ip ?? req.ip ?? null };
    const { token, user } = await this.codes.signIn(dto.email, dto.code, origin);
    setSessionCookie(res, token, SESSION_HOURS * 60 * 60 * 1000);
    return user;
  }

  // Signing out also ends viewing as someone: the switched session is the Super Admin's own (see view-as.ts). It ends
  // the session on the server too (20 October 2026). Public, so a session already over can still sign out.
  @Public()
  @DeveloperMayCall()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readToken(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  // an account on Hold still reaches its own session's basics and the app's fingerprint sign-in (owner, 23 October 2026:
  // "Check-in/out only"): who am I, the mode, the session and the sessions, the password, the phones
  @OpenOnHold()
  @Get('me')
  me(@CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<Me> {
    return this.auth.me(user, session);
  }

  // A developer who holds another role chooses how to use the system, at sign-in and with the top bar's switch (owner, 22
  // October 2026: "when a developer signin, give hin a switched to use the account as the main role assigned to him or
  // as a developer, to not confuse him"). Their own name and roles, as they are (DeveloperMaySee: not masked, in either
  // mode: it is about themselves); choosing is the one change a developer's view makes (DeveloperMayCall). Neither ends
  // the session nor counts as a new sign-in.

  /** Whether they choose, the mode in use, the last one chosen, and their name and own roles for the choice page. */
  @OpenOnHold()
  @DeveloperMaySee()
  @Get('mode')
  mode(@CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<ModeChoice> {
    return this.auth.modeChoice(user, session);
  }

  /** Choosing at sign-in, or switching: their session is used as themselves or as a developer from the next request. */
  @OpenOnHold()
  @DeveloperMayCall()
  @DeveloperMaySee()
  @Post('mode')
  @HttpCode(200)
  chooseMode(@Body() dto: SessionModeDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<ModeChoice> {
    return this.auth.chooseMode(user, session, dto.mode);
  }

  /**
   * The request's session and how long it has left before 15 minutes without activity end it (HR, Admin, Super Admin).
   * Asked with the x-background header (the web's idle warning, checking), it doesn't count as activity; asked without
   * (Stay signed in), it does.
   */
  @OpenOnHold()
  @Get('session')
  status(@CurrentActiveSession() session: ActiveSession): SessionStatus {
    const { id, kind, createdAt, lastActiveAt, expiresAt, idleTimeoutMs } = session;
    return { id, kind, createdAt, lastActiveAt, expiresAt, idleTimeoutMs, idleMsLeft: idleMsLeft(lastActiveAt, idleTimeoutMs, new Date()) };
  }

  /** Your Sessions: the signed-in user's sessions still open (the one viewed as, while a Super Admin views as someone). */
  @OpenOnHold()
  @Get('sessions')
  list(@CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<SessionView[]> {
    return this.sessions.list(user.id, session.id);
  }

  /** Sign out beside one of one's own sessions: it ends ('signed_out'), on whichever device it is. */
  @OpenOnHold()
  @DeveloperMayCall()
  @Post('sessions/:id/end')
  @HttpCode(204)
  end(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.sessions.endOwn(user, id);
  }

  /** Changing one's password also ends one's other sessions and stops fingerprint sign-in on one's phones. */
  @OpenOnHold()
  @DeveloperMayCall()
  @Post('change-password')
  @HttpCode(204)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<void> {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, session.id);
  }

  // Fingerprint sign-in in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first password
  // sign-in"; apps/mobile/README.md, Phase 3). Turned on from an app session (never while viewing as someone): the
  // answer carries the secret this once, for the phone to keep behind the fingerprint.
  @OpenOnHold()
  @Post('devices')
  @HttpCode(201)
  createDevice(@Body() dto: CreateDeviceDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<NewDevice> {
    return this.devices.create(user, session, dto);
  }

  /**
   * The website signs in with the phone's credential for the person, as with a password (their app's user agent and IP
   * address passed on): an ordinary app session and its cookie. Public, like login; refused with a 401 saying why.
   */
  @Public()
  @Post('devices/sign-in')
  @HttpCode(200)
  async deviceSignIn(@Body() dto: DeviceSignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const origin = { userAgent: dto.userAgent ?? req.headers['user-agent'] ?? null, ip: dto.ip ?? req.ip ?? null };
    const { token, user } = await this.auth.deviceSignIn(dto.id, dto.secret, origin, dto.ip ?? null);
    setSessionCookie(res, token, SESSION_HOURS * 60 * 60 * 1000);
    return user;
  }

  /** Your Sessions: the phones that sign in as the user with a fingerprint (the one viewed as, while viewing as someone). */
  @OpenOnHold()
  @Get('devices')
  listDevices(@CurrentUser() user: SessionUser): Promise<DeviceView[]> {
    return this.devices.list(user.id);
  }

  /** Sign out beside one of one's phones: its fingerprint sign-in stops ('signed_out'). */
  @OpenOnHold()
  @Post('devices/:id/revoke')
  @HttpCode(204)
  revokeDevice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.devices.revokeOwn(user, id);
  }
}
