'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { useFieldIds } from '@/components/form';
import { login, type LoginState } from './actions';

export function LoginForm() {
  const next = useSearchParams().get('next') ?? '';
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const fid = useFieldIds();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor={fid('email')} className="mb-1 block text-sm font-medium">
          Work email
        </label>
        <input
          id={fid('email')}
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('password')} className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input id={fid('password')} name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
