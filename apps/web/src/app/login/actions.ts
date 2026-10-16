'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, messagesOf } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/constants';
import { keepSession } from '@/lib/session-cookie';

export interface LoginState {
  error?: string;
  email?: string;
}

/** Only same-site paths, so the sign-in page can't be used to send people elsewhere. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.', email };

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: 'Cannot reach the server. Please try again in a moment.', email };
  }
  if (!res.ok) return { error: (await messagesOf(res)).join(' '), email };

  if (!(await keepSession(res))) return { error: 'Sign-in failed. Please try again.', email };
  redirect(safeNext(formData.get('next')));
}

/** Signing out also ends viewing as someone: the switched session is the Super Admin's own. */
export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
