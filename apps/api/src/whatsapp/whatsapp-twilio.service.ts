import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  twilioApprovalRequest,
  twilioContentRequest,
  twilioContentVariables,
  twilioTemplateName,
  WHATSAPP_CATEGORY,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TWILIO_TOKEN_UNREADABLE,
  whatsappContent,
  whatsappPreview,
  whatsappTwilioIncomingUrl,
  whatsappTwilioMissing,
  whatsappTwilioStatusUrl,
  type WhatsAppLanguage,
  type WhatsAppTemplateKey,
  type WhatsAppTemplateStatus,
  type WhatsAppTemplateStatusView,
  type WhatsAppTemplatesResult,
  type WhatsAppTestView,
  type WhatsAppTwilioView,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { webOriginOf } from '../employee-access/employee-access.service.js';
import type { WhatsAppSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  approvalOf,
  contentSidOf,
  listedContentsOf,
  twilioCreateContentRequest,
  twilioFetchApprovalRequest,
  twilioListContentRequest,
  twilioMessageForm,
  twilioMessageSidOf,
  twilioProblem,
  twilioSendRequest,
  twilioSubmitApprovalRequest,
  type TwilioProblem,
} from './twilio.js';
import { WhatsAppHttp } from './whatsapp-http.js';
import { WHATSAPP_SETTINGS_ENTITY, WhatsAppService } from './whatsapp.service.js';

// WhatsApp Settings' Twilio side (owner, 25 October 2026: "Add Twilio as a choice"): what the page shows of Twilio
// (never the Auth Token), Send a test message through Twilio, and the templates: the same 17 in English and Arabic made
// as Twilio Content (twilio/text, or twilio/call-to-action with the button), submitted for WhatsApp's approval (Utility)
// and their approval synced, each Content's SID kept. Called by WhatsAppSettingsService once it has checked that it is a
// Super Admin in their own session; each press works on Twilio whichever provider sends now, so Twilio's templates can
// be approved before switching. Every press audited, with "provider: twilio".

/** Twilio's refusal of a whole press, in words, with what it was (a sign-in, the account, Twilio not reached). */
class TwilioRefusal extends Error {
  constructor(readonly problem: TwilioProblem) {
    super(problem.message);
  }
}

/** A refusal that fails every request of a press alike: said once. */
const fatal = (p: TwilioProblem) => p.kind === 'auth' || p.kind === 'account' || p.kind === 'unreachable';

/** "already" at Twilio: the Content was submitted for WhatsApp's approval before. */
const ALREADY = /already|exists|duplicate/i;

const ok = (a: { status: number } | null): boolean => !!a && a.status >= 200 && a.status < 300;

