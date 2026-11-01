'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { forgotPassword, type ForgotState } from './actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPassword, {});
  const fid = useFieldIds();
  if (state.message) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
          {state.message}
        </p>
        <p className="text-sm">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor={fid('email')} className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input id={fid('email')} name="email" type="email" autoComplete="username" required maxLength={254} defaultValue={state.email} className="input" />
      </div>
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Sending…' : 'Email me a link'}
      </button>
      <p className="text-center text-sm">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
