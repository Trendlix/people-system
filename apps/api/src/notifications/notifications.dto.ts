import { PUSH_PLATFORMS, PUSH_TOKEN_MAX, type PushPlatform } from '@trendlix/shared';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from '../common/transforms.js';

// Notifications (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md, Phase 4): the inbox's page,
// the reminder switches, and the phone's push token from the app.

/** GET /me/notifications?page=N: the page, from 1. */
export class ListNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Choose a page from 1.' })
  @Min(1, { message: 'Choose a page from 1.' })
  @Max(10_000, { message: 'Choose a page from 1.' })
  page?: number;
}

/** PUT /me/notification-settings: the switches to change (one not sent stays as it is). */
export class NotificationSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'Say whether to remind you when you haven’t checked in: true or false.' })
  checkInReminder?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'Say whether to remind you when you’re still checked in: true or false.' })
  checkOutReminder?: boolean;
}

/** POST /me/push-devices: the phone's push token, as the app's Push Notifications plugin gave it. */
export class RegisterPushDeviceDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'The phone gave no push token.' })
  @MaxLength(PUSH_TOKEN_MAX, { message: 'That isn’t a push token.' })
  token: string;

  @IsIn(PUSH_PLATFORMS, { message: 'Choose Android or iPhone.' })
  platform: PushPlatform;
}

/** POST /me/push-devices/unregister: the token of the phone signing out. */
export class UnregisterPushDeviceDto {
  @Trim()
  @IsString()
  @MinLength(1, { message: 'The phone gave no push token.' })
  @MaxLength(PUSH_TOKEN_MAX, { message: 'That isn’t a push token.' })
  token: string;
}
