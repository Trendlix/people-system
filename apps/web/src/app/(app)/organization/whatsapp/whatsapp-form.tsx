'use client';

import {
  WHATSAPP_FOOTER,
  WHATSAPP_LANGUAGE_LABELS,
  WHATSAPP_PROVIDER_LABELS,
  WHATSAPP_PROVIDERS,
  WHATSAPP_SECRET_UNREADABLE,
  WHATSAPP_SETUP_STEPS,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TOKEN_UNREADABLE,
  WHATSAPP_TWILIO_SETUP_STEPS,
  WHATSAPP_TWILIO_TOKEN_UNREADABLE,
  isWhatsAppTemplateKey,
  type WhatsAppProvider,
  type WhatsAppSettingsView,
} from '@trendlix/shared';
import { startTransition, useActionState, useId, useRef, useState } from 'react';
import { TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds } from '@/components/form';
import { PhoneInput } from '@/components/phone-input';
import { formatDateTime, formatTime } from '@/lib/format';
import { BADGE_CLASSES, templateBadge } from '@/lib/whatsapp';
import { lastTestText, quietStart, switchNote, templatesByKey, templatesFor, type WhatsAppFormState, type WhatsAppIntent } from './settings';

// Organization → Company → WhatsApp's form (owner, 24 October 2026: "how to make whatsapp notifications?"; "Directly to
// Meta"): the connection to the WhatsApp Cloud API (the number's and the account's IDs, the number as people see it, the
// permanent token and the app secret, the webhook's address and verify token to paste in Meta), quiet hours and the
// switch; Send a test message; and the templates, submitted to Meta and their status synced. One form, the button
// pressed saying what to do. The token and the app secret are never shown again once saved: "Set · Replace" opens an
// empty box; nothing of them comes from the server (tokenSet, appSecretSet only).
// Since 25 October 2026 ("Add Twilio as a choice"): "Send through" Meta directly or Twilio, with what a switch means said
// before saving; the steps, the connection, the test and the templates of the provider chosen. Both providers' fields
// are always sent (the other's only hidden), so a switch never loses them. Twilio's Auth Token as the token is.

type Action = (prev: WhatsAppFormState, fd: FormData) => Promise<WhatsAppFormState>;

const NEW_TOKEN_CONFIRM = 'Make a new verify token and verify Meta’s webhook again?';

/** A read-only value with Copy; without clipboard access the box is selected for Ctrl+C. */
function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('yes');
    } catch {
      (document.getElementById(id) as HTMLInputElement | null)?.select();
      setCopied('failed');
    }
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 font-mono text-sm" />
        <button type="button" onClick={copy} className="btn btn-secondary">
          {copied === 'yes' ? 'Copied' : 'Copy'}
          <span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      </div>
      <p role="status" className="hint">
        {copied === 'yes' ? 'Copied.' : copied === 'failed' ? 'Press Ctrl+C (⌘C on a Mac) to copy it.' : ''}
      </p>
    </div>
  );
}

const SECRET_MAX = { accessToken: 1024, appSecret: 128, twilioAuthToken: 64 } as const;

