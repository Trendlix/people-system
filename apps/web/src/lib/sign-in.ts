import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionKindOf } from '@trendlix/shared';
import { API_URL, messagesOf } from './api';
import { clientIp } from './client-ip';
import { originHeaders } from './origin-headers';
import { safeNext } from './safe-next';
import { keepSession } from './session-cookie';
import { CHOOSE_MODE_PATH } from './session-mode';

/**
 * Signing in through the API, whatever proves who it is: the password (app/login/actions.ts) or a code by email (owner,
 * 31 October 2026: "and i can add OTP via Mail for app login", "via app and web"; app/login/code). The browser's (or the
 * app's) user agent and IP address go with it, as this server sees them: the API starts a website or an app session by
 * the user agent (the app's ends with "TrendLIXPeople"), and ends the older one of the same kind (owner, 20 October
 * 2026: "only 1 active session per user online and 1 active mobile session"). Signed in, the session's cookie is kept
 * and the page moves on (a developer who is also an employee chooses how to use the system first; owner, 22 October
 * 2026); refused, the API's words.
 */
export async function signInThrough(path: '/auth/login' | '/auth/email-code/sign-in', body: Record<string, string>, next: FormDataEntryValue | null): Promise<string> {
  const h = await headers();
  const userAgent = h.get('user-agent')?.trim().slice(0, 2000); // whole: the app's mark is at its end
  const ip = clientIp(h);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: 'POST',
      // where the visitor is, signed for the audit log's Sign-ins (owner, 31 October 2026: "with location and ip capture")
      headers: { 'content-type': 'application/json', ...(await originHeaders()) },
      body: JSON.stringify({ ...body, ...(userAgent && { userAgent }), ...(ip && { ip }) }),
    });
  } catch {
    return 'Cannot reach the server. Please try again in a moment.';
  }
  if (!res.ok) return (await messagesOf(res)).join(' ');
  if (!(await keepSession(res))) return 'Sign-in failed. Please try again.';
  // the API says a developer who is also an employee chooses with `mode: null` (in the app it is always 'self')
  const signedIn = (await res.json().catch(() => null)) as { mode?: string | null } | null;
  if (signedIn?.mode === null) redirect(CHOOSE_MODE_PATH);
  // with nowhere to go back to (signed out, or after the 15 minutes), the app opens at its own Home, not the site's
  redirect(safeNext(next, sessionKindOf(userAgent) === 'app' ? '/app' : '/'));
}
