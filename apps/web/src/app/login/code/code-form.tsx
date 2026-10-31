'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useActionState, useSyncExternalStore } from 'react';
import { LOGIN_CODE_DIGITS } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { askCode, signInWithCode, type AskState, type CodeState } from './actions';
import { resendIn, resendLabel } from './code';

// Signing in with a code by email (owner, 31 October 2026: "and i can add OTP via Mail for app login if the user didn't
// remember his password", "via app and web"): the email, then the 6 digits from it; a new code a minute on.

/** The clock, read again every second while the code is asked for (none on the server: 0). */
function everySecond(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}
const secondNow = () => Math.floor(Date.now() / 1000) * 1000;
const notKnown = () => 0;

export function CodeForm() {
  const next = useSearchParams().get('next') ?? '';
  const [asked, ask, asking] = useActionState<AskState, FormData>(askCode, {});
  const [state, signIn, signing] = useActionState<CodeState, FormData>(signInWithCode, {});
  const now = useSyncExternalStore(everySecond, secondNow, notKnown);
  const fid = useFieldIds();

  if (!asked.sentAt) {
    return (
      <form action={ask} className="space-y-4">
        <p className="text-sm text-muted">Type the email you sign in with. If it has an account, we email it a {LOGIN_CODE_DIGITS}-digit code to sign in with.</p>
        <div>
          <label htmlFor={fid('email')} className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input id={fid('email')} name="email" type="email" autoComplete="username" required maxLength={254} defaultValue={asked.email} className="input" />
        </div>
        <FormErrors errors={asked.errors} />
        <button type="submit" disabled={asking} className="btn btn-primary w-full">
          {asking ? 'Sending…' : 'Email me a code'}
        </button>
        <p className="text-center text-sm">
          <Link href="/login">Sign in with your password</Link>
        </p>
      </form>
    );
  }

  const wait = now ? resendIn(asked.sentAt, now) : 60;
  return (
    <div className="space-y-4">
      <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
        {asked.message}
      </p>
      <form action={signIn} className="space-y-4">
        <input type="hidden" name="email" value={asked.email ?? ''} />
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor={fid('code')} className="mb-1 block text-sm font-medium">
            Code from the email
          </label>
          <input
            id={fid('code')}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={12}
            placeholder="123 456"
            className="input text-center text-lg tracking-[0.3em] tabular-nums"
            aria-describedby={fid('code-hint')}
          />
          <p id={fid('code-hint')} className="hint">
            Sent to {asked.email}. Nothing after a few minutes? Check your spam folder.
          </p>
        </div>
        {state.error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={signing} className="btn btn-primary w-full">
          {signing ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <form action={ask}>
        <input type="hidden" name="email" value={asked.email ?? ''} />
        <button type="submit" disabled={asking || wait > 0} className="btn btn-secondary w-full">
          {asking ? 'Sending…' : resendLabel(wait)}
        </button>
      </form>
      <p className="text-center text-sm">
        <Link href="/login">Sign in with your password</Link>
      </p>
    </div>
  );
}
