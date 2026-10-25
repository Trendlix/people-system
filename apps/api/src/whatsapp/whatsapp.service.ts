import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALL_WHATSAPP_GROUPS,
  cairoDay,
  cairoTimeOfDay,
  DEVELOPER_NO_FILES,
  firstNameOf,
  inQuietHours,
  isStopWord,
  isTimeOfDay,
  isWhatsAppLanguage,
  MEETING_PROVIDER_LABELS,
  NOTIFICATION_KIND_LABELS,
  phoneOk,
  phoneTidy,
  quietHoursEnd,
  seesConfidential,
  WHATSAPP_DIGEST_AFTER,
  WHATSAPP_DIGEST_MINUTES,
  WHATSAPP_GROUPS,
  WHATSAPP_INTERVIEW_REMINDER_FROM,
  WHATSAPP_LOG_STAFF_ONLY,
  WHATSAPP_MESSAGES_PAGE_SIZE,
  WHATSAPP_OPT_IN_OWN,
  WHATSAPP_REMINDER_TEMPLATES,
  WHATSAPP_REMINDER_WITHIN_MINUTES,
  WHATSAPP_SEND_WITHIN_HOURS,
  WHATSAPP_TEMPLATES,
  whatsappContent,
  whatsappGroupOf,
  whatsappMessageLabel,
  whatsappStopConfirmation,
  whatsappTemplateFor,
  zonedMoment,
  type MeetingProvider,
  type MyWhatsAppInput,
  type MyWhatsAppView,
  type NotificationKind,
  type WhatsAppDayCount,
  type WhatsAppFacts,
  type WhatsAppGroup,
  type WhatsAppInterviewPlace,
  type WhatsAppLanguage,
  type WhatsAppMessagePage,
  type WhatsAppMessageRow,
  type WhatsAppMessageStatus,
  type WhatsAppPersonView,
  type WhatsAppProvider,
  type WhatsAppQuietHours,
  type WhatsAppTemplateKey,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { addDays, dayInCairo } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma, type WhatsAppSettings } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { openWhatsAppSecret, sameWhatsAppKey, sealWhatsAppSecret, whatsappKeyIdOf, whatsappKeyOf, type WhatsAppSecretPurpose } from './whatsapp-secret.js';

// WhatsApp notifications (owner, 24 October 2026: "how to make whatsapp notifications?"; asked whom, "Employees and
// candidates"; what, "Approvals waiting, Request decisions, Check-in reminders, Interviews"; how, "Directly to Meta";
// packages/shared whatsapp.ts). WhatsApp is one more channel beside the bell, push and email, never in their place:
// - a notification (NotificationsService.notify and remind) carrying its WhatsApp facts is queued for each recipient who
//   opted in, for its group, at their profile's current mobile, in their language, when the template is approved in it
//   and a Super Admin has WhatsApp switched on and set up; anything else: nothing (the bell, push and email as today);
// - a candidate who ticked it on a careers form gets "application received", the interview's invitation, its changes
//   and its cancellation, and a reminder the day before (interviewReminders, the sender's round);
// - quiet hours (22:00–08:00 Cairo unless changed): a message waits until they end; a check-in reminder is dropped;
// - approvals waiting go one by one, up to 3 within 10 minutes; more in those 10 minutes become one digest;
// - STOP (or توقف) from a number turns everything off for it and is answered once, free within Meta's 24 hours;
// - nothing about a C-level person reaches a message HR could see: the messages go only to the person concerned or
//   their approvers (as the notifications do), and those about a C-level person are kept marked, never shown to HR.
// Never throws into a flow: a failure is logged and the flow goes on. The sender (whatsapp-sender.service.ts) sends.
// Twilio, a second way to send (owner, 25 October 2026: "Add Twilio as a choice"): the same messages, opt-ins, quiet
// hours, queue and log; the provider chosen sends, with its own approved templates (config: `approved` is its).

export const WHATSAPP_SETTINGS_ENTITY = 'whatsapp_settings';
export const WHATSAPP_OPT_IN_ENTITY = 'whatsapp_opt_in';

/** What a notification carries for WhatsApp: its facts, and whom it is about (a C-level person's is never shown to HR). */
export interface WhatsAppNotice {
  facts: WhatsAppFacts;
  /** The employee the message is about (the requester of a request waiting), when it isn't the recipient. */
  about?: string | null;
  /** About something hidden from HR (a C-level vacancy, an interview for one). */
  confidential?: boolean;
}

/** The settings and the approved templates as the sending reads them. */
export interface WhatsAppConfig {
  row: WhatsAppSettings | null;
  /** Who sends now (25 October 2026): Meta directly, or Twilio. */
  provider: WhatsAppProvider;
  /** "<key>:<language>" of each template approved by the provider who sends (Meta's, or Twilio's with its Content SID). */
  approved: Set<string>;
  /** Twilio's: each approved template's Content SID, by "<key>:<language>". */
  contentSids: Map<string, string>;
  /**
   * Switched on, and complete for the provider who sends: Meta's ids, a token and an app secret readable with this
   * server's key; or Twilio's Account SID, sender and a readable Auth Token.
   */
  ready: boolean;
  quiet: WhatsAppQuietHours | null;
}

/** How long the settings are kept before they are read again; a save or a sync clears them at once. */
const KEPT_MS = 30_000;

