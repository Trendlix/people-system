'use server';

// Changing your own password. The API checks the session and the current password.
import { ApiError, apiSend } from '@/lib/api';
import type { FormState } from '@/lib/types';

export async function changePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const currentPassword = String(fd.get('currentPassword') ?? '');
  const newPassword = String(fd.get('newPassword') ?? '');
  if (newPassword !== String(fd.get('confirmPassword') ?? '')) {
    return { errors: ['The new password and its confirmation do not match.'] };
  }
  try {
    await apiSend('POST', '/auth/change-password', { currentPassword, newPassword });
  } catch (err) {
    // Passwords are never sent back to refill the form.
    if (err instanceof ApiError) return { errors: err.messages };
    throw err;
  }
  // the API also ends the person's other sessions and turns off fingerprint sign-in on their phones (20 October 2026)
  return { message: 'Your password has been changed. Your other sessions were signed out and fingerprint sign-in was turned off on your phones.' };
}
