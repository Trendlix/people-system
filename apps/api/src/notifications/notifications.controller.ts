import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type { NotificationPage, NotificationSettings } from '@trendlix/shared';
import { CurrentActiveSession, CurrentUser } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { ListNotificationsDto, NotificationSettingsDto, RegisterPushDeviceDto, UnregisterPushDeviceDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

// The signed-in user's notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): the inbox behind the bell (the one viewed as, while a
// Super Admin views as someone, who may only read it in view-only), the reminder switches, and the phone the app
// registers for push (an app session only, never while viewing as someone). The bell's count is read by the web as a
// background request, so it doesn't keep a session alive.
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@Query() query: ListNotificationsDto, @CurrentUser() user: SessionUser): Promise<NotificationPage> {
    return this.notifications.list(user.id, query.page ?? 1);
  }

  @Get('notifications/unread-count')
  unread(@CurrentUser() user: SessionUser): Promise<{ unread: number }> {
    return this.notifications.unreadCount(user.id);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: SessionUser): Promise<{ marked: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }

  @Get('notification-settings')
  settings(@CurrentUser() user: SessionUser): Promise<NotificationSettings> {
    return this.notifications.settings(user.id);
  }

  @Put('notification-settings')
  saveSettings(@Body() dto: NotificationSettingsDto, @CurrentUser() user: SessionUser): Promise<NotificationSettings> {
    return this.notifications.saveSettings(user.id, dto);
  }

  /** The app, signed in: this phone's push token is the user's, refreshed each time the app opens. */
  @Post('push-devices')
  @HttpCode(204)
  register(@Body() dto: RegisterPushDeviceDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<void> {
    return this.notifications.registerDevice(user, session, dto);
  }

  /** The app, signing out: this phone stops getting notifications. */
  @Post('push-devices/unregister')
  @HttpCode(204)
  unregister(@Body() dto: UnregisterPushDeviceDto): Promise<void> {
    return this.notifications.unregisterDevice(dto.token);
  }
}
