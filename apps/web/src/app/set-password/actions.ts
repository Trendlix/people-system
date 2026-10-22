'use server';

// The set-password page's actions (owner, 22 October 2026: "Set-password link"): what the link is, and the password set
// with it; then they are signed in as on the sign-in page (the same session rules: a website or an app session, the new
// one ending the older of its kind).
import type { AccessLinkCheck } from '@trendlix/shared';
import { newPasswordProblem } from '@/lib/access';
import { accessPost } from '@/lib/access-links';
import { login } from '../login/actions';

export interface SetPasswordState {
  errors?: string[];
}

/** What a link is: it works (with the email it sets the password of), has expired, was used, or is unknown. */
export async function checkPasswordLink(token: string): Promise<AccessLinkCheck | { state: 'failed'; messages: string[] }> {
  const r = await accessPost<AccessLinkCheck>('/auth/password-link/check', { token });
  return r.ok ? r.data : { state: 'failed', messages: r.messages };
}

/** The password set with the link, then signed in (redirected to their home page); else why not. */
export async function setPasswordWithLink(token: string, _prev: SetPasswordState, fd: FormData): Promise<SetPasswordState> {
  const password = String(fd.get('password') ?? '');
  const problem = newPasswordProblem(password, String(fd.get('repeat') ?? ''));
  if (problem) return { errors: [problem] };
  const r = await accessPost<{ email: string }>('/auth/password-link', { token, password });
  if (!r.ok) return { errors: r.messages };
  const signIn = new FormData();
  signIn.set('email', r.data.email);
  signIn.set('password', password);
  // redirects once signed in; an answer means it didn't work: the password is set, so the sign-in page will
  const failed = await login({}, signIn);
  return { errors: [`Your password is set. ${failed.error ?? ''} Sign in with it on the sign-in page.`.replace(/\s+/g, ' ').trim()] };
}
