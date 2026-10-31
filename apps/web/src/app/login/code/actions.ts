'use server';

import { LOGIN_CODE_FORMAT, loginCodeOf } from '@trendlix/shared';
import { accessPost } from '@/lib/access-links';
import { signInThrough } from '@/lib/sign-in';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"): asking for a code (the visitor's address signed, as Forgot password's),
// then signing in with it exactly as with a password (lib/sign-in.ts).

export interface AskState {
  errors?: string[];
  email?: string;
  /** The API's answer, once asked. */
  message?: string;
  /** When it was asked (ms), for "Send a new code" a minute on. */
  sentAt?: number;
}

export async function askCode(_prev: AskState, fd: FormData): Promise<AskState> {
  const email = String(fd.get('email') ?? '').trim();
  if (!email) return { errors: ['Enter your sign-in email.'] };
  const r = await accessPost<{ message: string }>('/auth/email-code', { email });
  if (!r.ok) return { errors: r.messages, email };
  return { message: r.data.message, email, sentAt: Date.now() };
}

export interface CodeState {
  error?: string;
}

export async function signInWithCode(_prev: CodeState, fd: FormData): Promise<CodeState> {
  const email = String(fd.get('email') ?? '').trim();
  const code = loginCodeOf(String(fd.get('code') ?? ''));
  if (!email) return { error: 'Enter your sign-in email.' };
  if (!code) return { error: LOGIN_CODE_FORMAT };
  return { error: await signInThrough('/auth/email-code/sign-in', { email, code }, fd.get('next')) };
}
