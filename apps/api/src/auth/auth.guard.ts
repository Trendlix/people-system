import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@trendlix/shared';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { FORBIDDEN_MESSAGE, IS_PUBLIC, REQUIRED_ROLES, VIEW_AS_CONTROL } from './decorators.js';
import { actsAs, isSuperAdmin } from './roles.js';
import { SESSION_COOKIE, sessionUserOf, WITH_ROLES, type SessionUser } from './session-user.js';
import { changesData, sessionClaims, viewOnlyMessage, type SessionClaims } from './view-as.js';

/** A request once the guard has let it through: who it is for, and what its session token says. */
export type SessionRequest = Request & { user?: SessionUser; sessionClaims?: SessionClaims };

// Global guard: every endpoint needs a valid session unless marked @Public().
// Roles are read from the database on each request, so role changes apply immediately.
//
// While a Super Admin views as someone (owner's decision, 17 October 2026: "a super admin can view any other user
// profile from a switcher, only the super admin"), the request is that user's: their roles, their data, their refusals.
// And it is view only ("view only with a button to act but by default not checked"): every change is refused here,
// whatever the endpoint, until the Super Admin switches on Act as them. Only the switcher's own endpoints, and signing
// out, are left.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const token = readToken(req);
    if (!token) throw new UnauthorizedException('Please sign in.');

    let claims: SessionClaims;
    try {
      claims = sessionClaims(await this.jwt.verifyAsync<object>(token));
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    const ids = claims.viewAs ? [claims.sub, claims.viewAs] : [claims.sub];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, include: WITH_ROLES });
    const signedIn = users.find((u) => u.id === claims.sub);
    if (!signedIn || !signedIn.isActive) throw new UnauthorizedException('Please sign in.');

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

function readToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}
