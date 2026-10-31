import { LOGIN_CODE_RESEND_SECONDS } from '@trendlix/shared';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"): the page's pure parts, tested. Relative imports for the tests.

/** Seconds until a new code may be asked for (0: now), from when the last was asked (ms) and now (ms). */
export function resendIn(sentAt: number | null | undefined, now: number): number {
  if (!sentAt || !Number.isFinite(sentAt)) return 0;
  return Math.max(0, Math.ceil((sentAt + LOGIN_CODE_RESEND_SECONDS * 1000 - now) / 1000));
}

/** "Send a new code" as its button says it: "Send a new code in 0:42" while it waits. */
export function resendLabel(seconds: number): string {
  if (seconds <= 0) return 'Send a new code';
  return `Send a new code in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
