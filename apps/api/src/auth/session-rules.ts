// The rules of a session kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15
// minutes inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session to
// be working spontaneously"; asked: a second sign-in of the same kind, the new one wins; the 15 minutes for HR, Admin and
// Super Admin, on the website and the app). Pure code, tested (session-rules.spec.ts): the guard (auth.guard.ts) and the
// sessions service (sessions.service.ts) decide with it. The kinds, reasons and words: packages/shared sessions.ts.

import {
  IDLE_TIMEOUT_MS,
  idleTimeoutApplies,
  signedOutMessage,
  type SessionEndReason,
  type SessionKind,
  type SignedOutReason,
} from '@trendlix/shared';

/** A request counts as activity at most this often a session: one write for a page that makes several requests. */
export const ACTIVITY_THROTTLE_MS = 30_000;

/** How much of a user agent is kept: enough to tell a browser and a phone apart. */
export const USER_AGENT_MAX = 300;

/** The part of a session row the rules read. */
export interface SessionState {
  userId: string;
  kind: string;
  lastActiveAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: string | null;
}

/**
 * What the guard does with a request's session:
 * - `ok`: let it through; `touch` when it counts as activity and the last one kept is old enough to keep a new one.
 * - refused (401 with `reason`): `end` when the session ends now ('idle', or 'expired' past its 8 hours), else it had
 *   already ended, or there is no such session of the token's user.
 */
export type SessionVerdict = { ok: true; touch: boolean } | { ok: false; reason: SignedOutReason; end?: 'idle' | 'expired' };

/**
 * The verdict on `session` (null: none with the token's id) for a request by `subject` (the token's user: the Super
 * Admin while they view as someone, so their 15 minutes apply), who holds `roles` now. `background`: a request the web
 * made by itself, which never counts as activity (but is refused all the same once the session is over).
 */
export function sessionVerdict(
  session: SessionState | null,
  subject: string,
  roles: readonly string[],
  now: Date,
  background: boolean,
): SessionVerdict {
  if (!session || session.userId !== subject) return { ok: false, reason: 'ended' };
  if (session.endedAt) return { ok: false, reason: endReasonOf(session.endReason) };
  if (session.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired', end: 'expired' };
  const idleFor = now.getTime() - session.lastActiveAt.getTime();
  if (idleTimeoutApplies(roles) && idleFor > IDLE_TIMEOUT_MS) return { ok: false, reason: 'idle', end: 'idle' };
  return { ok: true, touch: !background && idleFor >= ACTIVITY_THROTTLE_MS };
}

/** A stored reason as the 401 says it; one the database shouldn't hold reads as "ended". */
function endReasonOf(stored: string | null): SignedOutReason {
  const known: readonly string[] = ['signed_out', 'replaced', 'idle', 'expired', 'revoked'] satisfies SessionEndReason[];
  return stored && known.includes(stored) ? (stored as SessionEndReason) : 'ended';
}

/** The idle limit for someone with these roles, in milliseconds; null when it isn't for them. */
export const idleTimeoutFor = (roles: readonly string[]): number | null => (idleTimeoutApplies(roles) ? IDLE_TIMEOUT_MS : null);

/**
 * The milliseconds left before a session ends for want of activity, for the web's warning: null when there is no limit
 * (`idleTimeoutMs` null: someone the 15 minutes aren't for); never below zero.
 */
export function idleMsLeft(lastActiveAt: Date, idleTimeoutMs: number | null, now: Date): number | null {
  if (idleTimeoutMs === null) return null;
  return Math.max(0, lastActiveAt.getTime() + idleTimeoutMs - now.getTime());
}

/**
 * What a sign-in of `kind` does to the user's sessions still open: each of the same kind ends, 'replaced' (the new one
 * wins), or 'expired' when its 8 hours were already over; those of the other kind stay.
 */
export function endedBySignIn<T extends Pick<SessionState, 'kind' | 'expiresAt'>>(open: readonly T[], kind: SessionKind, now: Date): { session: T; reason: 'replaced' | 'expired' }[] {
  return open
    .filter((s) => s.kind === kind)
    .map((session) => ({ session, reason: session.expiresAt.getTime() <= now.getTime() ? ('expired' as const) : ('replaced' as const) }));
}

/** The body of the 401 refusing a request whose session is over: the sign-in page's words and the reason's code. */
export function signedOutBody(reason: SignedOutReason): { statusCode: 401; error: 'Unauthorized'; message: string; reason: SignedOutReason } {
  return { statusCode: 401, error: 'Unauthorized', message: signedOutMessage(reason), reason };
}

/** A user agent as it is kept: trimmed, at most USER_AGENT_MAX characters; null when there is none. */
export function keptUserAgent(userAgent: string | null | undefined): string | null {
  const ua = typeof userAgent === 'string' ? userAgent.trim() : '';
  return ua ? ua.slice(0, USER_AGENT_MAX) : null;
}

const IP = /^[0-9a-f.:]{2,45}$/i;

/** An IP address as it is kept: one that looks like an address, else null. */
export function keptIp(ip: string | null | undefined): string | null {
  const value = typeof ip === 'string' ? ip.trim().replace(/^::ffff:/i, '') : '';
  return IP.test(value) ? value : null;
}
