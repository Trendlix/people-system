import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public } from './decorators.js';
import { LoginDto } from './login.dto.js';
import { ChangePasswordDto } from './password.dto.js';
import { SESSION_COOKIE, SESSION_HOURS, type Me, type SessionUser } from './session-user.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<SessionUser> {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_HOURS * 60 * 60 * 1000,
    });
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser): Promise<Me> {
    return this.auth.me(user);
  }

  @Post('change-password')
  @HttpCode(204)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: SessionUser): Promise<void> {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
