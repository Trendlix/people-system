import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BACKGROUND_HEADER, type Role, type SessionKind } from '@trendlix/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { FORBIDDEN_MESSAGE, IS_PUBLIC, REQUIRED_ROLES, VIEW_AS_CONTROL } from './decorators.js';
import { actsAs, isSuperAdmin } from './roles.js';
import { idleTimeoutFor, sessionVerdict, signedOutBody } from './session-rules.js';
import { SESSION_COOKIE, sessionUserOf, WITH_ROLES, type SessionUser } from './session-user.js';
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
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const token = readToken(req);
    if (!token) throw new UnauthorizedException('Please sign in.');

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

    // the session first: ended, past its 8 hours, or 15 minutes without activity for HR, Admin and Super Admin
    const roles = signedIn ? sessionUserOf(signedIn).roles : [];
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
      req.user = { ...sessionUserOf(viewed), viewAs: { by: { id: signedIn.id, email: signedIn.email }, act: claims.act } };
    } else {
      req.user = { ...sessionUserOf(signedIn), viewAs: null };
    }
    req.sessionClaims = claims;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    if (required?.length && !actsAs(req.user.roles, required)) {
      const message = this.reflector.getAllAndOverride<string | undefined>(FORBIDDEN_MESSAGE, targets);
      throw new ForbiddenException(message ?? 'You do not have permission to do this.');
    }

    const viewOnly = req.user.viewAs && !req.user.viewAs.act;
    if (viewOnly && changesData(req.method) && !this.reflector.getAllAndOverride<boolean>(VIEW_AS_CONTROL, targets)) {
      throw new ForbiddenException(viewOnlyMessage(await this.nameOf(req.user.email)));
    }
    return true;
  }

  /** The user's name from their employee profile (the one with their work email), else their email. */
  private async nameOf(email: string): Promise<string> {
    const own = await this.prisma.employee.findUnique({ where: { workEmail: email.toLowerCase() }, select: { fullNameEn: true } });
    return own?.fullNameEn ?? email;
  }
}

/** The session token a request carries: the cookie (the API's own, as the tests send it), else the bearer the web sends. */
export function readToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}