const GROUP_COLUMN: Readonly<Record<WhatsAppGroup, 'approvals' | 'decisions' | 'checkIn' | 'interviews'>> = {
  approvals: 'approvals',
  decisions: 'decisions',
  check_in: 'checkIn',
  interviews: 'interviews',
};

/** The roles that approve something: "Approvals waiting" is offered to them (and to anyone in charge of a team). */
const APPROVING_ROLES = ['manager', 'hr', 'finance', 'ceo', 'super_admin'] as const;

/** The roles that see whether someone gets WhatsApp messages (the Access tab's), never change it. */
const SEES_PEOPLE = ['hr', 'admin', 'ceo'] as const;

const NO_MOBILE = 'Your profile has no mobile number: ask HR to add it, then turn WhatsApp messages on.';
const BAD_MOBILE = 'The mobile on your profile isn’t a number WhatsApp can reach: ask HR to correct it.';


/** A message to queue. */
interface Queued {
  userId?: string | null;
  candidateId?: string | null;
  applicationId?: string | null;
  generalCvId?: string | null;
  interviewId?: string | null;
  mobile: string;
  template: WhatsAppTemplateKey;
  language: WhatsAppLanguage;
  kind: string | null;
  group: WhatsAppGroup | null;
  body: string[];
  button: string | null;
  extra?: Record<string, unknown>;
  reference: string | null;
  link: string | null;
  confidential: boolean;
  nextAttemptAt: Date;
  sendBefore: Date | null;
  dedupeKey?: string | null;
}

const rowOf = (q: Queued, now: Date): Prisma.WhatsAppMessageCreateManyInput => ({
  userId: q.userId ?? null,
  candidateId: q.candidateId ?? null,
  applicationId: q.applicationId ?? null,
  generalCvId: q.generalCvId ?? null,
  interviewId: q.interviewId ?? null,
  mobile: q.mobile,
  template: q.template,
  templateName: WHATSAPP_TEMPLATES[q.template].name,
  language: q.language,
  kind: q.kind,
  groupKey: q.group,
  variables: { body: q.body, button: q.button, ...q.extra } as Prisma.InputJsonValue,
  reference: q.reference,
  link: q.link,
  confidential: q.confidential,
  status: 'queued',
  nextAttemptAt: q.nextAttemptAt,
  sendBefore: q.sendBefore,
  dedupeKey: q.dedupeKey ?? null,
  createdAt: now,
  updatedAt: now,
});

/** A vacancy's C-level flag (its grade, or its job title's lowest grade). */
const confidentialVacancy = (v: { grade: { confidential: boolean } | null; jobTitle: { minGrade: { confidential: boolean } | null } }): boolean =>
  v.grade?.confidential === true || v.jobTitle.minGrade?.confidential === true;

