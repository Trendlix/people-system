import { Global, Module } from '@nestjs/common';
import { MailSettingsController } from './mail-settings.controller.js';
import { MailSettingsService } from './mail-settings.service.js';
import { MailService } from './mail.service.js';

/**
 * Email by SMTP, for any module (see MailService), and Organization → Email Settings, where a Super Admin sets it up
 * (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup").
 */
@Global()
@Module({ controllers: [MailSettingsController], providers: [MailService, MailSettingsService], exports: [MailService] })
export class MailModule {}
