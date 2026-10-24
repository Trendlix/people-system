import { Global, Module } from '@nestjs/common';
import { MyWhatsAppController, WhatsAppLogController, WhatsAppSettingsController, WhatsAppTemplatesController, WhatsAppWebhookController } from './whatsapp.controller.js';
import { WhatsAppHttp } from './whatsapp-http.js';
import { WhatsAppSenderService } from './whatsapp-sender.service.js';
import { WhatsAppSettingsService } from './whatsapp-settings.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';
import { WhatsAppService } from './whatsapp.service.js';

/**
 * WhatsApp notifications through Meta's WhatsApp Cloud API (owner, 24 October 2026: "how to make whatsapp
 * notifications?"; "Employees and candidates"; "Approvals waiting, Request decisions, Check-in reminders, Interviews";
 * "Directly to Meta"): the settings a Super Admin sets, the templates, each person's opt-in, the queue and its sender,
 * Meta's webhook, and HR's log. Global, so the notifications and the recruitment flows queue messages with
 * WhatsAppService without wiring this module into theirs; WhatsAppHttp is the one door to Meta (the tests replace its
 * fetch).
 */
@Global()
@Module({
  controllers: [WhatsAppSettingsController, WhatsAppTemplatesController, WhatsAppLogController, MyWhatsAppController, WhatsAppWebhookController],
  providers: [WhatsAppHttp, WhatsAppService, WhatsAppSettingsService, WhatsAppSenderService, WhatsAppWebhookService],
  exports: [WhatsAppService, WhatsAppHttp, WhatsAppSenderService],
})
export class WhatsAppModule {}
