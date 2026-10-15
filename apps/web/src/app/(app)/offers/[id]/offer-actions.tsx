'use client';

import { useActionState, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';
import { EMAIL_NOT_SET_UP, newLinkConfirm, offerMailto, type OfferMailParts, type OfferSendState } from '../sending';

// The actions on an offer's page that take a few words or show an answer: sending by email, making the link to copy,
// extending, withdrawing and recording an answer given another way. Each small form opens from its button and closes
// once its action went through; a refused one stays open with the reason. One-click actions (Create the profile,
// Delete) use the profile's ActionButton.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type SendAction = (prev: OfferSendState, fd: FormData) => Promise<OfferSendState>;

const small = 'btn min-h-9 px-3';
const panel = 'w-full space-y-3 rounded-lg border border-line bg-canvas p-4';
const optional = <span className="font-normal text-muted">(optional)</span>;

/** The candidate's link after sending: to copy, or to send from HR's own email with the message ready. */
export function LinkBox({ link, mail }: { link: string; mail: Omit<OfferMailParts, 'link'> }) {
  const fid = useFieldIds();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      // without clipboard access (an older browser, or a page not on https): select it, for Ctrl+C
      const box = document.getElementById(fid('link')) as HTMLInputElement | null;
      box?.select();
      setCopied('failed');
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
      <label htmlFor={fid('link')} className="label">
        The candidate&apos;s link
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={fid('link')}
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          aria-describedby={fid('link-hint')}
          className="input min-w-0 flex-1 font-mono text-xs"
        />
        <button type="button" onClick={copy} className="btn btn-primary">
          Copy
        </button>
        <a href={offerMailto({ ...mail, link })} className="btn btn-secondary">
          Open in my email
        </a>
      </div>
      <p role="status" className="text-sm text-ok">
        {copied === 'yes' && 'Copied.'}
      </p>
      {copied === 'failed' && (
        <p role="alert" className="text-sm text-warn">
          Couldn&apos;t copy it here: the link is selected, press Ctrl+C (⌘C on a Mac) to copy it.
        </p>
      )}
      <p id={fid('link-hint')} className="hint">
        Anyone with this link can open the offer, so send it to the candidate only. Sending the offer again makes a new link, and this one stops working.
      </p>
    </div>
  );
}

/**
 * Send by email (when the server has email set up) and Copy link. Either one counts as sending the offer and makes a new
 * link, shown here once it is made.
 */
