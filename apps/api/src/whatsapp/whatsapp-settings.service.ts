import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEVELOPER_NO_FILES,
  phoneOk,
  phoneTidy,
  twilioSenderOf,
  WHATSAPP_CATEGORY,
  WHATSAPP_HELLO_WORLD,
  WHATSAPP_LANGUAGES,
  WHATSAPP_SECRET_UNREADABLE,
  WHATSAPP_SETTINGS_OWN_ACCOUNT,
  WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY,
  WHATSAPP_TEMPLATE_KEYS,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TOKEN_UNREADABLE,
  WHATSAPP_TWILIO_TOKEN_UNREADABLE,
  whatsappAllSettingsProblems,
  whatsappContent,
  whatsappMissing,
  whatsappNumber,
  whatsappTemplateMessage,
  whatsappTemplateRequest,
  whatsappWebhookUrl,
  type WhatsAppLanguage,
  type WhatsAppProvider,
  type WhatsAppSettingsView,
  type WhatsAppTemplateKey,
  type WhatsAppTemplateStatus,
  type WhatsAppTemplateStatusView,
  type WhatsAppTemplatesResult,
  type WhatsAppTestView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { webOriginOf } from '../employee-access/employee-access.service.js';
import type { WhatsAppSettings } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createdTemplateOf, createTemplateRequest, listedTemplatesOf, listTemplatesRequest, sendRequest, wamidOf, whatsappProblem } from './graph.js';
import type { WhatsAppSettingsDto } from './whatsapp.dto.js';
import { WhatsAppHttp } from './whatsapp-http.js';
import { newVerifyToken } from './whatsapp-secret.js';
import { WhatsAppTwilioService } from './whatsapp-twilio.service.js';
import { quietOf, WHATSAPP_SETTINGS_ENTITY, WhatsAppService } from './whatsapp.service.js';

// Organization → Company → WhatsApp (owner, 24 October 2026: "how to make whatsapp notifications?", "Directly to Meta"):
// a Super Admin's only, in their own session. Anyone else is refused (the controller's @Roles), a developer before
// anything runs (@NotForDevelopers; their writes by the guard), and a Super Admin viewing as someone, here. The access
// token and the app secret sealed, never returned, never in the audit log ("changed"); the webhook's verify token made
// by the system and shown; Send a test message with Meta's errors in plain words; Submit templates and Sync status.
// Every write audited. Since 25 October 2026 ("Add Twilio as a choice"): "Send through" Meta directly or Twilio, one at
// a time, and Twilio's settings beside Meta's (its Auth Token sealed and audited as the token is); the test and the
// templates' presses work on the provider asked for (the one chosen unless said), Twilio's in WhatsAppTwilioService.

const USER = { select: { id: true, email: true } } as const;

/** What a save shows in the audit log and compares: everything but the secrets. */
const shown = (r: Partial<WhatsAppSettings> | null) => ({
  provider: r?.provider ?? null,
  phoneNumberId: r?.phoneNumberId ?? null,
  businessAccountId: r?.businessAccountId ?? null,
  displayPhone: r?.displayPhone ?? null,
  enabled: r?.enabled ?? null,
  quietFrom: r?.quietFrom ?? null,
  quietTo: r?.quietTo ?? null,
  twilioAccountSid: r?.twilioAccountSid ?? null,
  twilioSender: r?.twilioSender ?? null,
});

const providerOf = (row: Pick<WhatsAppSettings, 'provider'> | null): WhatsAppProvider => (row?.provider === 'twilio' ? 'twilio' : 'meta');

/** "already exists" at Meta: the template was submitted before (by an earlier press, or by hand). */
const ALREADY = /already exists|same name|2388024|2388023/i;

