'use client';

import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';

// A Super Admin's Cancel of an approved correction (owner, 2 November 2026: "i want to cancel this"; "only super
// admin"), with why: the day goes back to the one it corrected. Asks first; the API checks the role, the payroll and the
// reason again.

export function HrCancelCorrectionForm({ action, what }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; what: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const [comment, setComment] = useState('');
  if (state.message) {
    return (
      <p role="status" className="text-sm text-ok">
        {state.message}
      </p>
    );
  }
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Cancel the ${what}? The day goes back to what it was.`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('comment')} className="label">
          Why it is cancelled
        </label>
        <textarea id={fid('comment')} name="comment" rows={2} maxLength={1000} required value={comment} onChange={(e) => setComment(e.target.value)} className="input" />
      </div>
      <button type="submit" disabled={pending || comment.trim() === ''} className="btn btn-danger">
        {pending ? 'Cancelling…' : 'Cancel the correction'}
      </button>
    </form>
  );
}
