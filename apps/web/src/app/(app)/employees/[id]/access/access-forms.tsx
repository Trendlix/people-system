'use client';

import { SIGN_IN_EMAIL_LABELS, type SignInEmailChoice } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { FormErrors } from '@/components/form';
import { SetUpEmailLink } from '@/components/set-up-email-link';
import type { FormState } from '@/lib/types';
import type { LinkState } from '../../access-actions';

// The Access tab's forms (owner, 22 October 2026: "On the employee profile"): the sign-in email HR chose ("let the HR
// Choose which mail to use"), Give access now, and the set-password links ("Set-password link"), emailed or copied once
// to send by hand.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

function Saved({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

/** Work or personal, each with its address; a change is asked about first (they sign in with the new one from now on). */
export function SignInEmailForm({
  action,
  saved,
  work,
  personal,
}: {
  action: Action;
  saved: SignInEmailChoice;
  work: string | null;
  personal: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [choice, setChoice] = useState<SignInEmailChoice>(saved);
  const address = { work, personal };
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const to = address[choice];
        if (choice === saved || !to || !window.confirm(`Sign in with ${to} from now on? Their password stays the same; the old email stops working for signing in.`)) {
          e.preventDefault();
        }
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="label">Sign-in email</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['work', 'personal'] as const).map((c) => (
            <label
              key={c}
              className={`flex min-h-11 items-start gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm has-checked:border-accent has-checked:bg-accent-soft ${address[c] ? 'cursor-pointer' : 'opacity-60'}`}
            >
              <input
                type="radio"
                name="choice"
                value={c}
                checked={choice === c}
                disabled={!address[c]}
                onChange={() => setChoice(c)}
                className="mt-0.5 size-4 accent-accent"
              />
              <span className="min-w-0">
                <span className="block font-medium">{SIGN_IN_EMAIL_LABELS[c]}</span>
                <span className="block break-all text-muted">{address[c] ?? 'None on their profile'}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || choice === saved} className="btn btn-secondary">
          {pending ? 'Saving…' : 'Save sign-in email'}
        </button>
        <Saved state={state} />
      </div>
    </form>
  );
}

/** Give access now: the account made at once (else within minutes), nothing sent. */
export function GiveAccessForm({ action }: { action: (prev: FormState) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Making it…' : 'Give access now'}
        </button>
        <Saved state={state} />
      </div>
    </form>
  );
}

/**
 * Give 7 days' grace (owner, 23 October 2026: "a 7 days grace period one time granted by the hr"; "Once per contract
 * gap"), on Hold: asked about first with its last day (`question`), as it is given once in this gap and can't be extended.
 */
export function GraceForm({ action, question }: { action: (prev: FormState) => Promise<FormState>; question: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(question)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Giving it…' : 'Give 7 days’ grace'}
        </button>
        <Saved state={state} />
      </div>
    </form>
  );
}

/**
 * Send invitation (or Resend), and Send password reset: by email when the server can send email, or a link to copy,
 * shown once here and sent by hand (WhatsApp). A new link stops the one before.
 */
export function LinkForm({
  action,
  purpose,
  emailReady,
  resend,
  email,
  setUpEmail = false,
}: {
  action: (prev: LinkState, fd: FormData) => Promise<LinkState>;
  purpose: 'invite' | 'reset';
  emailReady: boolean;
  /** An invitation is waiting: this one replaces it. */
  resend: boolean;
  /** Where it goes. */
  email: string;
  /** A Super Admin: "Set up email" after the not-set-up hint (23 October 2026: email set up on Organization → Email Settings). */
  setUpEmail?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);
  const emailLabel = purpose === 'invite' ? (resend ? 'Resend invitation' : 'Send invitation') : 'Send password reset';
  const copyLabel = purpose === 'invite' ? 'Copy invitation link' : 'Copy reset link';

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false); // the clipboard can be blocked: the link is on screen to copy by hand
    }
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        setCopied(false);
        const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const byEmail = button?.value !== 'copy';
        const question =
          purpose === 'reset'
            ? `Make a password reset link for ${email}? Setting a new password with it signs them out everywhere.`
            : resend
              ? `Make a new invitation for ${email}? The one sent before stops working.`
              : null;
        if (question && !window.confirm(byEmail ? `${question} It is emailed to them.` : question)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        {emailReady && (
          <button type="submit" name="mode" value="email" disabled={pending} className={purpose === 'invite' ? 'btn btn-primary' : 'btn btn-secondary'}>
            {pending ? 'Sending…' : emailLabel}
          </button>
        )}
        <button type="submit" name="mode" value="copy" disabled={pending} className={emailReady || purpose === 'reset' ? 'btn btn-secondary' : 'btn btn-primary'}>
          {copyLabel}
        </button>
      </div>
      {!emailReady && (
        <p className="hint">
          Email isn’t set up on the server yet: copy the link and send it to them yourself, by WhatsApp for example.
          {setUpEmail && (
            <>
              {' '}
              <SetUpEmailLink />
            </>
          )}
        </p>
      )}
      {state.link ? (
        <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
          <p className="text-sm">{state.message}</p>
          <div className="flex flex-wrap gap-2">
            <input readOnly value={state.link} aria-label="The link to send" onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 font-mono text-xs" />
            <button type="button" onClick={() => copy(state.link!)} className="btn btn-secondary">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p aria-live="polite" className="sr-only">
            {copied ? 'Link copied.' : ''}
          </p>
        </div>
      ) : (
        <Saved state={state} />
      )}
    </form>
  );
}
