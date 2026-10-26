'use client';

import { useActionState, useEffect } from 'react';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import { PasswordInput } from '@/components/password-input';
import { clearBiometric } from '@/lib/native';
import type { FormState } from '@/lib/types';
import { changePassword } from './actions';

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePassword, {} as FormState);
  const fid = useFieldIds();
  // a changed password turns off fingerprint sign-in on every phone of theirs (owner, 20 October 2026: chose Face ID /
  // fingerprint sign-in for the app; the API revokes the credentials): in the app, this phone's copy goes too, so it
  // offers to turn it on again rather than ask for a fingerprint the server no longer takes. Nothing outside the app.
  useEffect(() => {
    if (state.message) void clearBiometric();
  }, [state]);
  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      <div>
        <label htmlFor={fid('currentPassword')} className="label">
          Current password
        </label>
        <PasswordInput id={fid('currentPassword')} name="currentPassword" required maxLength={200} autoComplete="current-password" />
      </div>
      <div>
        <label htmlFor={fid('newPassword')} className="label">
          New password
        </label>
        <PasswordInput
          id={fid('newPassword')}
          name="newPassword"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
          aria-describedby={fid('newPassword-hint')}
        />
        <p id={fid('newPassword-hint')} className="hint">
          At least 10 characters, and different from your current password. A short sentence is easy to remember.
        </p>
      </div>
      <div>
        <label htmlFor={fid('confirmPassword')} className="label">
          Confirm new password
        </label>
        <PasswordInput id={fid('confirmPassword')} name="confirmPassword" required minLength={10} maxLength={200} autoComplete="new-password" />
      </div>
      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}