export function SendOffer({
  emailAction,
  linkAction,
  mail,
  emailConfigured,
  sentCount,
}: {
  emailAction: SendAction;
  linkAction: (prev: OfferSendState) => Promise<OfferSendState>;
  /** The email's parts but the link: the candidate's address (`to`) to start with. */
  mail: Omit<OfferMailParts, 'link'>;
  emailConfigured: boolean;
  sentCount: number;
}) {
  const fid = useFieldIds();
  const { state, pending: emailing, form } = useKeptForm(emailAction);
  const emailed: OfferSendState = state;
  const [linked, linkFormAction, linking] = useActionState(linkAction, {});
  const [open, setOpen] = useClosesOnSave(emailed);
  const again = sentCount > 0;
  // the newest sending's answer, with the link that works now (each sending replaces the link before it)
  const [seen, setSeen] = useState({ emailed, linked });
  const [latest, setLatest] = useState<OfferSendState | null>(null);
  if (emailed !== seen.emailed || linked !== seen.linked) {
    setSeen({ emailed, linked });
    const fresh = emailed !== seen.emailed ? emailed : linked;
    if (fresh.link) setLatest(fresh);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        {emailConfigured && !open && (
          <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-primary`}>
            {again ? 'Send again by email' : 'Send by email'}
          </button>
        )}
        <form
          action={linkFormAction}
          onSubmit={(e) => {
            const confirmText = newLinkConfirm(sentCount);
            if (confirmText && !window.confirm(confirmText)) e.preventDefault();
          }}
        >
          <button type="submit" disabled={linking} className={`${small} ${emailConfigured ? 'btn-secondary' : 'btn-primary'}`}>
            {linking ? 'Making the link…' : again ? 'Copy a new link' : 'Copy link'}
          </button>
        </form>
      </div>
      {!emailConfigured && <p className="text-sm text-muted">{EMAIL_NOT_SET_UP}</p>}
      {linked.errors && (
        <p role="alert" className="text-sm text-danger">
          {linked.errors.join(' ')}
        </p>
      )}

      {open && (
        <form {...form} ref={focusFirstField} aria-label="Send the offer by email" className={panel}>
          <FormErrors errors={emailed.errors} />
          <div className="max-w-md">
            <label htmlFor={fid('to')} className="label">
              Send to
            </label>
            <input
              id={fid('to')}
              name="to"
              type="email"
              required
              autoComplete="off"
              aria-describedby={fid('to-hint')}
              defaultValue={valueOf(emailed, 'to', mail.to)}
              className="input"
            />
            <p id={fid('to-hint')} className="hint">
              The candidate&apos;s personal email. The email has the offer as a protected PDF and the link to accept or decline it; answers to it come
              back to you.
            </p>
          </div>
          {again && <p className="text-sm text-warn">Sending again makes a new link: the one sent before stops working.</p>}
          <div className="flex flex-wrap gap-3">
            <SubmitButton busy={emailing} pendingText="Sending…">
              Send
            </SubmitButton>
            <button type="button" onClick={() => setOpen(false)} disabled={emailing} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}

      {latest?.message && (
        <p role="status" className="text-sm text-ok">
          {latest.message}
        </p>
      )}
      {latest?.link && <LinkBox link={latest.link} mail={latest.via === 'email' && latest.to ? { ...mail, to: latest.to } : mail} />}
    </div>
  );
}

/** Extend: a new last day to accept (an expired offer opens again until then). */
export function ExtendOffer({ action, expiresOn, suggested }: { action: Action; expiresOn: string; suggested: string }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  if (!open) {
    return (
      <div className="space-y-1">
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
          Extend
        </button>
        {state.message && (
          <p role="status" className="text-xs text-ok">
            {state.message}
          </p>
        )}
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label="Extend the offer" className={panel}>
      <FormErrors errors={state.errors} />
      <div className="max-w-60">
        <label htmlFor={fid('expiresOn')} className="label">
          Open until
        </label>
        <DateInput
          id={fid('expiresOn')}
          name="expiresOn"
          required
          aria-describedby={fid('expiresOn-hint')}
          defaultValue={valueOf(state, 'expiresOn', formatDate(suggested))}
        />
      </div>
      <p id={fid('expiresOn-hint')} className="hint">
        The new last day to accept; it was {formatDate(expiresOn)}. The candidate&apos;s link stays the same.
      </p>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>Extend</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Withdraw, with the reason if HR gives one: the candidate's link stops working. */
export function WithdrawOffer({ action, number }: { action: Action; number: string }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-danger`}>
        Withdraw
      </button>
    );
  }
  return (
    <form
      {...form}
      onSubmit={(e) => {
        if (!window.confirm(`Withdraw offer ${number}? The candidate can no longer accept it.`)) {
          e.preventDefault();
          return;
        }
        form.onSubmit(e);
      }}
      ref={focusFirstField}
      aria-label={`Withdraw offer ${number}`}
      className={panel}
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason {optional}
        </label>
        <textarea
          id={fid('reason')}
          name="reason"
          rows={2}
          maxLength={1000}
          aria-describedby={fid('reason-hint')}
          defaultValue={valueOf(state, 'reason', '')}
          className="input"
        />
        <p id={fid('reason-hint')} className="hint">
          For HR&apos;s records, e.g. the position was filled. The candidate&apos;s page only says the offer was withdrawn.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Withdrawing…">
          Withdraw the offer
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Record an answer the candidate gave another way: by phone, in person or by email. Accepting makes the profile, as online. */
export function RecordAnswer({ action }: { action: Action }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  const [answer, setAnswer] = useState(() => valueOf(state, 'answer', ''));
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
        Record answer
      </button>
    );
  }
  return (
    <form
      {...form}
      onSubmit={(e) => {
        const text =
          answer === 'accepted'
            ? 'Record that the candidate accepted? Their profile, employment and a draft contract are made from the offer.'
            : 'Record that the candidate declined?';
        if (answer && !window.confirm(text)) {
          e.preventDefault();
          return;
        }
        form.onSubmit(e);
      }}
      ref={focusFirstField}
      aria-label="Record the candidate's answer"
      className={panel}
    >
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="label">The candidate</legend>
        <div className="flex flex-wrap gap-2">
          {(['accepted', 'declined'] as const).map((a) => (
            <label
              key={a}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
            >
              <input
                type="radio"
                name="answer"
                value={a}
                required
                checked={answer === a}
                onChange={() => setAnswer(a)}
                className="size-4 accent-accent"
              />
              {a === 'accepted' ? 'Accepted' : 'Declined'}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={fid('reason')} className="label">
          {answer === 'declined' ? 'Why they declined' : 'Note'} {optional}
        </label>
        <textarea id={fid('reason')} name="reason" rows={2} maxLength={1000} defaultValue={valueOf(state, 'reason', '')} className="input" />
        <p className="hint">E.g. how they answered (by phone, in person) and anything they said.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Recording…">
          Record
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
