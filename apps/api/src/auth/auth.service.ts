import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  choosesMode,
  MODE_IN_APP,
  MODE_NOT_YOURS,
  MODE_WHILE_VIEWING,
  ownRoles,
  sessionKindOf,
  startingMode,
  type ModeChoice,
  type Role,
  type SessionKind,
  type SessionMode,
} from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { standInViewOf } from '../leave/stand-ins.js';
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
    const own = sessionUserOf(user);
    const mode = startingMode(own.roles, kind);
    const { sid, token } = await this.openSession(user.id, kind, origin, mode);
    await this.audit.record({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id, diff: { kind, sessionId: sid } });
    // a developer who holds another role: the mode they start in (null on the website: the web asks them first, 22
    // October 2026)
    return { token, user: choosesMode(own.roles) ? { ...own, mode } : own };
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
    const own = sessionUserOf(user);
    // in the app, a developer who holds another role is always themselves (22 October 2026)
    const mode = startingMode(own.roles, 'app');
    const { sid, token } = await this.openSession(user.id, 'app', origin, mode);
    await this.audit.record({ userId: user.id, action: 'device_login', entityType: 'user', entityId: user.id, diff: { kind: 'app', sessionId: sid, credentialId } });
    return { token, user: choosesMode(own.roles) ? { ...own, mode } : own };
  }

  /**
   * A new session of `kind` for the user (ending their open one of the same kind), and its token, for 8 hours; `mode`:
   * how a developer who holds another role uses it from the start (startingMode).
   */
  private async openSession(
    userId: string,
    kind: SessionKind,
    origin: { userAgent?: string | null; ip?: string | null },
    mode: SessionMode | null = null,
  ): Promise<{ sid: string; token: string }> {
    const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 60 * 60;
    const sid = await this.sessions.start(userId, kind, origin, new Date(exp * 1000), mode);
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
      // their own profile by the account's link (22 October 2026: never by the email)
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { id: true, fullNameEn: true } }) : null,
      assetsCallerOf(this.prisma, user),
    ]);
    // in charge of a department or team, while a current employee (owner, 19 October 2026: the person in charge); or standing
    // in today for an approver on leave (owner, 25 October 2026: "To a stand-in"), whose team's requests they decide
    const leading = own ? await this.prisma.department.count({ where: { headId: own.id, head: { employments: { some: { endDate: null } } } } }) : 0;
    const standIn = own ? await standInViewOf(this.prisma, own.id, { roles: [] }) : null;
    const standingInFor = [...(standIn?.for ?? new Map())].map(([id, e]) => ({ id, fullNameEn: e.fullNameEn, until: e.until }));
    // hiring for an open vacancy, or on an interview to come or of the last 60 days (recruitment, Phase 2, 22 October 2026);
    // or the hiring manager of one of those, who gives a scorecard on it too (29 October 2026: "Score Card for each of them")
    const since = new Date(Date.now() - 60 * 86_400_000);
    const hiring = own
      ? (await this.prisma.vacancy.count({ where: { hiringManagerId: own.id, status: { in: ['open', 'on_hold'] } } })) +
          (await this.prisma.interviewInterviewer.count({ where: { employeeId: own.id, interview: { startsAt: { gte: since } } } })) >
          0 ||
        (await this.prisma.interview.count({ where: { startsAt: { gte: since }, application: { vacancy: { hiringManagerId: own.id } } } })) > 0
      : false;
    return {
      ...user,
      viewAs: user.viewAs ?? null,
      employeeId: own?.id ?? null,
      name: own?.fullNameEn ?? null,
      leads: leading > 0 || standingInFor.length > 0,
      standingInFor,
      assets: assetsMe(assets),
      hiring,
      session: { id: session.id, kind: session.kind, idleTimeoutMs: session.idleTimeoutMs },
    };
  }

  /**
   * GET /auth/mode (owner, 22 October 2026: "when a developer signin, give hin a switched to use the account as the main
   * role assigned to him or as a developer, to not confuse him"): whether the user chooses how to use the system (the
   * Developer role and another), the mode in use (null until chosen), the one they chose last on the website (the choice
   * page pre-selects it), their own profile's name and their own roles ("As yourself: Hana Adel · Employee"), and whether
   * they switch here (a website session of their own). While a Super Admin views as them, theirs, not switchable.
   */
  async modeChoice(user: SessionUser, session: Pick<ActiveSession, 'kind'>): Promise<ModeChoice> {
    if (user.mode === undefined) return { chooses: false, mode: null, last: null, name: null, roles: [], switchable: false };
    const [account, own, last] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: WITH_ROLES }),
      user.employeeId ? this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { fullNameEn: true } }) : null,
      this.sessions.lastMode(user.id),
    ]);
    return {
      chooses: true,
      mode: user.mode,
      last,
      name: own?.fullNameEn ?? null,
      roles: ownRoles(account.roles.map((r) => r.role.key as Role)),
      switchable: session.kind === 'web' && !user.viewAs,
    };
  }

  /**
   * POST /auth/mode: a developer who holds another role chooses, at sign-in, or switches, from the top bar, how they use
   * this website session: kept on it and written to the audit log (sessions.setMode). Not in the app (always as
   * themselves), nor while a Super Admin views as them (the banner's switch is theirs), nor for anyone who doesn't choose.
   */
  async chooseMode(user: SessionUser, session: Pick<ActiveSession, 'id' | 'kind'>, mode: SessionMode): Promise<ModeChoice> {
    if (user.viewAs) throw new ConflictException(MODE_WHILE_VIEWING);
    if (user.mode === undefined) throw new ForbiddenException(MODE_NOT_YOURS);
    if (session.kind !== 'web') throw new BadRequestException(MODE_IN_APP);
    await this.sessions.setMode(user.id, session.id, mode);
    return this.modeChoice({ ...user, mode }, session);
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

  /**
   * The API documentation's sign-in (owner, 31 October 2026: "Password-protected"): a People email and password, of an
   * active Super Admin or developer, checked as signing in checks it (the same lockout, a refusal logged as a failed
   * sign-in) but opening no session. Null when refused (the lockout still throws).
   */
  async docsSignIn(email: string, password: string): Promise<SessionUser | null> {
    const normalized = email.trim().toLowerCase();
    await this.ensureNotLockedOut(normalized);
    const user = await this.prisma.user.findUnique({ where: { email: normalized }, include: WITH_ROLES });
    let ok = false;
    if (user?.passwordHash) ok = await verifyPassword(password, user.passwordHash);
    else await verifyPassword(password, await this.dummyHash);
    const own = user && ok && user.isActive ? sessionUserOf(user) : null;
    if (!own || !own.roles.some((r) => r === 'super_admin' || r === 'developer')) {
      await this.audit.record({ userId: null, action: 'login_failed', entityType: 'user', entityId: user?.id ?? null, diff: { email: normalized, to: 'api_docs' } });
      return null;
    }
    await this.audit.record({ userId: own.id, action: 'api_docs_open', entityType: 'user', entityId: own.id, diff: {} });
    return own;
  }

  /**
   * A session for someone already proven otherwise than by the password (a code by email, 31 October 2026), as login
   * opens one: the website's or the app's by the user agent, the open one of that kind ended, audited 'login' with how.
   */
  async signInProven(
    user: Parameters<typeof sessionUserOf>[0],
    origin: { userAgent?: string | null; ip?: string | null },
    method: 'email_code',
  ): Promise<{ token: string; user: SessionUser }> {
    const kind = sessionKindOf(origin.userAgent);
    const own = sessionUserOf(user);
    const mode = startingMode(own.roles, kind);
    const { sid, token } = await this.openSession(user.id, kind, origin, mode);
    await this.audit.record({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id, diff: { kind, sessionId: sid, method } });
    return { token, user: choosesMode(own.roles) ? { ...own, mode } : own };
  }

  /** Too many failed sign-ins for the email lately (its lockout): 429. Signing in with a code checks it too. */
  async ensureNotLockedOut(email: string): Promise<void> {
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
