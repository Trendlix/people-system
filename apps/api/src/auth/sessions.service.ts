import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IDLE_TIMEOUT_MS, type SessionEndReason, type SessionKind } from '@trendlix/shared';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isSuperAdmin } from './roles.js';
import { endedBySignIn, keptIp, keptUserAgent, type SessionState } from './session-rules.js';
import type { SessionUser } from './session-user.js';

// Sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
// inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session to be
// working spontaneously"; a second sign-in of the same kind: "the new one wins"). The rules: session-rules.ts. Signing
// in, signing out, a session ended by a newer sign-in, by 15 minutes without activity or by an Admin are written to the
// audit log (the user's account is the entry's record).

const ENTITY = 'user';

/** The session a request was let through with, as the guard found it (see auth.guard.ts). */
export interface ActiveSession {
  id: string;
  kind: SessionKind;
  createdAt: Date;
  /** The last activity kept, this request's when it counted. */
  lastActiveAt: Date;
  expiresAt: Date;
  /** The 15 minutes in milliseconds for HR, Admin and Super Admin (the person signed in, while viewing as someone); null for anyone else. */
  idleTimeoutMs: number | null;
}

/** A session still open, as Your Sessions and the Users page list it. */
export interface SessionView {
  id: string;
  kind: SessionKind;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  /** The session the request was made with: "This device". */
  current: boolean;
}

/** GET /auth/session: the request's session and how long it has left, for the web's idle warning. */
export interface SessionStatus {
  id: string;
  kind: SessionKind;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  idleTimeoutMs: number | null;
  /** Milliseconds before it ends for want of activity; null when the 15 minutes aren't for them. */
  idleMsLeft: number | null;
}

const VIEW = { id: true, kind: true, createdAt: true, lastActiveAt: true, expiresAt: true, userAgent: true } as const;

