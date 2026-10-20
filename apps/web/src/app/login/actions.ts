'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionKindOf } from '@trendlix/shared';
import { API_URL, apiFetch, messagesOf } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';
import { SESSION_COOKIE } from '@/lib/constants';
import { pushTokenOf } from '@/lib/notifications';
import { safeNext } from '@/lib/safe-next';
import { keepSession } from '@/lib/session-cookie';
import { signInPath } from '@/lib/signed-out';

export interface LoginState {
  error?: string;
  email?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.', email };

  // the browser's (or the app's) user agent and IP address, as this server sees them: the API starts a website or an app
  // session by the user agent (the app's ends with "TrendLIXPeople"), and ends the older one of the same kind (owner,
  // 20 October 2026: "only 1 active session per user online and 1 active mobile session")
  const h = await headers();
  const userAgent = h.get('user-agent')?.trim().slice(0, 2000); // whole: the app's mark is at its end
  const ip = clientIp(h);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, ...(userAgent && { userAgent }), ...(ip && { ip }) }),
    });
  } catch {
    return { error: 'Cannot reach the server. Please try again in a moment.', email };
  }
  if (!res.ok) return { error: (await messagesOf(res)).join(' '), email };

  if (!(await keepSession(res))) return { error: 'Sign-in failed. Please try again.', email };
  // with nowhere to go back to (signed out, or after the 15 minutes), the app opens at its own Home, not the site's
  redirect(safeNext(formData.get('next'), sessionKindOf(userAgent) === 'app' ? '/app' : '/'));
}

/**
 * Signing out also ends viewing as someone: the switched session is the Super Admin's own. It ends the session on the
 * server too (20 October 2026), so the token can't be used again; the cookie goes even when the API can't be reached.
 *
 * In the TrendLIX People app (its user agent's mark), signing out keeps the fingerprint sign-in (owner, 20 October 2026:
 * chose Face ID / fingerprint sign-in for the app; README: "Signing out in the app keeps the fingerprint (the next open
 * offers it)"): the phone's credential is left as it is, and the sign-in page opens with ?reason=signed_out, which only
 * stops it asking for the fingerprint by itself (Sign in with fingerprint is still there). The website: the sign-in page.
 *
 * In the app, the Sign out forms also send the phone's push token (components/push-token-field.tsx; owner, 20 October
 * 2026: "Push notifications: yes"; README, Phase 4): it is unregistered first, while the session still is, so the phone
 * gets no more notifications for the person signed out. Best effort: refused or unreachable, signing out goes on.
 */
export async function logout(formData?: FormData): Promise<void> {
  const pushToken = pushTokenOf(typeof formData?.get === 'function' ? formData.get('pushToken') : null);
  if (pushToken) {
    try {
      await apiFetch('/me/push-devices/unregister', { method: 'POST', body: JSON.stringify({ token: pushToken }) });
    } catch {
      // unreachable: the API stops sending to a token Firebase says is gone
    }
  }
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // unreachable: signed out here all the same
  }
  (await cookies()).delete(SESSION_COOKIE);
  const inApp = sessionKindOf((await headers()).get('user-agent')) === 'app';
  redirect(inApp ? signInPath('signed_out') : '/login');
}
