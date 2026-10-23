import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type { CheckInReminderView, NotificationPage, NotificationSettings } from '@trendlix/shared';
import { CurrentActiveSession, CurrentUser, OpenOnHold } from '../auth/decorators.js';
import type { SessionUser } from '../auth/session-user.js';
import type { ActiveSession } from '../auth/sessions.service.js';
import { ListNotificationsDto, NotificationSettingsDto, RegisterPushDeviceDto, UnregisterPushDeviceDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';
import { RemindersService } from './reminders.service.js';

// The signed-in user's notifications (owner, 20 October 2026: "Push notifications: yes (decisions, things waiting for
// someone, a check-in reminder)"; apps/mobile/README.md, Phase 4): the inbox behind the bell (the one viewed as, while a
// Super Admin views as someone, who may only read it in view-only), the reminder switches, the phone the app registers
// for push (an app session only, never while viewing as someone), and whether the popup "You haven't checked in yet" is
// due (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave every 10 minutes. like a
// popup"). The bell's count and the popup's question are read by the web as background requests, so they don't keep a
// session alive.
@Controller('me')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
  ) {}

  /**
   * Whether the popup "You haven't checked in yet" is due now (never while viewing as someone). Open on Hold, as the
   * phone's push registration is (owner, 23 October 2026: "Check-in/out only": the check-in reminder keeps working).
   */
  @OpenOnHold()
  @Get('check-in-reminder')
  checkInReminder(@CurrentUser() user: SessionUser): Promise<CheckInReminderView> {
    return this.reminders.checkInReminderFor(user);
  }

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
  @OpenOnHold()
  @Post('push-devices')
  @HttpCode(204)
  register(@Body() dto: RegisterPushDeviceDto, @CurrentUser() user: SessionUser, @CurrentActiveSession() session: ActiveSession): Promise<void> {
    return this.notifications.registerDevice(user, session, dto);
  }

  /** The app, signing out: this phone stops getting notifications. */
  @OpenOnHold()
  @Post('push-devices/unregister')
  @HttpCode(204)
  unregister(@Body() dto: UnregisterPushDeviceDto): Promise<void> {
    return this.notifications.unregisterDevice(dto.token);
  }
}
