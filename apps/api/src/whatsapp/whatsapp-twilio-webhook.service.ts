import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WHATSAPP_TWILIO_INCOMING_PATH, WHATSAPP_TWILIO_STATUS_PATH } from '@trendlix/shared';
import { webOriginOf } from '../employee-access/employee-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formParamsOf, twilioIncomingOf, twilioProblem, twilioSignatureOk, twilioStatusOf } from './twilio.js';
import { WhatsAppWebhookService, Window } from './whatsapp-webhook.service.js';
import { WhatsAppService } from './whatsapp.service.js';

// Twilio's calls for WhatsApp (owner, 25 October 2026: "Add Twilio as a choice"; "No, WhatsApp only"). Twilio calls the
// website (people.trendlix.com/whatsapp/twilio/status and …/incoming), which passes each call on with its bytes and its
// X-Twilio-Signature as they came; this answers them:
// - every call refused without a valid signature: the Auth Token's HMAC-SHA1 of the PUBLIC URL Twilio called (the
//   website's, from WEB_ORIGIN, never this API's own address) and its POST parameters; nothing in it is read before;
// - the status callback: a message's status (sent, delivered, read; failed or undelivered with Twilio's ErrorCode in
//   plain words), never going back, as Meta's statuses are kept (WhatsAppWebhookService.keep);
// - an incoming message: STOP (or توقف) opts the number out and is answered once through Twilio, within the 24 hours
//   (WhatsAppService.reply queues the answer; the sender sends it); anything else gets no answer. Only WhatsApp: an SMS
//   to the number is never read.
// Read whichever provider sends now: a message sent through Twilio before a switch still has its statuses, and a STOP
// is always heard. Rate-limited as Meta's webhook is (its own count).

const BAD_SIGNATURE = 'The signature doesn’t match.';

/** The longest query string taken on the public URL (Twilio's own calls have none, unless one was pasted with it). */
const SEARCH_MAX = 1024;

@Injectable()
export class WhatsAppTwilioWebhookService {
  private readonly logger = new Logger('WhatsAppTwilioWebhook');
  private readonly window = new Window();
  private readonly origin: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly webhook: WhatsAppWebhookService,
  ) {
    this.origin = webOriginOf(config);
  }

  private limit(address: string | null | undefined): void {
    if (!this.window.allow(address || 'unknown')) throw new HttpException('Too many calls. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** The call's parameters, once its signature is the saved Auth Token's for the public URL; 403 otherwise. */
  private async verified(path: string, search: string, raw: Buffer | undefined, signature: unknown, now: Date): Promise<[string, string][]> {
    const config = await this.whatsapp.config();
    const token = this.whatsapp.readable(config.row, 'twilio_auth_token') ? this.whatsapp.twilioToken(config.row) : null;
    const params = formParamsOf(raw);
    const query = search.length <= SEARCH_MAX && search.startsWith('?') ? search : '';
    if (!twilioSignatureOk(`${this.origin}${path}${query}`, params, signature, token)) throw new ForbiddenException(BAD_SIGNATURE);
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { twilioEventAt: now } });
    return params;
  }

  /** POST …/twilio/status: a message's status. Answers whether it was kept (for the tests). */
  async status(raw: Buffer | undefined, signature: unknown, search: string, address: string | null | undefined, now = new Date()): Promise<{ statuses: number }> {
    this.limit(address);
    const params = await this.verified(WHATSAPP_TWILIO_STATUS_PATH, search, raw, signature, now);
    const s = twilioStatusOf(params);
    if (!s) return { statuses: 0 };
    try {
      const failure = s.status === 'failed' ? twilioProblem({ code: s.errorCode }) : null;
      const kept = await this.webhook.keep(s.sid, s.status, now, failure, now);
      // the test message failing after Twilio took it (63016: a text outside the 24 hours): its result says so
      if (kept && failure) {
        const m = await this.prisma.whatsAppMessage.findFirst({ where: { wamid: s.sid, template: 'test_message' }, select: { id: true } });
        if (m) await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { lastTestOk: false, lastTestMessage: failure.message } });
      }
      return { statuses: kept ? 1 : 0 };
    } catch (err) {
      this.logger.warn(`A WhatsApp status from Twilio could not be kept: ${(err as Error).message}`);
      return { statuses: 0 };
    }
  }

  /** POST …/twilio/incoming: what someone wrote. Answers whether it was a STOP (for the tests). */
  async incoming(raw: Buffer | undefined, signature: unknown, search: string, address: string | null | undefined, now = new Date()): Promise<{ stops: number }> {
    this.limit(address);
    const params = await this.verified(WHATSAPP_TWILIO_INCOMING_PATH, search, raw, signature, now);
    const m = twilioIncomingOf(params);
    if (!m) return { stops: 0 };
    try {
      return { stops: (await this.whatsapp.reply(m.from, m.text, now)) ? 1 : 0 };
    } catch (err) {
      this.logger.warn(`A message to the business number (through Twilio) could not be read: ${(err as Error).message}`);
      return { stops: 0 };
    }
  }
}
