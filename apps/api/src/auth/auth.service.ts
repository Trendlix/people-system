import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sessionKindOf, type SessionKind } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { assetsCallerOf, assetsMe } from '../assets/assets-access.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceCredentialsService } from './device-credentials.service.js';
import { isCredentialId } from './device-rules.js';
import { hashPassword, verifyPassword } from './password.js';
import { keptIp } from './session-rules.js';
import { SESSION_HOURS, sessionUserOf, WITH_ROLES, type Me, type SessionUser } from './session-user.js';
import { SessionsService, type ActiveSession } from './sessions.service.js';
import { sessionClaims, tokenPayload } from './view-as.js';

const INVALID = 'Invalid email or password.';

// Failed sign-ins allowed per email within the window before further attempts are refused.
export const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  // Compared against when the email is unknown, so both cases take about the same time.
  private readonly dummyHash = hashPassword('not-a-real-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
    private readonly devices: DeviceCredentialsService,
  ) {}

  /**
   * Signing in starts a session kept on the server (owner, 20 October 2026), of the kind the user agent says (the app's
   * ends with "TrendLIXPeople"), ending the user's open one of the same kind: the new one wins. Its token names it.
   */
  async login(email: string, password: string, origin: { userAgent?: string | null; ip?: string | null } = {}): Promise<{ token: string; user: SessionUser }> {
    const normalized = email.trim().toLowerCase();
    await this.ensureNotLockedOut(normalized);
    const user = await this.prisma.user.findUnique({ where: { email: normalized }, include: WITH_ROLES });

    let ok = false;
    if (user?.passwordHash) ok = await verifyPassword(password, user.passwordHash);
    else await verifyPassword(password, await this.dummyHash);

    if (!user || !ok || !user.isActive) {
      await this.audit.record({
        userId: null,
        action: 'login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        diff: { email: normalized },
      });
      throw new UnauthorizedException(INVALID);
    }

    const kind = sessionKindOf(origin.userAgent);
    const { sid, token } = await this.openSession(user.id, kind, origin);
    await this.audit.record({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id, diff: { kind, sessionId: sid } });
    return { token, user: sessionUserOf(user) };
  }

  /**
   * Signing in with the fingerprint in the app (owner, 20 October 2026: "Sign-in: Face ID / fingerprint after the first
   * password sign-in"; apps/mobile/README.md, Phase 3): the phone's device credential, unlocked by the fingerprint,
   * traded for an ordinary app session, as a password sign-in in the app starts: it ends the user's open app session (the
   * new one wins), and the 15 minutes apply as ever. Refused (401 with the reason, 429 after too many refusals) by the
   * device credentials service. `limitIp`: the person's address as the website saw it, counted for the limit.
   */
  async deviceSignIn(
    id: string,
    secret: string,
    origin: { userAgent?: string | null; ip?: string | null },
    limitIp: string | null,
  ): Promise<{ token: string; user: SessionUser }> {
    const ip = keptIp(limitIp);
    await this.devices.ensureNotLimited(isCredentialId(id) ? id : null, ip);
    const { credentialId, user } = await this.devices.verify(id, secret, ip);
    const { sid, token } = await this.openSession(user.id, 'app', origin);
    await this.audit.record({ userId: user.id, action: 'device_login', entityType: 'user', entityId: user.id, diff: { kind: 'app', sessionId: sid, credentialId } });
    return { token, user: sessionUserOf(user) };
  }

  /** A new session of `kind` for the user (ending their open one of the same kind), and its token, for 8 hours. */
  private async openSession(userId: string, kind: SessionKind, origin: { userAgent?: string | null; ip?: string | null }): Promise<{ sid: string; token: string }> {
    const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 60 * 60;
    const sid = await this.sessions.start(userId, kind, origin, new Date(exp * 1000));
    const token = await this.jwt.signAsync(tokenPayload({ sub: userId, sid, viewAs: null, act: false, exp }));
    return { sid, token };
  }

  /**
   * Signing out ends the token's session on the server ('signed_out'), even past its 8 hours; a token that isn't this
   * API's, or none, changes nothing (the cookie is cleared all the same).
   */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    let claims: { sub: string; sid: string };
    try {
      claims = sessionClaims(await this.jwt.verifyAsync<object>(token, { ignoreExpiration: true }));
    } catch {
      return;
    }
    await this.sessions.signOut(claims.sid, claims.sub);
  }

  /**
   * The signed-in user and the id and name of their own employee profile, if they have one; while a Super Admin views as
   * someone, that user, with who is viewing (see view-as.ts).
   */
  async me(user: SessionUser, session: Pick<ActiveSession, 'id' | 'kind' | 'idleTimeoutMs'>): Promise<Me> {
    // their Assets access in effect and whether they see the values (owner, 21 October 2026: "3 levels per user";
    // "CEO and Finance"), for the sidebar and the pages; the API checks each request itself
    const [own, assets] = await Promise.all([
      this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true, fullNameEn: true } }),
      assetsCallerOf(this.prisma, user),
    ]);
    // in charge of a department or team, while a current employee (owner, 19 October 2026: the person in charge)
    const leading = own ? await this.prisma.department.count({ where: { headId: own.id, head: { employments: { some: { endDate: null } } } } }) : 0;
    return {
      ...user,
      viewAs: user.viewAs ?? null,
      employeeId: own?.id ?? null,
      name: own?.fullNameEn ?? null,
      leads: leading > 0,
      assets: assetsMe(assets),
      session: { id: session.id, kind: session.kind, idleTimeoutMs: session.idleTimeoutMs },
    };
  }

  /**
   * A signed-in person changes their own password; the current one is asked for again. Their phones' fingerprint sign-in
   * stops ('password_changed': turned on again from the app after signing in with the new password; README Phase 3, 20
   * October 2026), and their other open sessions end ('revoked'), on the website and in the app: only the one they
   * changed it from stays (`currentSessionId`).
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, currentSessionId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    const ok = user.passwordHash ? await verifyPassword(currentPassword, user.passwordHash) : false;
    if (!ok) throw new BadRequestException('Your current password is not correct.');
    if (newPassword === currentPassword) {
      throw new BadRequestException('Choose a new password that is different from your current one.');
    }
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    const { sessionsEnded, devicesRevoked } = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      const sessions = await tx.session.updateMany({
        where: { userId, endedAt: null, expiresAt: { gt: now }, id: { not: currentSessionId } },
        data: { endedAt: now, endReason: 'revoked' },
      });
      const devices = await tx.deviceCredential.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'password_changed' } });
      return { sessionsEnded: sessions.count, devicesRevoked: devices.count };
    });
    await this.audit.record({ userId, action: 'password_change', entityType: 'user', entityId: userId, diff: { sessionsEnded, devicesRevoked } });
  }

  private async ensureNotLockedOut(email: string): Promise<void> {
    const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const failures = await this.prisma.auditLog.count({
      where: { action: 'login_failed', at: { gte: since }, diff: { path: ['email'], equals: email } },
    });
    if (failures >= MAX_FAILED_LOGINS) {
      throw new HttpException(
        `Too many failed sign-in attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
