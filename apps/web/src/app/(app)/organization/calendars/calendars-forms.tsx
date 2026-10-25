'use client';

import type { CalendarAppView } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import { dataCentreOptions, type CalendarAppState } from './setup';

// Organization → Calendars' form (owner, 25 October 2026: "its zoho mails"): the Zoho app's client ID, its secret and
// the data centre. The secret is never shown again once saved: "Set · Replace" opens an empty box, and an empty box keeps
// the saved one; nothing of it comes from the server (clientSecretSet only).

type Action = (prev: CalendarAppState, fd: FormData) => Promise<CalendarAppState>;

function SecretField({ set, unreadable, saved }: { set: boolean; unreadable: boolean; saved: number | undefined }) {
  const fid = useFieldIds();
  const kept = set && !unreadable;
  const [replacing, setReplacing] = useState(false);
  // a save that went through closes the box it had open, and the secret typed in it goes
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setReplacing(false);
  }
  if (kept && !replacing) {
    return (
      <div>
        <p id={fid('secret-label')} className="label">
          Client secret
        </p>
        <div role="group" aria-labelledby={fid('secret-label')} className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">Set</span>
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <button type="button" onClick={() => setReplacing(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
            Replace<span className="sr-only"> the client secret</span>
          </button>
        </div>
        <p className="hint">Saved encrypted, and never shown again.</p>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={fid('clientSecret')} className="label">
        Client secret
      </label>
      <input id={fid('clientSecret')} name="clientSecret" type="password" autoComplete="new-password" maxLength={500} autoFocus={replacing} className="input" />
      <p className={unreadable ? 'hint text-warn' : 'hint'}>
        {unreadable ? 'The saved secret can’t be read any more: paste it again.' : kept ? 'Leave it empty to keep the saved secret.' : 'Saved encrypted, and never shown again.'}
        {kept && (
          <>
            {' '}
            <button type="button" onClick={() => setReplacing(false)} className="font-semibold text-accent underline-offset-2 hover:underline">
              Keep the saved one
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/** The Zoho app: what api-console.zoho.com gives, the secret saved encrypted, and the company's data centre. */
export function ZohoAppForm({ app, action }: { app: CalendarAppView; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('clientId')} className="label">
            Client ID
          </label>
          <input
            id={fid('clientId')}
            name="clientId"
            defaultValue={app.clientId ?? ''}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={200}
            placeholder="1000.…"
            className="input font-mono text-sm"
          />
        </div>
        <SecretField set={app.clientSecretSet} unreadable={app.clientSecretUnreadable} saved={state.saved} />
      </div>
      <div className="sm:max-w-sm">
        <label htmlFor={fid('dataCentre')} className="label">
          Data centre
        </label>
        <Select id={fid('dataCentre')} name="dataCentre" defaultValue={app.dataCentre ?? ''} aria-describedby={fid('dataCentre-hint')} className="input">
          <option value="" disabled>
            Choose…
          </option>
          {dataCentreOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <p id={fid('dataCentre-hint')} className="hint">
          Where the company’s Zoho account is: the address you sign in to Zoho Mail at.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state.message && !state.errors && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
      {app.updatedAt && (
        <p className="text-xs text-muted">
          Last saved {formatDateTime(app.updatedAt)}
          {app.updatedBy ? ` by ${app.updatedBy.name}` : ''}.
        </p>
      )}
    </form>
  );
}
