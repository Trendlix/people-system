'use client';

import { useActionState, useState } from 'react';
import { LINKEDIN_LIMITS, LINKEDIN_SETUP_STEPS, type LinkedInSettingsView } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { linkedinStatus } from '../../recruitment/linkedin-settings';

// Recruitment Settings' "LinkedIn Sign-in" (owner, 25 October 2026, on "Apply for This Job": "can i use linkedin to
// complete the data?"; told that LinkedIn's sign-in shares only a name, an email and a photo, they chose "Sign in with
// LinkedIn" with "Fill the form from the CV"; packages/shared linkedin-signin.ts): a Super Admin's. The short steps on
// LinkedIn's side, the redirect URL to give it (this site's address) with Copy, the app's client ID and secret (the
// secret saved encrypted and never shown again: "Set · Replace"), and the switch that shows "Fill in with LinkedIn" on
// both careers forms. Audited by the API (the secret only as "changed").

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const TONE = { ok: 'bg-ok-soft text-ok', neutral: 'bg-accent-soft text-accent', warn: 'bg-warn-soft text-warn' } as const;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('Copy the redirect URL:', value);
        }
      }}
      className="btn btn-secondary min-h-10 shrink-0 px-3 text-sm"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function LinkedInSettingsForm({ action, view, redirectUrl }: { action: Action; view: LinkedInSettingsView; redirectUrl: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  const one = (name: string) => {
    const x = v[name];
    return Array.isArray(x) ? x[0] : x;
  };
  // the saved secret, readable with the server's key: an empty box keeps it
  const saved = view.secretSet && !view.secretUnreadable;
  const [replacing, setReplacing] = useState(false);
  // a save that went through closes the box it had open, and the secret typed in it goes
  const [seenMessage, setSeenMessage] = useState(state.message);
  if (state.message !== seenMessage) {
    setSeenMessage(state.message);
    if (state.message) setReplacing(false);
  }
  const status = linkedinStatus(view);

  return (
    <div className="space-y-5">
      <p role="status" className={`rounded-lg px-4 py-3 text-sm font-semibold break-words ${TONE[status.tone]}`}>
        {status.text}
      </p>

      <div className="space-y-2">
        <h3 className="font-semibold">On LinkedIn</h3>
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          {LINKEDIN_SETUP_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <div>
        <p id={fid('redirect-label')} className="label">
          Redirect URL
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code aria-labelledby={fid('redirect-label')} className="min-w-0 flex-1 basis-64 rounded-lg border border-line bg-canvas px-3 py-2 text-sm break-all">
            {redirectUrl}
          </code>
          <CopyButton value={redirectUrl} />
        </div>
        <p className="hint">This site’s own address. Paste it on the app’s Auth tab exactly as shown.</p>
      </div>

      <form action={formAction} className="space-y-4">
        <FormErrors errors={state.errors} />
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor={fid('clientId')} className="label">
              Client ID
            </label>
            <input
              id={fid('clientId')}
              name="clientId"
              defaultValue={one('clientId') ?? view.clientId ?? ''}
              maxLength={LINKEDIN_LIMITS.clientId}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="input"
            />
          </div>
          <div>
            {saved && !replacing ? (
              <>
                <p id={fid('secret-label')} className="label">
                  Client secret
                </p>
                <div role="group" aria-labelledby={fid('secret-label')} className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-medium">Set</span>
                  <span aria-hidden="true" className="text-muted">
                    ·
                  </span>
                  <button type="button" onClick={() => setReplacing(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
                    Paste a new one to replace it
                  </button>
                </div>
                <p className="hint">Saved encrypted, and never shown again.</p>
              </>
            ) : (
              <>
                <label htmlFor={fid('clientSecret')} className="label">
                  Client secret
                </label>
                <input
                  id={fid('clientSecret')}
                  name="clientSecret"
                  type="password"
                  autoComplete="new-password"
                  maxLength={LINKEDIN_LIMITS.clientSecret}
                  autoFocus={replacing}
                  aria-describedby={fid('clientSecret-hint')}
                  className="input"
                />
                <p id={fid('clientSecret-hint')} className={view.secretUnreadable ? 'hint text-warn' : 'hint'}>
                  {view.secretUnreadable
                    ? 'The saved secret can’t be read any more (the server’s key changed): paste it again.'
                    : saved
                      ? 'Leave it empty to keep the saved secret.'
                      : 'The Primary Client Secret from the app’s Auth tab. Saved encrypted, and never shown again.'}
                  {saved && (
                    <>
                      {' '}
                      <button type="button" onClick={() => setReplacing(false)} className="font-semibold text-accent underline-offset-2 hover:underline">
                        Keep the saved one
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            name="enabled"
            defaultChecked={state.values ? one('enabled') === 'on' : view.enabled}
            className="size-5 shrink-0 accent-accent"
          />
          Show “Fill in with LinkedIn” on the careers forms
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? 'Saving…' : 'Save the LinkedIn sign-in'}
          </button>
          {state.message && !state.errors && (
            <span role="status" className="text-sm text-ok">
              {state.message}
            </span>
          )}
        </div>
        {view.updatedAt && (
          <p className="text-xs text-muted">
            Last changed {formatDateTime(view.updatedAt)}
            {view.updatedBy ? ` by ${view.updatedBy.name ?? view.updatedBy.email}` : ''}.
          </p>
        )}
      </form>
    </div>
  );
}
