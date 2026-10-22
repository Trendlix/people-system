import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_LINK_DAYS,
  isSignInEmailChoice,
  ROLES,
  setPasswordPath,
  signInEmailOf,
  type AccessLinkPurpose,
  type AccessLinkResult,
  type AssetsAccess,
  type BulkInviteResult,
  type EmployeeAccessView,
  type Role,
  type SignInEmailChoice,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { actsAs } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';
import { fromDateOnly, todayInCairo, toDateOnly } from '../common/date-only.js';
import { ConfidentialService } from '../employees/confidential.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { accessStates, eligibleIds, inForceEmployment, notEligibleReason } from './access-state.js';

// Every active employee gets access (owner, 22 October 2026: "i dont thint that the users and employees needs to be
// divided, any active employee with active contract should have access. how can we make it?"; packages/shared
// employee-access.ts):
// - The accounts: an employee with a current employment and a signed contract in force gets one, linked to them
//   (users.employee_id), in the email HR chose ("let the HR Choose which mail to use"), with the Employee role and
//   Direct manager when someone reports to them then. Made by a sweep every few minutes (and at once from the profile),
//   never sending anything ("Create now, HR sends when ready"). An account another person's email holds is never made
//   (the profile shows the clash); one of the Users page's with that email, not linked to anyone, is taken over. An
//   account kept while its contract isn't in force (a renewal on its way) is listed, never closed: their employment's
//   end closes it (offboarding).
// - The first password by a set-password link ("Set-password link"): emailed, or copied by HR, valid 7 days, used once,
//   only its SHA-256 kept, a new one cancelling the older ones; a reset the same way.
// - Access is managed on the profile ("On the employee profile"): HR, an Admin and a Super Admin see it; the C-level
//   rules hold (a C-level person's is the CEO's and a Super Admin's: 404 for HR); the person sees their own sign-in.
//   Roles, Assets access, turning it off and sessions stay the Users page's tools (an Admin's), now shown on the profile.

export const ACCESS_ENTITY = 'user';
const EMPLOYEE_ENTITY = 'employee';
const LOCK_NAME = 'people-system employee access';

/** A token's SHA-256 (hex): what the database keeps. */
export const tokenHashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The website's address for the links (WEB_ORIGIN; never taken from a request). */
export const webOriginOf = (config: ConfigService): string => (config.get<string>('WEB_ORIGIN')?.trim() || 'https://people.trendlix.com').replace(/\/+$/, '');

const DAY_MS = 86_400_000;

/** Who manages access: HR, an Admin, a Super Admin (and the CEO, for a C-level person). */
const managesAccess = (user: SessionUser) => actsAs(user.roles, ['hr', 'admin']);
/** Who manages an account's roles, Assets access, active flag and sessions: an Admin or a Super Admin (the Users page's). */
const managesAccounts = (user: SessionUser) => actsAs(user.roles, ['admin']);

const PERSON = {
  id: true,
  fullNameEn: true,
  workEmail: true,
  personalEmail: true,
  signInEmail: true,
  account: {
    select: { id: true, email: true, isActive: true, passwordHash: true, createdAt: true, assetsAccess: true, roles: { select: { role: { select: { key: true } } } } },
  },
} as const satisfies Prisma.EmployeeSelect;

type Person = Prisma.EmployeeGetPayload<{ select: typeof PERSON }>;

/** What making an employee's account came to. */
type EnsureResult = 'created' | 'linked' | 'synced' | 'kept' | 'clash' | 'no_email' | 'not_eligible';

