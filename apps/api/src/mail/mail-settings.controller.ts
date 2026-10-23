import { Body, Controller, Delete, Get, HttpCode, Post, Put, SetMetadata } from '@nestjs/common';
import { MAIL_SETTINGS_SUPER_ADMIN_ONLY } from '@trendlix/shared';
import { CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { MailSettingsDto, MailTestDto } from './mail-settings.dto.js';
import { MailSettingsService } from './mail-settings.service.js';

// Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"): a Super
// Admin's only, in their own session (the service refuses one viewing as someone). Never a developer's, not even to
// read (@NotForDevelopers): the settings hold the company's mailbox and its server. Writes are refused to a developer by
// the guard as every write is.
@Controller('mail-settings')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, MAIL_SETTINGS_SUPER_ADMIN_ONLY)
@NotForDevelopers()
export class MailSettingsController {
  constructor(private readonly settings: MailSettingsService) {}

  /** The settings without the password (passwordSet: true or false), and where emails are sent from now. */
  @NotForDevelopers()
  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.settings.get(user);
  }

  /** Saves them; an empty password keeps the saved one. */
  @NotForDevelopers()
  @Put()
  update(@Body() dto: MailSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }

  /** "Send a test email" with the form's values (the saved password when none is typed): ok, or why not in words. */
  @NotForDevelopers()
  @Post('test')
  @HttpCode(200)
  test(@Body() dto: MailTestDto, @CurrentUser() user: SessionUser) {
    return this.settings.test(dto, user);
  }

  /** "Remove the saved password": a Super Admin's, as every DELETE is (the controller's @Roles), saying so in its own words. */
  @NotForDevelopers()
  @Delete('password')
  removePassword(@CurrentUser() user: SessionUser) {
    return this.settings.removePassword(user);
  }
}
