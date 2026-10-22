import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_IP_TOKEN,
  ACCESS_LINK_STATE_TEXT,
  accountEmail,
  FORGOT_PASSWORD_ANSWER,
  FORGOT_PASSWORD_LIMITS,
  isAccessToken,
  SET_PASSWORD_FAILED_PER_HOUR,
  type AccessLinkCheck,
  type AccessLinkPurpose,
} from '@trendlix/shared';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { AuditService } from '../audit/audit.service.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password.dto.js';
import { hashPassword } from '../auth/password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_ENTITY, EmployeeAccessService, tokenHashOf } from './employee-access.service.js';

// The public side of set-password links (owner, 22 October 2026: "Set-password link"; packages/shared
// employee-access.ts): the page a link opens asks what it is, then sets the password with it; and Forgot password on
// the sign-in page. No session: the token is the proof, never logged, only its SHA-256 looked up. Rate-limited by the
// address (the one the website signed with WEB_KEY, else the connection's) and, for Forgot password, by the email; its
// answer is always the same, so it never says whether an account has the email.

const HOUR_MS = 60 * 60 * 1000;

/** Where a public request comes from: the connection's address, and the headers (the address the website signed). */
export interface LinkOrigin {
  ip: string | null;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class AccessLinksService {
  private readonly logger = new Logger('AccessLinks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EmployeeAccessService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /auth/password-link/check: what a link is (it works, has expired, was used, is unknown). Changes nothing but
   * an unknown link counted against the address, as a failed try (429 after too many in an hour).
   */
  async check(token: unknown, origin: LinkOrigin, now = new Date()): Promise<AccessLinkCheck> {
    const ip = this.ipOf(origin);
    await this.limit('set_failed', { ip }, SET_PASSWORD_FAILED_PER_HOUR, now);
    const found = typeof token === 'string' ? await this.find(token) : null;
    if (!found) {
      await this.prisma.accessLinkRequest.create({ data: { kind: 'set_failed', ip, at: now } });
      return { state: 'unknown' };
    }
    const state = stateOf(found, now);
    if (state !== 'ok') return { state };
    return { state, email: found.user.email, purpose: found.purpose as AccessLinkPurpose, expiresAt: found.expiresAt.toISOString() };
  }

  /**
   * POST /auth/password-link: the password set with a link that works, which is used up (once, whoever presses at the
   * same moment); the account's other links waiting are cancelled. A reset also ends their sessions and signs their
   * phones out, as an Admin's reset does. Refused (400) with the link's state in words; (403) a closed account; (429)
   * too many failed tries from one address in an hour.
   */
  async setPassword(token: unknown, password: unknown, origin: LinkOrigin, now = new Date()): Promise<{ email: string }> {
    const ip = this.ipOf(origin);
    await this.limit('set_failed', { ip }, SET_PASSWORD_FAILED_PER_HOUR, now);
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      throw new BadRequestException([`Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`]);
    }
    const found = typeof token === 'string' ? await this.find(token) : null;
    const state = found ? stateOf(found, now) : 'unknown';
    if (!found || state !== 'ok') {
      await this.prisma.accessLinkRequest.create({ data: { kind: 'set_failed', ip, at: now } });
      throw new BadRequestException([ACCESS_LINK_STATE_TEXT[state as Exclude<typeof state, 'ok'>]]);
    }
    if (!found.user.isActive) throw new ConflictException('Your access is turned off. Ask HR.');
    const passwordHash = await hashPassword(password);
    const reset = found.purpose === 'reset';
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.accessLink.updateMany({ where: { id: found.id, usedAt: null, cancelledAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (!count) return null;
      await tx.accessLink.updateMany({ where: { userId: found.userId, id: { not: found.id }, usedAt: null, cancelledAt: null }, data: { cancelledAt: now } });
      await tx.user.update({ where: { id: found.userId }, data: { passwordHash } });
      if (!reset) return { sessionsEnded: 0, devicesRevoked: 0 };
      const sessions = await tx.session.updateMany({ where: { userId: found.userId, endedAt: null }, data: { endedAt: now, endReason: 'revoked' } });
      const devices = await tx.deviceCredential.updateMany({ where: { userId: found.userId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'password_reset' } });
      return { sessionsEnded: sessions.count, devicesRevoked: devices.count };
    });
    if (!done) throw new BadRequestException([ACCESS_LINK_STATE_TEXT.used]);
    await this.audit.record({
      userId: found.userId,
      action: 'password_set',
      entityType: ACCESS_ENTITY,
      entityId: found.userId,
      diff: { purpose: found.purpose, via: 'link', ...(reset && done) },
    });
    return { email: found.user.email };
  }

  /**
   * POST /auth/forgot-password: a reset link emailed to an active account with this email, at most 3 an hour for one
   * email (more are left unsent, quietly). Always the same answer; 429 only for too many requests from one address.
   */
  async forgot(emailIn: unknown, origin: LinkOrigin, now = new Date()): Promise<{ message: string }> {
    const ip = this.ipOf(origin);
    await this.limit('forgot', { ip }, FORGOT_PASSWORD_LIMITS.perIpHour, now);
    const email = typeof emailIn === 'string' ? accountEmail(emailIn) : null;
    if (!email || email.length > 254 || !email.includes('@')) throw new BadRequestException(['Enter your sign-in email.']);
    const recent = await this.prisma.accessLinkRequest.count({ where: { kind: 'forgot', email, at: { gte: new Date(now.getTime() - HOUR_MS) } } });
    await this.prisma.accessLinkRequest.create({ data: { kind: 'forgot', email, ip, at: now } });
    // a day's requests are enough to count by
    await this.prisma.accessLinkRequest.deleteMany({ where: { at: { lt: new Date(now.getTime() - 24 * HOUR_MS) } } });
    if (recent >= FORGOT_PASSWORD_LIMITS.perEmailHour) return { message: FORGOT_PASSWORD_ANSWER };
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, isActive: true, employee: { select: { fullNameEn: true } } } });
    if (user?.isActive) {
      try {
        await this.access.issue({ id: user.id, email: user.email }, user.employee?.fullNameEn ?? null, 'reset', 'email', null);
      } catch (err) {
        // email not set up, or refused: the answer stays the same; HR can send a link from the profile
        this.logger.warn(`A reset link could not be emailed: ${(err as Error).message}`);
      }
    }
    return { message: FORGOT_PASSWORD_ANSWER };
  }

  // ---------- helpers ----------

  private find(token: string) {
    if (!isAccessToken(token)) return Promise.resolve(null);
    return this.prisma.accessLink.findUnique({
      where: { tokenHash: tokenHashOf(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true, cancelledAt: true, user: { select: { email: true, isActive: true } } },
    });
  }

  /** The address a request counts against: the one the website signed for these links, else the connection's. */
  private ipOf(origin: LinkOrigin): string | null {
    const signed = verifySignedIp(origin.headers, ACCESS_IP_TOKEN, this.config.get<string>('WEB_KEY'), Date.now());
    return signed.ip ?? origin.ip;
  }

  /** 429 once `max` requests of `kind` came from the address in the last hour. */
  private async limit(kind: 'forgot' | 'set_failed', by: { ip: string | null }, max: number, now: Date): Promise<void> {
    if (!by.ip) return;
    const n = await this.prisma.accessLinkRequest.count({ where: { kind, ip: by.ip, at: { gte: new Date(now.getTime() - HOUR_MS) } } });
    if (n >= max) throw new HttpException('Too many tries. Please try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** A link's state at `now`: used; expired, or cancelled by a newer one (said as expired: "ask HR for a new one"); working. */
function stateOf(l: { expiresAt: Date; usedAt: Date | null; cancelledAt: Date | null }, now: Date): 'ok' | 'expired' | 'used' {
  if (l.usedAt) return 'used';
  return !l.cancelledAt && l.expiresAt > now ? 'ok' : 'expired';
}
