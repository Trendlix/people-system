'use client';

import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

/**
 * Approve (note optional, asks first) or Reject (note required) for one thing waiting on Approvals: the CEO's for an
 * ending, HR's or an Admin's for a change request (a new photo's note is optional either way: `noteHint`). The button pressed is sent as `decision`; a refusal shows on the card.
 */
export function DecisionForm({
  action,
  confirmApprove,
  noteMax = 2000,
  noteHint = 'optional to approve, required to reject',
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** The question asked before approving, e.g. "Approve the end of Omar Khaled's employment? The last working day is 30/11/2026." */
  confirmApprove: string;
  /** The longest note the API takes. */
  noteMax?: number;
  /** When a note is needed, beside its label: a new photo's is optional either way (31 October 2026). */
  noteHint?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [pressed, setPressed] = useState<'approve' | 'reject' | null>(null);
  const fid = useFieldIds();

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const decision = button?.value === 'reject' ? 'reject' : 'approve';
        if (decision === 'approve' && !window.confirm(confirmApprove)) {
          e.preventDefault();
          return;
        }
        setPressed(decision);
      }}
      className="mt-4 space-y-3 border-t border-line-soft pt-4"
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('note')} className="label">
          Note <span className="font-normal text-muted">· {noteHint}</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={noteMax} defaultValue={valueOf(state, 'note')} className="input" />
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" name="decision" value="approve" disabled={pending} className="btn btn-primary">
          {pending && pressed === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button type="submit" name="decision" value="reject" disabled={pending} className="btn btn-danger">
          {pending && pressed === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </form>
  );
}
