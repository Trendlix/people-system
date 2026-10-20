import { Global, Module } from '@nestjs/common';
import { FcmSender } from './fcm-sender.service.js';
import { NoticesService } from './notices.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { RemindersService } from './reminders.service.js';

/**
 * Notifications (owner, 20 October 2026: "Push notifications: yes"; apps/mobile/README.md, Phase 4), for any module:
 * the emitter (NotificationsService.notify), what each flow's step tells whom (NoticesService), the FCM sender, the
 * reminders' scheduler, and the user's inbox, switches and phones (NotificationsController).
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NoticesService, FcmSender, RemindersService],
  exports: [NotificationsService, NoticesService, RemindersService],
})
export class NotificationsModule {}
