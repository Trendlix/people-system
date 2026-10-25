import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { WHATSAPP_STATUS_ORDER } from '@trendlix/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { signatureOk, webhookEventsOf, whatsappProblem, type WebhookStatus } from './graph.js';
import { WhatsAppService } from './whatsapp.service.js';

// Meta's webhook (owner, 24 October 2026: "Directly to Meta"; the brief: "GET verification (hub.challenge), and POST with
// the X-Hub-Signature-256 check against the app secret, for statuses and STOP. Public, no session, rate-limited;
// nothing else is processed from it"). Meta calls the website (people.trendlix.com/whatsapp/webhook), which passes the
// call on unchanged; this answers it:
// - GET: Meta's check when the webhook is set up: hub.mode "subscribe" and our verify token answer hub.challenge;
// - POST: refused without a valid signature (the app secret's HMAC-SHA256 of the exact bytes); then the messages'
//   statuses kept (sent, delivered, read, failed with why: never going back), and STOP from a number answered
//   (WhatsAppService.reply). Anything else in it (other fields, other kinds of message) is left aside.
// At most 1,200 calls a minute in all, 600 from one address (behind the website and Caddy most share one): more answer 429,
// and Meta tries again later (a burst of messages brings three statuses each).

/** Calls a minute: in all, and from one address. */
export const WEBHOOK_LIMITS = { perMinute: 1200, perAddress: 600 } as const;

const NOT_VERIFIED = 'The verify token doesn’t match the one in WhatsApp Settings.';
const BAD_SIGNATURE = 'The signature doesn’t match.';

/** A minute's count of calls, in all and by address (Twilio's calls have their own: whatsapp-twilio-webhook.service.ts). */
export class Window {
  private minute = 0;
  private total = 0;
  private readonly byAddress = new Map<string, number>();

  /** Whether one more call from `address` is allowed this minute (and counts it). */
  allow(address: string, now = Date.now()): boolean {
    const minute = Math.floor(now / 60_000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.total = 0;
      this.byAddress.clear();
    }
    const mine = this.byAddress.get(address) ?? 0;
    if (this.total >= WEBHOOK_LIMITS.perMinute || mine >= WEBHOOK_LIMITS.perAddress) return false;
    this.total++;
    this.byAddress.set(address, mine + 1);
    return true;
  }
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger('WhatsAppWebhook');
  private readonly window = new Window();

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private limit(address: string | null | undefined): void {
    if (!this.window.allow(address || 'unknown')) throw new HttpException('Too many calls. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** GET: Meta's verification. Answers the challenge as it came, or 403. */
  async verify(query: Record<string, unknown>, address: string | null | undefined): Promise<string> {
    this.limit(address);
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const row = await this.prisma.whatsAppSettings.findUnique({ where: { id: 1 }, select: { verifyToken: true } });
    if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string' || !row?.verifyToken || !same(token, row.verifyToken) || challenge.length > 200) {
      throw new ForbiddenException(NOT_VERIFIED);
    }
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { webhookVerifiedAt: new Date() } });
    return challenge;
  }

  /**
   * POST: a signed call. Answers how many statuses were kept and whether a STOP was answered (for the tests); 401 for a
   * call without a valid signature (nothing in it is read).
   */
  async receive(raw: Buffer | undefined, signature: unknown, body: unknown, address: string | null | undefined, now = new Date()): Promise<{ statuses: number; stops: number }> {
    this.limit(address);
    const config = await this.whatsapp.config();
    const secret = this.whatsapp.readable(config.row, 'app_secret') ? this.whatsapp.appSecret(config.row) : null;
    if (!signatureOk(raw, signature, secret)) throw new UnauthorizedException(BAD_SIGNATURE);
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { webhookEventAt: now } });
    const { statuses, replies } = webhookEventsOf(body);
    let kept = 0;
    for (const s of statuses) {
      try {
        if (await this.status(s, now)) kept++;
      } catch (err) {
        this.logger.warn(`A WhatsApp status could not be kept: ${(err as Error).message}`);
      }
    }
    let stops = 0;
    for (const r of replies) {
      try {
        if (await this.whatsapp.reply(r.from, r.text, now)) stops++;
      } catch (err) {
        this.logger.warn(`A reply to the business number could not be read: ${(err as Error).message}`);
      }
    }
    return { statuses: kept, stops };
  }

  /** A message's status from Meta: forward only (sent → delivered → read), or failed with why. */
  private async status(s: WebhookStatus, now: Date): Promise<boolean> {
    return this.keep(s.wamid, s.status, s.at, s.status === 'failed' ? whatsappProblem(s.error ? { error: s.error } : null) : null, now);
  }

  /**
   * A message's status, by its id at the provider (Meta's wamid, or Twilio's message SID: its status callback, 25 October
   * 2026): forward only (sent → delivered → read), or failed with why in plain words; a message not ours is left aside.
   */
  async keep(wamid: string, status: WebhookStatus['status'], at: Date, failure: { message: string; code: number | null } | null, now: Date): Promise<boolean> {
    const s = { wamid, status, at };
    if (s.status === 'failed') {
      const p = failure ?? { message: 'It failed, without a reason given.', code: null };
      const { count } = await this.prisma.whatsAppMessage.updateMany({
        where: { wamid: s.wamid, status: { in: ['sending', 'sent'] } },
        data: { status: 'failed', failedAt: s.at, error: p.message, errorCode: p.code, updatedAt: now },
      });
      return count > 0;
    }
    const rank = WHATSAPP_STATUS_ORDER[s.status];
    const earlier = (Object.keys(WHATSAPP_STATUS_ORDER) as (keyof typeof WHATSAPP_STATUS_ORDER)[]).filter((k) => WHATSAPP_STATUS_ORDER[k] < rank);
    const data =
      s.status === 'sent'
        ? { status: 'sent', sentAt: s.at }
        : s.status === 'delivered'
          ? { status: 'delivered', deliveredAt: s.at }
          : { status: 'read', readAt: s.at };
    const { count } = await this.prisma.whatsAppMessage.updateMany({ where: { wamid: s.wamid, status: { in: ['sending', ...earlier] } }, data: { ...data, updatedAt: now } });
    // read before delivered was heard of: delivered then too
    if (count && s.status === 'read') await this.prisma.whatsAppMessage.updateMany({ where: { wamid: s.wamid, deliveredAt: null }, data: { deliveredAt: s.at } });
    return count > 0;
  }
}
