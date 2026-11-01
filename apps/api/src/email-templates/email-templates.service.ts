import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  EMAIL_TEMPLATES,
  emailTemplateKinds,
  emailTemplateProblems,
  isEmailTemplateKey,
  renderEmailTemplate,
  sampleValues,
  type EmailTemplateKey,
  type EmailTemplateText,
  type EmailTemplateView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { MailService } from '../mail/mail.service.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Organization → Email Templates (owner, 1 November 2026: "is there a templete screen for email and whatsapp templetes";
// "build the mail templetes"): HR writes the subject and text of each email the system sends, with {{fields}} filled in
// when it goes (their name, the link, the interview's day); a preview and a test with sample values; "Reset to standard"
// back to the system's words. Saved words equal to the standard ones aren't kept: the email is the system's again.
// WhatsApp messages aren't here: Meta approves their words, so they are changed in WhatsApp Manager, not in People.
// Every save, reset and test audited, with the email's name and what changed.

export const EMAIL_TEMPLATE_ENTITY = 'email_template';

const USER = { select: { id: true, email: true } } as const;

/** Tidied as saved: the subject on one line without spaces around it, the text without spaces at its ends. */
const tidy = (t: { subject: string; body: string }): EmailTemplateText => ({ subject: t.subject.trim(), body: t.body.replace(/\r\n?/g, '\n').trim() });

@Injectable()
export class EmailTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** The kind, or 404 for a key that isn't one. */
  private kindOf(key: string): EmailTemplateKey {
    if (!isEmailTemplateKey(key)) throw new NotFoundException('There is no such email.');
    return key;
  }

  /** GET /email-templates: every email, in the page's order, each with HR's words when they wrote them. */
  async list(): Promise<EmailTemplateView[]> {
    const rows = await this.prisma.emailTemplate.findMany({ include: { updatedBy: USER } });
    const names = await userNames(this.prisma, rows.map((r) => r.updatedBy));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return emailTemplateKinds().map((k) => {
      const row = byKey.get(k.key);
      return {
        key: k.key,
        group: k.group,
        label: k.label,
        when: k.when,
        fields: [...k.fields],
        required: [...k.required],
        start: { ...k.start },
        custom: row
          ? { subject: row.subject, body: row.body, updatedAt: row.updatedAt.toISOString(), updatedBy: row.updatedBy ? (names.get(row.updatedBy.id) ?? null) : null }
          : null,
      };
    });
  }

  private async one(key: EmailTemplateKey): Promise<EmailTemplateView> {
    return (await this.list()).find((t) => t.key === key)!;
  }

  /** PUT /email-templates/:key: HR's words; the standard words again remove HR's (the email is the system's again). */
  async save(key: string, dto: { subject: string; body: string }, user: SessionUser): Promise<EmailTemplateView> {
    const k = this.kindOf(key);
    const problems = emailTemplateProblems(k, dto);
    if (problems.length) throw new BadRequestException(problems);
    const next = tidy(dto);
    const start = EMAIL_TEMPLATES[k].start;
    const before = await this.prisma.emailTemplate.findUnique({ where: { key: k } });
    const was = before ? { subject: before.subject, body: before.body } : start;
    const diff = changes({ ...was }, { ...next });
    if (!Object.keys(diff).length) return this.one(k);

    if (next.subject === start.subject && next.body === start.body) {
      await this.prisma.emailTemplate.deleteMany({ where: { key: k } });
    } else {
      await this.prisma.emailTemplate.upsert({
        where: { key: k },
        create: { key: k, ...next, updatedById: user.id },
        update: { ...next, updatedById: user.id },
      });
    }
    this.mail.forgetTemplates();
    await this.audit.record({ userId: user.id, action: 'update', entityType: EMAIL_TEMPLATE_ENTITY, entityId: null, diff: { email: EMAIL_TEMPLATES[k].label, key: k, ...diff } });
    return this.one(k);
  }

  /** POST /email-templates/:key/reset: back to the system's words ("Reset to standard"). */
  async reset(key: string, user: SessionUser): Promise<EmailTemplateView> {
    const k = this.kindOf(key);
    const before = await this.prisma.emailTemplate.findUnique({ where: { key: k } });
    if (!before) return this.one(k);
    await this.prisma.emailTemplate.delete({ where: { key: k } });
    this.mail.forgetTemplates();
    await this.audit.record({
      userId: user.id,
      action: 'reset_to_standard',
      entityType: EMAIL_TEMPLATE_ENTITY,
      entityId: null,
      diff: { email: EMAIL_TEMPLATES[k].label, key: k, ...changes({ subject: before.subject, body: before.body }, { ...EMAIL_TEMPLATES[k].start }) },
    });
    return this.one(k);
  }

  /**
   * POST /email-templates/:key/test: the email filled with the sample values, to the signed-in person: the words on
   * screen (saved or not), else the saved ones, else the standard. Answers ok or why not, either way 200.
   */
  async test(key: string, dto: { subject?: string; body?: string }, user: SessionUser): Promise<{ ok: boolean; message: string; to: string }> {
    const k = this.kindOf(key);
    const saved = await this.prisma.emailTemplate.findUnique({ where: { key: k } });
    const base = saved ? { subject: saved.subject, body: saved.body } : EMAIL_TEMPLATES[k].start;
    const words = { subject: dto.subject ?? base.subject, body: dto.body ?? base.body };
    const problems = emailTemplateProblems(k, words);
    if (problems.length) throw new BadRequestException(problems);
    const to = user.email.toLowerCase();
    if (!(await this.mail.ready())) {
      throw new BadRequestException(['Email isn’t set up yet, so a test can’t be sent. A Super Admin sets it up in Organization → Email Settings.']);
    }
    const filled = renderEmailTemplate(tidy(words), sampleValues(k));
    let result: { ok: boolean; message: string };
    try {
      await this.mail.send({ to, subject: `[Test] ${filled.subject}`, text: filled.text, html: filled.html });
      result = { ok: true, message: `Sent to ${to}, filled with the sample values. Check that it arrived, and look in the spam folder if it didn’t.` };
    } catch (err) {
      result = { ok: false, message: err instanceof ServiceUnavailableException ? err.message : 'The test couldn’t be sent. Try again in a minute.' };
    }
    await this.audit.record({
      userId: user.id,
      action: 'send_test',
      entityType: EMAIL_TEMPLATE_ENTITY,
      entityId: null,
      diff: { email: EMAIL_TEMPLATES[k].label, key: k, sentTo: to, sent: result.ok, ...(!result.ok && { reason: result.message }) },
    });
    return { ...result, to };
  }
}
