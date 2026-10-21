// Sessions kept on the server (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes
// inactive, then session to be terminated; only 1 active session per user online and 1 active mobile session to be
// working spontaneously"). Asked what a second sign-in of the same kind does: the new one wins, the older one ends at
// once ("You were signed out because you signed in on another device"); asked who the 15 minutes are for: HR, Admin and
// Super Admin, on the website and on the mobile app alike. Pure: the API decides with these and the web shows the same
// words.

import type { Role } from './index.js';

/**
 * Where a session was signed in: the website (any browser) or the TrendLIX People app, one of each at a time; or the
 * Claude connector (owner, 21 October 2026: "the connection method": Claude reads and drafts in Assets on the person's
 * own Claude account), one a person, the newest winning too, reaching the Assets endpoints only, long-lived (no 15
 * minutes; 90 days without a refresh end it: connector.ts).
 */
export const SESSION_KINDS = ['web', 'app', 'connector'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_KIND_LABELS: Record<SessionKind, string> = { web: 'Website', app: 'App', connector: 'Claude connector' };

/**
 * Why a session ended: signing out (the menu's Sign out, or Sign out beside a session on Your Sessions), a newer sign-in
 * of the same kind, 15 minutes without activity (HR, Admin, Super Admin), its 8 hours over, or an Admin ending it on the
 * Users page (or deactivating the account).
 */
export const SESSION_END_REASONS = ['signed_out', 'replaced', 'idle', 'expired', 'revoked'] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

/** What a refused request's 401 says ended the session: one of the reasons, or `ended` (no session known, an old token). */
export type SignedOutReason = SessionEndReason | 'ended';

export const isSignedOutReason = (value: unknown): value is SignedOutReason =>
  value === 'ended' || (SESSION_END_REASONS as readonly unknown[]).includes(value);

/** The minutes without activity after which the session of someone holding one of IDLE_ROLES ends. */
export const IDLE_TIMEOUT_MINUTES = 15;
export const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60_000;

/** The web's warning comes this long before the 15 minutes are up, with Stay signed in. */
export const IDLE_WARNING_MS = 60_000;

/** Who the 15 minutes are for (owner, 20 October 2026): HR, Admin and Super Admin, whatever else they hold. */
export const IDLE_ROLES = ['hr', 'admin', 'super_admin'] as const satisfies readonly Role[];

/** Whether someone with these roles is signed out after 15 minutes without activity. */
export const idleTimeoutApplies = (roles: readonly string[]): boolean => roles.some((r) => (IDLE_ROLES as readonly string[]).includes(r));

/**
 * The mark the TrendLIX People app adds at the end of its web view's user agent (apps/mobile/capacitor.config.ts,
 * appendUserAgent): a sign-in from the app is an `app` session, any other a `web` one.
 */
export const APP_USER_AGENT_MARK = 'TrendLIXPeople';

/** The kind of session a sign-in from this user agent starts. */
export function sessionKindOf(userAgent: string | null | undefined): SessionKind {
  return typeof userAgent === 'string' && userAgent.trim().endsWith(APP_USER_AGENT_MARK) ? 'app' : 'web';
}

/**
 * The header the web sends on the requests it makes by itself (the sidebar's counts, the idle watcher's checks): they
 * don't count as activity, so a page left open doesn't keep a session alive. Page loads and actions do count.
 */
export const BACKGROUND_HEADER = 'x-background';

/** The sign-in page's words for why someone was signed out (also the API's 401 message). */
export function signedOutMessage(reason: SignedOutReason): string {
  switch (reason) {
    case 'idle':
      return `You were signed out after ${IDLE_TIMEOUT_MINUTES} minutes without activity.`;
    case 'replaced':
      return 'You were signed out because you signed in on another device.';
    default:
      return 'Your session ended.';
  }
}
