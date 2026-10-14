'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, messagesOf } from '@/lib/api';
import { SESSION_COOKIE, SESSION_HOURS } from '@/lib/constants';

export interface LoginState {
  error?: string;
  email?: string;
}

/** Only same-site paths, so the sign-in page can't be used to send people elsewhere. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

function sessionTokenFrom(res: Response): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [name, ...rest] = pair.split('=');
    if (name.trim() === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
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

  const token = sessionTokenFrom(res);
  if (!token) return { error: 'Sign-in failed. Please try again.', email };

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60,
  });
  redirect(safeNext(formData.get('next')));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
