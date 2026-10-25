import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  inQuietHours,
  quietHoursEnd,
  twilioContentVariables,
  twilioTemplateName,
  WHATSAPP_MAX_ATTEMPTS,
  WHATSAPP_REMINDER_TEMPLATES,
  WHATSAPP_RETRY_MINUTES,
  WHATSAPP_ROUND_SECONDS,
  WHATSAPP_SEND_PER_ROUND,
  whatsappNumber,
  whatsappTemplateMessage,
  whatsappTextMessage,
  whatsappTwilioStatusUrl,
  type WhatsAppLanguage,
  type WhatsAppTemplateKey,
} from '@trendlix/shared';
import { webOriginOf } from '../employee-access/employee-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sendRequest, wamidOf, whatsappProblem, type GraphRequest } from './graph.js';
import { twilioMessageForm, twilioMessageSidOf, twilioProblem, twilioSendRequest } from './twilio.js';
import { WhatsAppHttp } from './whatsapp-http.js';
import { WhatsAppService } from './whatsapp.service.js';

// The WhatsApp sender (owner, 24 October 2026: "Directly to Meta"; the brief: "a sender in the scheduler with retries and
// backoff, and a rate limit"): every 15 seconds a round, under a Postgres advisory lock so one process sends at a time:
// - the candidates' reminders the day before their interview queued (from 10:00 Cairo), so they go in the same round;
// - what waited too long cancelled (a day; a check-in reminder half an hour; an interview's reminder at its start), and
//   a message left "sending" by a process that stopped marked failed (it may or may not have gone: never sent twice);
// - in quiet hours nothing goes but the answer to a STOP (a reply they asked for), and a check-in reminder is dropped;
// - then up to 20 due messages claimed and sent one by one (about 80 a minute at most, well within Meta's limits), each
//   with its template only while it is approved; a refusal worth trying again goes back in the queue after 1, 5, 30 and
//   120 minutes, then fails; any other fails at once, with the reason in plain words.
// Started by main.ts, so the tests' apps don't run it by themselves: they call runOnce with a moment of their own.
// Through the provider chosen when it is sent (owner, 25 October 2026: "Add Twilio as a choice"): Meta's Cloud API, or
// Twilio's Messages API (the template's Content SID and its variables, or the STOP answer's text; Twilio's message SID
// kept as the message's id, its status callback with each). A message queued before a switch goes by the new provider,
// with its own approved templates; one not approved there isn't sent (the bell, push and email had it already).

const LOCK_NAME = 'people-system whatsapp sender';

/** A message "sending" for this long was left by a process that stopped. */
const STALE_MS = 10 * 60_000;

export interface WhatsAppRound {
  sent: number;
  failed: number;
  retried: number;
  cancelled: number;
  reminders: number;
}

