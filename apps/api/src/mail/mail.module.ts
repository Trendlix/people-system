import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/** Email by SMTP, for any module (see MailService). */
@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
