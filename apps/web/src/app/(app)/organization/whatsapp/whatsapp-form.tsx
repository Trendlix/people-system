'use client';

import {
  WHATSAPP_CATEGORY,
  WHATSAPP_FOOTER,
  WHATSAPP_HELLO_WORLD,
  WHATSAPP_LANGUAGE_LABELS,
  WHATSAPP_PROVIDER_HINTS,
  WHATSAPP_PROVIDER_LABELS,
  WHATSAPP_PROVIDERS,
  WHATSAPP_SECRET_UNREADABLE,
  WHATSAPP_SETUP_STEPS,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TOKEN_UNREADABLE,
  WHATSAPP_TWILIO_SETUP_NOTE,
  WHATSAPP_TWILIO_SETUP_STEPS,
  WHATSAPP_TWILIO_TOKEN_UNREADABLE,
  isWhatsAppTemplateKey,
  twilioTemplateName,
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

const NEW_TOKEN_CONFIRM =
  'Make a new verify token? Meta’s webhook stops verifying with the old one: paste the new one in the app’s WhatsApp → Configuration → Webhook and verify it again.';

/** A read-only value with Copy; without clipboard access the box is selected for Ctrl+C. */
function CopyField({ label, value, hint, where = 'Meta' }: { label: string; value: string; hint?: string; where?: string }) {
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
        {copied === 'yes' ? `Copied. Paste it in ${where}.` : copied === 'failed' ? 'Press Ctrl+C (⌘C on a Mac) to copy it.' : (hint ?? '')}
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
  hint,
  replacing,
  setReplacing,
}: {
  name: keyof typeof SECRET_MAX;
  label: string;
  saved: boolean;
  unreadable: boolean;
  unreadableText: string;
  hint: string;
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
        <p className="hint">Saved encrypted, and never shown again.</p>
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
        aria-describedby={`${id}-hint`}
        className="input font-mono"
      />
      <p id={`${id}-hint`} className={unreadable ? 'hint text-warn' : 'hint'}>
        {unreadable ? unreadableText : saved ? 'Leave it empty to keep the saved one.' : hint}
        {saved && (
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
      <p className="mt-1 max-w-3xl text-sm text-muted">
        {twilio
          ? 'Once, in this order. Meta charges per message and Twilio adds its own small fee; Twilio bills both to the company’s Twilio account.'
          : 'Once, in this order. Meta charges per message; the company pays Meta directly.'}
      </p>
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
      {twilio && <p className="mt-4 max-w-3xl text-sm text-muted">{WHATSAPP_TWILIO_SETUP_NOTE}</p>}
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
        <p className="mt-1 max-w-3xl text-sm text-muted">
          One at a time, and switchable later: the same messages, opt-ins, quiet hours and log either way. Each keeps its own templates’ approval. WhatsApp
          only: no SMS.
        </p>
        <fieldset className="mt-4">
          <legend className="sr-only">Send WhatsApp messages through</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {WHATSAPP_PROVIDERS.map((p) => (
              <label key={p} className="flex cursor-pointer gap-3 rounded-lg border border-line bg-white p-4 has-checked:border-accent has-checked:bg-accent-soft">
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => setProvider(p)}
                  aria-describedby={fid(`provider-${p}-hint`)}
                  className="mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {WHATSAPP_PROVIDER_LABELS[p]}
                    {view.provider === p && <span className="ml-2 text-xs font-normal text-muted">(chosen now)</span>}
                  </span>
                  <span id={fid(`provider-${p}-hint`)} className="block text-sm text-muted">
                    {WHATSAPP_PROVIDER_HINTS[p]}
                  </span>
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
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {twilio
            ? 'The Twilio account and the WhatsApp sender the messages go from (from the steps above). Meta’s own settings stay below it, hidden, for a switch back.'
            : 'The WhatsApp Business number the messages go from, and what lets the system send with it (from the steps above).'}
        </p>

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
                aria-describedby={fid('phoneNumberId-hint')}
                className="input font-mono tabular-nums"
              />
              <p id={fid('phoneNumberId-hint')} className="hint">
                WhatsApp → API Setup, under the number: a long number, not the phone number itself.
              </p>
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
                aria-describedby={fid('businessAccountId-hint')}
                className="input font-mono tabular-nums"
              />
              <p id={fid('businessAccountId-hint')} className="hint">
                WhatsApp → API Setup: the account the number and the templates belong to.
              </p>
            </div>
            <div>
              <label htmlFor={fid('displayPhone')} className="label">
                The business number
              </label>
              <PhoneInput id={fid('displayPhone')} name="displayPhone" label="The business number" defaultValue={view.displayPhone} aria-describedby={fid('displayPhone-hint')} />
              <p id={fid('displayPhone-hint')} className="hint">
                As people see it in WhatsApp: the number added and verified in Meta.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <SecretField
              name="accessToken"
              label="Permanent access token"
              saved={tokenSaved}
              unreadable={view.tokenUnreadable}
              unreadableText={WHATSAPP_TOKEN_UNREADABLE}
              hint="The system user’s token (expiry Never). Saved encrypted, and never shown again."
              replacing={replacingToken}
              setReplacing={setReplacingToken}
            />
            <SecretField
              name="appSecret"
              label="App secret"
              saved={secretSaved}
              unreadable={view.appSecretUnreadable}
              unreadableText={WHATSAPP_SECRET_UNREADABLE}
              hint="App settings → Basic → App secret: checks that the webhook’s calls come from Meta. Saved encrypted."
              replacing={replacingSecret}
              setReplacing={setReplacingSecret}
            />
          </div>

          <h3 className="mt-8 font-semibold">Webhook</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Paste both in the app → WhatsApp → Configuration → Webhook, then subscribe to messages. Meta tells the system with it whether each message was
            delivered and read, and when someone replies STOP.
          </p>
          <div className="mt-3 grid gap-5 lg:grid-cols-2">
            <CopyField label="Callback URL" value={view.webhookUrl} />
            <div>
              <CopyField label="Verify token" value={view.verifyToken} hint="Made by the system. Meta asks for it once, when the webhook is verified." />
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
                aria-describedby={fid('twilioAccountSid-hint')}
                className="input font-mono"
              />
              <p id={fid('twilioAccountSid-hint')} className="hint">
                The Twilio Console’s home page, under Account Info: AC and 32 letters and digits.
              </p>
            </div>
            <SecretField
              name="twilioAuthToken"
              label="Auth Token"
              saved={twilioTokenSaved}
              unreadable={view.twilio.authTokenUnreadable}
              unreadableText={WHATSAPP_TWILIO_TOKEN_UNREADABLE}
              hint="Beside the Account SID: it lets the system send through Twilio, and check that Twilio’s calls are Twilio’s. Saved encrypted, and never shown again."
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
                placeholder="whatsapp:+20 100 123 4567"
                aria-describedby={fid('twilioSender-hint')}
                className="input max-w-xl font-mono"
              />
              <p id={fid('twilioSender-hint')} className="hint max-w-3xl">
                The number registered as a WhatsApp sender in Twilio, written whatsapp:+20… with its country code; or the SID of a Messaging Service that holds
                it (MG…), and Twilio sends from the service’s sender. Either works; a Messaging Service lets numbers be added or changed in Twilio later
                without changing this.
              </p>
            </div>
          </div>

          <h3 className="mt-8 font-semibold">Webhooks</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            In the Twilio Console, paste the incoming-message URL as the sender’s “When a message comes in” (HTTP POST): STOP from someone turns their messages
            off. The status callback goes with every message by itself (it may be pasted as the sender’s status callback URL too): Twilio tells the system
            through it whether each message was delivered and read. Every call is checked against the Auth Token.
          </p>
          <div className="mt-3 grid gap-5 lg:grid-cols-2">
            <CopyField label="Incoming-message URL" value={view.twilio.incomingUrl} where="Twilio" hint="The sender’s “When a message comes in”, method HTTP POST." />
            <CopyField label="Status callback URL" value={view.twilio.statusCallbackUrl} where="Twilio" hint="Sent with every message; pasting it in Twilio is optional." />
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
              aria-describedby={fid('quiet-hint')}
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
          <p id={fid('quiet-hint')} className="hint max-w-3xl">
            Cairo time, 10:00 PM to 8:00 AM unless changed. A message due in them waits until they end; a check-in or check-out reminder is dropped
            instead, as it would come too late.
          </p>
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
              aria-describedby={fid('enabled-hint')}
              className="size-5 accent-accent"
            />
            Send WhatsApp messages
          </label>
          <p id={fid('enabled-hint')} className="hint max-w-3xl">
            Only to those who turned them on (employees on their Notifications page, candidates with the tick on the careers forms), and only with
            approved templates. The bell, push and email go on as before, whatever this says.
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
          Send a Test Message
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {twilio ? (
            <>
              Sent through Twilio with its saved settings (save first), to a number that has WhatsApp: our own template {twilioTemplateName('test_message', 'en')}{' '}
              once it is approved on Twilio; until then a plain text, which WhatsApp delivers only if that phone wrote to the business number in the last 24
              hours (else Twilio fails it with error 63016, and the result here says so). The result says in plain words what Twilio answered: authentication
              failed, the sender not WhatsApp-enabled, a template not approved, the recipient not on WhatsApp, or the account suspended or out of funds.
            </>
          ) : (
            <>
              Sent with the saved settings (save first), to a number that has WhatsApp: our own template {WHATSAPP_TEMPLATES.test_message.name} once Meta
              approves it, until then Meta’s sample {WHATSAPP_HELLO_WORLD.name} (in English), which every new WhatsApp Business Account has. The result says
              in plain words what Meta answered: a token expired or invalid, the number not registered, a template not approved, the recipient not on
              WhatsApp, or a payment problem.
            </>
          )}
        </p>
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
        <p className="mt-1 max-w-3xl text-sm text-muted">
          {twilio
            ? `The same texts as Meta’s, in English and Arabic, made in Twilio as Content (a text, or a text with the button), named people_<template>_<language>, and submitted for WhatsApp’s approval in the ${WHATSAPP_CATEGORY.toLowerCase()} category; the STOP line ends each text, as these have no footer. Twilio keeps its own approval, apart from Meta’s: only approved ones are used while Twilio sends, anything else goes by the bell, push and email only.`
            : `Every WhatsApp message is one of these, in English and Arabic, of Meta’s ${WHATSAPP_CATEGORY.toLowerCase()} category: names, dates and references, never an amount or a reason. Submit them once the connection is saved; Meta reviews each (usually within minutes, up to a day). Only approved ones are used: anything else goes by the bell, push and email only.`}
        </p>
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