/** A secret saved encrypted: "Set · Replace", or the box to paste one into (an empty box keeps the saved one). */
function SecretField({
  name,
  label,
  saved,
  unreadable,
  unreadableText,
  replacing,
  setReplacing,
}: {
  name: keyof typeof SECRET_MAX;
  label: string;
  saved: boolean;
  unreadable: boolean;
  unreadableText: string;
  replacing: boolean;
  setReplacing: (v: boolean) => void;
}) {
  const id = useId();
  if (saved && !replacing) {
    return (
      <div>
        <p id={`${id}-label`} className="label">
          {label}
        </p>
        <div role="group" aria-labelledby={`${id}-label`} className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">Set</span>
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <button type="button" onClick={() => setReplacing(true)} className="font-semibold text-accent underline-offset-2 hover:underline">
            Replace<span className="sr-only"> the {label.toLowerCase()}</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="password"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={SECRET_MAX[name]}
        autoFocus={replacing}
        aria-describedby={unreadable ? `${id}-hint` : undefined}
        className="input font-mono"
      />
      {unreadable && (
        <p id={`${id}-hint`} className="hint text-warn">
          {unreadableText}
        </p>
      )}
      {saved && (
        <p className="hint">
          <button type="button" onClick={() => setReplacing(false)} className="font-semibold text-accent underline-offset-2 hover:underline">
            Keep the saved one
          </button>
        </p>
      )}
    </div>
  );
}

/** The owner's steps for the provider chosen, as they are, in order. */
function Steps({ provider }: { provider: WhatsAppProvider }) {
  const id = useId();
  const twilio = provider === 'twilio';
  const steps = twilio ? WHATSAPP_TWILIO_SETUP_STEPS : WHATSAPP_SETUP_STEPS;
  return (
    <section aria-labelledby={id} className="card p-6">
      <h2 id={id} className="text-lg font-semibold">
        {twilio ? 'Set Up in Twilio' : 'Set Up in Meta'}
      </h2>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-medium">{step.title}</span>
              <span className="block text-sm text-muted">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WhatsAppSettingsForm({ action, view, testTo }: { action: Action; view: WhatsAppSettingsView; testTo: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [running, setRunning] = useState<WhatsAppIntent | null>(null);
  const fid = useFieldIds();
  const testButton = useRef<HTMLButtonElement>(null);

  const [provider, setProvider] = useState<WhatsAppProvider>(view.provider);
  const twilio = provider === 'twilio';
  const quiet = quietStart(view);
  const [quietOn, setQuietOn] = useState(quiet.on);
  const [enabled, setEnabled] = useState(view.enabled);

  const tokenSaved = view.tokenSet && !view.tokenUnreadable;
  const secretSaved = view.appSecretSet && !view.appSecretUnreadable;
  const twilioTokenSaved = view.twilio.authTokenSet && !view.twilio.authTokenUnreadable;
  const [replacingToken, setReplacingToken] = useState(false);
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [replacingTwilio, setReplacingTwilio] = useState(false);
  // a save that went through closes the boxes it had open, and what was typed in them goes
  const [seenSaved, setSeenSaved] = useState(state.saved);
  if (state.saved !== seenSaved) {
    setSeenSaved(state.saved);
    setReplacingToken(false);
    setReplacingSecret(false);
    setReplacingTwilio(false);
  }

  function dispatch(fd: FormData) {
    const intent = fd.get('intent');
    setRunning(typeof intent === 'string' && intent !== '' ? (intent as WhatsAppIntent) : 'save');
    startTransition(() => formAction(fd));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    dispatch(new FormData(e.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null));
  }

  /** Make a new verify token: a button of its own (not a submit, so Enter in a field never presses it), after a confirm. */
  function newVerifyToken() {
    if (!window.confirm(NEW_TOKEN_CONFIRM)) return;
    const fd = new FormData();
    fd.set('intent', 'verify-token');
    dispatch(fd);
  }

  const busy = (intent: WhatsAppIntent) => pending && running === intent;
  const shownTest = state.test ?? view.lastTest;
  const saved = templatesFor(view, provider);
  // a press's answer is shown with its own provider's list only
  const pressed = state.templates && state.templatesProvider === provider ? state.templates : null;
  const rows = templatesByKey(pressed?.templates ?? saved.templates);
  const note = switchNote(view, provider);

  return (
    // noValidate: the action checks every value with the API's own rules, and a half-typed test number mustn't hold back Save
    <form action={formAction} onSubmit={onSubmit} noValidate className="space-y-6">
      <FormErrors errors={state.errors} />
      <input type="hidden" name="tokenSaved" value={String(tokenSaved)} />
      <input type="hidden" name="secretSaved" value={String(secretSaved)} />
      <input type="hidden" name="twilioTokenSaved" value={String(twilioTokenSaved)} />

      <section aria-labelledby={fid('provider-heading')} className="card p-6">
        <h2 id={fid('provider-heading')} className="text-lg font-semibold">
          Send Through
        </h2>
        <fieldset className="mt-4">
          <legend className="sr-only">Send WhatsApp messages through</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {WHATSAPP_PROVIDERS.map((p) => (
              <label key={p} className="flex cursor-pointer gap-3 rounded-lg border border-line bg-card p-4 has-checked:border-accent has-checked:bg-accent-soft">
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  className="mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span className="min-w-0 font-semibold">
                  {WHATSAPP_PROVIDER_LABELS[p]}
                  {view.provider === p && <span className="ml-2 text-xs font-normal text-muted">(chosen now)</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {note && (
          <p role="status" className="mt-4 rounded-lg bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">
            {note}
          </p>
        )}
      </section>

      <Steps provider={provider} />

      <section aria-labelledby={fid('connection-heading')} className="card p-6">
        <h2 id={fid('connection-heading')} className="text-lg font-semibold">
          Connection
        </h2>

        {/* Meta's: hidden while Twilio is chosen, still sent so nothing of them is lost */}
        <div hidden={twilio}>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('phoneNumberId')} className="label">
                Phone number ID
              </label>
              <input
                id={fid('phoneNumberId')}
                name="phoneNumberId"
                defaultValue={view.phoneNumberId ?? ''}
                inputMode="numeric"
                autoComplete="off"
                maxLength={30}
                className="input font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={fid('businessAccountId')} className="label">
                WhatsApp Business Account ID
              </label>
              <input
                id={fid('businessAccountId')}
                name="businessAccountId"
                defaultValue={view.businessAccountId ?? ''}
                inputMode="numeric"
                autoComplete="off"
                maxLength={30}
                className="input font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor={fid('displayPhone')} className="label">
                The business number
              </label>
              <PhoneInput id={fid('displayPhone')} name="displayPhone" label="The business number" defaultValue={view.displayPhone} />
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <SecretField
              name="accessToken"
              label="Permanent access token"
              saved={tokenSaved}
              unreadable={view.tokenUnreadable}
              unreadableText={WHATSAPP_TOKEN_UNREADABLE}
              replacing={replacingToken}
              setReplacing={setReplacingToken}
            />
            <SecretField
              name="appSecret"
              label="App secret"
              saved={secretSaved}
              unreadable={view.appSecretUnreadable}
              unreadableText={WHATSAPP_SECRET_UNREADABLE}
              replacing={replacingSecret}
              setReplacing={setReplacingSecret}
            />
          </div>

          <h3 className="mt-8 font-semibold">Webhook</h3>
          <div className="mt-3 grid gap-5 lg:grid-cols-2">
            <CopyField label="Callback URL" value={view.webhookUrl} />
            <div>
              <CopyField label="Verify token" value={view.verifyToken} />
              <button type="button" onClick={newVerifyToken} disabled={pending} className="btn btn-secondary mt-1 min-h-9 px-3">
                {busy('verify-token') ? 'Making…' : 'Make a new verify token'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">
            {view.webhook.verifiedAt ? `Verified by Meta ${formatDateTime(view.webhook.verifiedAt)}.` : 'Not verified by Meta yet.'}{' '}
            {view.webhook.lastEventAt ? `Meta last called it ${formatDateTime(view.webhook.lastEventAt)}.` : ''}
          </p>
        </div>

        {/* Twilio's: hidden while Meta is chosen, still sent so nothing of them is lost */}
        <div hidden={!twilio}>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('twilioAccountSid')} className="label">
                Account SID
              </label>
              <input
                id={fid('twilioAccountSid')}
                name="twilioAccountSid"
                defaultValue={view.twilio.accountSid ?? ''}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={40}
                placeholder="AC…"
                className="input font-mono"
              />
            </div>
            <SecretField
              name="twilioAuthToken"
              label="Auth Token"
              saved={twilioTokenSaved}
              unreadable={view.twilio.authTokenUnreadable}
              unreadableText={WHATSAPP_TWILIO_TOKEN_UNREADABLE}
              replacing={replacingTwilio}
              setReplacing={setReplacingTwilio}
            />
            <div className="sm:col-span-2">
              <label htmlFor={fid('twilioSender')} className="label">
                WhatsApp sender
              </label>
              <input
                id={fid('twilioSender')}
                name="twilioSender"
                defaultValue={view.twilio.sender ?? ''}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={60}
                placeholder="whatsapp:+20 100 123 4567 or MG…"
                className="input max-w-xl font-mono"
              />
            </div>
          </div>

          <h3 className="mt-8 font-semibold">Webhooks</h3>
          <div className="mt-3 grid gap-5 lg:grid-cols-2">
            <CopyField label="Incoming-message URL" value={view.twilio.incomingUrl} />
            <CopyField label="Status callback URL" value={view.twilio.statusCallbackUrl} />
          </div>
          <p className="mt-3 text-sm text-muted">{view.twilio.lastEventAt ? `Twilio last called ${formatDateTime(view.twilio.lastEventAt)}.` : 'Twilio hasn’t called yet.'}</p>
        </div>

        <h3 className="mt-8 font-semibold">Quiet Hours</h3>
        <div className="mt-3 space-y-3">
          {/* a hidden "false" so switching it off is sent too */}
          <input type="hidden" name="quietHours" value="false" />
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              name="quietHours"
              value="true"
              checked={quietOn}
              onChange={(e) => setQuietOn(e.target.checked)}
              className="size-5 accent-accent"
            />
            No WhatsApp messages at night
          </label>
          {quietOn && (
            <div className="grid max-w-md gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={fid('quietFrom')} className="label">
                  From
                </label>
                <TimeInput id={fid('quietFrom')} name="quietFrom" required defaultValue={formatTime(quiet.from)} />
              </div>
              <div>
                <label htmlFor={fid('quietTo')} className="label">
                  Until
                </label>
                <TimeInput id={fid('quietTo')} name="quietTo" required defaultValue={formatTime(quiet.to)} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-line-soft pt-5">
          <input type="hidden" name="enabled" value="false" />
          <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              role="switch"
              name="enabled"
              value="true"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-5 accent-accent"
            />
            Send WhatsApp messages
          </label>
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
          Send a Test Message
        </h2>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <label htmlFor={fid('testTo')} className="label">
              Send the test to
            </label>
            <div
              onKeyDown={(e) => {
                // Enter here sends the test, not the form's first button (Save)
                if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
                e.preventDefault();
                testButton.current?.click();
              }}
            >
              <PhoneInput id={fid('testTo')} name="testTo" label="Send the test to" defaultValue={testTo} />
            </div>
          </div>
          <button ref={testButton} type="submit" name="intent" value="test" disabled={pending} className="btn btn-secondary">
            {busy('test') ? 'Sending…' : 'Send a test message'}
          </button>
        </div>
        {shownTest && !busy('test') && (
          <p role="status" className={`mt-4 text-sm ${shownTest.ok ? 'text-ok' : 'text-danger'}`}>
            {lastTestText(shownTest, formatDateTime)}
          </p>
        )}
      </section>

      <section aria-labelledby={fid('templates-heading')} className="card p-6">
        <h2 id={fid('templates-heading')} className="text-lg font-semibold">
          {twilio ? 'Templates on Twilio' : 'Templates'}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" name="intent" value="submit" disabled={pending} className="btn btn-primary">
            {busy('submit') ? 'Submitting…' : 'Submit templates'}
          </button>
          <button type="submit" name="intent" value="sync" disabled={pending} className="btn btn-secondary">
            {busy('sync') ? 'Syncing…' : 'Sync status'}
          </button>
          <p className="text-sm text-muted">
            {saved.syncedAt ? `Synced with ${twilio ? 'Twilio' : 'Meta'} ${formatDateTime(saved.syncedAt)}.` : `Not synced with ${twilio ? 'Twilio' : 'Meta'} yet.`}
          </p>
        </div>
        {pressed && !busy('submit') && !busy('sync') && (
          <p role="status" className={`mt-3 text-sm ${pressed.ok ? 'text-ok' : 'text-danger'}`}>
            {pressed.message}
          </p>
        )}

        <ul className="mt-5 divide-y divide-line-soft border-y border-line-soft">
          {rows.map((row) => {
            const d = isWhatsAppTemplateKey(row.key) ? WHATSAPP_TEMPLATES[row.key] : null;
            return (
              <li key={row.key} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium">
                    {row.label} <span className="font-mono text-xs text-muted">{twilio ? row.languages.map((l) => l.name).join(' · ') : row.name}</span>
                  </p>
                  <p className="text-xs text-muted">{d ? (d.audience === 'candidate' ? 'To candidates' : d.audience === 'test' ? 'The test' : 'To employees') : ''}</p>
                </div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {row.languages.map((t) => {
                    const badge = templateBadge(t.status);
                    return (
                      <li key={t.language} className="text-sm">
                        <span className="text-muted">{WHATSAPP_LANGUAGE_LABELS[t.language]}: </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[badge.tone]}`}>{badge.text}</span>
                        {t.reason && <span className="ml-1 text-xs text-danger">{t.reason}</span>}
                      </li>
                    );
                  })}
                </ul>
                {d && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-accent">Show the text</summary>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg bg-canvas p-3">
                        <p className="whitespace-pre-line">{d.body.en}</p>
                        <p className="mt-2 text-xs text-muted">{WHATSAPP_FOOTER.en}</p>
                        {d.button && <p className="mt-2 text-xs font-semibold text-accent">[{d.button.en}]</p>}
                      </div>
                      <div dir="rtl" lang="ar" className="rounded-lg bg-canvas p-3">
                        <p className="whitespace-pre-line">{d.body.ar}</p>
                        <p className="mt-2 text-xs text-muted">{WHATSAPP_FOOTER.ar}</p>
                        {d.button && <p className="mt-2 text-xs font-semibold text-accent">[{d.button.ar}]</p>}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted">{d.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </form>
  );
}
