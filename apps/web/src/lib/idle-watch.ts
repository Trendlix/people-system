import type { SignedOutReason } from '@trendlix/shared';

// The idle warning (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes inactive, then
// session to be terminated"; for HR, Admin and Super Admin, on the website and the app). The API ends the session after
// 15 minutes without activity; the page shows "You'll be signed out in 1 minute" with Stay signed in a minute before,
// then goes to the sign-in page. The page never decides alone: before warning and before leaving it asks the API how
// long the session has left (without counting as activity), so another tab's activity, or a request the page doesn't
// know about, keeps it open. Pure code (no "@/" imports): tested. The component: components/idle-watcher.tsx.

/** What the page learns when it asks the API about its session. */
export type SessionCheck =
  | { status: 'active'; idleMsLeft: number | null }
  | { status: 'ended'; reason: SignedOutReason }
  /** the API couldn't be reached: asked again a little later, nothing shown */
  | { status: 'unknown' };

/** What the page does next: wait and ask again, show the warning until the session ends, or go to the sign-in page. */
export type WatchStep = { kind: 'wait'; checkInMs: number } | { kind: 'warn'; endsInMs: number } | { kind: 'signedOut'; reason: SignedOutReason };

/** How often the API keeps a request as activity (apps/api session-rules.ts, ACTIVITY_THROTTLE_MS). */
export const ACTIVITY_THROTTLE_MS = 30_000;

/** Asked again this long after the API couldn't be reached. */
export const RETRY_MS = 30_000;

/** Asked again this long after the API said there is no limit for this person any more (their roles changed). */
export const NO_LIMIT_MS = 5 * 60_000;

/** After the warning's time is up, the last check waits this much more, so it lands after the API's 15 minutes. */
export const GRACE_MS = 1500;

/**
 * When to ask first after a page is shown (its requests counted as activity): before the warning is due, early enough
 * for the API's last activity being up to 30 seconds older than the page's.
 */
export function firstCheckInMs(timeoutMs: number, warnMs: number): number {
  return Math.max(0, timeoutMs - warnMs - ACTIVITY_THROTTLE_MS);
}

/** What to do with the API's answer, `warnMs` before the end being when the warning shows. */
export function stepAfter(check: SessionCheck, warnMs: number): WatchStep {
  if (check.status === 'ended') return { kind: 'signedOut', reason: check.reason };
  if (check.status === 'unknown') return { kind: 'wait', checkInMs: RETRY_MS };
  if (check.idleMsLeft === null) return { kind: 'wait', checkInMs: NO_LIMIT_MS };
  const left = Math.max(0, check.idleMsLeft);
  return left > warnMs ? { kind: 'wait', checkInMs: left - warnMs } : { kind: 'warn', endsInMs: left };
}

/** The warning's words, counting down: "You'll be signed out in 1 minute.", then in seconds. */
export function warningText(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  if (seconds >= 60) return 'You’ll be signed out in 1 minute.';
  if (seconds <= 1) return 'You’ll be signed out in 1 second.';
  return `You’ll be signed out in ${seconds} seconds.`;
}
