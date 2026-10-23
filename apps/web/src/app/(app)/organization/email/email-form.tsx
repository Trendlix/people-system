'use client';

import {
  MAIL_PROVIDER_LABELS,
  MAIL_PROVIDERS,
  MAIL_SECURITIES,
  MAIL_SECURITY_LABELS,
  MAIL_PASSWORD_UNREADABLE,
  mailPreset,
  mailProviderNote,
  type MailProvider,
  type MailSecurity,
  type MailSettingsView,
} from '@trendlix/shared';
import { startTransition, useActionState, useRef, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import { formatDateTime } from '@/lib/format';
import { lastTestText, type MailFormState, type MailIntent } from './settings';

// Organization → Email Settings' form (owner, 23 October 2026: "why dont we add SMTP setup in the organization setup"):
// the email server and the sender, "Send the system's emails with these settings", and Send a test email, in one form so
// the test sends what is on screen. The test uses the form's values as typed, saved or not (an empty password box: the
// saved password), so the Super Admin can check settings before saving them or switching them on. The password is never
// shown again once saved: "Set · Replace" opens an empty box; nothing of it comes from the server (passwordSet only).
// Choosing a provider fills in its server, port and security, with a note under it.

type Action = (prev: MailFormState, fd: FormData) => Promise<MailFormState>;

const REMOVE_CONFIRM = 'Remove the saved password? Settings that need it stop being used until a new one is entered.';

export function MailSettingsForm({ action, view, testTo }: { action: Action; view: MailSettingsView; testTo: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [running, setRunning] = useState<MailIntent | null>(null);
  const fid = useFieldIds();
  const testButton = useRef<HTMLButtonElement>(null);

  const [provider, setProvider] = useState<MailProvider>(view.provider);
  const [host, setHost] = useState(view.host ?? '');
  const [port, setPort] = useState(String(view.port));
  const [security, setSecurity] = useState<MailSecurity>(view.security);
  const [enabled, setEnabled] = useState(view.enabled);

  // the saved password, readable with the server's key: an empty box keeps it
  const saved = view.passwordSet && !view.passwordUnreadable;
  const [replacing, setReplacing] = useState(false);
  // a save (or a removal) that went through closes the box it had open, and the password typed in it goes
  const [seenSaved, setSeenSaved] = useState(state.saved);
  if (state.saved !== seenSaved) {
    setSeenSaved(state.saved);
    setReplacing(false);
  }

  function choose(next: MailProvider) {
    setProvider(next);
    const preset = mailPreset(next);
    if (!preset) return;
    setHost(preset.host);
    setPort(String(preset.port));
    setSecurity(preset.security);
  }

  /** Sends the form to the action with the button pressed (React leaves the fields as they are: no reset). */
  function dispatch(fd: FormData) {
    const intent = fd.get('intent');
    setRunning(intent === 'test' || intent === 'remove' ? intent : 'save');
    startTransition(() => formAction(fd));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    dispatch(new FormData(e.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null));
  }

  function removePassword() {
    if (!window.confirm(REMOVE_CONFIRM)) return;
    const fd = new FormData();
    fd.set('intent', 'remove');
    dispatch(fd);
  }

  const busy = (intent: MailIntent) => pending && running === intent;
  const shownTest = state.test ?? view.lastTest;

  return (
    // noValidate: the action checks every value with the API's own rules, and an address half typed in "Send the test to"
    // mustn't hold back Save
    <form action={formAction} onSubmit={onSubmit} noValidate className="space-y-6">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="passwordSaved" value={String(saved)} />

      <section aria-labelledby={fid('server-heading')} className="card p-6">
        <h2 id={fid('server-heading')} className="text-lg font-semibold">
          Email Server
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">The company mailbox the system sends from, and its provider’s sending (SMTP) server.</p>

        <div className="mt-5 space-y-5">
          <div className="max-w-md">
            <label htmlFor={fid('provider')} className="label">
              Email provider
            </label>
            <Select
              id={fid('provider')}
              name="provider"
              value={provider}
              onChange={(e) => choose(e.target.value as MailProvider)}
              aria-describedby={fid('provider-hint')}
              className="input"
            >
              {MAIL_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {MAIL_PROVIDER_LABELS[p]}
                </option>
              ))}
            </Select>
            <p id={fid('provider-hint')} className="hint">
              {mailProviderNote(provider)}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)]">
            <div>
              <label htmlFor={fid('host')} className="label">
                Server
              </label>
              <input
                id={fid('host')}
                name="host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={253}
                placeholder="smtp.gmail.com"
                className="input"
              />
            </div>
            <div>
              <label htmlFor={fid('port')} className="label">
                Port
              </label>
              <input
                id={fid('port')}
                name="port"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                className="input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={fid('security')} className="label">
                Security
              </label>
              <Select id={fid('security')} name="security" value={security} onChange={(e) => setSecurity(e.target.value as MailSecurity)} className="input">
                {MAIL_SECURITIES.map((s) => (
                  <option key={s} value={s}>
                    {MAIL_SECURITY_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('username')} className="label">
                Username
              </label>
              <input
                id={fid('username')}
                name="username"
                defaultValue={view.username ?? ''}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                aria-describedby={fid('username-hint')}
                className="input"
              />
              <p id={fid('username-hint')} className="hint">
                Usually the mailbox’s address, e.g. hr@trendlix.com. Leave it empty for a server that needs no sign-in.
              </p>
            </div>
            <div>
              {saved && !replacing ? (
                <>
                  <p id={fid('password-label')} className="label">
                    Password
                  </p>
                  <div role="group" aria-labelledby={fid('password-label')} className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">Set</span>
                    <span aria-hidden="true" className="text-muted">
                      ·
                    </span>
                    <button type="button" onClick={() => setReplacing(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
                      Replace<span className="sr-only"> the password</span>
                    </button>
                  </div>
                  <p className="hint">Saved encrypted, and never shown again.</p>
                </>
              ) : (
                <>
                  <label htmlFor={fid('password')} className="label">
                    Password
                  </label>
                  <input
                    id={fid('password')}
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    maxLength={256}
                    autoFocus={replacing}
                    aria-describedby={fid('password-hint')}
                    className="input"
                  />
                  <p id={fid('password-hint')} className={view.passwordUnreadable ? 'hint text-warn' : 'hint'}>
                    {view.passwordUnreadable
                      ? MAIL_PASSWORD_UNREADABLE
                      : saved
                        ? 'Leave it empty to keep the saved password.'
                        : 'Saved encrypted, and never shown again: an app password where the provider asks for one.'}
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
              {view.passwordSet && (
                <button type="button" onClick={removePassword} disabled={pending} className="btn btn-secondary mt-2 min-h-9 px-3">
                  {busy('remove') ? 'Removing…' : 'Remove the saved password'}
                </button>
              )}
            </div>
          </div>
        </div>

        <h3 className="mt-8 font-semibold">Sender</h3>
        <div className="mt-3 grid gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor={fid('fromName')} className="label">
              Sender’s name
            </label>
            <input id={fid('fromName')} name="fromName" defaultValue={view.fromName ?? ''} autoComplete="off" maxLength={100} placeholder="TrendLIX HR" className="input" />
          </div>
          <div>
            <label htmlFor={fid('fromAddress')} className="label">
              Sender’s address
            </label>
            <input
              id={fid('fromAddress')}
              name="fromAddress"
              type="email"
              defaultValue={view.fromAddress ?? ''}
              autoComplete="off"
              maxLength={254}
              placeholder="hr@trendlix.com"
              aria-describedby={fid('fromAddress-hint')}
              className="input"
            />
            <p id={fid('fromAddress-hint')} className="hint">
              The mailbox’s own address, or one it may send as.
            </p>
          </div>
          <div>
            <label htmlFor={fid('replyTo')} className="label">
              Reply-to <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id={fid('replyTo')} name="replyTo" type="email" defaultValue={view.replyTo ?? ''} autoComplete="off" maxLength={254} aria-describedby={fid('replyTo-hint')} className="input" />
            <p id={fid('replyTo-hint')} className="hint">
              Where answers go when nobody else is named: a job offer’s or an interview’s go to the HR user who sent it.
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-line-soft pt-5">
          {/* a hidden "false" so switching it off is sent too */}
          <input type="hidden" name="enabled" value="false" />
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              name="enabled"
              value="true"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              aria-describedby={fid('enabled-hint')}
              className="size-5 accent-accent"
            />
            Send the system’s emails with these settings
          </label>
          <p id={fid('enabled-hint')} className="hint">
            Off, or not complete: the server’s settings (deploy/.env) are used, if it has them. The test below works either way.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" name="intent" value="save" disabled={pending} className="btn btn-primary">
            {busy('save') ? 'Saving…' : 'Save'}
          </button>
          {state.message && !pending && (
            <p role="status" className="text-sm text-ok">
              {state.message}
            </p>
          )}
        </div>
        {view.updatedAt && (
          <p className="mt-3 text-xs text-muted">
            Last saved {formatDateTime(view.updatedAt)}
            {view.updatedBy ? ` by ${view.updatedBy.name}` : ''}.
          </p>
        )}
      </section>

      <section aria-labelledby={fid('test-heading')} className="card p-6">
        <h2 id={fid('test-heading')} className="text-lg font-semibold">
          Send a Test Email
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          A short email sent with the settings above as they are on screen, saved or not (an empty password box uses the saved password), so they can be
          checked before they are saved or switched on.
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <label htmlFor={fid('testTo')} className="label">
              Send the test to
            </label>
            <input
              id={fid('testTo')}
              name="testTo"
              type="email"
              defaultValue={testTo}
              autoComplete="email"
              maxLength={254}
              onKeyDown={(e) => {
                // Enter here sends the test, not the form's first button (Save)
                if (e.key !== 'Enter') return;
                e.preventDefault();
                testButton.current?.click();
              }}
              className="input"
            />
          </div>
          <button ref={testButton} type="submit" name="intent" value="test" disabled={pending} className="btn btn-secondary">
            {busy('test') ? 'Sending…' : 'Send a test email'}
          </button>
        </div>
        {shownTest && !busy('test') && (
          <p role="status" className={`mt-4 text-sm ${shownTest.ok ? 'text-ok' : 'text-danger'}`}>
            {lastTestText(shownTest, formatDateTime)}
          </p>
        )}
      </section>
    </form>
  );
}
