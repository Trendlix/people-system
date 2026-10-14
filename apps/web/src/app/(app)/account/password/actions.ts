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
  return { message: 'Your password has been changed. Use the new one next time you sign in.' };
}