@Injectable()
export class EmployeeAccessService {
  private readonly logger = new Logger('EmployeeAccess');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly confidential: ConfidentialService,
    private readonly config: ConfigService,
  ) {}

  // ---------- reading ----------

  /** GET /employees/:id/access: refused (404) to anyone who may not manage it, but the person themself. */
  async view(employeeId: string, user: SessionUser, now = new Date()): Promise<EmployeeAccessView> {
    const person = await this.allowed(employeeId, user, { self: true });
    const [eligible, states] = await Promise.all([eligibleIds(this.prisma, [employeeId]), accessStates(this.prisma, [person], now)]);
    const isEligible = eligible.has(employeeId);
    const a = person.account;
    const chosen = signInEmailOf(person);
    const [link, lastSignIn, clash, closedBy] = await Promise.all([
      a
        ? this.prisma.accessLink.findFirst({
            where: { userId: a.id, usedAt: null, cancelledAt: null, expiresAt: { gt: now } },
            orderBy: { createdAt: 'desc' },
            select: { purpose: true, createdAt: true, expiresAt: true, emailed: true },
          })
        : null,
      a ? this.prisma.auditLog.findFirst({ orderBy: { at: 'desc' }, where: { entityType: 'user', entityId: a.id, action: { in: ['login', 'device_login'] } }, select: { at: true } }) : null,
      !a && chosen ? this.prisma.user.findUnique({ where: { email: chosen.email }, select: { email: true, employee: { select: { id: true, fullNameEn: true } } } }) : null,
      // closed: by their employment's end (offboarding), else turned off on the Users page or the Access tab
      a && !a.isActive ? this.prisma.employment.findFirst({ where: { employeeId, signInClosedAt: { not: null } }, orderBy: { signInClosedAt: 'desc' }, select: { endDate: true } }) : null,
    ]);
    const self = user.employeeId === employeeId && !managesAccess(user);
    const state = states.get(employeeId)!;
    return {
      employeeId,
      state: state.state,
      signInEmail: {
        choice: isSignInEmailChoice(person.signInEmail) ? person.signInEmail : null,
        work: self ? null : person.workEmail,
        personal: self ? null : person.personalEmail,
        email: a?.email ?? chosen?.email ?? null,
      },
      eligible: isEligible,
      notEligibleReason: isEligible ? null : await notEligibleReason(this.prisma, employeeId),
      account: a && {
        id: a.id,
        email: a.email,
        isActive: a.isActive,
        passwordSet: !!a.passwordHash,
        createdAt: a.createdAt.toISOString(),
        lastSignInAt: lastSignIn?.at.toISOString() ?? null,
        roles: self ? [] : ROLES.filter((r) => a.roles.some((x) => x.role.key === r)),
        assetsAccess: (self ? 'none' : a.assetsAccess) as AssetsAccess,
      },
      closedReason: !a || a.isActive ? null : closedBy?.endDate ? `Their employment ended on ${fromDateOnly(closedBy.endDate)}.` : 'Turned off by an Admin.',
      link: self ? null : link && { purpose: link.purpose as AccessLinkPurpose, createdAt: link.createdAt.toISOString(), expiresAt: link.expiresAt.toISOString(), emailed: link.emailed },
      clash: clash && clash.employee?.id !== employeeId && (clash.employee || state.state === 'clash') ? { email: clash.email, otherEmployee: clash.employee } : null,
      withoutContract: state.withoutContract,
      emailReady: this.mail.configured,
      can: { invite: !self && this.mayManage(user), manageAccount: !self && managesAccounts(user) },
    };
  }

  // ---------- the accounts ----------

  /**
   * Makes (or keeps in step) the account of an employee who should have one: their current employment has a signed
   * contract in force, and they have an email. Answers what it came to; never sends anything. `actor`: who asked (the
   * profile's Give access now), else the system (the sweep).
   */
  async ensureFor(employeeId: string, actor: SessionUser | null = null, today = todayInCairo()): Promise<EnsureResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // one employee's account at a time (the sweep and the profile at once)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${LOCK_NAME}:${employeeId}`}))`;
      const person = await tx.employee.findUnique({ where: { id: employeeId }, select: PERSON });
      if (!person) return { result: 'not_eligible' as const };
      const wanted = signInEmailOf(person);
      const a = person.account;
      if (!(await eligibleIds(tx, [employeeId], today)).has(employeeId)) return { result: 'not_eligible' as const };
      if (!wanted) return { result: 'no_email' as const };
      const holder = await tx.user.findUnique({ where: { email: wanted.email }, select: { id: true, employeeId: true } });
      if (a) {
        if (a.email === wanted.email) return { result: 'kept' as const };
        if (holder && holder.id !== a.id) return { result: 'clash' as const };
        await tx.user.update({ where: { id: a.id }, data: { email: wanted.email } });
        return { result: 'synced' as const, userId: a.id, from: a.email, to: wanted.email };
      }
      if (holder) {
        if (holder.employeeId && holder.employeeId !== employeeId) return { result: 'clash' as const };
        // an account of the Users page with their email, linked to nobody: theirs from now on
        await tx.user.update({ where: { id: holder.id }, data: { employeeId } });
        return { result: 'linked' as const, userId: holder.id, to: wanted.email };
      }
      // an account of the Users page with their other email (made before every employee had access), linked to nobody:
      // theirs too, never a second one. With no choice made, that email becomes their sign-in one; with HR's choice, the
      // account moves to the chosen email.
      const other = otherEmailOf(person, wanted.choice);
      const otherHolder = other ? await tx.user.findUnique({ where: { email: other.email }, select: { id: true, employeeId: true } }) : null;
      if (other && otherHolder && !otherHolder.employeeId) {
        const chosen = isSignInEmailChoice(person.signInEmail);
        await tx.user.update({ where: { id: otherHolder.id }, data: { employeeId, ...(chosen && { email: wanted.email }) } });
        if (!chosen) await tx.employee.update({ where: { id: employeeId }, data: { signInEmail: other.choice } });
        return { result: 'linked' as const, userId: otherHolder.id, to: chosen ? wanted.email : other.email };
      }
      // Direct manager when someone's current employment reports to them now (the role is the Users page's otherwise)
      const manages = await tx.employment.count({ where: { managerId: employeeId, OR: [{ endDate: null }, { endDate: { gte: toDateOnly(today) } }] } });
      const keys: Role[] = manages ? ['employee', 'manager'] : ['employee'];
      const roles = await tx.role.findMany({ where: { key: { in: keys } }, select: { id: true } });
      const made = await tx.user.create({
        data: { email: wanted.email, employeeId, passwordHash: null, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
        select: { id: true },
      });
      return { result: 'created' as const, userId: made.id, to: wanted.email, roles: keys };
    });
    if (result.result === 'created' || result.result === 'linked' || result.result === 'synced') {
      await this.audit.record({
        userId: actor?.id ?? null,
        action: result.result === 'created' ? 'create' : 'update',
        entityType: ACCESS_ENTITY,
        entityId: result.userId,
        diff:
          result.result === 'created'
            ? { email: result.to, roles: result.roles, employeeId, reason: 'An active employee with an active contract' }
            : result.result === 'linked'
              ? { employeeId, reason: 'Their sign-in email: linked to their profile' }
              : { email: { from: result.from, to: result.to }, reason: 'Their sign-in email changed' },
      });
    }
    return result.result;
  }

  /**
   * The sweep (every few minutes, and in the tests by hand): every eligible employee's account made or kept in step.
   * Answers how many it made, linked and changed. One sweep at a time across the API's instances.
   */
  async sweep(today = todayInCairo()): Promise<{ created: number; linked: number; synced: number } | null> {
    const started = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`${LOCK_NAME} sweep`})) AS locked`;
      if (!lock?.locked) return null;
      return tx.employee.findMany({ where: { employments: { some: inForceEmployment(today) } }, select: { id: true } });
    });
    if (!started) return null;
    const counts = { created: 0, linked: 0, synced: 0 };
    for (const e of started) {
      try {
        const r = await this.ensureFor(e.id, null, today);
        if (r === 'created' || r === 'linked' || r === 'synced') counts[r]++;
      } catch (err) {
        this.logger.warn(`The account of ${e.id} could not be made: ${(err as Error).message}`);
      }
    }
    if (counts.created || counts.linked || counts.synced) this.logger.log(`Access: ${counts.created} made, ${counts.linked} linked, ${counts.synced} changed.`);
    return counts;
  }

  /**
   * After a contract is signed (the first, a renewal) or an employment changes: their account made or kept in step at
   * once, the sweep catching anything missed. Never fails the change that called it.
   */
  async afterChange(employeeId: string): Promise<void> {
    try {
      await this.ensureFor(employeeId);
    } catch (err) {
      this.logger.warn(`The account of ${employeeId} could not be made now (the sweep tries again): ${(err as Error).message}`);
    }
  }

  /** POST /employees/:id/access/account: Give access now (HR, Admin, Super Admin). 409 with why it can't be made. */
  async giveNow(employeeId: string, user: SessionUser): Promise<EmployeeAccessView> {
    await this.allowed(employeeId, user);
    const r = await this.ensureFor(employeeId, user);
    if (r === 'not_eligible') throw new ConflictException(await notEligibleReason(this.prisma, employeeId));
    if (r === 'no_email') throw new ConflictException('Add a work or personal email to their profile first.');
    if (r === 'clash') throw new ConflictException('Another account already uses this email. An Admin can change that account on the Users page, or choose their other email.');
    return this.view(employeeId, user);
  }

  /** PUT /employees/:id/access/sign-in-email: the email they sign in with, work or personal; the account follows. */
  async setSignInEmail(employeeId: string, choice: unknown, user: SessionUser): Promise<EmployeeAccessView> {
    if (!isSignInEmailChoice(choice)) throw new BadRequestException(['Choose their work email or their personal email.']);
    const person = await this.allowed(employeeId, user);
    const address = choice === 'work' ? person.workEmail : person.personalEmail;
    if (!address) throw new BadRequestException([choice === 'work' ? 'They have no work email: add it on Basic Data first.' : 'They have no personal email: add it on Basic Data first.']);
    const before: SignInEmailChoice | null = isSignInEmailChoice(person.signInEmail) ? person.signInEmail : null;
    // a clash is refused before anything changes: their account keeps its email
    const email = address.trim().toLowerCase();
    if (person.account && person.account.email !== email) {
      const holder = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (holder && holder.id !== person.account.id) throw new ConflictException(`Another account already signs in with ${email}.`);
    }
    if (before !== choice) {
      await this.prisma.employee.update({ where: { id: employeeId }, data: { signInEmail: choice } });
      await this.audit.record({ userId: user.id, action: 'update', entityType: EMPLOYEE_ENTITY, entityId: employeeId, diff: { signInEmail: { from: before, to: choice } } });
    }
    await this.ensureFor(employeeId, user);
    return this.view(employeeId, user);
  }

  // ---------- set-password links ----------

  /**
   * POST /employees/:id/access/invite or …/reset: a set-password link for their account, emailed (`mode: 'email'`, SMTP
   * set up) or to copy (`mode: 'copy'`: the link comes back once). An invitation for an account without a password, a
   * reset for any active account.
   */
  async makeLink(employeeId: string, purpose: AccessLinkPurpose, mode: 'email' | 'copy', user: SessionUser): Promise<AccessLinkResult> {
    const person = await this.allowed(employeeId, user);
    // an eligible person without an account yet gets it first
    if (!person.account) await this.ensureFor(employeeId, user);
    const account = await this.prisma.user.findUnique({ where: { employeeId }, select: { id: true, email: true, isActive: true, passwordHash: true } });
    if (!account) throw new ConflictException('They have no account yet: they need a signed contract in force and an email.');
    if (!account.isActive) throw new ConflictException('Their access is turned off: turn it on first.');
    if (purpose === 'invite' && account.passwordHash) throw new ConflictException('They have set their password already: send a password reset instead.');
    if (mode === 'email' && !this.mail.configured) throw new ConflictException("Email isn't set up on the server yet: copy the link and send it yourself.");
    return this.issue(account, person.fullNameEn, purpose, mode, user);
  }

  /** POST /employees/access/invitations: invitations emailed to those chosen (or every one not invited), as one press. */
  async inviteMany(input: { employeeIds?: unknown; allNotInvited?: unknown }, user: SessionUser): Promise<BulkInviteResult> {
    if (!this.mayManage(user)) throw new ForbiddenException('Only HR, an Admin or a Super Admin send invitations.');
    if (!this.mail.configured) throw new ConflictException("Email isn't set up on the server yet: copy each person's link from their profile instead.");
    const hidden = await this.confidential.view(user);
    let ids: string[];
    if (input.allNotInvited === true) {
      ids = (await this.prisma.employee.findMany({ where: { employments: { some: inForceEmployment() } }, select: { id: true } })).map((e) => e.id);
    } else if (Array.isArray(input.employeeIds) && input.employeeIds.every((x) => typeof x === 'string') && input.employeeIds.length <= 500) {
      ids = [...new Set(input.employeeIds as string[])];
    } else {
      throw new BadRequestException(['Choose the people to invite, or everyone not invited yet.']);
    }
    // C-level people hidden from HR left out; the CEO (without HR's roles) invites only the C-level people
    ids = ids.filter((id) => !hidden.hidden.has(id) && (managesAccess(user) || hidden.all.has(id)));
    const people = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: PERSON });
    const result: BulkInviteResult = { sent: 0, skipped: [] };
    for (const p of people) {
      try {
        if (!p.account) await this.ensureFor(p.id, user);
        const [fresh] = await this.prisma.employee.findMany({ where: { id: p.id }, select: PERSON });
        const state = (await accessStates(this.prisma, [fresh])).get(p.id)!.state;
        const a = fresh.account;
        if (!a || state !== 'not_invited') {
          // asked for by name: say why not; "everyone not invited" leaves the others out quietly
          if (input.allNotInvited !== true) result.skipped.push({ employeeId: p.id, fullNameEn: p.fullNameEn, reason: SKIP_REASON[state] });
          continue;
        }
        await this.issue({ id: a.id, email: a.email }, p.fullNameEn, 'invite', 'email', user);
        result.sent++;
      } catch (err) {
        result.skipped.push({ employeeId: p.id, fullNameEn: p.fullNameEn, reason: (err as Error).message });
      }
    }
    return result;
  }

  /** Makes a link for an account (the older ones waiting cancelled), and emails it or answers it to copy. */
  async issue(account: { id: string; email: string }, name: string | null, purpose: AccessLinkPurpose, mode: 'email' | 'copy', actor: SessionUser | null): Promise<AccessLinkResult> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_LINK_DAYS * DAY_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.accessLink.updateMany({ where: { userId: account.id, usedAt: null, cancelledAt: null }, data: { cancelledAt: now } });
      await tx.accessLink.create({ data: { userId: account.id, purpose, tokenHash: tokenHashOf(token), createdAt: now, expiresAt, createdById: actor?.id ?? null, emailed: mode === 'email' } });
    });
    const link = `${webOriginOf(this.config)}${setPasswordPath(token)}`;
    if (mode === 'email') await this.mail.send(await this.linkMail(account.email, name, purpose, link, expiresAt));
    // the audit says a link was made, never the token
    await this.audit.record({
      userId: actor?.id ?? null,
      action: purpose === 'invite' ? 'invite' : 'password_link',
      entityType: ACCESS_ENTITY,
      entityId: account.id,
      diff: { purpose, emailed: mode === 'email', expiresAt: expiresAt.toISOString() },
    });
    return { emailed: mode === 'email', expiresAt: expiresAt.toISOString(), ...(mode === 'copy' && { link }) };
  }

  /** The email with a set-password link: English, then Arabic. */
  private async linkMail(to: string, name: string | null, purpose: AccessLinkPurpose, link: string, expiresAt: Date) {
    const company = (await this.prisma.company.findUnique({ where: { id: 1 }, select: { nameEn: true, nameAr: true } })) ?? { nameEn: 'The company', nameAr: null };
    const until = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(expiresAt);
    const origin = webOriginOf(this.config);
    const hello = name ? `Hello ${name},` : 'Hello,';
    const invite = purpose === 'invite';
    const subject = invite ? `${company.nameEn}: your Trendlix People account` : 'Set a new password for Trendlix People';
    const text = [
      hello,
      '',
      invite
        ? `${company.nameEn} has given you access to Trendlix People, the company's HR system: your requests, attendance, payslips and more.`
        : 'A new password was asked for your Trendlix People account. If you didn’t ask for it, you can ignore this email.',
      '',
      `Your sign-in email: ${to}`,
      `Set your password with this link (it works once, until ${until}):`,
      link,
      '',
      `Then sign in at ${origin}/login, or in the Trendlix People app.`,
      '',
      '—',
      '',
      name ? `مرحبًا ${name}،` : 'مرحبًا،',
      '',
      invite
        ? `أتاحت لك ${company.nameAr ?? company.nameEn} الدخول إلى Trendlix People، نظام الموارد البشرية للشركة: طلباتك وحضورك وقسائم راتبك وغيرها.`
        : 'طُلبت كلمة مرور جديدة لحسابك في Trendlix People. إن لم تطلبها فتجاهل هذه الرسالة.',
      '',
      `بريد الدخول: ${to}`,
      `اختر كلمة المرور من هذا الرابط (يعمل مرة واحدة حتى ${until}):`,
      link,
    ].join('\n');
    return { to, subject, text };
  }

  // ---------- who may ----------

  private mayManage(user: SessionUser): boolean {
    return managesAccess(user) || actsAs(user.roles, ['ceo']);
  }

  /**
   * The person, when the user may manage their access: HR, an Admin or a Super Admin, the CEO for a C-level person (a
   * C-level person's is hidden from HR: 404, as their profile is); with `self`, the person themself too (read only).
   */
  private async allowed(employeeId: string, user: SessionUser, opts: { self?: boolean } = {}): Promise<Person> {
    const person = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: PERSON });
    if (!person) throw new NotFoundException('Employee not found.');
    if (opts.self && user.employeeId === employeeId) return person;
    if (await this.confidential.isHidden(user, employeeId)) throw new NotFoundException('Employee not found.');
    const view = await this.confidential.view(user);
    const ok = managesAccess(user) || (actsAs(user.roles, ['ceo']) && view.all.has(employeeId));
    if (!ok) throw new NotFoundException('Employee not found.');
    return person;
  }
}

/** The address other than the one they sign in with (their personal email when it's the work one, and back). */
function otherEmailOf(p: { workEmail: string | null; personalEmail: string | null }, choice: SignInEmailChoice): { choice: SignInEmailChoice; email: string } | null {
  const otherChoice: SignInEmailChoice = choice === 'work' ? 'personal' : 'work';
  const email = (otherChoice === 'work' ? p.workEmail : p.personalEmail)?.trim().toLowerCase();
  return email ? { choice: otherChoice, email } : null;
}

/** Why a person asked for by name got no invitation. */
const SKIP_REASON: Record<string, string> = {
  no_email: 'No work or personal email on their profile.',
  not_eligible: 'No signed contract in force today.',
  pending: 'Their account couldn’t be made yet.',
  clash: 'Another account uses their email.',
  invited: 'Invited already: resend from their profile.',
  active: 'They have set their password already.',
  closed: 'Their access is turned off.',
};
