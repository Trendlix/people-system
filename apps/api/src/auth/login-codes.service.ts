import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_IP_TOKEN,
  accountEmail,
  LOGIN_CODE_ANSWER,
  LOGIN_CODE_DIGITS,
  LOGIN_CODE_FORMAT,
  LOGIN_CODE_LIMITS,
  LOGIN_CODE_MINUTES,
  LOGIN_CODE_REFUSED,
  LOGIN_CODE_REQUEST_KIND,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TRIES,
  loginCodeMail,
  loginCodeOf,
} from '@trendlix/shared';
import { verifySignedIp } from '../attendance/signed-ip.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { WITH_ROLES, type SessionUser } from './session-user.js';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"; packages/shared login-codes.ts). Asking: an active account with the email
// is emailed 6 digits, kept only as an HMAC with the server's secret (JWT_SECRET), working once for 10 minutes and 5
// tries; a new code ends the one before, and none is sent sooner than a minute after the last. The answer is the same
// whether or not an account has the email; asking is limited by the address (the one the website signed with WEB_KEY,
// else the connection's) and, quietly, by the email, as Forgot password is (access-links.service.ts). Signing in: the
// sign-in's lockout first; a code that works is used up and traded for an ordinary session (AuthService.signInProven:
// the website's or the app's by the user agent, audited 'login' with how); any refusal is a failed sign-in, in the same
// words whatever the reason.

const HOUR_MS = 60 * 60 * 1000;

/** Where a public request comes from: the connection's address, and the headers (the address the website signed). */
export interface CodeOrigin {
  ip: string | null;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class LoginCodesService {
  private readonly logger = new Logger('LoginCodes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** POST /auth/email-code: a code emailed to an active account with this email. Always the same answer; 429 for an address asking too often. */
  async request(emailIn: unknown, origin: CodeOrigin, now = new Date()): Promise<{ message: string }> {
    const ip = this.ipOf(origin);
    if (ip) {
      const fromIp = await this.prisma.accessLinkRequest.count({ where: { kind: LOGIN_CODE_REQUEST_KIND, ip, at: { gte: new Date(now.getTime() - HOUR_MS) } } });
      if (fromIp >= LOGIN_CODE_LIMITS.perIpHour) throw new HttpException('Too many tries. Please try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const email = typeof emailIn === 'string' ? accountEmail(emailIn) : null;
    if (!email || email.length > 254 || !email.includes('@')) throw new BadRequestException(['Enter your sign-in email.']);
    const recent = await this.prisma.accessLinkRequest.count({ where: { kind: LOGIN_CODE_REQUEST_KIND, email, at: { gte: new Date(now.getTime() - HOUR_MS) } } });
    await this.prisma.accessLinkRequest.create({ data: { kind: LOGIN_CODE_REQUEST_KIND, email, ip, at: now } });
    if (recent >= LOGIN_CODE_LIMITS.perEmailHour) return { message: LOGIN_CODE_ANSWER };
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, isActive: true, employee: { select: { fullNameEn: true } } } });
    if (!user?.isActive) return { message: LOGIN_CODE_ANSWER };
    // never sooner than a minute after the last (the screens count it down)
    const last = await this.prisma.loginCode.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (last && now.getTime() - last.createdAt.getTime() < LOGIN_CODE_RESEND_SECONDS * 1000) return { message: LOGIN_CODE_ANSWER };

    const code = String(randomInt(0, 10 ** LOGIN_CODE_DIGITS)).padStart(LOGIN_CODE_DIGITS, '0');
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      // a new code ends the one before
      await tx.loginCode.updateMany({ where: { userId: user.id, usedAt: null, endedAt: null }, data: { endedAt: now } });
      await tx.loginCode.create({ data: { id, userId: user.id, codeHash: this.hashOf(id, code), createdAt: now, expiresAt: new Date(now.getTime() + LOGIN_CODE_MINUTES * 60 * 1000), ip } });
    });
    try {
      await this.mail.send({ to: user.email, ...loginCodeMail(code, user.employee?.fullNameEn ?? null) });
      await this.audit.record({ userId: null, action: 'login_code_sent', entityType: 'user', entityId: user.id, diff: { email } });
    } catch (err) {
      // email not set up, or refused: the answer stays the same; the code, never sent, ends
      this.logger.warn(`A sign-in code could not be emailed: ${(err as Error).message}`);
      await this.prisma.loginCode.update({ where: { id }, data: { endedAt: now } });
    }
    return { message: LOGIN_CODE_ANSWER };
  }

  /** POST /auth/email-code/sign-in: the email's code traded for a session, as a password is; refused (401) in one set of words. */
  async signIn(emailIn: unknown, codeIn: unknown, origin: { userAgent?: string | null; ip?: string | null }, now = new Date()): Promise<{ token: string; user: SessionUser }> {
    const email = typeof emailIn === 'string' ? accountEmail(emailIn) : null;
    if (!email || email.length > 254 || !email.includes('@')) throw new BadRequestException(['Enter your sign-in email.']);
    const code = loginCodeOf(codeIn);
    if (!code) throw new BadRequestException([LOGIN_CODE_FORMAT]);
    await this.auth.ensureNotLockedOut(email, 'email_code');
    const user = await this.prisma.user.findUnique({ where: { email }, include: WITH_ROLES });
    const live = user
      ? await this.prisma.loginCode.findFirst({
          where: { userId: user.id, usedAt: null, endedAt: null, expiresAt: { gt: now }, attempts: { lt: LOGIN_CODE_TRIES } },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    // a try is taken before the code is compared, in one step with the limit, so guesses sent all at once can't pass it
    const took = live
      ? (await this.prisma.loginCode.updateMany({ where: { id: live.id, usedAt: null, endedAt: null, attempts: { lt: LOGIN_CODE_TRIES } }, data: { attempts: { increment: 1 } } })).count > 0
      : false;
    const right = took && !!live && sameHash(live.codeHash, this.hashOf(live.id, code));
    // used up once, whoever comes first
    const used = live && right && user?.isActive ? (await this.prisma.loginCode.updateMany({ where: { id: live.id, usedAt: null, endedAt: null }, data: { usedAt: now } })).count > 0 : false;
    if (!user || !used) {
      await this.audit.record({ userId: null, action: 'login_failed', entityType: 'user', entityId: user?.id ?? null, diff: { email, via: 'email_code' } });
      throw new UnauthorizedException(LOGIN_CODE_REFUSED);
    }
    return this.auth.signInProven(user, origin, 'email_code');
  }

  /** A code's HMAC with the server's secret, bound to its row: a copy of the table alone tells no code. */
  private hashOf(id: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update(`login-code:${id}:${code}`).digest('hex');
  }

  private ipOf(origin: CodeOrigin): string | null {
    const signed = verifySignedIp(origin.headers, ACCESS_IP_TOKEN, this.config.get<string>('WEB_KEY'), Date.now());
    return signed.ip ?? origin.ip;
  }
}

/** Two hashes compared in constant time. */
function sameHash(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(a, 'hex'), Buffer.from(b, 'hex')];
  return x.length === y.length && timingSafeEqual(x, y);
}
