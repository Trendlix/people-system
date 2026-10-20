import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isSuperAdmin } from './roles.js';
import { sessionUserOf, WITH_ROLES, type SessionUser } from './session-user.js';
import {
  alreadyViewing,
  deactivatedAccount,
  msLeft,
  NOT_VIEWING,
  NOT_YOURSELF,
  ONLY_SUPER_ADMIN_VIEWS_AS,
  tokenPayload,
  type SessionClaims,
} from './view-as.js';

const ENTITY = 'user';

/** A session the switcher signed: its token, the cookie's lifetime, and who the requests made with it are for. */
export interface NewSession {
  token: string;
  maxAgeMs: number;
  user: SessionUser;
}

// The switcher (owner's decisions, 17 October 2026): a Super Admin switches to any active user but themself, views as
// them, may switch on Act as them (off on every switch), and goes back to their own account. Each step is a new
// session token, signed like the one from signing in and ending when it ends (see view-as.ts), and each is written to
// the audit log as the Super Admin's own: from whom, to whom, acting or not. Every token names the Super Admin's own
// session (sid, kept on the server since 20 October 2026), so its rules are theirs: their 15 minutes without activity,
// a newer sign-in of the same kind, signing out; going back keeps it.
@Injectable()
export class ViewAsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** POST /auth/view-as: only a Super Admin in their own session; never nested, never to themself or a deactivated user. */
  async start(user: SessionUser, session: SessionClaims, userId: string): Promise<NewSession> {
    if (user.viewAs) throw new ConflictException(alreadyViewing(await this.nameOf(user.email)));
    if (!isSuperAdmin(user)) throw new ForbiddenException(ONLY_SUPER_ADMIN_VIEWS_AS);
    if (userId === user.id) throw new BadRequestException(NOT_YOURSELF);
    const target = await this.prisma.user.findUnique({ where: { id: userId }, include: WITH_ROLES });
    if (!target) throw new NotFoundException('User not found.');
    if (!target.isActive) throw new ConflictException(deactivatedAccount(target.email));

    await this.audit.record({
      userId: user.id,
      action: 'view_as_start',
      entityType: ENTITY,
      entityId: target.id,
      diff: { from: user.email, to: target.email, act: false },
    });
    // view only to start with, every time
    return this.issue(
      { sub: user.id, sid: session.sid, viewAs: target.id, act: false, exp: session.exp },
      { ...sessionUserOf(target), viewAs: { by: { id: user.id, email: user.email }, act: false } },
    );
  }

  /** POST /auth/view-as/act: Act as them on or off, while viewing as someone. Written to the audit log when it changes. */
  async act(user: SessionUser, session: SessionClaims, act: boolean): Promise<NewSession> {
    const viewAs = user.viewAs;
    if (!viewAs) throw new ConflictException(NOT_VIEWING);
    if (act !== viewAs.act) {
      await this.audit.record({ userId: viewAs.by.id, action: 'view_as_act', entityType: ENTITY, entityId: user.id, diff: { from: viewAs.by.email, to: user.email, act } });
    }
    return this.issue({ ...session, act }, { ...user, viewAs: { ...viewAs, act } });
  }

  /**
   * POST /auth/view-as/stop: back to the Super Admin's own session at once, without signing in again; it ends when it
   * would have. In one's own session it changes nothing (e.g. Back to my account pressed twice).
   */
  async stop(user: SessionUser, session: SessionClaims): Promise<NewSession> {
    const viewAs = user.viewAs;
    if (!viewAs) return this.issue({ ...session, viewAs: null, act: false }, user);
    await this.audit.record({ userId: viewAs.by.id, action: 'view_as_stop', entityType: ENTITY, entityId: user.id, diff: { from: viewAs.by.email, to: user.email, act: viewAs.act } });
    const own = await this.prisma.user.findUniqueOrThrow({ where: { id: viewAs.by.id }, include: WITH_ROLES });
    return this.issue({ sub: own.id, sid: session.sid, viewAs: null, act: false, exp: session.exp }, { ...sessionUserOf(own), viewAs: null });
  }

  private async issue(claims: SessionClaims, user: SessionUser): Promise<NewSession> {
    return { token: await this.jwt.signAsync(tokenPayload(claims)), maxAgeMs: msLeft(claims), user };
  }

  /** The user's name from their employee profile, else their email. */
  private async nameOf(email: string): Promise<string> {
    const own = await this.prisma.employee.findUnique({ where: { workEmail: email.toLowerCase() }, select: { fullNameEn: true } });
    return own?.fullNameEn ?? email;
  }
}
