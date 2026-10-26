'use client';

import { useState, type InputHTMLAttributes } from 'react';

// A password field with an eye to see what was typed (owner, 26 October 2026: "users are asking to preview password icon
// on login"): on signing in, setting a password from a link, and changing one's password. Pressed, the field shows its
// text and the eye is crossed out; pressed again, it is hidden. It starts hidden every time, and stays a password field
// for the browser's password manager until shown. The secrets HR and a Super Admin paste in setup (an app's client
// secret, the email password) keep plain password fields: those are never read back.

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { id: string; name: string };

export function PasswordInput(props: Props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input pe-11" />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={props.id}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 end-0 flex w-11 cursor-pointer items-center justify-center rounded-e-lg text-muted hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <path d="M1.75 10s3-5.75 8.25-5.75S18.25 10 18.25 10s-3 5.75-8.25 5.75S1.75 10 1.75 10Z" />
          <circle cx="10" cy="10" r="2.5" />
          {shown && <path d="M3 17 17 3" />}
        </svg>
      </button>
    </div>
  );
}