const SUPER_ADMIN_ACCOUNT_ONLY = "Only a Super Admin can change a Super Admin's account.";

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Signing in: the user's open session of the same kind ends ('replaced': the new one wins; 'expired' if its 8 hours were
   * already over), and the new one starts. One sign-in of a user at a time (their row locked), so two at the same moment
   * can't both stay open. Answers the new session's id.
   */
  async start(userId: string, kind: SessionKind, origin: { userAgent?: string | null; ip?: string | null }, expiresAt: Date): Promise<string> {
    const now = new Date();
    const { id, replaced } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const open = await tx.session.findMany({ where: { userId, endedAt: null }, select: { id: true, kind: true, expiresAt: true } });
      const ending = endedBySignIn(open, kind, now);
      for (const reason of ['replaced', 'expired'] as const) {
        const ids = ending.filter((e) => e.reason === reason).map((e) => e.session.id);
        if (ids.length) await tx.session.updateMany({ where: { id: { in: ids }, endedAt: null }, data: { endedAt: now, endReason: reason } });
      }
      const created = await tx.session.create({
        data: { userId, kind, createdAt: now, lastActiveAt: now, expiresAt, userAgent: keptUserAgent(origin.userAgent), ip: keptIp(origin.ip) },
        select: { id: true },
      });
      return { id: created.id, replaced: ending.filter((e) => e.reason === 'replaced').map((e) => e.session.id) };
    });
    for (const sessionId of replaced) {
      await this.audit.record({ userId, action: 'session_replaced', entityType: ENTITY, entityId: userId, diff: { kind, sessionId, by: id } });
    }
    return id;
  }

  /** The session a token names, for the guard. */
  find(id: string): Promise<(SessionState & { id: string; createdAt: Date }) | null> {
    return this.prisma.session.findUnique({
      where: { id },
      select: { id: true, userId: true, kind: true, createdAt: true, lastActiveAt: true, expiresAt: true, endedAt: true, endReason: true },
    });
  }

  /** A request that counts as activity: kept as the session's last (unless it has ended meanwhile). */
  async touch(id: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({ where: { id, endedAt: null }, data: { lastActiveAt: now } });
  }

  /**
   * Ends a session the guard refused: 15 minutes without activity ('idle', written to the audit log once, by whichever
   * request ended it) or past its 8 hours ('expired').
   */
  async endByGuard(session: { id: string; userId: string; kind: string; lastActiveAt: Date }, reason: 'idle' | 'expired', now: Date): Promise<void> {
    // idle: only if no request has counted as activity meanwhile (one at the same moment may just have)
    const quiet = reason === 'idle' ? { lastActiveAt: { lt: new Date(now.getTime() - IDLE_TIMEOUT_MS) } } : {};
    const { count } = await this.prisma.session.updateMany({ where: { id: session.id, endedAt: null, ...quiet }, data: { endedAt: now, endReason: reason } });
    if (count && reason === 'idle') {
      await this.audit.record({
        userId: session.userId,
        action: 'session_idle',
        entityType: ENTITY,
        entityId: session.userId,
        diff: { kind: session.kind, sessionId: session.id, lastActiveAt: session.lastActiveAt, minutes: IDLE_TIMEOUT_MS / 60_000 },
      });
    }
  }

  /**
   * Signing out (POST /auth/logout): the token's session ends ('signed_out'), if it is open and the token's user's.
   * Written to the audit log as theirs (the Super Admin's while they view as someone: it is their session).
   */
  async signOut(sessionId: string, userId: string): Promise<void> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, kind: true } });
    if (!session || session.userId !== userId) return;
    const { count } = await this.prisma.session.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: now, endReason: 'signed_out' } });
    if (count) await this.audit.record({ userId, action: 'logout', entityType: ENTITY, entityId: userId, diff: { kind: session.kind, sessionId } });
  }

  /** The user's sessions still open, newest first; `currentId`: the request's own. */
  async list(userId: string, currentId: string | null): Promise<SessionView[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, endedAt: null, expiresAt: { gt: new Date() } },
      select: VIEW,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, kind: r.kind as SessionKind, current: r.id === currentId }));
  }

  /** The Users page: a user's sessions still open; `currentId`: the Admin's own request's (when it is their account). */
  async listFor(userId: string, currentId: string | null): Promise<SessionView[]> {
    if (!(await this.prisma.user.count({ where: { id: userId } }))) throw new NotFoundException('User not found.');
    return this.list(userId, currentId);
  }

  /**
   * Your Sessions' Sign out beside a session: one of the user's own ('signed_out'); another's is not found. The current
   * one too (the web then signs out on this device).
   */
  async endOwn(user: SessionUser, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, kind: true, endedAt: true } });
    if (!session || session.userId !== user.id) throw new NotFoundException('Session not found.');
    if (session.endedAt) return;
    const { count } = await this.prisma.session.updateMany({ where: { id: sessionId, endedAt: null }, data: { endedAt: new Date(), endReason: 'signed_out' } });
    if (count) await this.audit.record({ userId: user.id, action: 'logout', entityType: ENTITY, entityId: user.id, diff: { kind: session.kind, sessionId } });
  }

  /**
   * The Users page: an Admin (a Super Admin too) ends a user's open sessions, all of them or one ('revoked'); a Super
   * Admin's, only a Super Admin (as every change to their account). Answers how many ended.
   */
  async revoke(actor: SessionUser, userId: string, sessionId?: string): Promise<{ ended: number }> {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { roles: { select: { role: { select: { key: true } } } } } });
    if (!target) throw new NotFoundException('User not found.');
    if (isSuperAdmin({ roles: target.roles.map((r) => r.role.key as SessionUser['roles'][number]) }) && !isSuperAdmin(actor)) {
      throw new ForbiddenException(SUPER_ADMIN_ACCOUNT_ONLY);
    }
    const now = new Date();
    const open = await this.prisma.session.findMany({
      where: { userId, endedAt: null, expiresAt: { gt: now }, ...(sessionId && { id: sessionId }) },
      select: { id: true, kind: true },
    });
    if (sessionId && !open.length) throw new NotFoundException('This session is not open any more.');
    if (!open.length) return { ended: 0 };
    const reason: SessionEndReason = 'revoked';
    const { count } = await this.prisma.session.updateMany({ where: { id: { in: open.map((s) => s.id) }, endedAt: null }, data: { endedAt: now, endReason: reason } });
    if (count) await this.audit.record({ userId: actor.id, action: 'session_revoked', entityType: ENTITY, entityId: userId, diff: { sessions: open.map((s) => ({ id: s.id, kind: s.kind })) } });
    return { ended: count };
  }
}
