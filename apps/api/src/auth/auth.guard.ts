import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_HOLD_MESSAGE,
  ACCESS_HOLD_REASON,
  BACKGROUND_HEADER,
  DEVELOPER_READ_ONLY,
  isConnectorAccessToken,
  neverHeldRole,
  type Role,
  type SessionKind,
} from '@trendlix/shared';
import type { Request } from 'express';
import { ConnectorTokensService } from '../connector/connector-tokens.service.js';
import { standingOf } from '../employee-access/access-state.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CONNECTOR_NOT_OPEN, CONNECTOR_SCOPE_KEY, DEVELOPER_MAY_CALL, FORBIDDEN_MESSAGE, IS_PUBLIC, OPEN_ON_HOLD, REQUIRED_ROLES, VIEW_AS_CONTROL } from './decorators.js';
import { actsAs, isSuperAdmin } from './roles.js';
import { ACTIVITY_THROTTLE_MS, idleTimeoutFor, sessionVerdict, signedOutBody } from './session-rules.js';
import { answeredAs, SESSION_COOKIE, sessionUserIn, sessionUserOf, viewedAs, WITH_ROLES, type SessionUser } from './session-user.js';
import { SessionsService, type ActiveSession } from './sessions.service.js';
import { changesData, sessionClaims, viewOnlyMessage, type SessionClaims } from './view-as.js';

/** A request once the guard has let it through: who it is for, what its session token says, and its session. */
export type SessionRequest = Request & { user?: SessionUser; sessionClaims?: SessionClaims; activeSession?: ActiveSession };

