'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionKindOf } from '@trendlix/shared';
import { API_URL, apiFetch, messagesOf } from '@/lib/api';
import { clientIp } from '@/lib/client-ip';
import { SESSION_COOKIE } from '@/lib/constants';
import { keepSession } from '@/lib/session-cookie';

export interface LoginState {
  error?: string;
  email?: string;
}

/** Only same-site paths, so the sign-in page can't be used to send people elsewhere; else `home`. */
function safeNext(value: FormDataEntryValue | null, home: string): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : home;
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
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // unreachable: signed out here all the same
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
