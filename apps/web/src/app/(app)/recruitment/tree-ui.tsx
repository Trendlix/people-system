'use client';

import { FEEDBACK_MAX, REJECT_REASON_LABELS, STEP_OUTCOME_LABELS, STEP_OUTCOME_NOTES, type HoldOutcome, type RejectReason, type StepOutcome } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { holdBadge } from './tree';

// The recruitment tree's forms (owner, 3 November 2026: "Recrutment tree"; "Reason list + feedback"): the reasons of a
// rejection ticked (one or more) and the written feedback, the same wherever a step is decided or an applicant rejected;
// Decide on an applicant's page (its outcomes, the reasons once Rejected is chosen); HR's Reject from any step; the
// hold's badge.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** The reasons of a rejection to tick, one or more. */
export function ReasonPicker({ reasons, legend = 'Why they are rejected' }: { reasons: readonly RejectReason[]; legend?: string }) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {reasons.map((r) => (
          <label key={r} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
            <input type="checkbox" name="reasons" value={r} className="size-4 accent-accent" />
            {REJECT_REASON_LABELS[r]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The written feedback. */
export function FeedbackField({ id, label = 'Feedback' }: { id: string; label?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label} <span className="font-normal text-muted">(optional)</span>
      </label>
      <textarea id={id} name="feedback" rows={2} maxLength={FEEDBACK_MAX} className="input" />
    </div>
  );
}

/** Decide their step: an outcome, the reasons when Rejected, the feedback, and (HR) the rejection's email tick. */
export function DecideForm({ action, stageLabel, outcomes, reasons, emailOption }: { action: Action; stageLabel: string; outcomes: readonly StepOutcome[]; reasons: readonly RejectReason[]; emailOption: boolean }) {
  const [outcome, setOutcome] = useState<StepOutcome | ''>('');
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await action(prev, fd);
    if (next.message && !next.errors) setOutcome('');
    return next;
  }, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-line p-4">
      <h3 className="font-semibold">Decide {stageLabel}</h3>
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="sr-only">Outcome</legend>
        <div className="flex flex-wrap gap-2">
          {outcomes.map((o) => (
            <label key={o} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
              <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="size-4 accent-accent" />
              <span>
                {STEP_OUTCOME_LABELS[o]}
                {STEP_OUTCOME_NOTES[o] && <span className="block text-xs text-muted">{STEP_OUTCOME_NOTES[o]}</span>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {outcome === 'rejected' && <ReasonPicker reasons={reasons} />}
      <FeedbackField id={fid('feedback')} />
      {outcome === 'rejected' && emailOption && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="email" className="mt-1" />
          <span>Email the candidate</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !outcome} className={`btn ${outcome === 'rejected' || outcome === 'declined' ? 'btn-danger' : 'btn-primary'}`}>
          {pending ? 'Saving…' : 'Save decision'}
        </button>
        {state.message && !state.errors && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

/** HR's Reject from any step: its reasons, the feedback and the email tick, asked once Reject is pressed. */
export function RejectButton({ action, reasons, emailOption }: { action: Action; reasons: readonly RejectReason[]; emailOption: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await action(prev, fd);
    if (next.message && !next.errors) setOpen(false);
    return next;
  }, {});
  const fid = useFieldIds();
  if (!open) {
    return (
      <div className="space-y-1">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-danger">
          Reject
        </button>
        {state.message && !state.errors && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    );
  }
  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      <ReasonPicker reasons={reasons} />
      <FeedbackField id={fid('feedback')} />
      {emailOption && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="email" className="mt-1" />
          <span>Email the candidate</span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn btn-danger">
          {pending ? 'Rejecting…' : 'Reject'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "Unreachable", "Pending": kept at their step. */
export function HoldBadge({ hold, className = '' }: { hold: HoldOutcome | null | undefined; className?: string }) {
  const badge = holdBadge(hold);
  if (!badge) return null;
  return (
    <span className={`badge ${badge.className} ${className}`} title={badge.title}>
      {badge.label}
    </span>
  );
}