@Injectable()
export class WhatsAppTwilioService {
  private readonly origin: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly whatsapp: WhatsAppService,
    private readonly http: WhatsAppHttp,
  ) {
    this.origin = webOriginOf(config);
  }

  /** Twilio's part of the settings page: the Auth Token only as set or not. */
  viewOf(row: WhatsAppSettings | null, templates: WhatsAppTemplateStatusView[]): WhatsAppTwilioView {
    const tokenOk = this.whatsapp.readable(row, 'twilio_auth_token');
    const sender = row?.twilioSender ?? null;
    return {
      accountSid: row?.twilioAccountSid ?? null,
      authTokenSet: !!row?.twilioAuthTokenEnc,
      authTokenUnreadable: !!row?.twilioAuthTokenEnc && !tokenOk,
      sender,
      senderKind: sender ? (sender.startsWith('MG') ? 'service' : 'number') : null,
      statusCallbackUrl: whatsappTwilioStatusUrl(this.origin),
      incomingUrl: whatsappTwilioIncomingUrl(this.origin),
      templates,
      templatesSyncedAt: row?.twilioTemplatesSyncedAt?.toISOString() ?? null,
      lastEventAt: row?.twilioEventAt?.toISOString() ?? null,
      missing: whatsappTwilioMissing({ accountSid: row?.twilioAccountSid ?? null, authToken: tokenOk, sender }),
    };
  }

  /** Every template in each language, as last submitted or synced on Twilio (not submitted: none kept). */
  async templates(): Promise<WhatsAppTemplateStatusView[]> {
    const rows = await this.prisma.whatsAppTwilioTemplate.findMany();
    const byKey = new Map(rows.map((r) => [`${r.key}:${r.language}`, r]));
    return WHATSAPP_TEMPLATE_KEYS.flatMap((key) =>
      WHATSAPP_LANGUAGES.map((language) => {
        const r = byKey.get(`${key}:${language}`);
        return {
          key,
          name: twilioTemplateName(key, language),
          label: WHATSAPP_TEMPLATES[key].label,
          language,
          category: WHATSAPP_CATEGORY,
          status: (r?.status ?? 'not_submitted') as WhatsAppTemplateStatus,
          reason: r?.reason ?? null,
          submittedAt: r?.submittedAt?.toISOString() ?? null,
          syncedAt: r?.syncedAt?.toISOString() ?? null,
        };
      }),
    );
  }

  /** The saved Account SID and Auth Token (and the sender, to send), or the refusal in words. */
  private async connection(need: 'send' | 'templates'): Promise<{ row: WhatsAppSettings; accountSid: string; token: string; sender: string }> {
    const row = await this.prisma.whatsAppSettings.findUniqueOrThrow({ where: { id: 1 } });
    const lacking: string[] = [];
    if (!row.twilioAccountSid) lacking.push('the Account SID');
    if (!row.twilioAuthTokenEnc) lacking.push('the Auth Token');
    if (need === 'send' && !row.twilioSender) lacking.push('the WhatsApp sender');
    if (lacking.length) throw new BadRequestException([`Save Twilio’s ${lacking.length === 1 ? lacking[0] : `${lacking.slice(0, -1).join(', ')} and ${lacking[lacking.length - 1]}`} first.`]);
    const token = this.whatsapp.readable(row, 'twilio_auth_token') ? this.whatsapp.twilioToken(row) : null;
    if (!token) throw new BadRequestException([WHATSAPP_TWILIO_TOKEN_UNREADABLE]);
    return { row, accountSid: row.twilioAccountSid!, token, sender: row.twilioSender ?? '' };
  }

  /**
   * Send a test message through Twilio to `mobile` (+201…), with the saved settings: our own test template once it is
   * approved on Twilio in English; until then a plain text, which WhatsApp delivers only within 24 hours of that phone
   * writing to the business number (else Twilio fails it after taking it, error 63016, and the status callback says so
   * here and in the log). Kept as the last test, in the log and the audit log.
   */
  async test(mobile: string, user: SessionUser): Promise<WhatsAppTestView> {
    const { accountSid, token, sender } = await this.connection('send');
    const ours = await this.prisma.whatsAppTwilioTemplate.findUnique({ where: { key_language: { key: 'test_message', language: 'en' } }, select: { status: true, contentSid: true } });
    const company = (await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } }))?.nameEn?.trim() || 'the company';
    const approved = ours?.status === 'approved' && !!ours.contentSid;
    const content = whatsappContent({ template: 'test_message', company }, 'en');
    const name = twilioTemplateName('test_message', 'en');
    const form = twilioMessageForm({
      to: mobile,
      sender,
      ...(approved ? { content: { sid: ours.contentSid!, variables: twilioContentVariables(content.body, null) } } : { text: whatsappPreview('test_message', 'en', content.body) }),
      statusCallback: whatsappTwilioStatusUrl(this.origin),
    });
    const answer = await this.http.send(twilioSendRequest(accountSid, token, form));
    const sid = twilioMessageSidOf(answer);
    const problem = sid ? null : twilioProblem(answer);
    const at = new Date();
    const message = sid
      ? approved
        ? `Sent to ${mobile} through Twilio with ${name}.`
        : `Sent to ${mobile} through Twilio as a plain text, until ${name} is approved: it arrives only if that phone wrote to the business number in the last 24 hours. Otherwise Twilio fails it (error 63016), and this says so.`
      : problem!.message;
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { lastTestAt: at, lastTestOk: !!sid, lastTestMessage: message } });
    await this.prisma.whatsAppMessage.create({
      data: {
        mobile,
        template: 'test_message',
        templateName: approved ? name : 'text',
        language: 'en',
        kind: 'test_message',
        variables: { body: approved ? content.body : [], button: null },
        reference: 'Test',
        status: sid ? 'sent' : 'failed',
        wamid: sid,
        provider: 'twilio',
        error: problem?.message ?? null,
        errorCode: problem?.code ?? null,
        attempts: 1,
        nextAttemptAt: at,
        createdAt: at,
        sentAt: sid ? at : null,
        failedAt: sid ? null : at,
        updatedAt: at,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'send_test_message',
      entityType: WHATSAPP_SETTINGS_ENTITY,
      entityId: null,
      diff: { provider: 'twilio', sentTo: mobile, template: approved ? name : 'text', sent: !!sid, ...(problem && { reason: problem.message }) },
    });
    return { at: at.toISOString(), ok: !!sid, message };
  }

  /**
   * Submit templates on Twilio: every template in each language not already approved or under review made as Content
   * (one made before, by an earlier press or by hand with its name, is used again) and submitted for WhatsApp's
   * approval (Utility); then their approval synced. Audited.
   */
  async submit(user: SessionUser): Promise<WhatsAppTemplatesResult> {
    const { accountSid, token } = await this.connection('templates');
    const kept = new Map((await this.prisma.whatsAppTwilioTemplate.findMany()).map((t) => [`${t.key}:${t.language}`, t]));
    let made = 0;
    let submitted = 0;
    const refused: string[] = [];
    let found: Map<string, string> | null = null;
    const stop = async (problem: TwilioProblem) => {
      await this.audit.record({ userId: user.id, action: 'submit_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { provider: 'twilio', made, submitted, refused: problem.message } });
      return { ok: false, message: problem.message, templates: await this.templates() };
    };
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      for (const language of WHATSAPP_LANGUAGES) {
        const k = kept.get(`${key}:${language}`);
        if (k && ['approved', 'pending', 'in_appeal'].includes(k.status)) continue;
        const name = twilioTemplateName(key, language);
        let sid = k?.contentSid ?? null;
        if (!sid) {
          try {
            found ??= await this.contentsByName(accountSid, token);
          } catch (err) {
            if (err instanceof TwilioRefusal) return stop(err.problem);
            throw err;
          }
          sid = found.get(name) ?? null;
        }
        if (!sid) {
          const answer = await this.http.send(twilioCreateContentRequest(accountSid, token, twilioContentRequest(key, language, this.origin)));
          sid = contentSidOf(answer);
          if (!sid) {
            const problem = twilioProblem(answer);
            if (fatal(problem)) return stop(problem);
            refused.push(`${name}: ${problem.message}`);
            continue;
          }
          made++;
        }
        // kept at once, so a refusal below never leaves a Content made and forgotten
        if (sid !== k?.contentSid) await this.keepTemplate(key, language, { contentSid: sid, status: (k?.status as WhatsAppTemplateStatus | undefined) ?? 'not_submitted' });
        const answer = await this.http.send(twilioSubmitApprovalRequest(accountSid, token, sid, twilioApprovalRequest(key, language)));
        if (ok(answer)) {
          const approval = approvalOf(answer!.body);
          await this.keepTemplate(key, language, { contentSid: sid, status: approval.status === 'not_submitted' ? 'pending' : approval.status, reason: approval.reason, submittedAt: new Date() });
          submitted++;
          continue;
        }
        if (ALREADY.test(JSON.stringify(answer?.body ?? ''))) continue; // the sync reads its approval
        const problem = twilioProblem(answer);
        if (fatal(problem)) return stop(problem);
        refused.push(`${name}: ${problem.message}`);
      }
    }
    let synced: string;
    try {
      synced = await this.syncNow(accountSid, token);
    } catch (err) {
      synced = `Their status couldn’t be synced: ${(err as Error).message}`;
    }
    await this.audit.record({ userId: user.id, action: 'submit_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { provider: 'twilio', made, submitted, refused: refused.length } });
    const message = refused.length
      ? `${submitted} submitted; Twilio refused ${refused.length}: ${refused.slice(0, 3).join(' ')}`
      : submitted
        ? `${submitted} submitted for WhatsApp’s approval through Twilio. ${synced}`
        : `Nothing new to submit. ${synced}`;
    return { ok: !refused.length, message, templates: await this.templates() };
  }

  /** Sync status on Twilio: each template's WhatsApp approval now (approved, pending, rejected and why). Audited. */
  async sync(user: SessionUser): Promise<WhatsAppTemplatesResult> {
    const { accountSid, token } = await this.connection('templates');
    try {
      const message = await this.syncNow(accountSid, token);
      await this.audit.record({ userId: user.id, action: 'sync_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { provider: 'twilio', result: message } });
      return { ok: true, message, templates: await this.templates() };
    } catch (err) {
      const message = (err as Error).message;
      await this.audit.record({ userId: user.id, action: 'sync_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { provider: 'twilio', refused: message } });
      return { ok: false, message, templates: await this.templates() };
    }
  }

  /**
   * Reads which Content of ours Twilio has (by name), then each one's WhatsApp approval, and keeps them; answers the
   * counts in words. Throws Twilio's refusal in words.
   */
  private async syncNow(accountSid: string, token: string): Promise<string> {
    const rows = new Map((await this.prisma.whatsAppTwilioTemplate.findMany()).map((t) => [`${t.key}:${t.language}`, t]));
    const found = await this.contentsByName(accountSid, token);
    const now = new Date();
    const counts: Partial<Record<WhatsAppTemplateStatus, number>> = {};
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      for (const language of WHATSAPP_LANGUAGES) {
        let sid = rows.get(`${key}:${language}`)?.contentSid ?? found.get(twilioTemplateName(key, language)) ?? null;
        let status: WhatsAppTemplateStatus = 'not_submitted';
        let reason: string | null = null;
        if (sid) {
          const answer = await this.http.send(twilioFetchApprovalRequest(accountSid, token, sid));
          if (ok(answer)) ({ status, reason } = approvalOf(answer!.body));
          // a Content Twilio no longer has is forgotten: Submit makes it again
          else if (answer?.status === 404) sid = null;
          else throw new TwilioRefusal(twilioProblem(answer));
        }
        counts[status] = (counts[status] ?? 0) + 1;
        await this.keepTemplate(key, language, { contentSid: sid, status, reason, syncedAt: now });
      }
    }
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { twilioTemplatesSyncedAt: now } });
    this.whatsapp.forget();
    const parts = [`${counts.approved ?? 0} approved`, `${counts.pending ?? 0} pending`, `${counts.rejected ?? 0} rejected`];
    if (counts.not_submitted) parts.push(`${counts.not_submitted} not submitted`);
    return `Synced with Twilio: ${parts.join(', ')}.`;
  }

  /** Our Content at Twilio by name (people_<key>_<lang>): every page read; the newest of a name kept. Throws a TwilioRefusal. */
  private async contentsByName(accountSid: string, token: string): Promise<Map<string, string>> {
    const ours = new Set(WHATSAPP_TEMPLATE_KEYS.flatMap((k) => WHATSAPP_LANGUAGES.map((l) => twilioTemplateName(k, l))));
    const found = new Map<string, { sid: string; at: string }>();
    let page: string | null = null;
    for (let i = 0; i < 20; i++) {
      const answer = await this.http.send(twilioListContentRequest(accountSid, token, page));
      if (!ok(answer)) throw new TwilioRefusal(twilioProblem(answer));
      const { items, next } = listedContentsOf(answer!.body);
      for (const c of items) {
        if (!ours.has(c.name)) continue;
        const was = found.get(c.name);
        if (!was || (c.createdAt ?? '') > was.at) found.set(c.name, { sid: c.sid, at: c.createdAt ?? '' });
      }
      if (!next) break;
      page = next;
    }
    return new Map([...found].map(([name, c]) => [name, c.sid]));
  }

  private async keepTemplate(
    key: WhatsAppTemplateKey,
    language: WhatsAppLanguage,
    data: { contentSid?: string | null; status: WhatsAppTemplateStatus; reason?: string | null; submittedAt?: Date; syncedAt?: Date },
  ): Promise<void> {
    const values = {
      status: data.status,
      ...(data.contentSid !== undefined && { contentSid: data.contentSid }),
      ...(data.reason !== undefined && { reason: data.reason }),
      ...(data.submittedAt && { submittedAt: data.submittedAt }),
      ...(data.syncedAt && { syncedAt: data.syncedAt }),
      updatedAt: new Date(),
    };
    await this.prisma.whatsAppTwilioTemplate.upsert({
      where: { key_language: { key, language } },
      create: { key, language, name: twilioTemplateName(key, language), ...values },
      update: values,
    });
  }
}