// Global guard: every endpoint needs a valid session unless marked @Public().
// Roles are read from the database on each request, so role changes apply immediately.
//
// While a Super Admin views as someone (owner's decision, 17 October 2026: "a super admin can view any other user
// profile from a switcher, only the super admin"), the request is that user's: their roles, their data, their refusals.
// And it is view only ("view only with a button to act but by default not checked"): every change is refused here,
// whatever the endpoint, until the Super Admin switches on Act as them. Only the switcher's own endpoints, and signing
// out, are left.
//
// The session is kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
// inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session"): the
// token names it (sid), and a token whose session has ended (signed out, replaced by a newer sign-in of the same kind,
// ended by an Admin, past its 8 hours) is refused with a 401 saying why (`reason`, the sign-in page's words). For HR,
// Admin and Super Admin (the person signed in: the Super Admin while viewing as someone), 15 minutes since the last
// activity end it ('idle'). Every request counts as activity but the ones the web makes by itself (the x-background
// header: the sidebar's counts, the idle warning's checks), kept at most every 30 seconds. The rules: session-rules.ts.
//
// A Claude connector's access token (owner, 21 October 2026: "the connection method"; "tlxa_…", not a signed token) is
// checked apart (connectorRequest): its session must be on, and the route open to the connector (@ConnectorScope: the
// Assets reads and the drafts); every other route refuses it with a 403. Its person is never viewed as, and the 15
// minutes are never for it.
//
// A developer (owner, 22 October 2026: "act as super admin with numbers hidden and real sensitve numbers as national ids
// hidden changing nothing, and no act as") is answered as a Super Admin who is also HR, the CEO and Finance
// (answeredAs), read only: every request but a read is refused here, save the few marked @DeveloperMayCall (signing
// out, ending one's own session, changing one's own password), through the connector too. Never viewed as by anyone's
// switch nor viewing as anyone (the switcher is a change, and their database roles hold no Super Admin). The money and
// personal IDs are masked in every answer (developer.interceptor.ts). Their 15 minutes are those of HR and Super Admin.
//
// A developer who holds another role (owner, 22 October 2026: "when a developer signin, give hin a switched to use the
// account as the main role assigned to him or as a developer, to not confuse him") is answered in the mode their session
// is used in (sessions.mode; sessionUserIn): as themselves, their own roles without the Developer role, so none of the
// above applies to them (their own data, their changes, no masking, no 15 minutes unless their own roles have them); as
// a developer, or until they choose on the website, as a developer. In the app always as themselves. A Super Admin
// viewing as them sees them as themselves, or as a developer once the banner's switch says so (viewedAs).
//
// Access follows the contract (owner, 23 October 2026: "Access should be on hold with a 7 days grace period one time
// granted by the hr"; asked, on Hold "Check-in/out only"): an employee's account whose contract isn't in force and who
// has no grace running is on Hold, read from the contract on each request (so a contract signed or a grace given opens
// everything at once, and an expired grace holds the next request without signing out). `hold` is set on the user, and
// only the routes marked @OpenOnHold answer (their own session's basics, checking in and out, the app's equivalents),
// with the view-as switcher's own; every other answers 403 with ACCESS_HOLD_MESSAGE, before any other check. A Super
// Admin, the CEO (their own roles) and an account that isn't an employee's are never held. While a Super Admin views as
// someone on Hold, the request is theirs: held too. A Claude connector's token of an account on Hold reaches nothing.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly connector: ConnectorTokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const token = readToken(req);
    if (!token) throw new UnauthorizedException('Please sign in.');
    if (isConnectorAccessToken(token)) return this.connectorRequest(req, token, targets);

    let payload: object;
    try {
      payload = await this.jwt.verifyAsync<object>(token);
    } catch (err) {
      // signed by this API but past its 8 hours: "Your session ended."
      if (err instanceof Error && err.name === 'TokenExpiredError') throw new UnauthorizedException(signedOutBody('expired'));
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    let claims: SessionClaims;
    try {
      claims = sessionClaims(payload);
    } catch {
      // signed by this API but not as it signs them now: a token from before sessions were kept (no sid) is refused once
      throw new UnauthorizedException(signedOutBody('ended'));
    }

    const ids = claims.viewAs ? [claims.sub, claims.viewAs] : [claims.sub];
    const [users, session] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, include: WITH_ROLES }),
      this.sessions.find(claims.sid),
    ]);
    const signedIn = users.find((u) => u.id === claims.sub);

    // the session first: ended, past its 8 hours, or 15 minutes without activity for HR, Admin and Super Admin (a
    // developer counts as one: answeredAs; a developer using the system as themselves has their own roles' rule)
    const roles = signedIn && session ? sessionUserIn(sessionUserOf(signedIn), session).roles : [];
    const now = new Date();
    const verdict = sessionVerdict(session, claims.sub, roles, now, req.headers[BACKGROUND_HEADER] === '1');
    if (!verdict.ok) {
      if (verdict.end && session) await this.sessions.endByGuard(session, verdict.end, now);
      throw new UnauthorizedException(signedOutBody(verdict.reason));
    }
    if (!session || !signedIn || !signedIn.isActive) throw new UnauthorizedException('Please sign in.');
    if (verdict.touch) await this.sessions.touch(session.id, now);
    req.activeSession = {
      id: session.id,
      kind: session.kind as SessionKind,
      createdAt: session.createdAt,
      lastActiveAt: verdict.touch ? now : session.lastActiveAt,
      expiresAt: session.expiresAt,
      idleTimeoutMs: idleTimeoutFor(roles),
    };

    if (claims.viewAs) {
      // Only a Super Admin views as someone, and only an active user. Checked on each request too: one who has lost the
      // role since, or is viewing as a user deactivated since, is signed out, as a deactivated user is.
      const viewed = users.find((u) => u.id === claims.viewAs);
      if (!isSuperAdmin(sessionUserOf(signedIn)) || !viewed?.isActive) throw new UnauthorizedException('Please sign in.');
      req.user = { ...viewedAs(sessionUserOf(viewed), claims.viewMode), viewAs: { by: { id: signedIn.id, email: signedIn.email }, act: claims.act } };
    } else {
      req.user = { ...sessionUserIn(sessionUserOf(signedIn), session), viewAs: null };
    }
    req.sessionClaims = claims;

    // on Hold (23 October 2026): the account the request is for (the one viewed as, while a Super Admin views as someone)
    const subject = claims.viewAs ? users.find((u) => u.id === claims.viewAs)! : signedIn;
    if (await this.onHold(subject)) {
      req.user = { ...req.user, hold: true };
      const open = this.reflector.getAllAndOverride<boolean>(OPEN_ON_HOLD, targets) === true;
      const switching = !!req.user.viewAs && this.reflector.getAllAndOverride<boolean>(VIEW_AS_CONTROL, targets) === true;
      if (!open && !switching) throw holdRefusal();
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (required?.length && !actsAs(req.user.roles, required)) {
      const message = this.reflector.getAllAndOverride<string | undefined>(FORBIDDEN_MESSAGE, targets);
      throw new ForbiddenException(message ?? 'You do not have permission to do this.');
    }

    // a developer looks and changes nothing (22 October 2026); a Super Admin viewing as one still has the switcher's own
    // endpoints (Act as them, see them as themselves, back to their account): the session is the Super Admin's
    const switcher = !!req.user.viewAs && this.reflector.getAllAndOverride<boolean>(VIEW_AS_CONTROL, targets) === true;
    if (req.user.developer && changesData(req.method) && !switcher && !this.reflector.getAllAndOverride<boolean>(DEVELOPER_MAY_CALL, targets)) {
      throw new ForbiddenException(DEVELOPER_READ_ONLY);
    }

    const viewOnly = req.user.viewAs && !req.user.viewAs.act;
    if (viewOnly && changesData(req.method) && !this.reflector.getAllAndOverride<boolean>(VIEW_AS_CONTROL, targets)) {
      throw new ForbiddenException(viewOnlyMessage(await this.nameOf(req.user)));
    }
    return true;
  }

  /**
   * A request with a Claude connector's access token: refused (401) when the token or its session is no good, refused
   * (403) on a route not open to the connector; else the request is the person's, as on the website, with their roles.
   */
  private async connectorRequest(req: SessionRequest, token: string, targets: Parameters<Reflector['getAllAndOverride']>[1]): Promise<boolean> {
    const now = new Date();
    const { session } = await this.connector.verifyAccess(token, now);
    if (this.reflector.getAllAndOverride<string | undefined>(CONNECTOR_SCOPE_KEY, targets) !== session.scope) throw new ForbiddenException(CONNECTOR_NOT_OPEN);
    const touch = now.getTime() - session.lastActiveAt.getTime() >= ACTIVITY_THROTTLE_MS;
    if (touch) await this.sessions.touch(session.id, now);
    req.activeSession = {
      id: session.id,
      kind: 'connector',
      createdAt: session.createdAt,
      lastActiveAt: touch ? now : session.lastActiveAt,
      expiresAt: session.expiresAt,
      idleTimeoutMs: null,
    };
    req.user = { ...answeredAs(sessionUserOf(session.user)), viewAs: null };
    // an account on Hold (23 October 2026): no route of the connector's is open to it
    if (await this.onHold(session.user)) throw holdRefusal();
    // a developer's Claude reads and drafts nothing (22 October 2026)
    if (req.user.developer && changesData(req.method)) throw new ForbiddenException(DEVELOPER_READ_ONLY);
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (required?.length && !actsAs(req.user.roles, required)) {
      const message = this.reflector.getAllAndOverride<string | undefined>(FORBIDDEN_MESSAGE, targets);
      throw new ForbiddenException(message ?? 'You do not have permission to do this.');
    }
    return true;
  }

  /**
   * Whether an account is on Hold now (23 October 2026): an employee's, on, held by none of NEVER_HELD_ROLES (its own
   * roles, never a developer's sight), whose standing is Hold (packages/shared accessStandingOf).
   */
  private async onHold(account: { employeeId: string | null; isActive: boolean; roles: { role: { key: string } }[] }): Promise<boolean> {
    if (!account.employeeId || !account.isActive || neverHeldRole(account.roles.map((r) => r.role.key))) return false;
    return (await standingOf(this.prisma, account.employeeId))?.result.standing === 'hold';
  }

  /** The user's name from their employee profile (the account's link, 22 October 2026), else their email. */
  private async nameOf(user: SessionUser): Promise<string> {
    const own = user.employeeId ? await this.prisma.employee.findUnique({ where: { id: user.employeeId }, select: { fullNameEn: true } }) : null;
    return own?.fullNameEn ?? user.email;
  }
}

/** The refusal of anything but checking in and out to an account on Hold, with a reason the website knows it by. */
export const holdRefusal = () => new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: ACCESS_HOLD_MESSAGE, reason: ACCESS_HOLD_REASON });

/** The session token a request carries: the cookie (the API's own, as the tests send it), else the bearer the web sends. */
export function readToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}
