import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

// Sends email through the company's own email provider, by SMTP (job offers, owner's request, 15 October 2026). It is
// optional: without SMTP_HOST and MAIL_FROM nothing is sent, `configured` is false, and the screens offer the offer's
// link to send by hand instead. Settings (deploy/.env): SMTP_HOST, SMTP_PORT (587 unless set; 465 is TLS from the start),
// SMTP_USER, SMTP_PASS, MAIL_FROM (e.g. "TrendLIX HR <hr@trendlix.com>"). MAIL_TRANSPORT=memory keeps the messages in
// `outbox` instead of sending them, for the tests.

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface Mail {
  to: string;
  /** Where the answer goes: the HR user who sent it. */
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string | null;
  /** MAIL_TRANSPORT=memory: what would have been sent, oldest first. */
  readonly outbox: Mail[] = [];
  private readonly memory: boolean;

  constructor(config: ConfigService) {
    this.memory = config.get<string>('MAIL_TRANSPORT') === 'memory';
    this.from = config.get<string>('MAIL_FROM')?.trim() || (this.memory ? 'People System <hr@test.local>' : null);
    const host = config.get<string>('SMTP_HOST')?.trim();
    if (this.memory) {
      this.transport = nodemailer.createTransport({ jsonTransport: true });
    } else if (host && this.from) {
      const port = Number(config.get<string>('SMTP_PORT') || 587);
      const user = config.get<string>('SMTP_USER')?.trim();
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') ?? '' } : undefined,
      });
    } else {
      this.transport = null;
    }
  }

  /** Whether email can be sent: SMTP_HOST and MAIL_FROM are set. */
  get configured(): boolean {
    return this.transport !== null;
  }

  /** Sends one message; refused (503) when email isn't set up or the provider refuses it. */
  async send(mail: Mail): Promise<void> {
    if (!this.transport || !this.from) throw new ServiceUnavailableException("Email isn't set up on the server yet. Send the offer's link yourself instead.");
    try {
      await this.transport.sendMail({ from: this.from, ...mail });
    } catch (err) {
      this.logger.error(`Sending to ${mail.to} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The email could not be sent: the email provider refused it. Check the email settings, or send the link yourself.');
    }
    if (this.memory) this.outbox.push(mail);
  }
}