@Injectable()
export class WhatsAppSenderService implements OnModuleDestroy {
  private readonly logger = new Logger('WhatsAppSender');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Twilio's status callback, sent with each message (the website passes it on). */
  private readonly statusCallback: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly http: WhatsAppHttp,
  ) {
    this.statusCallback = whatsappTwilioStatusUrl(webOriginOf(config));
  }

  /** Starts a round every 15 seconds (main.ts, once the API listens). The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), WHATSAPP_ROUND_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round, unless the last is still going. Never throws. */
  async tick(now = new Date()): Promise<WhatsAppRound | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.runOnce(now);
    } catch (err) {
      this.logger.error(`The WhatsApp round could not run: ${(err as Error).message}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** A round at `now`; null when another process holds the lock. */
  async runOnce(now = new Date()): Promise<WhatsAppRound | null> {
    const round: WhatsAppRound = { sent: 0, failed: 0, retried: 0, cancelled: 0, reminders: 0 };
    // the candidates' reminders first, so they go in this round (each claimed on its interview: never twice)
    try {
      round.reminders = await this.whatsapp.interviewReminders(now);
    } catch (err) {
      this.logger.error(`The interview reminders could not be queued: ${(err as Error).message}`);
    }
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_NAME})) AS locked`;
        if (!lock?.locked) return null;
        // too late to send
        const late = await tx.whatsAppMessage.updateMany({
          where: { status: 'queued', sendBefore: { lte: now } },
          data: { status: 'cancelled', error: 'Too late to send: it waited past its time (quiet hours, retries, or WhatsApp switched off).', updatedAt: now },
        });
        round.cancelled += late.count;
        // left "sending" by a process that stopped: never sent again, so never twice
        const stale = await tx.whatsAppMessage.updateMany({
          where: { status: 'sending', claimedAt: { lt: new Date(now.getTime() - STALE_MS) } },
          data: { status: 'failed', failedAt: now, error: 'The server stopped while sending it: it may or may not have gone.', updatedAt: now },
        });
        round.failed += stale.count;
        const config = await this.whatsapp.config();
        if (!config.ready) return [];
        const quiet = inQuietHours(now, config.quiet);
        if (quiet) {
          // a reminder isn't held through the night
          const dropped = await tx.whatsAppMessage.updateMany({
            where: { status: 'queued', template: { in: [...WHATSAPP_REMINDER_TEMPLATES] } },
            data: { status: 'cancelled', error: 'Quiet hours: a reminder isn’t held until morning.', updatedAt: now },
          });
          round.cancelled += dropped.count;
        }
        // claimed in one statement: due, oldest first, at most a round's worth; in quiet hours only a STOP's answer
        return tx.$queryRaw<{ id: string }[]>`
          UPDATE whatsapp_messages SET status = 'sending', claimed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
          WHERE id IN (
            SELECT id FROM whatsapp_messages
            WHERE status = 'queued' AND next_attempt_at <= ${now}::timestamptz
              AND (send_before IS NULL OR send_before > ${now}::timestamptz)
              AND (${quiet}::boolean = false OR template = 'stop_confirmation')
            ORDER BY next_attempt_at, created_at
            LIMIT ${WHATSAPP_SEND_PER_ROUND}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id`;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (claimed === null) return null;
    for (const { id } of claimed) await this.send(id, now, round);
    if (round.sent || round.failed || round.retried) this.logger.log(`WhatsApp: ${round.sent} sent, ${round.retried} to try again, ${round.failed} failed.`);
    return round;
  }

  /** Sends one claimed message, and keeps what came of it. */
  private async send(id: string, now: Date, round: WhatsAppRound): Promise<void> {
    const m = await this.prisma.whatsAppMessage.findUnique({ where: { id } });
    if (!m || m.status !== 'sending') return;
    const config = await this.whatsapp.config();
    const twilio = config.provider === 'twilio';
    const token = !config.ready ? null : twilio ? this.whatsapp.twilioToken(config.row) : this.whatsapp.token(config.row);
    const phoneNumberId = config.row?.phoneNumberId ?? null;
    const accountSid = config.row?.twilioAccountSid ?? null;
    const sender = config.row?.twilioSender ?? null;
    if (!token || (twilio ? !accountSid || !sender : !phoneNumberId)) {
      await this.prisma.whatsAppMessage.update({ where: { id }, data: { status: 'queued', claimedAt: null, updatedAt: now } });
      return;
    }
    const vars = (m.variables ?? {}) as { body?: unknown; button?: unknown; text?: unknown };
    let request: GraphRequest;
    if (m.template === 'stop_confirmation') {
      const text = typeof vars.text === 'string' ? vars.text : '';
      request = twilio
        ? twilioSendRequest(accountSid!, token, twilioMessageForm({ to: m.mobile, sender: sender!, text, statusCallback: this.statusCallback }))
        : sendRequest(phoneNumberId!, token, whatsappTextMessage(whatsappNumber(m.mobile), text));
    } else {
      // only an approved template is ever sent: one Meta (or Twilio) paused or rejected since, or one not approved yet
      // by the provider switched to, falls back to the other channels
      const key = `${m.template as WhatsAppTemplateKey}:${m.language}`;
      if (!config.approved.has(key)) {
        const error = twilio ? 'Its template isn’t approved on Twilio (not yet, or not any more): not sent.' : 'Its template isn’t approved by Meta any more: not sent.';
        await this.prisma.whatsAppMessage.update({ where: { id }, data: { status: 'cancelled', error, updatedAt: now } });
        round.cancelled++;
        return;
      }
      const body = Array.isArray(vars.body) ? vars.body.map(String) : [];
      const button = typeof vars.button === 'string' ? vars.button : null;
      request = twilio
        ? twilioSendRequest(accountSid!, token, twilioMessageForm({ to: m.mobile, sender: sender!, content: { sid: config.contentSids.get(key)!, variables: twilioContentVariables(body, button) }, statusCallback: this.statusCallback }))
        : sendRequest(phoneNumberId!, token, whatsappTemplateMessage(whatsappNumber(m.mobile), { name: m.templateName, language: m.language }, body, button));
    }
    const answer = await this.http.send(request);
    const wamid = twilio ? twilioMessageSidOf(answer) : answer && answer.status >= 200 && answer.status < 300 ? wamidOf(answer.body) : null;
    const attempts = m.attempts + 1;
    if (wamid) {
      // Twilio's template by its name there (people_<key>_<lang>), so the log says what went
      const templateName = twilio && m.template !== 'stop_confirmation' ? twilioTemplateName(m.template as WhatsAppTemplateKey, m.language as WhatsAppLanguage) : m.templateName;
      await this.prisma.whatsAppMessage.update({
        where: { id },
        data: { status: 'sent', wamid, provider: config.provider, templateName, sentAt: now, attempts, error: null, errorCode: null, claimedAt: null, updatedAt: now },
      });
      round.sent++;
      return;
    }
    const problem = twilio ? twilioProblem(answer) : whatsappProblem(answer);
    if (problem.retry && attempts < WHATSAPP_MAX_ATTEMPTS) {
      const next = Math.max(now.getTime() + WHATSAPP_RETRY_MINUTES[attempts - 1] * 60_000, quietHoursEnd(now.getTime() + WHATSAPP_RETRY_MINUTES[attempts - 1] * 60_000, config.quiet));
      await this.prisma.whatsAppMessage.update({
        where: { id },
        data: { status: 'queued', attempts, nextAttemptAt: new Date(next), error: problem.message, errorCode: problem.code, claimedAt: null, updatedAt: now },
      });
      round.retried++;
      return;
    }
    await this.prisma.whatsAppMessage.update({
      where: { id },
      data: {
        status: 'failed',
        provider: config.provider,
        attempts,
        failedAt: now,
        error: problem.retry ? `${problem.message.replace(/: it will be tried again\.$/, '.')} Tried ${attempts} times.` : problem.message,
        errorCode: problem.code,
        claimedAt: null,
        updatedAt: now,
      },
    });
    round.failed++;
  }
}
