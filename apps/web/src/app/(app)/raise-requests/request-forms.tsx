'use client';

import { useActionState, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// The small forms of raise requests (owner's decisions, 16 October 2026): Request a raise, on the Employment tab for the
// employee themself, their direct manager and HR; and HR's Decline, with a reason, on the profile and the Raise
// Requests page. Each opens in place; one that went through closes and says so, one refused stays open with the reason.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Moves focus into the form when it opens (a stable function, so a later render doesn't move it again). */
const focusOnOpen = (el: HTMLTextAreaElement | null) => el?.focus();

/** Whether the last answer went through: the form then closes (the page has refreshed with it). */
function useClosesOnSuccess(state: FormState, close: () => void) {
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) close();
  }
}

function Done({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
      {message}
    </p>
  );
}

/**
 * Request a raise: why (required) and, for the employee and HR (`suggestsAmount`), the gross they suggest. A manager
 * states no amount: HR and the CEO set it.
 */
export function RequestRaiseForm({
  action,
  suggestsAmount,
  forSelf,
  name,
}: {
  action: Action;
  suggestsAmount: boolean;
  forSelf: boolean;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const fid = useFieldIds();
  useClosesOnSuccess(state, () => setOpen(false));

  if (!open) {
    return (
      <div className="space-y-3">
        <Done message={state.message} />
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-primary">
          Request a raise
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} aria-label={forSelf ? 'Request a raise' : `Request a raise for ${name}`} className="card max-w-2xl space-y-4 p-5">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Why the raise
        </label>
        <textarea
          ref={focusOnOpen}
          id={fid('reason')}
          name="reason"
          rows={4}
          required
          maxLength={2000}
          aria-describedby={fid('reason-hint')}
          defaultValue={valueOf(state, 'reason')}
          className="input"
        />
        <p id={fid('reason-hint')} className="hint">
          {forSelf
            ? 'What you have taken on or achieved, and since when. HR reads it first, then the CEO decides.'
            : `What ${name} has taken on or achieved, and since when. HR reads it first, then the CEO decides.`}
        </p>
      </div>
      {suggestsAmount ? (
        <div>
          <label htmlFor={fid('suggestedGross')} className="label">
            Suggested gross a month (EGP) <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id={fid('suggestedGross')}
            name="suggestedGross"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={fid('suggestedGross-hint')}
            defaultValue={valueOf(state, 'suggestedGross')}
            className="input max-w-xs tabular-nums"
          />
          <p id={fid('suggestedGross-hint')} className="hint">
            The monthly gross you suggest, without the allowances, e.g. 15,000. HR and the CEO decide the amount.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">A direct manager&apos;s request has no amount: HR and the CEO set it. You are told each decision here.</p>
      )}
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Sending…">
          Send request
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** HR's Decline, for a request with HR: the reason is required (the employee and their manager see it); asks first. */
export function DeclineRequestForm({ action, name }: { action: Action; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const fid = useFieldIds();
  useClosesOnSuccess(state, () => setOpen(false));

  if (!open) {
    return (
      <div className="space-y-2">
        <Done message={state.message} />
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-danger min-h-9 px-3">
          Decline<span className="sr-only"> the raise request for {name}</span>
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Decline the raise request for ${name}? The employee and their manager see your reason.`)) e.preventDefault();
      }}
      aria-label={`Decline the raise request for ${name}`}
      className="min-w-64 space-y-3 rounded-lg border border-line bg-canvas p-4"
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Why it is declined
        </label>
        <textarea
          ref={focusOnOpen}
          id={fid('reason')}
          name="reason"
          rows={3}
          required
          maxLength={1000}
          aria-describedby={fid('reason-hint')}
          defaultValue={valueOf(state, 'reason')}
          className="input"
        />
        <p id={fid('reason-hint')} className="hint">
          The employee and their manager see it.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn btn-danger">
          {pending ? 'Declining…' : 'Decline request'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
