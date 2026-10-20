import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sessionKindOf } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './password.js';
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
    const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 60 * 60;
    const sid = await this.sessions.start(user.id, kind, origin, new Date(exp * 1000));
    await this.audit.record({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id, diff: { kind, sessionId: sid } });
    const token = await this.jwt.signAsync(tokenPayload({ sub: user.id, sid, viewAs: null, act: false, exp }));
    return { token, user: sessionUserOf(user) };
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
    const own = await this.prisma.employee.findUnique({ where: { workEmail: user.email.toLowerCase() }, select: { id: true, fullNameEn: true } });
    // in charge of a department or team, while a current employee (owner, 19 October 2026: the person in charge)
    const leading = own ? await this.prisma.department.count({ where: { headId: own.id, head: { employments: { some: { endDate: null } } } } }) : 0;
    return {
      ...user,
      viewAs: user.viewAs ?? null,
      employeeId: own?.id ?? null,
      name: own?.fullNameEn ?? null,
      leads: leading > 0,
      session: { id: session.id, kind: session.kind, idleTimeoutMs: session.idleTimeoutMs },
    };
  }

  /** A signed-in person changes their own password; the current one is asked for again. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    const ok = user.passwordHash ? await verifyPassword(currentPassword, user.passwordHash) : false;
    if (!ok) throw new BadRequestException('Your current password is not correct.');
    if (newPassword === currentPassword) {
      throw new BadRequestException('Choose a new password that is different from your current one.');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await this.audit.record({ userId, action: 'password_change', entityType: 'user', entityId: userId });
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
