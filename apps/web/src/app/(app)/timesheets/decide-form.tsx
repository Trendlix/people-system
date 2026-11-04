'use client';

import { TIMESHEET_LIMITS } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// Deciding a week of hours (owner, 4 November 2026: "Direct manager, weekly"): Approve (a comment optional), or Reject
// with why; rejecting asks first. The API checks who decides again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const choice =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

export function TimesheetDecideForm({ action, name }: { action: Action; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [decision, setDecision] = useState(() => valueOf(state, 'decision'));
  const [comment, setComment] = useState(() => valueOf(state, 'comment'));
  const ready = decision === 'approve' || (decision === 'reject' && comment.trim() !== '');
  if (state.message && !state.errors) {
    return (
      <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
        {state.message}
      </p>
    );
  }
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (decision === 'reject' && !window.confirm(`Reject the hours of ${name}?`)) e.preventDefault();
      }}
      aria-label={`Decide on the hours of ${name}`}
      className="space-y-4"
    >
      <FormErrors errors={state.errors} />
      <fieldset>
        <legend className="label">Decision</legend>
        <div className="flex flex-wrap gap-2">
          <label className={choice}>
            <input type="radio" name="decision" value="approve" checked={decision === 'approve'} onChange={() => setDecision('approve')} className="size-4 accent-accent" />
            Approve
          </label>
          <label className={choice}>
            <input type="radio" name="decision" value="reject" checked={decision === 'reject'} onChange={() => setDecision('reject')} className="size-4 accent-accent" />
            Reject
          </label>
        </div>
      </fieldset>
      <div>
        <label htmlFor={fid('comment')} className="label">
          {decision === 'reject' ? 'Why you reject it' : 'Comment'} {decision !== 'reject' && <span className="font-normal text-muted">(optional)</span>}
        </label>
        <textarea
          id={fid('comment')}
          name="comment"
          rows={3}
          maxLength={TIMESHEET_LIMITS.reason}
          required={decision === 'reject'}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="input"
        />
      </div>
      <button type="submit" disabled={pending || !ready} className={`btn ${decision === 'reject' ? 'btn-danger' : 'btn-primary'} disabled:cursor-not-allowed disabled:opacity-60`}>
        {pending ? 'Saving…' : decision === 'reject' ? 'Reject the week' : 'Approve the week'}
      </button>
    </form>
  );
}