@Injectable()
export class WhatsAppSettingsService {
  private readonly origin: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly whatsapp: WhatsAppService,
    private readonly http: WhatsAppHttp,
    private readonly twilio: WhatsAppTwilioService,
  ) {
    this.origin = webOriginOf(config);
  }

  /** A Super Admin in their own session; anyone else refused, a developer too (also refused before, by the interceptor). */
  private assertOwner(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException(WHATSAPP_SETTINGS_SUPER_ADMIN_ONLY);
    if (user.viewAs) throw new ForbiddenException(WHATSAPP_SETTINGS_OWN_ACCOUNT);
  }

  /** The row, made on the first look with its verify token (Meta's webhook needs it before anything else is pasted). */
  private async row(): Promise<WhatsAppSettings> {
    return this.prisma.whatsAppSettings.upsert({ where: { id: 1 }, create: { id: 1, verifyToken: newVerifyToken() }, update: {} });
  }

  /** GET /whatsapp/settings. */
  async get(user: SessionUser): Promise<WhatsAppSettingsView> {
    this.assertOwner(user);
    await this.row();
    return this.view();
  }

  private async view(): Promise<WhatsAppSettingsView> {
    const [row, templates, twilioTemplates] = await Promise.all([
      this.prisma.whatsAppSettings.findUnique({ where: { id: 1 }, include: { updatedBy: USER } }),
      this.templates(),
      this.twilio.templates(),
    ]);
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    const tokenOk = this.whatsapp.readable(row, 'access_token');
    const secretOk = this.whatsapp.readable(row, 'app_secret');
    const provider = providerOf(row);
    const twilio = this.twilio.viewOf(row, twilioTemplates);
    // what the provider chosen lacks, and its own templates' approval
    const missing =
      provider === 'twilio' ? twilio.missing : whatsappMissing({ phoneNumberId: row?.phoneNumberId ?? null, businessAccountId: row?.businessAccountId ?? null, token: tokenOk, appSecret: secretOk });
    const approved = (provider === 'twilio' ? twilioTemplates : templates).filter((t) => t.status === 'approved').length;
    const why = !row?.enabled
      ? 'WhatsApp messages are switched off.'
      : missing.length
        ? `Enter ${missing.join(', ')}.`
        : !approved
          ? provider === 'twilio'
            ? 'No template is approved on Twilio yet: submit them, then sync their status.'
            : 'No template is approved by Meta yet: submit them, then sync their status.'
          : null;
    return {
      provider,
      phoneNumberId: row?.phoneNumberId ?? null,
      businessAccountId: row?.businessAccountId ?? null,
      displayPhone: row?.displayPhone ?? null,
      tokenSet: !!row?.accessTokenEnc,
      tokenUnreadable: !!row?.accessTokenEnc && !tokenOk,
      appSecretSet: !!row?.appSecretEnc,
      appSecretUnreadable: !!row?.appSecretEnc && !secretOk,
      verifyToken: row?.verifyToken ?? '',
      webhookUrl: whatsappWebhookUrl(this.origin),
      enabled: row?.enabled ?? false,
      quietHours: quietOf(row),
      missing,
      updatedAt: row?.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy.id) ?? null) : null,
      lastTest: row?.lastTestAt ? { at: row.lastTestAt.toISOString(), ok: !!row.lastTestOk, message: row.lastTestMessage ?? '' } : null,
      templates,
      templatesSyncedAt: row?.templatesSyncedAt?.toISOString() ?? null,
      webhook: { verifiedAt: row?.webhookVerifiedAt?.toISOString() ?? null, lastEventAt: row?.webhookEventAt?.toISOString() ?? null },
      twilio,
      sending: { on: !why, why },
    };
  }

  /** Every template in each language, as last submitted or synced (not submitted: none kept). */
  private async templates(): Promise<WhatsAppTemplateStatusView[]> {
    const rows = await this.prisma.whatsAppTemplate.findMany();
    const byKey = new Map(rows.map((r) => [`${r.key}:${r.language}`, r]));
    return WHATSAPP_TEMPLATE_KEYS.flatMap((key) =>
      WHATSAPP_LANGUAGES.map((language) => {
        const r = byKey.get(`${key}:${language}`);
        return {
          key,
          name: WHATSAPP_TEMPLATES[key].name,
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

  /**
   * PUT /whatsapp/settings: an empty token, app secret or Auth Token keeps the saved one; the provider and Twilio's
   * fields left out keep theirs. Audited, the secrets only as "changed".
   */
  async update(dto: WhatsAppSettingsDto, user: SessionUser): Promise<WhatsAppSettingsView> {
    this.assertOwner(user);
    const before = await this.row();
    const provider: WhatsAppProvider = dto.provider ?? providerOf(before);
    const token = dto.accessToken?.trim() || null;
    const secret = dto.appSecret?.trim() || null;
    const twilioToken = dto.twilioAuthToken?.trim() || null;
    const tokenSaved = this.whatsapp.readable(before, 'access_token');
    const secretSaved = this.whatsapp.readable(before, 'app_secret');
    const twilioTokenSaved = this.whatsapp.readable(before, 'twilio_auth_token');
    // a saved secret that can't be read any more stops a switched-on save only for the provider chosen
    if (dto.enabled && provider === 'meta' && !token && before.accessTokenEnc && !tokenSaved) throw new BadRequestException([WHATSAPP_TOKEN_UNREADABLE]);
    if (dto.enabled && provider === 'meta' && !secret && before.appSecretEnc && !secretSaved) throw new BadRequestException([WHATSAPP_SECRET_UNREADABLE]);
    if (dto.enabled && provider === 'twilio' && !twilioToken && before.twilioAuthTokenEnc && !twilioTokenSaved) throw new BadRequestException([WHATSAPP_TWILIO_TOKEN_UNREADABLE]);
    const twilioAccountSid = dto.twilioAccountSid === undefined ? before.twilioAccountSid : dto.twilioAccountSid?.trim() || null;
    const twilioSender = dto.twilioSender === undefined ? before.twilioSender : dto.twilioSender?.trim() || null;
    const problems = whatsappAllSettingsProblems(
      {
        provider,
        phoneNumberId: dto.phoneNumberId ?? null,
        businessAccountId: dto.businessAccountId ?? null,
        displayPhone: dto.displayPhone ?? null,
        accessToken: token,
        appSecret: secret,
        enabled: dto.enabled,
        quietHours: dto.quietHours,
        quietFrom: dto.quietFrom ?? null,
        quietTo: dto.quietTo ?? null,
        twilioAccountSid,
        twilioAuthToken: twilioToken,
        twilioSender,
      },
      { tokenSaved, secretSaved, twilioTokenSaved },
    );
    if (problems.length) throw new BadRequestException(problems);

    const next = {
      provider,
      phoneNumberId: dto.phoneNumberId?.trim() || null,
      businessAccountId: dto.businessAccountId?.trim() || null,
      displayPhone: dto.displayPhone?.trim() ? phoneTidy(dto.displayPhone) : null,
      enabled: dto.enabled,
      quietFrom: dto.quietHours ? dto.quietFrom! : null,
      quietTo: dto.quietHours ? dto.quietTo! : null,
      twilioAccountSid,
      // as Twilio takes it: whatsapp:+201001234567, or the Messaging Service SID
      twilioSender: twilioSender ? (twilioSenderOf(twilioSender)?.value ?? null) : null,
    };
    const diff: Record<string, unknown> = changes(shown(before), shown(next));
    // the secrets only as "changed": never their value, length or any part
    if (token) diff.accessToken = 'changed';
    if (secret) diff.appSecret = 'changed';
    if (twilioToken) diff.twilioAuthToken = 'changed';
    if (!Object.keys(diff).length) return this.view();
    const sealedToken = token ? this.whatsapp.seal(token, 'access_token') : null;
    const sealedSecret = secret ? this.whatsapp.seal(secret, 'app_secret') : null;
    const sealedTwilio = twilioToken ? this.whatsapp.seal(twilioToken, 'twilio_auth_token') : null;
    await this.prisma.whatsAppSettings.update({
      where: { id: 1 },
      data: {
        ...next,
        ...(sealedToken && { accessTokenEnc: sealedToken.enc, accessTokenKeyId: sealedToken.keyId }),
        ...(sealedSecret && { appSecretEnc: sealedSecret.enc, appSecretKeyId: sealedSecret.keyId }),
        ...(sealedTwilio && { twilioAuthTokenEnc: sealedTwilio.enc, twilioAuthTokenKeyId: sealedTwilio.keyId }),
        updatedById: user.id,
        updatedAt: new Date(),
      },
    });
    this.whatsapp.forget();
    await this.audit.record({ userId: user.id, action: 'update', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff });
    return this.view();
  }

  /** POST /whatsapp/settings/verify-token: a new verify token (Meta's webhook must be verified again with it). Audited. */
  async newVerifyToken(user: SessionUser): Promise<WhatsAppSettingsView> {
    this.assertOwner(user);
    await this.row();
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { verifyToken: newVerifyToken(), webhookVerifiedAt: null, updatedById: user.id, updatedAt: new Date() } });
    this.whatsapp.forget();
    await this.audit.record({ userId: user.id, action: 'new_verify_token', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { verifyToken: 'changed' } });
    return this.view();
  }

  /** The saved ids and token, or the refusal in words. */
  private async connection(need: 'send' | 'templates'): Promise<{ row: WhatsAppSettings; token: string }> {
    const row = await this.row();
    const lacking: string[] = [];
    if (need === 'send' && !row.phoneNumberId) lacking.push('the phone number ID');
    if (need === 'templates' && !row.businessAccountId) lacking.push('the WhatsApp Business Account ID');
    if (!row.accessTokenEnc) lacking.push('the access token');
    if (lacking.length) throw new BadRequestException([`Save ${lacking.join(' and ')} first.`]);
    const token = this.whatsapp.readable(row, 'access_token') ? this.whatsapp.token(row) : null;
    if (!token) throw new BadRequestException([WHATSAPP_TOKEN_UNREADABLE]);
    return { row, token };
  }

  /**
   * POST /whatsapp/settings/test: a test message to `to` with the saved settings (switched on or not): our own test
   * template once Meta approves it in English, until then Meta's sample "hello_world", which every new WhatsApp
   * Business Account has. Answers sent or why not in plain words, either way 200; kept as the last test, in the log and
   * the audit log. Through Twilio when it is asked for, or chosen (WhatsAppTwilioService.test).
   */
  async test(to: string, user: SessionUser, provider?: WhatsAppProvider): Promise<WhatsAppTestView> {
    this.assertOwner(user);
    const mobile = phoneTidy(to);
    if (!phoneOk(mobile)) throw new BadRequestException(['Write the number to send the test to with its country code, e.g. +20 100 123 4567.']);
    if ((provider ?? providerOf(await this.row())) === 'twilio') return this.twilio.test(mobile, user);
    const { row, token } = await this.connection('send');
    const ours = await this.prisma.whatsAppTemplate.findUnique({ where: { key_language: { key: 'test_message', language: 'en' } }, select: { status: true } });
    const company = (await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } }))?.nameEn?.trim() || 'the company';
    const approved = ours?.status === 'approved';
    const content = whatsappContent({ template: 'test_message', company }, 'en');
    const template = approved ? { name: WHATSAPP_TEMPLATES.test_message.name, language: 'en' } : { ...WHATSAPP_HELLO_WORLD };
    const answer = await this.http.send(sendRequest(row.phoneNumberId!, token, whatsappTemplateMessage(whatsappNumber(mobile), template, approved ? content.body : [], null)));
    const wamid = answer && answer.status >= 200 && answer.status < 300 ? wamidOf(answer.body) : null;
    const problem = wamid ? null : whatsappProblem(answer);
    const at = new Date();
    const message = wamid ? `Sent to ${mobile} with ${template.name}${approved ? '' : ' (Meta’s sample, until our test template is approved)'}.` : problem!.message;
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { lastTestAt: at, lastTestOk: !!wamid, lastTestMessage: message } });
    await this.prisma.whatsAppMessage.create({
      data: {
        mobile,
        template: 'test_message',
        templateName: template.name,
        language: 'en',
        kind: 'test_message',
        variables: { body: approved ? content.body : [], button: null },
        reference: 'Test',
        status: wamid ? 'sent' : 'failed',
        wamid,
        provider: 'meta',
        error: problem?.message ?? null,
        errorCode: problem?.code ?? null,
        attempts: 1,
        nextAttemptAt: at,
        createdAt: at,
        sentAt: wamid ? at : null,
        failedAt: wamid ? null : at,
        updatedAt: at,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'send_test_message',
      entityType: WHATSAPP_SETTINGS_ENTITY,
      entityId: null,
      diff: { sentTo: mobile, template: template.name, sent: !!wamid, ...(problem && { reason: problem.message }) },
    });
    return { at: at.toISOString(), ok: !!wamid, message };
  }

  /**
   * POST /whatsapp/templates/submit: every template in each language not already approved or under review, submitted
   * for Meta's review (Utility, with its examples and the button to the website); then their statuses synced. Audited.
   * Twilio's own when it is asked for, or chosen (WhatsAppTwilioService.submit).
   */
  async submit(user: SessionUser, provider?: WhatsAppProvider): Promise<WhatsAppTemplatesResult> {
    this.assertOwner(user);
    if ((provider ?? providerOf(await this.row())) === 'twilio') return this.twilio.submit(user);
    const { row, token } = await this.connection('templates');
    const kept = new Map((await this.prisma.whatsAppTemplate.findMany()).map((t) => [`${t.key}:${t.language}`, t]));
    let submitted = 0;
    const refused: string[] = [];
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      for (const language of WHATSAPP_LANGUAGES) {
        const k = kept.get(`${key}:${language}`);
        if (k && ['approved', 'pending', 'in_appeal'].includes(k.status)) continue;
        const answer = await this.http.send(createTemplateRequest(row.businessAccountId!, token, whatsappTemplateRequest(key, language, this.origin)));
        if (answer && answer.status >= 200 && answer.status < 300) {
          const made = createdTemplateOf(answer.body);
          await this.keepTemplate(key, language, { status: made.status, metaId: made.id, submittedAt: new Date(), reason: null });
          submitted++;
          continue;
        }
        const problem = whatsappProblem(answer);
        if (ALREADY.test(JSON.stringify(answer?.body ?? ''))) continue; // the sync reads its status
        // the whole press fails alike on a token or an id problem: say it once
        if (problem.kind === 'token' || problem.kind === 'permission' || problem.kind === 'ids' || problem.kind === 'unreachable') {
          await this.audit.record({ userId: user.id, action: 'submit_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { submitted, refused: problem.message } });
          return { ok: false, message: problem.message, templates: await this.templates() };
        }
        refused.push(`${WHATSAPP_TEMPLATES[key].name} (${language}): ${problem.message}`);
      }
    }
    const synced = await this.syncNow(row, token);
    await this.audit.record({ userId: user.id, action: 'submit_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { submitted, refused: refused.length } });
    const message = refused.length
      ? `${submitted} submitted; Meta refused ${refused.length}: ${refused.slice(0, 3).join(' ')}`
      : submitted
        ? `${submitted} submitted for Meta’s review. ${synced}`
        : `Nothing new to submit. ${synced}`;
    return { ok: !refused.length, message, templates: await this.templates() };
  }

  /**
   * POST /whatsapp/templates/sync: every template's status as Meta has it now (approved, pending, rejected and why).
   * Audited. Twilio's when it is asked for, or chosen (WhatsAppTwilioService.sync).
   */
  async sync(user: SessionUser, provider?: WhatsAppProvider): Promise<WhatsAppTemplatesResult> {
    this.assertOwner(user);
    if ((provider ?? providerOf(await this.row())) === 'twilio') return this.twilio.sync(user);
    const { row, token } = await this.connection('templates');
    try {
      const message = await this.syncNow(row, token);
      await this.audit.record({ userId: user.id, action: 'sync_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { result: message } });
      return { ok: true, message, templates: await this.templates() };
    } catch (err) {
      const message = (err as Error).message;
      await this.audit.record({ userId: user.id, action: 'sync_templates', entityType: WHATSAPP_SETTINGS_ENTITY, entityId: null, diff: { refused: message } });
      return { ok: false, message, templates: await this.templates() };
    }
  }

  /** Reads every page of the templates at Meta and keeps ours' statuses; answers the counts in words. Throws Meta's refusal in words. */
  private async syncNow(row: WhatsAppSettings, token: string): Promise<string> {
    const ours = new Map(WHATSAPP_TEMPLATE_KEYS.map((k) => [WHATSAPP_TEMPLATES[k].name, k]));
    const seen = new Map<string, { status: WhatsAppTemplateStatus; reason: string | null; id: string | null }>();
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const answer = await this.http.send(listTemplatesRequest(row.businessAccountId!, token, after));
      if (!answer || answer.status < 200 || answer.status >= 300) throw new Error(whatsappProblem(answer).message);
      const { items, next } = listedTemplatesOf(answer.body);
      for (const t of items) {
        const key = ours.get(t.name);
        const language = t.language.split('_')[0];
        if (key && (language === 'en' || language === 'ar')) seen.set(`${key}:${language}`, { status: t.status, reason: t.reason, id: t.id });
      }
      if (!next) break;
      after = next;
    }
    const now = new Date();
    const counts: Partial<Record<WhatsAppTemplateStatus, number>> = {};
    for (const key of WHATSAPP_TEMPLATE_KEYS) {
      for (const language of WHATSAPP_LANGUAGES) {
        const s = seen.get(`${key}:${language}`);
        const status: WhatsAppTemplateStatus = s?.status ?? 'not_submitted';
        counts[status] = (counts[status] ?? 0) + 1;
        await this.keepTemplate(key, language, { status, reason: status === 'rejected' ? (s?.reason ?? null) : null, metaId: s?.id ?? null, syncedAt: now });
      }
    }
    await this.prisma.whatsAppSettings.update({ where: { id: 1 }, data: { templatesSyncedAt: now } });
    this.whatsapp.forget();
    const parts = [`${counts.approved ?? 0} approved`, `${counts.pending ?? 0} pending`, `${counts.rejected ?? 0} rejected`];
    if (counts.not_submitted) parts.push(`${counts.not_submitted} not submitted`);
    return `Synced with Meta: ${parts.join(', ')}.`;
  }

  private async keepTemplate(key: WhatsAppTemplateKey, language: WhatsAppLanguage, data: { status: WhatsAppTemplateStatus; reason?: string | null; metaId?: string | null; submittedAt?: Date; syncedAt?: Date }): Promise<void> {
    const values = { status: data.status, ...(data.reason !== undefined && { reason: data.reason }), ...(data.metaId && { metaId: data.metaId }), ...(data.submittedAt && { submittedAt: data.submittedAt }), ...(data.syncedAt && { syncedAt: data.syncedAt }), updatedAt: new Date() };
    await this.prisma.whatsAppTemplate.upsert({
      where: { key_language: { key, language } },
      create: { key, language, name: WHATSAPP_TEMPLATES[key].name, ...values },
      update: values,
    });
  }
}

