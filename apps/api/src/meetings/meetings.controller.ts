import { Body, Controller, Get, HttpCode, Param, Post, Put, SetMetadata } from '@nestjs/common';
import { MEETINGS_SCHEDULERS_ONLY, MEETINGS_SUPER_ADMIN_ONLY } from '@trendlix/shared';
import { CurrentActiveSession, CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { MeetingAppDto, MeetingDefaultDto, MeetingFinishDto, MeetingHostDto, MeetingStartDto } from './meetings.dto.js';
import { MeetingsService } from './meetings.service.js';

// Online interview meetings (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; "make it both"): Organization → Meetings, a Super Admin's (the service also refuses one
// viewing as someone); Your Meetings, HR's and a Super Admin's own (also a Super Admin's acting as them, 25 October 2026:
// the guard refuses every change while only viewing); and the sign-in's start and return, tied to the session. Never a
// developer's, not even to read (@NotForDevelopers): the routes hold the apps' credentials and the connections'
// accounts; a developer's writes are refused by the guard as every write is. Disconnecting is a POST, so HR may
// disconnect their own: every DELETE is a Super Admin's (15 October 2026).

/** Organization → Meetings: the apps, the company's connections, the default, the tests. */
@Controller('meetings')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, MEETINGS_SUPER_ADMIN_ONLY)
@NotForDevelopers()
export class MeetingSettingsController {
  constructor(private readonly meetings: MeetingsService) {}

  /** The three apps (never a secret), the company's connections and the default. A Super Admin's. */
  @NotForDevelopers()
  @Get('settings')
  settings(@CurrentUser() user: SessionUser) {
    return this.meetings.settings(user);
  }

  /** A provider's app; an empty secret keeps the saved one. A Super Admin's. */
  @NotForDevelopers()
  @Put('apps/:provider')
  saveApp(@Param('provider') provider: string, @Body() dto: MeetingAppDto, @CurrentUser() user: SessionUser) {
    return this.meetings.saveApp(provider, dto, user);
  }

  /** The company's Microsoft or Zoom host, checked with the app's own token. A Super Admin's. */
  @NotForDevelopers()
  @Post('company/:provider/host')
  @HttpCode(200)
  setHost(@Param('provider') provider: string, @Body() dto: MeetingHostDto, @CurrentUser() user: SessionUser) {
    return this.meetings.setHost(provider, dto.hostEmail, user);
  }

  @NotForDevelopers()
  @Post('company/:provider/disconnect')
  @HttpCode(200)
  disconnectCompany(@Param('provider') provider: string, @CurrentUser() user: SessionUser) {
    return this.meetings.disconnectCompany(provider, user);
  }

  /** "Create a test meeting" with the company's connection: made and deleted, answered in plain words either way. */
  @NotForDevelopers()
  @Post('company/:provider/test')
  @HttpCode(200)
  testCompany(@Param('provider') provider: string, @CurrentUser() user: SessionUser) {
    return this.meetings.testCompany(provider, user);
  }

  @NotForDevelopers()
  @Put('default')
  setDefault(@Body() dto: MeetingDefaultDto, @CurrentUser() user: SessionUser) {
    return this.meetings.setDefault(dto.choice, user);
  }

}

/** Signing in at a provider, Your Meetings, and the choices of "Create the meeting with": HR's and a Super Admin's. */
@Controller('meetings')
@Roles('hr', 'super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, MEETINGS_SCHEDULERS_ONLY)
@NotForDevelopers()
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  /** The provider's sign-in page: the company's Google account (a Super Admin) or one's own. */
  @NotForDevelopers()
  @Post('oauth/start')
  @HttpCode(200)
  start(@Body() dto: MeetingStartDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession) {
    return this.meetings.start(dto, user, session.id);
  }

  /** The provider's return, passed on by the website: where to send the person back, and how it went. */
  @NotForDevelopers()
  @Post('oauth/finish')
  @HttpCode(200)
  finish(@Body() dto: MeetingFinishDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession) {
    return this.meetings.finish(dto, user, session.id);
  }

  /** Your Meetings: one's own connections. */
  @NotForDevelopers()
  @Get('mine')
  mine(@CurrentUser() user: SessionUser) {
    return this.meetings.mine(user);
  }

  @NotForDevelopers()
  @Post('mine/:provider/disconnect')
  @HttpCode(200)
  disconnectMine(@Param('provider') provider: string, @CurrentUser() user: SessionUser) {
    return this.meetings.disconnectMine(provider, user);
  }

  @NotForDevelopers()
  @Post('mine/:provider/test')
  @HttpCode(200)
  testMine(@Param('provider') provider: string, @CurrentUser() user: SessionUser) {
    return this.meetings.testMine(provider, user);
  }

  /** "Create the meeting with": the scheduler's choices, the one the form starts on. */
  @NotForDevelopers()
  @Get('choices')
  choices(@CurrentUser() user: SessionUser) {
    return this.meetings.choices(user);
  }
}
