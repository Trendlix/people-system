'use client';

import { ACCESS_LINK_STATE_TEXT, ACCESS_PASSWORD_MIN, type AccessLinkCheck } from '@trendlix/shared';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { PasswordInput } from '@/components/password-input';
import { formatDate } from '@/lib/format';
import { tokenFromHash } from '@/lib/access';
import { checkPasswordLink, setPasswordWithLink, type SetPasswordState } from './actions';

// The page a set-password link opens (owner, 22 October 2026: "Set-password link"): the token is after the # in its
// address, which a browser never sends to a server (so never in a log); read here, asked about, then sent with the
// password typed twice.

type Checked = AccessLinkCheck | { state: 'failed'; messages: string[] } | { state: 'none' };

export function SetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    const t = tokenFromHash(window.location.hash);
    if (!t) {
      // read once, on the client: the address isn't the server's to see
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecked({ state: 'none' });
      return;
    }
    setToken(t);
    let live = true;
    void checkPasswordLink(t).then((c) => {
      if (live) setChecked(c);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!checked) return <p className="text-sm text-muted">Checking your link…</p>;
  if (checked.state === 'none') return <Problem text={ACCESS_LINK_STATE_TEXT.unknown} />;
  if (checked.state === 'failed') return <Problem text={checked.messages.join(' ')} />;
  if (checked.state !== 'ok' || !token) return <Problem text={ACCESS_LINK_STATE_TEXT[checked.state === 'ok' ? 'unknown' : checked.state]} />;
  return <PasswordFields token={token} check={checked} />;
}

function Problem({ text }: { text: string }) {
  return (
    <div className="space-y-4">
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        {text}
      </p>
      <p className="text-sm">
        <Link href="/login">Go to sign in</Link> · <Link href="/forgot-password">Forgot password?</Link>
      </p>
    </div>
  );
}

function PasswordFields({ token, check }: { token: string; check: AccessLinkCheck }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPasswordWithLink.bind(null, token), {});
  const fid = useFieldIds();
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm">
        {check.purpose === 'reset' ? 'Choose a new password for' : 'Welcome! Choose a password for'} <span className="font-medium break-all">{check.email}</span>.
        {check.expiresAt && <span className="text-muted"> This link works until {formatDate(check.expiresAt)}.</span>}
      </p>
      {/* the sign-in email, for the browser's password manager */}
      <input type="email" name="username" autoComplete="username" value={check.email ?? ''} readOnly hidden />
      <div>
        <label htmlFor={fid('password')} className="mb-1 block text-sm font-medium">
          New password
        </label>
        <PasswordInput
          id={fid('password')}
          name="password"
          autoComplete="new-password"
          required
          minLength={ACCESS_PASSWORD_MIN}
          maxLength={200}
          aria-describedby={fid('password-hint')}
        />
        <p id={fid('password-hint')} className="hint">
          At least {ACCESS_PASSWORD_MIN} characters.
        </p>
      </div>
      <div>
        <label htmlFor={fid('repeat')} className="mb-1 block text-sm font-medium">
          The same password again
        </label>
        <PasswordInput id={fid('repeat')} name="repeat" autoComplete="new-password" required maxLength={200} />
      </div>
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Saving…' : 'Set password and sign in'}
      </button>
    </form>
  );
}
