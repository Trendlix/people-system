import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  DEVELOPER_NO_FILES,
  isEmail,
  MAIL_PASSWORD_UNREADABLE,
  MAIL_SETTINGS_OWN_ACCOUNT,
  MAIL_SETTINGS_SUPER_ADMIN_ONLY,
  mailAddress,
  mailMissing,
  mailSettingsProblems,
  type MailProvider,
  type MailSecurity,
  type MailSettingsView,
  type MailTestView,
} from '@trendlix/shared';
import { AuditService, changes } from '../audit/audit.service.js';
import { isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import type { MailSettings } from '../generated/prisma/client.js';
import { userNames } from '../payroll/adjustments/people.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MailServerDto, MailSettingsDto, MailTestDto } from './mail-settings.dto.js';
import { MailService } from './mail.service.js';

// Organization → Email Settings (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"; the plan
// told to the owner: "a page Organization → Email Settings, Super Admin only"; "the password encrypted, never shown
// again ("Set · Replace"), never sent to the browser, developers or the audit log"; "the server's .env kept as the
// fallback when the page isn't filled"). A Super Admin in their own session only: anyone else is refused (the
// controller's @Roles), a developer before anything runs (@NotForDevelopers; their writes by the guard), and a Super
// Admin viewing as someone, even another Super Admin with Act as them, here. Every save audited with its changes, the
// password only as "changed"; every test with whom it went to and whether it went.
//
// The test email (POST /mail-settings/test) is sent with the form's values as they are on screen, saved or not, and the
// saved password when the box is left empty: the settings can be tried before they are saved or switched on, so a
// mistake never goes live to find out. With the form unchanged it is a test of the saved settings. Its result is kept
// on the settings (the last test) and in the audit log.

export const MAIL_SETTINGS_ENTITY = 'mail_settings';

const USER = { select: { id: true, email: true } } as const;

/** The form's values as a plain object, for the shared checks. */
const inputOf = (dto: MailServerDto) => ({
  provider: dto.provider,
  host: dto.host ?? null,
  port: dto.port,
  security: dto.security,
  username: dto.username ?? null,
  fromName: dto.fromName ?? null,
  fromAddress: dto.fromAddress ?? null,
  replyTo: dto.replyTo ?? null,
});

/** What a save shows in the audit log and compares: everything but the password. */
const shown = (r: Partial<MailSettings> | null) => ({
  provider: r?.provider ?? null,
  host: r?.host ?? null,
  port: r?.port ?? null,
  security: r?.security ?? null,
  username: r?.username ?? null,
  fromName: r?.fromName ?? null,
  fromAddress: r?.fromAddress ?? null,
  replyTo: r?.replyTo ?? null,
  enabled: r?.enabled ?? null,
});

@Injectable()
export class MailSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** A Super Admin in their own session; anyone else refused, a developer too (also refused before, by the interceptor). */
  private assertOwner(user: SessionUser): void {
    if (user.developer) throw new ForbiddenException(DEVELOPER_NO_FILES);
    if (!isSuperAdmin(user)) throw new ForbiddenException(MAIL_SETTINGS_SUPER_ADMIN_ONLY);
    if (user.viewAs) throw new ForbiddenException(MAIL_SETTINGS_OWN_ACCOUNT);
  }

  /** GET /mail-settings: the settings without the password (whether one is saved, whether it reads), and where mail goes from. */
  async get(user: SessionUser): Promise<MailSettingsView> {
    this.assertOwner(user);
    return this.view();
  }

  private async view(): Promise<MailSettingsView> {
    const row = await this.prisma.mailSettings.findUnique({ where: { id: 1 }, include: { updatedBy: USER } });
    const names = await userNames(this.prisma, [row?.updatedBy ?? null]);
    const passwordSet = !!row?.passwordEnc;
    const readable = this.mail.passwordReadable(row);
    return {
      provider: (row?.provider ?? 'other') as MailProvider,
      host: row?.host ?? null,
      port: row?.port ?? 587,
      security: (row?.security ?? 'starttls') as MailSecurity,
      username: row?.username ?? null,
      passwordSet,
      passwordUnreadable: passwordSet && !readable,
      fromName: row?.fromName ?? null,
      fromAddress: row?.fromAddress ?? null,
      replyTo: row?.replyTo ?? null,
      enabled: row?.enabled ?? false,
      missing: mailMissing({ host: row?.host ?? null, fromAddress: row?.fromAddress ?? null, username: row?.username ?? null, password: readable }),
      // saved by someone (a row made by a test alone has no saver)
      updatedAt: row?.updatedById ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy.id) ?? null) : null,
      lastTest: row?.lastTestAt ? { at: row.lastTestAt.toISOString(), ok: !!row.lastTestOk, message: row.lastTestMessage ?? '' } : null,
      sending: this.mail.sendingWith(row),
    };
  }

  /** The values a save or a test keeps, tidied: the addresses in lower case, empty ones null. */
  private values(dto: MailServerDto) {
    return {
      provider: dto.provider,
      host: dto.host?.trim().toLowerCase() || null,
      port: dto.port,
      security: dto.security,
      username: dto.username?.trim() || null,
      fromName: dto.fromName?.trim() || null,
      fromAddress: mailAddress(dto.fromAddress),
      replyTo: mailAddress(dto.replyTo),
    };
  }

  /** PUT /mail-settings: an empty password keeps the saved one; the transport is made again on the next email. */
  async update(dto: MailSettingsDto, user: SessionUser): Promise<MailSettingsView> {
    this.assertOwner(user);
    const before = await this.prisma.mailSettings.findUnique({ where: { id: 1 } });
    const password = dto.password ? dto.password : null;
    const problems = mailSettingsProblems({ ...inputOf(dto), password, enabled: dto.enabled }, { passwordSaved: this.mail.passwordReadable(before) });
    // switched on with a username, and the saved password sealed with a key this server no longer has: say so
    if (dto.enabled && !password && dto.username?.trim() && before?.passwordEnc && !this.mail.passwordReadable(before)) {
      throw new BadRequestException([MAIL_PASSWORD_UNREADABLE]);
    }
    if (problems.length) throw new BadRequestException(problems);

    const next = { ...this.values(dto), enabled: dto.enabled };
    const diff: Record<string, unknown> = changes(shown(before), shown(next));
    // the password only as "changed": never its value, its length or any part of it
    if (password) diff.password = 'changed';
    if (!Object.keys(diff).length) return this.view();

    const sealed = password ? this.mail.sealPassword(password) : {};
    const data = { ...next, ...sealed, updatedById: user.id, updatedAt: new Date() };
    await this.prisma.mailSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    this.mail.forget();
    await this.audit.record({ userId: user.id, action: 'update', entityType: MAIL_SETTINGS_ENTITY, entityId: null, diff });
    return this.view();
  }

  /** DELETE /mail-settings/password: "Remove the saved password". Switched on with a username, they stop being used. */
  async removePassword(user: SessionUser): Promise<MailSettingsView> {
    this.assertOwner(user);
    const before = await this.prisma.mailSettings.findUnique({ where: { id: 1 }, select: { passwordEnc: true } });
    if (!before?.passwordEnc) return this.view();
    await this.prisma.mailSettings.update({ where: { id: 1 }, data: { passwordEnc: null, passwordKeyId: null, updatedById: user.id, updatedAt: new Date() } });
    this.mail.forget();
    await this.audit.record({ userId: user.id, action: 'remove_password', entityType: MAIL_SETTINGS_ENTITY, entityId: null, diff: { password: 'changed' } });
    return this.view();
  }

  /**
   * POST /mail-settings/test: a short email to `to` (default: the signed-in user) with the form's values, and the saved
   * password when none is typed. Answers ok, or why not in plain words, either way 200; kept as the last test.
   */
  async test(dto: MailTestDto, user: SessionUser): Promise<MailTestView> {
    this.assertOwner(user);
    const before = await this.prisma.mailSettings.findUnique({ where: { id: 1 } });
    const typed = dto.password ? dto.password : null;
    const readable = this.mail.passwordReadable(before);
    if (!typed && dto.username?.trim() && before?.passwordEnc && !readable) throw new BadRequestException([MAIL_PASSWORD_UNREADABLE]);
    const problems = mailSettingsProblems({ ...inputOf(dto), password: typed, enabled: false }, { passwordSaved: readable, forTest: true });
    const to = mailAddress(dto.to) ?? user.email.toLowerCase();
    if (!isEmail(to)) problems.push('Write the address to send the test to in full, e.g. hr@trendlix.com.');
    if (problems.length) throw new BadRequestException(problems);

    const v = this.values(dto);
    const password = v.username ? (typed ?? this.mail.openPassword(before)) : null;
    const result = await this.mail.sendTest(
      { provider: v.provider, host: v.host!, port: v.port, security: v.security, username: v.username, password, fromName: v.fromName, fromAddress: v.fromAddress!, replyTo: v.replyTo },
      to,
    );
    const at = new Date();
    const last = { lastTestAt: at, lastTestOk: result.ok, lastTestMessage: result.message };
    await this.prisma.mailSettings.upsert({ where: { id: 1 }, create: { id: 1, ...last }, update: last });
    await this.audit.record({
      userId: user.id,
      action: 'send_test',
      entityType: MAIL_SETTINGS_ENTITY,
      entityId: null,
      diff: { sentTo: to, sent: result.ok, ...(!result.ok && { reason: result.message }) },
    });
    return { at: at.toISOString(), ok: result.ok, message: result.message };
  }
}
