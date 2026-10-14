'use client';

import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { changePassword } from './actions';

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePassword, {} as FormState);
  const fid = useFieldIds();
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
        <input
          id={fid('currentPassword')}
          name="currentPassword"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('newPassword')} className="label">
          New password
        </label>
        <input
          id={fid('newPassword')}
          name="newPassword"
          type="password"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
          aria-describedby={fid('newPassword-hint')}
          className="input"
        />
        <p id={fid('newPassword-hint')} className="hint">
          At least 10 characters, and different from your current password. A short sentence is easy to remember.
        </p>
      </div>
      <div>
        <label htmlFor={fid('confirmPassword')} className="label">
          Confirm new password
        </label>
        <input
          id={fid('confirmPassword')}
          name="confirmPassword"
          type="password"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
          className="input"
        />
      </div>
      <SubmitButton>Change password</SubmitButton>
    </form>
  );
}