const VACANCY_FLAGS = { grade: { select: { confidential: true } }, jobTitle: { select: { minGrade: { select: { confidential: true } } } } } as const;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger('WhatsApp');
  private readonly key: Buffer;
  private kept: { at: number; config: Promise<WhatsAppConfig> } | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly confidential: ConfidentialService,
    private readonly audit: AuditService,
  ) {
    this.key = whatsappKeyOf(config.getOrThrow<string>('JWT_SECRET'));
  }

  // ---------- the settings, as the sending reads them ----------

  /** The settings and the approved templates: kept 30 seconds; a failed read isn't kept. */
  config(): Promise<WhatsAppConfig> {
    if (!this.kept || Date.now() - this.kept.at > KEPT_MS) {
      const config = this.read();
      const kept = { at: Date.now(), config };
      this.kept = kept;
      void config.catch(() => {
        if (this.kept === kept) this.kept = null;
      });
    }
    return this.kept.config;
  }

  /** After a save or a sync: read again on the next message. */
  forget(): void {
    this.kept = null;
  }

  private async read(): Promise<WhatsAppConfig> {
    const [row, templates, twilio] = await Promise.all([
      this.prisma.whatsAppSettings.findUnique({ where: { id: 1 } }),
      this.prisma.whatsAppTemplate.findMany({ where: { status: 'approved' }, select: { key: true, language: true } }),
      this.prisma.whatsAppTwilioTemplate.findMany({ where: { status: 'approved', contentSid: { not: null } }, select: { key: true, language: true, contentSid: true } }),
    ]);
    const provider: WhatsAppProvider = row?.provider === 'twilio' ? 'twilio' : 'meta';
    const contentSids = new Map(twilio.map((t) => [`${t.key}:${t.language}`, t.contentSid!]));
    if (provider === 'twilio') {
      const ready = !!row?.enabled && !!row.twilioAccountSid && !!row.twilioSender && this.readable(row, 'twilio_auth_token');
      return { row, provider, approved: new Set(contentSids.keys()), contentSids, ready, quiet: quietOf(row) };
    }
    const ready = !!row?.enabled && !!row.phoneNumberId && !!row.businessAccountId && this.readable(row, 'access_token') && this.readable(row, 'app_secret');
    return { row, provider, approved: new Set(templates.map((t) => `${t.key}:${t.language}`)), contentSids, ready, quiet: quietOf(row) };
  }

  /** Whether a saved secret opens with this server's key, told by its fingerprint: never opened to tell. */
  readable(
    row: Pick<WhatsAppSettings, 'accessTokenEnc' | 'accessTokenKeyId' | 'appSecretEnc' | 'appSecretKeyId' | 'twilioAuthTokenEnc' | 'twilioAuthTokenKeyId'> | null,
    purpose: WhatsAppSecretPurpose,
  ): boolean {
    if (!row) return false;
    if (purpose === 'twilio_auth_token') return !!row.twilioAuthTokenEnc && sameWhatsAppKey(row.twilioAuthTokenKeyId, this.key);
    return purpose === 'access_token' ? !!row.accessTokenEnc && sameWhatsAppKey(row.accessTokenKeyId, this.key) : !!row.appSecretEnc && sameWhatsAppKey(row.appSecretKeyId, this.key);
  }

  /** A secret sealed for saving, with the fingerprint of the key that sealed it. */
  seal(plain: string, purpose: WhatsAppSecretPurpose): { enc: string; keyId: string } {
    return { enc: sealWhatsAppSecret(plain, this.key, purpose), keyId: whatsappKeyIdOf(this.key) };
  }

  /** The saved access token, opened: only to call Meta. */
  token(row: Pick<WhatsAppSettings, 'accessTokenEnc'> | null): string | null {
    return openWhatsAppSecret(row?.accessTokenEnc, this.key, 'access_token');
  }

  /** The saved app secret, opened: only to check a webhook's signature. */
  appSecret(row: Pick<WhatsAppSettings, 'appSecretEnc'> | null): string | null {
    return openWhatsAppSecret(row?.appSecretEnc, this.key, 'app_secret');
  }

  /** The saved Twilio Auth Token, opened: only to call Twilio, or to check a Twilio call's signature. */
  twilioToken(row: Pick<WhatsAppSettings, 'twilioAuthTokenEnc'> | null): string | null {
    return openWhatsAppSecret(row?.twilioAuthTokenEnc, this.key, 'twilio_auth_token');
  }

  // ---------- from the notifications ----------

  /**
   * A notification's WhatsApp, for each of `userIds` who opted in for its group at their current mobile, in their
   * language, while its template is approved in it and WhatsApp is on. Never throws.
   */
  async fromNotification(userIds: readonly string[], n: { kind: NotificationKind; link: string | null; whatsapp?: WhatsAppNotice | null }, now = new Date()): Promise<number> {
    try {
      const notice = n.whatsapp;
      if (!notice || !userIds.length) return 0;
      const group = whatsappGroupOf(n.kind);
      const template = whatsappTemplateFor(n.kind, notice.facts);
      if (!group || !template) return 0;
      const config = await this.config();
      if (!config.ready) return 0;
      const reminder = WHATSAPP_REMINDER_TEMPLATES.includes(template);
      // a reminder in quiet hours is dropped, never held (it would be wrong by morning)
      if (reminder && inQuietHours(now, config.quiet)) return 0;
      const optIns = await this.prisma.whatsAppOptIn.findMany({
        where: { userId: { in: [...new Set(userIds)] }, stoppedAt: null, [GROUP_COLUMN[group]]: true, user: { isActive: true } },
        select: { userId: true, mobile: true, language: true, user: { select: { employee: { select: { id: true, mobile: true, fullNameEn: true, fullNameAr: true } } } } },
      });
      if (!optIns.length) return 0;
      const cLevel = await this.confidential.ids();
      let queued = 0;
      for (const o of optIns) {
        const employee = o.user.employee;
        // their profile's mobile now: a changed mobile stops the messages until they turn them on again for it
        if (!employee || phoneTidy(employee.mobile) !== o.mobile) continue;
        const language: WhatsAppLanguage = isWhatsAppLanguage(o.language) ? o.language : 'en';
        if (!config.approved.has(`${template}:${language}`)) continue;
        const firstName = firstNameOf(language === 'ar' && employee.fullNameAr?.trim() ? employee.fullNameAr : employee.fullNameEn);
        const content = whatsappContent(notice.facts, language, { firstName, link: n.link });
        const confidential = !!notice.confidential || cLevel.has(employee.id) || (!!notice.about && cLevel.has(notice.about));
        const base: Queued = {
          userId: o.userId,
          mobile: o.mobile,
          template,
          language,
          kind: n.kind,
          group,
          body: content.body,
          button: content.button,
          reference: NOTIFICATION_KIND_LABELS[n.kind] ?? null,
          link: n.link,
          confidential,
          nextAttemptAt: new Date(quietHoursEnd(now, config.quiet)),
          sendBefore: new Date(now.getTime() + (reminder ? WHATSAPP_REMINDER_WITHIN_MINUTES * 60_000 : WHATSAPP_SEND_WITHIN_HOURS * 3_600_000)),
          // a reminder at most once a kind a day, whatever its steps
          dedupeKey: reminder ? `${template}:${o.userId}:${cairoDay(now)}` : null,
        };
        if (template === 'approval_waiting') {
          await this.approval(base, firstName, config, now);
        } else {
          await this.prisma.whatsAppMessage.createMany({ data: [rowOf(base, now)], skipDuplicates: true });
        }
        queued++;
      }
      return queued;
    } catch (err) {
      this.logger.error(`A WhatsApp message for a notification of kind "${n.kind}" could not be queued: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * An approval waiting: one message for it, unless WHATSAPP_DIGEST_AFTER already went (or wait) to them within
   * WHATSAPP_DIGEST_MINUTES; then it joins the digest waiting for them ("you have N more to approve"), sent when the 10 minutes end.
   * Under a lock of theirs, so two at once count right.
   */
  private async approval(base: Queued, firstName: string, config: WhatsAppConfig, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people-system whatsapp approvals ${base.userId}`}))`;
      const since = new Date(now.getTime() - WHATSAPP_DIGEST_MINUTES * 60_000);
      const recent = await tx.whatsAppMessage.count({
        where: { userId: base.userId, template: 'approval_waiting', status: { not: 'cancelled' }, OR: [{ status: { in: ['queued', 'sending'] } }, { createdAt: { gte: since } }] },
      });
      if (recent < WHATSAPP_DIGEST_AFTER) {
        await tx.whatsAppMessage.create({ data: rowOf(base, now) as Prisma.WhatsAppMessageUncheckedCreateInput });
        return;
      }
      const digest = await tx.whatsAppMessage.findFirst({ where: { userId: base.userId, template: 'approvals_digest', status: 'queued' }, orderBy: { createdAt: 'desc' }, select: { id: true, variables: true, language: true, confidential: true } });
      const count = digest ? Number((digest.variables as { count?: unknown }).count ?? 0) + 1 : 1;
      const language = (digest?.language as WhatsAppLanguage | undefined) ?? base.language;
      const content = whatsappContent({ template: 'approvals_digest', count }, language, { firstName, link: '/notifications' });
      if (digest) {
        // one gathered about a C-level person keeps the digest from HR's log too
        await tx.whatsAppMessage.update({ where: { id: digest.id }, data: { variables: { body: content.body, button: content.button, count }, confidential: digest.confidential || base.confidential, updatedAt: now } });
        return;
      }
      if (!config.approved.has(`approvals_digest:${language}`)) return;
      const at = Math.max(now.getTime() + WHATSAPP_DIGEST_MINUTES * 60_000, quietHoursEnd(now, config.quiet));
      await tx.whatsAppMessage.create({
        data: rowOf(
          { ...base, template: 'approvals_digest', language, body: content.body, button: content.button, extra: { count }, reference: 'Approvals', link: '/notifications', nextAttemptAt: new Date(at) },
          now,
        ) as Prisma.WhatsAppMessageUncheckedCreateInput,
      });
    });
  }

  // ---------- candidates ----------

  /** "Application received" for an application whose candidate ticked WhatsApp on the careers form. Never throws. */
  async applicationReceived(applicationId: string, now = new Date()): Promise<void> {
    await this.safely('an application received', async () => {
      const a = await this.prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, number: true, fullName: true, mobile: true, candidateId: true, whatsappOptInAt: true, whatsappStoppedAt: true, whatsappLanguage: true, vacancy: { select: { title: true, ...VACANCY_FLAGS } } },
      });
      if (!a) return;
      const company = await this.companyName();
      await this.toCandidate(
        { ...a, kind: 'application' },
        { template: 'application_received', name: a.fullName, job: a.vacancy.title, company, reference: a.number },
        { applicationId: a.id, confidential: confidentialVacancy(a.vacancy) },
        now,
      );
    });
  }

  /**
   * "We've updated your application" (owner, 25 October 2026: "Update their application"): the same person applied again
   * for the job, the tick on; once a day an application. Never throws.
   */
  async applicationUpdated(applicationId: string, now = new Date()): Promise<void> {
    await this.safely('an application updated', async () => {
      const a = await this.prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, number: true, fullName: true, mobile: true, candidateId: true, whatsappOptInAt: true, whatsappStoppedAt: true, whatsappLanguage: true, vacancy: { select: { title: true, ...VACANCY_FLAGS } } },
      });
      if (!a) return;
      const company = await this.companyName();
      await this.toCandidate(
        { ...a, kind: 'application' },
        { template: 'application_updated', name: a.fullName, job: a.vacancy.title, company, reference: a.number },
        { applicationId: a.id, confidential: confidentialVacancy(a.vacancy), dedupeKey: `application_updated:${a.id}:${dayInCairo(now)}` },
        now,
      );
    });
  }

  /** "CV received" for a general CV sent with the tick. Never throws. */
  async cvReceived(generalCvId: string, now = new Date()): Promise<void> {
    await this.safely('a CV received', async () => {
      const g = await this.prisma.generalCv.findUnique({
        where: { id: generalCvId },
        select: { id: true, number: true, fullName: true, mobile: true, candidateId: true, whatsappOptInAt: true, whatsappStoppedAt: true, whatsappLanguage: true },
      });
      if (!g) return;
      const company = await this.companyName();
      await this.toCandidate({ ...g, kind: 'general' }, { template: 'cv_received', name: g.fullName, company, reference: g.number }, { generalCvId: g.id, confidential: false }, now);
    });
  }

  /**
   * An interview's invitation, its change, or its cancellation, for the candidate who ticked WhatsApp on the application
   * (once it has its link, for an online one: the flow calls this only then). A change clears the day-before reminder,
   * so the new day gets one. Never throws.
   */
  async interview(kind: 'invite' | 'moved' | 'cancelled', interviewId: string, now = new Date()): Promise<void> {
    await this.safely('an interview', async () => {
      if (kind === 'moved') await this.prisma.interview.updateMany({ where: { id: interviewId }, data: { whatsappRemindedAt: null } });
      const r = await this.interviewRow(interviewId);
      if (!r) return;
      const company = await this.companyName();
      const a = r.application;
      const facts: WhatsAppFacts =
        kind === 'cancelled'
          ? { template: 'interview_cancelled', name: a.fullName, job: a.vacancy.title, company, at: r.startsAt.toISOString() }
          : { template: kind === 'moved' ? 'interview_updated' : 'interview_invitation', name: a.fullName, job: a.vacancy.title, company, at: r.startsAt.toISOString(), place: { ...placeOf(r, company), mobile: phoneTidy(a.mobile) || null } };
      await this.toCandidate({ ...a, kind: 'application' }, facts, { applicationId: a.id, interviewId: r.id, confidential: confidentialVacancy(a.vacancy) }, now);
    });
  }

  /**
   * The candidates' reminders the day before their interview (the brief: "a reminder the day before (a new scheduled
   * job)"), from 10:00 Cairo: each interview scheduled for tomorrow whose candidate ticked WhatsApp, once (claimed on the
   * interview). Not for one invited (or changed) today: that message is fresh. Answers how many were queued.
   */
  async interviewReminders(now = new Date()): Promise<number> {
    const config = await this.config();
    if (!config.ready || cairoTimeOfDay(now) < WHATSAPP_INTERVIEW_REMINDER_FROM || inQuietHours(now, config.quiet)) return 0;
    const today = cairoDay(now);
    const tomorrow = addDays(today, 1);
    const due = await this.prisma.interview.findMany({
      where: {
        status: 'scheduled',
        whatsappRemindedAt: null,
        startsAt: { gte: new Date(zonedMoment(tomorrow, '00:00')), lt: new Date(zonedMoment(addDays(tomorrow, 1), '00:00')) },
        application: { whatsappOptInAt: { not: null }, whatsappStoppedAt: null },
      },
      select: { id: true },
      take: 500,
    });
    let queued = 0;
    for (const { id } of due) {
      const { count } = await this.prisma.interview.updateMany({ where: { id, whatsappRemindedAt: null }, data: { whatsappRemindedAt: now } });
      if (!count) continue;
      const r = await this.interviewRow(id);
      if (!r || (r.kind === 'online' && !r.location)) continue;
      const last = await this.prisma.whatsAppMessage.findFirst({ where: { interviewId: id, template: { in: ['interview_invitation', 'interview_updated'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (last && cairoDay(last.createdAt) === today) continue;
      const company = await this.companyName();
      const a = r.application;
      const done = await this.toCandidate(
        { ...a, kind: 'application' },
        { template: 'interview_reminder', name: a.fullName, job: a.vacancy.title, company, at: r.startsAt.toISOString(), place: { ...placeOf(r, company), mobile: phoneTidy(a.mobile) || null } },
        { applicationId: a.id, interviewId: r.id, confidential: confidentialVacancy(a.vacancy), sendBefore: r.startsAt, dedupeKey: `interview_reminder:${r.id}:${r.startsAt.toISOString()}` },
        now,
      );
      if (done) queued++;
    }
    return queued;
  }

  private interviewRow(id: string) {
    return this.prisma.interview.findUnique({
      where: { id },
      select: {
        id: true,
        startsAt: true,
        kind: true,
        location: true,
        meetingProvider: true,
        status: true,
        application: {
          select: {
            id: true,
            number: true,
            fullName: true,
            mobile: true,
            candidateId: true,
            whatsappOptInAt: true,
            whatsappStoppedAt: true,
            whatsappLanguage: true,
            vacancy: { select: { title: true, ...VACANCY_FLAGS } },
          },
        },
      },
    });
  }

  /**
   * A message to the candidate of an application or a general CV: only when they ticked it there and haven't replied
   * STOP since, in the page's language, with the template approved in it, at their mobile. Answers whether one was queued.
   */
  private async toCandidate(
    who: { kind: 'application' | 'general'; number: string; mobile: string; candidateId: string | null; whatsappOptInAt: Date | null; whatsappStoppedAt: Date | null; whatsappLanguage: string | null },
    facts: WhatsAppFacts,
    on: { applicationId?: string; generalCvId?: string; interviewId?: string; confidential: boolean; sendBefore?: Date; dedupeKey?: string },
    now: Date,
  ): Promise<boolean> {
    if (!who.whatsappOptInAt || who.whatsappStoppedAt) return false;
    const config = await this.config();
    if (!config.ready) return false;
    const language: WhatsAppLanguage = isWhatsAppLanguage(who.whatsappLanguage) ? who.whatsappLanguage : 'en';
    if (!config.approved.has(`${facts.template}:${language}`)) return false;
    const mobile = phoneTidy(who.mobile);
    if (!phoneOk(mobile)) return false;
    if (who.candidateId) {
      const c = await this.prisma.candidate.findUnique({ where: { id: who.candidateId }, select: { whatsappStoppedAt: true } });
      if (c?.whatsappStoppedAt && c.whatsappStoppedAt > who.whatsappOptInAt) return false;
    }
    const content = whatsappContent(facts, language);
    const sendBefore = on.sendBefore ?? new Date(now.getTime() + WHATSAPP_SEND_WITHIN_HOURS * 3_600_000);
    const { count } = await this.prisma.whatsAppMessage.createMany({
      data: [
        rowOf(
          {
            candidateId: who.candidateId,
            applicationId: on.applicationId ?? null,
            generalCvId: on.generalCvId ?? null,
            interviewId: on.interviewId ?? null,
            mobile,
            template: facts.template,
            language,
            kind: facts.template,
            group: null,
            body: content.body,
            button: content.button,
            reference: who.number,
            link: null,
            confidential: on.confidential,
            nextAttemptAt: new Date(quietHoursEnd(now, config.quiet)),
            sendBefore,
            dedupeKey: on.dedupeKey ?? null,
          },
          now,
        ),
      ],
      skipDuplicates: true,
    });
    return count > 0;
  }

  private async companyName(): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true } });
    return company?.nameEn?.trim() || 'the company';
  }

  // ---------- an employee's own choice ----------

  /** GET /me/whatsapp: their own choice, their mobile, and whether the company sends WhatsApp messages now. */
  async mine(user: SessionUser): Promise<MyWhatsAppView> {
    const [config, employee, row, approver] = await Promise.all([
      this.config(),
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { mobile: true } }) : null,
      this.prisma.whatsAppOptIn.findUnique({ where: { userId: user.id } }),
      this.approves(user),
    ]);
    const mobile = phoneTidy(employee?.mobile) || null;
    const mobileChanged = !!row && !row.stoppedAt && !!mobile && row.mobile !== mobile;
    const on = !!row && !row.stoppedAt && !!mobile && row.mobile === mobile;
    return {
      available: config.ready,
      mobile,
      on,
      language: isWhatsAppLanguage(row?.language) ? row.language : 'en',
      groups: row ? { approvals: row.approvals, decisions: row.decisions, check_in: row.checkIn, interviews: row.interviews } : { ...ALL_WHATSAPP_GROUPS },
      approver,
      optedInAt: on ? row!.optedInAt.toISOString() : null,
      mobileChanged,
      stoppedAt: row?.stoppedAt?.toISOString() ?? null,
      stoppedBy: (row?.stoppedBy as 'self' | 'stop' | null) ?? null,
    };
  }

  /**
   * PUT /me/whatsapp: turned on (at their profile's mobile, every group on unless they chose), its language and groups
   * changed, or turned off. Only the person themself, in their own session (never while a Super Admin views as them,
   * even acting as them: the opt-in is theirs to give). Audited.
   */
  async saveMine(user: SessionUser, dto: MyWhatsAppInput): Promise<MyWhatsAppView> {
    if (user.viewAs) throw new ForbiddenException(WHATSAPP_OPT_IN_OWN);
    const now = new Date();
    const before = await this.prisma.whatsAppOptIn.findUnique({ where: { userId: user.id } });
    const language: WhatsAppLanguage = isWhatsAppLanguage(dto.language) ? dto.language : 'en';
    const wasOn = !!before && !before.stoppedAt;
    const groups = { ...(before && wasOn ? { approvals: before.approvals, decisions: before.decisions, check_in: before.checkIn, interviews: before.interviews } : ALL_WHATSAPP_GROUPS) };
    for (const g of WHATSAPP_GROUPS) if (typeof dto.groups?.[g] === 'boolean') groups[g] = dto.groups[g]!;
    const columns = { language, approvals: groups.approvals, decisions: groups.decisions, checkIn: groups.check_in, interviews: groups.interviews };
    if (dto.on) {
      const employee = user.employeeId ? await this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { mobile: true } }) : null;
      const mobile = phoneTidy(employee?.mobile);
      if (!mobile) throw new BadRequestException([NO_MOBILE]);
      if (!phoneOk(mobile)) throw new BadRequestException([BAD_MOBILE]);
      const fresh = !wasOn || before!.mobile !== mobile;
      const same = !fresh && before!.language === language && WHATSAPP_GROUPS.every((g) => before![GROUP_COLUMN[g]] === groups[g]);
      if (same) return this.mine(user);
      await this.prisma.whatsAppOptIn.upsert({
        where: { userId: user.id },
        create: { userId: user.id, mobile, ...columns, optedInAt: now, updatedAt: now },
        update: { mobile, ...columns, ...(fresh && { optedInAt: now }), stoppedAt: null, stoppedBy: null, updatedAt: now },
      });
      // the choice and its time, never the number (it is on their profile)
      await this.audit.record({
        userId: user.id,
        action: fresh ? 'whatsapp_opt_in' : 'whatsapp_choices',
        entityType: WHATSAPP_OPT_IN_ENTITY,
        entityId: user.id,
        diff: { language, groups, ...(fresh && before?.mobile && before.mobile !== mobile && { mobile: 'changed' }) },
      });
    } else if (before && wasOn) {
      await this.prisma.whatsAppOptIn.update({ where: { userId: user.id }, data: { ...columns, stoppedAt: now, stoppedBy: 'self', updatedAt: now } });
      await this.prisma.whatsAppMessage.updateMany({ where: { userId: user.id, status: 'queued' }, data: { status: 'cancelled', error: 'They turned WhatsApp messages off: not sent.', updatedAt: now } });
      await this.audit.record({ userId: user.id, action: 'whatsapp_opt_out', entityType: WHATSAPP_OPT_IN_ENTITY, entityId: user.id, diff: { by: 'self' } });
    } else if (before) {
      await this.prisma.whatsAppOptIn.update({ where: { userId: user.id }, data: { ...columns, updatedAt: now } });
    }
    return this.mine(user);
  }

  /** Whether "Approvals waiting" is for them: an approving role, in charge of a department or team, or with direct reports. */
  private async approves(user: SessionUser): Promise<boolean> {
    if (actsAs(user.roles, [...APPROVING_ROLES])) return true;
    if (!user.employeeId) return false;
    const [leads, reports] = await Promise.all([
      this.prisma.department.count({ where: { headId: user.employeeId } }),
      this.prisma.employment.count({ where: { managerId: user.employeeId, endDate: null } }),
    ]);
    return leads + reports > 0;
  }

  /**
   * GET /whatsapp/people/:employeeId: whether someone gets WhatsApp messages (HR, an Admin, the CEO, a Super Admin; never
   * a developer: the route refuses them), never changing it. A C-level person's is not found for those who don't see
   * C-level people.
   */
  async person(employeeId: string, user: SessionUser): Promise<WhatsAppPersonView> {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!actsAs(user.roles, [...SEES_PEOPLE])) throw new ForbiddenException('Only HR, an Admin or the CEO see whether someone gets WhatsApp messages.');
    const hidden = await this.confidential.hiddenFrom(user);
    const employee = hidden.includes(employeeId) ? null : await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { mobile: true, account: { select: { id: true } } } });
    if (!employee) throw new NotFoundException('Employee not found.');
    const none: WhatsAppPersonView = { on: false, mobile: phoneTidy(employee.mobile) || null, language: null, groups: null, optedInAt: null, stoppedAt: null, stoppedBy: null, noAccount: !employee.account };
    if (!employee.account) return none;
    const row = await this.prisma.whatsAppOptIn.findUnique({ where: { userId: employee.account.id } });
    if (!row) return none;
    const on = !row.stoppedAt && row.mobile === none.mobile;
    return {
      ...none,
      on,
      language: isWhatsAppLanguage(row.language) ? row.language : 'en',
      groups: { approvals: row.approvals, decisions: row.decisions, check_in: row.checkIn, interviews: row.interviews },
      optedInAt: on ? row.optedInAt.toISOString() : null,
      stoppedAt: row.stoppedAt?.toISOString() ?? null,
      stoppedBy: (row.stoppedBy as 'self' | 'stop' | null) ?? null,
    };
  }

  // ---------- STOP ----------

  /**
   * Someone wrote to the business number. STOP (or توقف) turns WhatsApp off for their number everywhere (an employee's
   * opt-in, every application and general CV that ticked it, their candidate), cancels what waits for it, and answers
   * once, in the language they wrote in (free: within the 24 hours after they wrote). Anything else is never answered.
   * Answers whether it was a STOP.
   */
  async reply(from: string, text: string, now = new Date()): Promise<boolean> {
    if (!isStopWord(text)) return false;
    const mobile = phoneTidy(`+${from.replace(/\D/g, '')}`);
    if (!/^\+\d{8,15}$/.test(mobile)) return false;
    const [optIns, applications, generalCvs, contacts] = await Promise.all([
      this.prisma.whatsAppOptIn.updateMany({ where: { mobile, stoppedAt: null }, data: { stoppedAt: now, stoppedBy: 'stop', updatedAt: now } }),
      this.prisma.jobApplication.updateMany({ where: { mobile, whatsappOptInAt: { not: null }, whatsappStoppedAt: null }, data: { whatsappStoppedAt: now } }),
      this.prisma.generalCv.updateMany({ where: { mobile, whatsappOptInAt: { not: null }, whatsappStoppedAt: null }, data: { whatsappStoppedAt: now } }),
      this.prisma.candidateContact.findMany({ where: { kind: 'mobile', value: mobile }, select: { candidateId: true } }),
    ]);
    const candidates = contacts.length
      ? (await this.prisma.candidate.updateMany({ where: { id: { in: contacts.map((c) => c.candidateId) } }, data: { whatsappStoppedAt: now } })).count
      : 0;
    await this.prisma.whatsAppMessage.updateMany({ where: { mobile, status: 'queued' }, data: { status: 'cancelled', error: 'They replied STOP: not sent.', updatedAt: now } });
    const language: WhatsAppLanguage = /[؀-ۿ]/.test(text) ? 'ar' : 'en';
    const body = whatsappStopConfirmation(language, await this.companyName());
    await this.prisma.whatsAppMessage.create({
      data: {
        mobile,
        template: 'stop_confirmation',
        templateName: 'text',
        language,
        kind: 'stop_confirmation',
        variables: { text: body },
        reference: 'STOP',
        status: 'queued',
        nextAttemptAt: now,
        // within Meta's 24 hours after they wrote
        sendBefore: new Date(now.getTime() + 23 * 3_600_000),
        createdAt: now,
        updatedAt: now,
      },
    });
    await this.audit.record({
      userId: null,
      action: 'whatsapp_stop',
      entityType: WHATSAPP_OPT_IN_ENTITY,
      entityId: null,
      diff: { employees: optIns.count, applications: applications.count, generalCvs: generalCvs.count, candidates },
    });
    return true;
  }

  // ---------- HR's log ----------

  /**
   * GET /whatsapp/messages: the messages, newest first, by status, type and days (Cairo), without their texts beyond the
   * template and the reference; failures with their reasons; and each day's counts (Meta charges per template message).
   * HR and a Super Admin; HR never sees a message about (or to) a C-level person, only counts it.
   */
  async messages(query: { status?: string; template?: string; from?: string; to?: string; page?: number }, user: SessionUser): Promise<WhatsAppMessagePage> {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!actsAs(user.roles, ['hr', 'super_admin'])) throw new ForbiddenException(WHATSAPP_LOG_STAFF_ONLY);
    const page = query.page && query.page >= 1 ? query.page : 1;
    const from = query.from ? new Date(zonedMoment(query.from, '00:00')) : null;
    const to = query.to ? new Date(zonedMoment(addDays(query.to, 1), '00:00')) : null;
    const filter: Prisma.WhatsAppMessageWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.template && { template: query.template }),
      ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lt: to }) } }),
    };
    const where: Prisma.WhatsAppMessageWhereInput = seesConfidential(user) ? filter : { AND: [filter, { confidential: false }] };
    const [rows, total, days] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * WHATSAPP_MESSAGES_PAGE_SIZE,
        take: WHATSAPP_MESSAGES_PAGE_SIZE,
        select: {
          id: true,
          createdAt: true,
          userId: true,
          candidateId: true,
          mobile: true,
          template: true,
          templateName: true,
          language: true,
          reference: true,
          status: true,
          error: true,
          attempts: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          user: { select: { email: true, employee: { select: { fullNameEn: true } } } },
          candidate: { select: { fullName: true } },
        },
      }),
      this.prisma.whatsAppMessage.count({ where }),
      this.dayCounts(query, from, to),
    ]);
    const items: WhatsAppMessageRow[] = rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      recipient: r.userId
        ? { kind: 'employee', name: r.user?.employee?.fullNameEn ?? r.user?.email ?? null, id: r.userId }
        : r.candidateId
          ? { kind: 'candidate', name: r.candidate?.fullName ?? null, id: r.candidateId }
          : { kind: 'number', name: null, id: null },
      mobile: r.mobile,
      template: r.templateName,
      templateKey: r.template as WhatsAppMessageRow['templateKey'],
      label: whatsappMessageLabel(r.template),
      reference: r.reference,
      language: (isWhatsAppLanguage(r.language) ? r.language : 'en') as WhatsAppLanguage,
      status: r.status as WhatsAppMessageStatus,
      problem: r.status === 'failed' || r.status === 'cancelled' || (r.status === 'queued' && r.attempts > 0) ? r.error : null,
      attempts: r.attempts,
      sentAt: r.sentAt?.toISOString() ?? null,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
    }));
    return { items, page, pageSize: WHATSAPP_MESSAGES_PAGE_SIZE, total, days };
  }

  /** Each Cairo day's counts in the filter (the last 14 days when no dates are chosen), newest first; every message counted. */
  private async dayCounts(query: { status?: string; template?: string }, from: Date | null, to: Date | null): Promise<WhatsAppDayCount[]> {
    const since = from ?? new Date(zonedMoment(addDays(cairoDay(new Date()), -13), '00:00'));
    const until = to ?? new Date(Date.now() + 86_400_000);
    const rows = await this.prisma.$queryRaw<{ day: string; total: bigint; sent: bigint; delivered: bigint; read: bigint; failed: bigint; waiting: bigint }[]>`
      SELECT to_char((created_at AT TIME ZONE 'Africa/Cairo')::date, 'YYYY-MM-DD') AS day,
        count(*) AS total,
        count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) AS sent,
        count(*) FILTER (WHERE status IN ('delivered', 'read')) AS delivered,
        count(*) FILTER (WHERE status = 'read') AS read,
        count(*) FILTER (WHERE status = 'failed') AS failed,
        count(*) FILTER (WHERE status IN ('queued', 'sending')) AS waiting
      FROM whatsapp_messages
      WHERE created_at >= ${since} AND created_at < ${until}
        AND (${query.status ?? null}::text IS NULL OR status = ${query.status ?? null}::text)
        AND (${query.template ?? null}::text IS NULL OR template = ${query.template ?? null}::text)
      GROUP BY 1 ORDER BY 1 DESC`;
    return rows.map((r) => ({ day: r.day, total: Number(r.total), sent: Number(r.sent), delivered: Number(r.delivered), read: Number(r.read), failed: Number(r.failed), waiting: Number(r.waiting) }));
  }

  // ---------- helpers ----------

  private async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      this.logger.error(`The WhatsApp message for ${what} could not be queued: ${(err as Error).message}`);
    }
  }
}

/** The quiet hours saved; none when switched off. */
export function quietOf(row: Pick<WhatsAppSettings, 'quietFrom' | 'quietTo'> | null): WhatsAppQuietHours | null {
  if (!row) return null;
  return isTimeOfDay(row.quietFrom) && isTimeOfDay(row.quietTo) && row.quietFrom !== row.quietTo ? { from: row.quietFrom, to: row.quietTo } : null;
}

/** Where an interview takes place, for the candidate: the meeting's link, the address (the office's: the company), the phone. */
function placeOf(r: { kind: string; location: string | null; meetingProvider: string | null }, company: string): WhatsAppInterviewPlace {
  const kind = r.kind === 'online' || r.kind === 'phone' ? r.kind : 'in_person';
  return {
    kind,
    location: r.location,
    meetingName: kind === 'online' && r.meetingProvider ? (MEETING_PROVIDER_LABELS[r.meetingProvider as MeetingProvider] ?? null) : null,
    company,
  };
}
