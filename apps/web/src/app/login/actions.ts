'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionKindOf } from '@trendlix/shared';
import { apiFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/constants';
import { pushTokenOf } from '@/lib/notifications';
import { signInThrough } from '@/lib/sign-in';
import { signInPath } from '@/lib/signed-out';

export interface LoginState {
  error?: string;
  email?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.', email };
  // signed in, it moves on (lib/sign-in.ts); refused, why
  return { error: await signInThrough('/auth/login', { email, password }, formData.get('next')), email };
}

/**
 * Signing out also ends viewing as someone: the switched session is the Super Admin's own. It ends the session on the
 * server too (20 October 2026), so the token can't be used again; the cookie goes even when the API can't be reached.
 *
 * In the Trendlix People app (its user agent's mark), signing out keeps the fingerprint sign-in (owner, 20 October 2026:
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
