'use client';

import type { MeetingAppView, MeetingChoiceKey, MeetingProvider } from '@trendlix/shared';
import { useActionState, useId, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { hostLabel, NO_DEFAULT, type MeetingAppState } from './setup';

// Organization → Meetings' forms (owner, 24 October 2026: "can i link an online meeting service provider to automatically
// generate meeting links?"; "make it both"): a provider's app (its client ID, secret, Microsoft's tenant, Zoom's account
// and its General app), the company's host for Microsoft and Zoom, the default for new online interviews, and the
// redirect URI with Copy. A secret is never shown again once saved: "Set · Replace" opens an empty box, and an empty box
// keeps the saved one; nothing of it comes from the server (clientSecretSet only).

type Action<S extends FormState = FormState> = (prev: S, fd: FormData) => Promise<S>;

function Saved({ state, pending }: { state: FormState; pending: boolean }) {
  if (!state.message || state.errors || pending) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

/** The redirect URI, with Copy; without clipboard access the box is selected for Ctrl+C. */
export function CopyUri({ uri }: { uri: string }) {
  const id = useId();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied('yes');
    } catch {
      (document.getElementById(id) as HTMLInputElement | null)?.select();
      setCopied('failed');
    }
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label">
        Redirect URI
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={id} readOnly value={uri} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 font-mono text-sm" />
        <button type="button" onClick={copy} className="btn btn-secondary">
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p role="status" className="text-xs text-muted">
        {copied === 'yes' ? 'Copied. Paste it in the provider’s console.' : copied === 'failed' ? 'Press Ctrl+C (⌘C on a Mac) to copy it.' : ''}
      </p>
    </div>
  );
}

/** A secret's box: "Set · Replace" while one is saved and readable; else an empty box. */
function SecretField({ name, label, set, unreadable, saved }: { name: string; label: string; set: boolean; unreadable: boolean; saved: number | undefined }) {
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
        <p id={fid(`${name}-label`)} className="label">
          {label}
        </p>
        <div role="group" aria-labelledby={fid(`${name}-label`)} className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">Set</span>
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <button type="button" onClick={() => setReplacing(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
            Replace<span className="sr-only"> the {label.toLowerCase()}</span>
          </button>
        </div>
        <p className="hint">Saved encrypted, and never shown again.</p>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={fid(name)} className="label">
        {label}
      </label>
      <input id={fid(name)} name={name} type="password" autoComplete="new-password" maxLength={500} autoFocus={replacing} className="input" />
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

function TextField({ name, label, value, hint, placeholder }: { name: string; label: string; value: string | null; hint?: string; placeholder?: string }) {
  const fid = useFieldIds();
  return (
    <div>
      <label htmlFor={fid(name)} className="label">
        {label}
      </label>
      <input
        id={fid(name)}
        name={name}
        defaultValue={value ?? ''}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={200}
        placeholder={placeholder}
        aria-describedby={hint ? fid(`${name}-hint`) : undefined}
        className="input font-mono text-sm"
      />
      {hint && (
        <p id={fid(`${name}-hint`)} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A provider's app: what the company's console gives, saved encrypted where it is a secret. */
export function MeetingAppForm({ provider, app, action }: { provider: MeetingProvider; app: MeetingAppView; action: Action<MeetingAppState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormErrors errors={state.errors} />
      {provider === 'microsoft' && <TextField name="tenantId" label="Directory (tenant) ID" value={app.tenantId} placeholder="1b2c3d4e-…" />}
      {provider === 'zoom' && (
        <h4 className="text-sm font-semibold">Server-to-Server OAuth App (Company Meetings)</h4>
      )}
      {provider === 'zoom' && <TextField name="accountId" label="Account ID" value={app.accountId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="clientId"
          label={provider === 'microsoft' ? 'Application (client) ID' : 'Client ID'}
          value={app.clientId}
          placeholder={provider === 'google' ? '….apps.googleusercontent.com' : undefined}
        />
        <SecretField name="clientSecret" label="Client secret" set={app.clientSecretSet} unreadable={app.clientSecretUnreadable} saved={state.saved} />
      </div>
      {provider === 'zoom' && (
        <>
          <h4 className="text-sm font-semibold">General App (Each HR Person’s Own)</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="userClientId" label="Client ID" value={app.userClientId} />
            <SecretField name="userClientSecret" label="Client secret" set={app.userClientSecretSet} unreadable={app.userClientSecretUnreadable} saved={state.saved} />
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <Saved state={state} pending={pending} />
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

/** The company's host for Microsoft (a mailbox) or Zoom (a user): saved once the app's credentials are accepted. */
export function MeetingHostForm({ provider, current, action, disabled }: { provider: 'microsoft' | 'zoom'; current: string | null; action: Action; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} noValidate className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <label htmlFor={fid('hostEmail')} className="label">
            {hostLabel(provider)}
          </label>
          <input
            id={fid('hostEmail')}
            name="hostEmail"
            type="email"
            defaultValue={current ?? ''}
            autoComplete="off"
            maxLength={254}
            placeholder="hr@trendlix.com"
            aria-describedby={fid('hostEmail-hint')}
            className="input"
          />
        </div>
        <button type="submit" disabled={pending || disabled} className="btn btn-primary">
          {pending ? 'Checking…' : current ? 'Change the host' : 'Use this host'}
        </button>
      </div>
      <p id={fid('hostEmail-hint')} className="hint">
        {provider === 'microsoft'
          ? 'The mailbox whose calendar holds the company’s interview meetings, with a Teams licence.'
          : 'A user of the company’s Zoom account, who hosts its interview meetings.'}
        {disabled ? ' Save the app’s credentials first.' : ''}
      </p>
      <Saved state={state} pending={pending} />
    </form>
  );
}

/** The company connection new online interviews start with, or none. */
export function MeetingDefaultForm({ options, current, action }: { options: { value: MeetingChoiceKey | typeof NO_DEFAULT; label: string }[]; current: MeetingChoiceKey | null; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label htmlFor={fid('choice')} className="label">
            New online interviews start with
          </label>
          <Select id={fid('choice')} name="choice" defaultValue={current ?? NO_DEFAULT} className="input">
            {options.map((o) => (
              <option key={o.value || 'none'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <Saved state={state} pending={pending} />
    </form>
  );
}
