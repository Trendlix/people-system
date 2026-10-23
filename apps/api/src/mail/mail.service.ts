import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { addressOfSender, mailFromText, mailMissing, type MailProvider, type MailSecurity, type MailSource } from '@trendlix/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { keyIdOf, mailKeyOf, openSecret, sameKey, sealSecret } from './mail-secret.js';
import { smtpProblem, transportOptions, type SmtpSettings } from './smtp-problems.js';

// Sends email through the company's own email provider, by SMTP (job offers, owner's request, 15 October 2026; the
// invitations, interviews and the rest since). Where from, in this order:
// 1. The system's settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"):
//    Organization → Email Settings, a Super Admin's (mail-settings.service.ts), while switched on and complete (the
//    server, the sender's address, and the password when there is a username, readable with this server's key). Read
//    from the database at most every 30 seconds, and at once after a save (forget()).
// 2. Else the server's settings, exactly as before (deploy/.env): SMTP_HOST, SMTP_PORT (587 unless set; 465 is TLS from
//    the start), SMTP_USER, SMTP_PASS, MAIL_FROM (e.g. "TrendLIX HR <hr@trendlix.com>"), both SMTP_HOST and MAIL_FROM
//    needed.
// 3. Else nothing is sent: ready() is false, and the screens offer the link to send by hand instead, as before.
// MAIL_TRANSPORT=memory keeps the messages in `outbox` instead of sending them, for the tests: whichever settings apply,
// nothing leaves the machine, and each message kept says the sender and the settings it went with. The test email
// (sendTest) always talks to the server: that is its point.

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface Mail {
  to: string;
  /** Where the answer goes: the HR user who sent it; else the settings' reply-to, if any. */
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

/** A message as MAIL_TRANSPORT=memory keeps it: with the sender it went from and whose settings those were. */
export interface KeptMail extends Mail {
  from: string;
  source: Exclude<MailSource, 'none'>;
}

/** Where emails go out from now, as the settings page says it: the source and its sender. */
export interface MailSending {
  source: MailSource;
  /** "TrendLIX HR <hr@trendlix.com>", or null when nothing is sent. */
  from: string | null;
  address: string | null;
}

/** One way of sending: a transport and the sender it goes with. */
interface Sender {
  source: Exclude<MailSource, 'none'>;
  transport: Transporter;
  from: { name: string; address: string } | string;
  fromText: string;
  replyTo: string | null;
}

/** A test email's settings: what the form says, the password opened. */
export interface MailTestSettings extends SmtpSettings {
  provider: MailProvider;
  fromName: string | null;
  fromAddress: string;
  replyTo: string | null;
}

/** How long the saved settings are kept before they are read again; a save clears them at once. */
const KEPT_MS = 30_000;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** The server's settings (deploy/.env), made once: the fallback. */
  private readonly server: Sender | null;
  /** The key the saved password is sealed with, from JWT_SECRET (mail-secret.ts). */
  private readonly key: Buffer;
  /** MAIL_TRANSPORT=memory: what would have been sent, oldest first. */
  readonly outbox: KeptMail[] = [];
  private readonly memory: boolean;
  private kept: { at: number; row: Promise<MailSettings | null> } | null = null;
  /** The system's transport, made from the saved settings as they were (`stamp`) when first needed. */
  private system: { stamp: string; sender: Sender | null } | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.memory = config.get<string>('MAIL_TRANSPORT') === 'memory';
    this.key = mailKeyOf(config.getOrThrow<string>('JWT_SECRET'));
    const from = config.get<string>('MAIL_FROM')?.trim() || (this.memory ? 'People System <hr@test.local>' : null);
    const host = config.get<string>('SMTP_HOST')?.trim();
    if (this.memory && from) {
      this.server = { source: 'server', transport: nodemailer.createTransport({ jsonTransport: true }), from, fromText: from, replyTo: null };
    } else if (host && from) {
      const port = Number(config.get<string>('SMTP_PORT') || 587);
      const user = config.get<string>('SMTP_USER')?.trim();
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') ?? '' } : undefined,
      });
      this.server = { source: 'server', transport, from, fromText: from, replyTo: null };
    } else {
      this.server = null;
    }
  }

  // ---------- the saved settings ----------

  /** The saved settings' row (id 1), or null: kept 30 seconds; a failed read isn't kept. */
  settingsRow(): Promise<MailSettings | null> {
    if (!this.kept || Date.now() - this.kept.at > KEPT_MS) {
      const row = this.prisma.mailSettings.findUnique({ where: { id: 1 } });
      const kept = { at: Date.now(), row };
      this.kept = kept;
      void row.catch(() => {
        if (this.kept === kept) this.kept = null;
      });
    }
    return this.kept.row;
  }

  /** After a save: the settings are read again, and the transport made again, on the next email. */
  forget(): void {
    this.kept = null;
    const old = this.system?.sender?.transport;
    this.system = null;
    if (old && old !== this.server?.transport) old.close();
  }

  /** Whether a saved password can be opened with this server's key, told by its fingerprint: never opened to tell. */
  passwordReadable(row: Pick<MailSettings, 'passwordEnc' | 'passwordKeyId'> | null): boolean {
    return !!row?.passwordEnc && sameKey(row.passwordKeyId, this.key);
  }

  /** A password sealed for saving, with the fingerprint of the key that sealed it. */
  sealPassword(plain: string): { passwordEnc: string; passwordKeyId: string } {
    return { passwordEnc: sealSecret(plain, this.key), passwordKeyId: keyIdOf(this.key) };
  }

  /** The saved password, opened: only to send (sendTest with the saved one, or the system's transport). */
  openPassword(row: Pick<MailSettings, 'passwordEnc'> | null): string | null {
    return openSecret(row?.passwordEnc, this.key);
  }

  /** Whether the saved settings are used: switched on and complete, their password (if needed) readable here. */
  systemUsable(row: MailSettings | null): row is MailSettings & { host: string; fromAddress: string } {
    if (!row?.enabled) return false;
    return mailMissing({ host: row.host, fromAddress: row.fromAddress, username: row.username, password: this.passwordReadable(row) }).length === 0;
  }

  /** Where emails go out from now, without opening the password: the system's settings, the server's, or none. */
  sendingWith(row: MailSettings | null): MailSending {
    if (this.systemUsable(row)) {
      return { source: 'system', from: mailFromText(row.fromName, row.fromAddress), address: row.fromAddress };
    }
    if (this.server) return { source: 'server', from: this.server.fromText, address: addressOfSender(this.server.fromText) };
    return { source: 'none', from: null, address: null };
  }

  // ---------- sending ----------

  /** Whether email can be sent: the system's settings are on and complete, or the server's are set. */
  async ready(): Promise<boolean> {
    return this.sendingWith(await this.readRow()).source !== 'none';
  }

  /** Sends one message; refused (503) when email isn't set up or the provider refuses it. */
  async send(mail: Mail): Promise<void> {
    const sender = await this.sender();
    if (!sender) throw new ServiceUnavailableException("Email isn't set up on the server yet. Send the offer's link yourself instead.");
    const replyTo = mail.replyTo ?? sender.replyTo ?? undefined;
    try {
      await sender.transport.sendMail({ ...mail, from: sender.from, replyTo });
    } catch (err) {
      this.logger.error(`Sending to ${mail.to} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The email could not be sent: the email provider refused it. Check the email settings, or send the link yourself.');
    }
    if (this.memory) this.outbox.push({ ...mail, ...(replyTo && { replyTo }), from: sender.fromText, source: sender.source });
  }

  /**
   * A short test email with these settings, through the server they name (never the memory outbox): ok, or why not in
   * plain words (smtp-problems.ts).
   */
  async sendTest(s: MailTestSettings, to: string): Promise<{ ok: boolean; message: string }> {
    const transport = nodemailer.createTransport(transportOptions(s));
    try {
      await transport.sendMail({
        from: { name: s.fromName ?? '', address: s.fromAddress },
        to,
        replyTo: s.replyTo ?? undefined,
        subject: 'Test email from Trendlix People',
        text: [
          'This is a test email from Trendlix People, the company’s HR system.',
          '',
          `It was sent through ${s.host} on port ${s.port}, from ${mailFromText(s.fromName, s.fromAddress)}.`,
          'If you can read this, the email settings work.',
        ].join('\n'),
      });
      return { ok: true, message: `Sent to ${to}. Check that it arrived, and look in the spam folder if it didn’t.` };
    } catch (err) {
      const message = smtpProblem(err, { host: s.host, port: s.port, provider: s.provider });
      this.logger.warn(`A test email to ${to} through ${s.host}:${s.port} failed: ${message}`);
      return { ok: false, message };
    } finally {
      transport.close();
    }
  }

  /** The saved row, or null when it can't be read: then the server's settings, as before there was a page. */
  private async readRow(): Promise<MailSettings | null> {
    try {
      return await this.settingsRow();
    } catch (err) {
      this.logger.warn(`The email settings could not be read, so the server's are used: ${(err as Error).message}`);
      return null;
    }
  }

  /** How the next email goes: the system's settings when usable, else the server's, else none. */
  private async sender(): Promise<Sender | null> {
    const row = await this.readRow();
    if (!this.systemUsable(row)) return this.server;
    const stamp = `${row.updatedAt.toISOString()}|${row.passwordKeyId ?? ''}`;
    if (this.system?.stamp !== stamp) {
      const old = this.system?.sender?.transport;
      this.system = { stamp, sender: this.systemSender(row) };
      old?.close();
    }
    return this.system.sender ?? this.server;
  }

  /** The system's transport, from the saved settings; null when the saved password won't open (then the server's). */
  private systemSender(row: MailSettings & { host: string; fromAddress: string }): Sender | null {
    const password = row.username ? this.openPassword(row) : null;
    if (row.username && password === null) {
      this.logger.warn("The saved email password can't be opened with this server's key, so the server's settings are used.");
      return null;
    }
    const settings: SmtpSettings = { host: row.host, port: row.port, security: row.security as MailSecurity, username: row.username, password };
    const transport = this.memory ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(transportOptions(settings));
    return {
      source: 'system',
      transport,
      from: { name: row.fromName ?? '', address: row.fromAddress },
      fromText: mailFromText(row.fromName, row.fromAddress),
      replyTo: row.replyTo,
    };
  }
}
