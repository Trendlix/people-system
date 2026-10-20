// Viewing as another user (owner's decisions, 17 October 2026): "a super admin can view any other user profile from a
// switcher, only the super admin"; asked whether the Super Admin only views or can act: "view only with a button to act
// but by default not checked". Pure code, tested (view-as.spec.ts); the guard (auth.guard.ts) and the switcher's
// endpoints (view-as.controller.ts) use it.
//
// The session stays one signed cookie, as before. Its subject is always the person signed in; while they view as
// someone it names that user too, and whether they act in their name. Switching, Act as them and going back each sign
// a new one with the same expiry and the same session (sid, a row kept on the server since 20 October 2026: see
// session-rules.ts), so the switched session is the Super Admin's own: it ends with it (signing out, a newer sign-in,
// 15 minutes without activity, or 8 hours after signing in), and going back needs no new sign-in.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the session cookie's signed token says. */
export interface SessionClaims {
  /** The person signed in: a Super Admin while viewing as someone. */
  sub: string;
  /** Their session, as the server keeps it (sessions.id): every token of one sign-in names the same one. */
  sid: string;
  /** The user viewed as, or null in one's own session. */
  viewAs: string | null;
  /** Whether the Super Admin acts in that user's name; always false in one's own session. */
  act: boolean;
  /** When the session ends, in seconds since 1970, as in every signed token. */
  exp: number;
}

/** The claims of a token whose signature has been checked; throws when they are not as this API signs them. */
export function sessionClaims(payload: unknown): SessionClaims {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.sub !== 'string' || !UUID.test(p.sub)) throw new Error('No subject');
  // a token signed before 20 October 2026 names no session: refused, and its user signs in again
  if (typeof p.sid !== 'string' || !UUID.test(p.sid)) throw new Error('No session');
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) throw new Error('No expiry');
  if (p.viewAs === undefined || p.viewAs === null) {
    if (p.act !== undefined && p.act !== false) throw new Error('Acting without viewing as anyone');
    return { sub: p.sub, sid: p.sid, viewAs: null, act: false, exp: p.exp };
  }
  if (typeof p.viewAs !== 'string' || !UUID.test(p.viewAs) || p.viewAs === p.sub) throw new Error('Not a user to view as');
  if (typeof p.act !== 'boolean') throw new Error('No act flag');
  return { sub: p.sub, sid: p.sid, viewAs: p.viewAs, act: p.act, exp: p.exp };
}

/** What a new session's token carries: only what is needed, and the session and expiry of the one it replaces. */
export function tokenPayload(claims: SessionClaims): Record<string, unknown> {
  const own = { sub: claims.sub, sid: claims.sid };
  return claims.viewAs ? { ...own, viewAs: claims.viewAs, act: claims.act, exp: claims.exp } : { ...own, exp: claims.exp };
}

/** The milliseconds left before a session ends, for the cookie's lifetime: never below zero. */
export function msLeft(claims: Pick<SessionClaims, 'exp'>, now = Date.now()): number {
  return Math.max(0, claims.exp * 1000 - now);
}

/** Reading only: any other request is a change, refused while viewing as someone without Act as them. */
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const changesData = (method: string) => !READS.has(method.toUpperCase());

/** The refusal of a change while viewing only; `who`: the user's name, or their email when they have no profile. */
export const viewOnlyMessage = (who: string) => `Viewing as ${who}: view only. Switch on Act as them to make changes.`;

export const ONLY_SUPER_ADMIN_VIEWS_AS = 'Only a Super Admin can view as another user.';
export const NOT_YOURSELF = 'You cannot view as yourself.';
/** No switching while switched: back to one's own account first. */
export const alreadyViewing = (who: string) => `You are viewing as ${who}. Go back to your account first.`;
export const NOT_VIEWING = 'You are not viewing as anyone.';
export const deactivatedAccount = (email: string) => `${email}'s account is deactivated. You can only view as an active user.`;
