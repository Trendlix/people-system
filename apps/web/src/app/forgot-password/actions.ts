'use server';

// Forgot password on the sign-in page (owner, 22 October 2026: "Set-password link"): the API emails a reset link to an
// active account with the email, and answers the same either way, so the page never tells whether an account has it.
import { accessPost } from '@/lib/access-links';

export interface ForgotState {
  errors?: string[];
  message?: string;
  email?: string;
}

export async function forgotPassword(_prev: ForgotState, fd: FormData): Promise<ForgotState> {
  const email = String(fd.get('email') ?? '').trim();
  if (!email) return { errors: ['Enter your sign-in email.'] };
  const r = await accessPost<{ message: string }>('/auth/forgot-password', { email });
  if (!r.ok) return { errors: r.messages, email };
  return { message: r.data.message, email };
}
