import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, SetMetadata } from '@nestjs/common';
import { CALENDARS_SUPER_ADMIN_ONLY } from '@trendlix/shared';
import { CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { CalendarAppDto, CalendarFinishDto, CalendarStartDto, CalendarTestDto } from './calendars.dto.js';
import { CalendarsService } from './calendars.service.js';

// Calendars read for interviewers' busy times (owner, 25 October 2026: "Hours + calendar"; "its zoho mails"):
// Organization → Calendars, a Super Admin's (the service also refuses one viewing as someone); each person's own
// calendars, anyone's with an employee profile (the service checks); and the sign-in's start and return. Never a
// developer's, not even to read (@NotForDevelopers): the routes hold the Zoho app's credentials and the connections'
// accounts; a developer's writes are refused by the guard as every write is. Disconnecting is a POST, so anyone may
// disconnect their own: every DELETE is a Super Admin's (15 October 2026).

/** Organization → Calendars: the Zoho app, the company's Zoho connection, its test. */
@Controller('calendars')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, CALENDARS_SUPER_ADMIN_ONLY)
@NotForDevelopers()
export class CalendarSettingsController {
  constructor(private readonly calendars: CalendarsService) {}

  /** The Zoho app (never its secret) and the company's Zoho connection. A Super Admin's. */
  @NotForDevelopers()
  @Get('settings')
  @Header('Cache-Control', 'private, no-store')
  settings(@CurrentUser() user: SessionUser) {
    return this.calendars.settings(user);
  }

  /** The Zoho app; an empty secret keeps the saved one. A Super Admin's. */
  @NotForDevelopers()
  @Put('apps/zoho')
  saveApp(@Body() dto: CalendarAppDto, @CurrentUser() user: SessionUser) {
    return this.calendars.saveApp(dto, user);
  }

  @NotForDevelopers()
  @Post('company/zoho/disconnect')
  @HttpCode(200)
  disconnectCompany(@CurrentUser() user: SessionUser) {
    return this.calendars.disconnectCompany(user);
  }

  /** The company's Zoho connection reads its own account's free/busy (and a colleague's), answered in counts. */
  @NotForDevelopers()
  @Post('company/zoho/test')
  @HttpCode(200)
  testCompany(@Body() dto: CalendarTestDto, @CurrentUser() user: SessionUser) {
    return this.calendars.testCompany(dto.email, user);
  }
}

/** Signing in at a calendar, and one's own calendars: anyone's with an employee profile, checked by the service. */
@Controller('calendars')
@NotForDevelopers()
export class CalendarsController {
  constructor(private readonly calendars: CalendarsService) {}

  /** The provider's sign-in page: the company's Zoho account (a Super Admin) or one's own calendar. */
  @NotForDevelopers()
  @Post('oauth/start')
  @HttpCode(200)
  start(@Body() dto: CalendarStartDto, @CurrentUser() user: SessionUser) {
    return this.calendars.start(dto, user);
  }

  /** The provider's return, passed on by the website: where to send the person back, and how it went. */
  @NotForDevelopers()
  @Post('oauth/finish')
  @HttpCode(200)
  finish(@Body() dto: CalendarFinishDto, @CurrentUser() user: SessionUser) {
    return this.calendars.finish(dto, user);
  }

  /** One's own calendar connections, and what reads one's busy times without one. */
  @NotForDevelopers()
  @Get('mine')
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: SessionUser) {
    return this.calendars.mine(user);
  }

  @NotForDevelopers()
  @Post('mine/:provider/disconnect')
  @HttpCode(200)
  disconnectMine(@Param('provider') provider: string, @CurrentUser() user: SessionUser) {
    return this.calendars.disconnectMine(provider, user);
  }

  @NotForDevelopers()
  @Post('mine/:provider/test')
  @HttpCode(200)
  testMine(@Param('provider') provider: string, @CurrentUser() user: SessionUser) {
    return this.calendars.testMine(provider, user);
  }
}
