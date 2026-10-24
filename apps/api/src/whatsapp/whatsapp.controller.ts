import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, SetMetadata } from '@nestjs/common';
import { WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY, isWhatsAppGroup, type MyWhatsAppView, type WhatsAppGroup } from '@trendlix/shared';
import type { Request } from 'express';
import { CurrentUser, FORBIDDEN_MESSAGE, NotForDevelopers, Public, Roles } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import { ListWhatsAppMessagesDto, MyWhatsAppDto, WhatsAppSettingsDto, WhatsAppTestDto } from './whatsapp.dto.js';
import { WhatsAppSettingsService } from './whatsapp-settings.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';
import { WhatsAppService } from './whatsapp.service.js';

// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; asked, "Employees and
// candidates", "Approvals waiting, Request decisions, Check-in reminders, Interviews", "Directly to Meta").
// - Organization → Company → WhatsApp: a Super Admin's only, in their own session (the service refuses one viewing as
//   someone); never a developer's, not even to read (@NotForDevelopers).
// - The messages' log: HR's and a Super Admin's; never a developer's.
// - Whether someone gets them: HR, an Admin, the CEO; never a developer's; nobody changes it but the person.
// - Their own choice: every signed-in person's (/me/whatsapp).
// - Meta's webhook: public (no session), its own checks (the verify token, the signature) and rate limit.

@Controller('whatsapp/settings')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY)
@NotForDevelopers()
export class WhatsAppSettingsController {
  constructor(private readonly settings: WhatsAppSettingsService) {}

  @NotForDevelopers()
  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.settings.get(user);
  }

  /** Saves them; an empty token or app secret keeps the saved one. */
  @NotForDevelopers()
  @Put()
  update(@Body() dto: WhatsAppSettingsDto, @CurrentUser() user: SessionUser) {
    return this.settings.update(dto, user);
  }

  /** "Send a test message" with the saved settings: sent, or why not in words. */
  @NotForDevelopers()
  @Post('test')
  @HttpCode(200)
  test(@Body() dto: WhatsAppTestDto, @CurrentUser() user: SessionUser) {
    return this.settings.test(dto.to, user);
  }

  /** "Make a new verify token". */
  @NotForDevelopers()
  @Post('verify-token')
  @HttpCode(200)
  verifyToken(@CurrentUser() user: SessionUser) {
    return this.settings.newVerifyToken(user);
  }
}

@Controller('whatsapp/templates')
@Roles('super_admin')
@SetMetadata(FORBIDDEN_MESSAGE, WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY)
@NotForDevelopers()
export class WhatsAppTemplatesController {
  constructor(private readonly settings: WhatsAppSettingsService) {}

  /** "Submit templates": every one not approved or under review, for Meta's review; then their statuses. */
  @NotForDevelopers()
  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser() user: SessionUser) {
    return this.settings.submit(user);
  }

  /** "Sync status": each template's status at Meta now. */
  @NotForDevelopers()
  @Post('sync')
  @HttpCode(200)
  sync(@CurrentUser() user: SessionUser) {
    return this.settings.sync(user);
  }
}

@Controller('whatsapp')
@NotForDevelopers()
export class WhatsAppLogController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  /** The messages sent, by status, type and days; each day's counts. HR and a Super Admin (the service checks). */
  @NotForDevelopers()
  @Get('messages')
  messages(@Query() query: ListWhatsAppMessagesDto, @CurrentUser() user: SessionUser) {
    return this.whatsapp.messages(query, user);
  }

  /** Whether an employee gets WhatsApp messages: HR, an Admin, the CEO (the service checks). Read only. */
  @NotForDevelopers()
  @Get('people/:employeeId')
  person(@Param('employeeId', ParseUUIDPipe) employeeId: string, @CurrentUser() user: SessionUser) {
    return this.whatsapp.person(employeeId, user);
  }
}

@Controller('me/whatsapp')
export class MyWhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  mine(@CurrentUser() user: SessionUser): Promise<MyWhatsAppView> {
    return this.whatsapp.mine(user);
  }

  /** Turned on (at their mobile), changed, or off: theirs alone, never while viewing as them (the service refuses). */
  @Put()
  save(@Body() dto: MyWhatsAppDto, @CurrentUser() user: SessionUser): Promise<MyWhatsAppView> {
    const groups: Partial<Record<WhatsAppGroup, boolean>> = {};
    for (const [k, v] of Object.entries(dto.groups ?? {})) if (isWhatsAppGroup(k) && typeof v === 'boolean') groups[k] = v;
    return this.whatsapp.saveMine(user, { on: dto.on, language: dto.language, groups });
  }
}

/** Meta's webhook, without signing in: the website passes Meta's calls on to it unchanged. */
@Public()
@Controller('public/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly webhook: WhatsAppWebhookService) {}

  /** Meta's verification: the challenge back as text, or 403. */
  @Get('webhook')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  verify(@Query() query: Record<string, unknown>, @Req() req: Request): Promise<string> {
    return this.webhook.verify(query, req.ip);
  }

  /** A signed call: the statuses and STOP read from it; 401 without a valid signature. */
  @Post('webhook')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  receive(@Req() req: Request & { rawBody?: Buffer }) {
    return this.webhook.receive(req.rawBody, req.headers['x-hub-signature-256'], req.body, req.ip);
  }
}
