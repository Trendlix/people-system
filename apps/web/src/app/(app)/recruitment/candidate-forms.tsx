'use client';

import { useActionState, useState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';

// "Merge with…" on a candidate's profile (owner, 22 October 2026: "the same email or mobile joins automatically; HR can
// merge what slips through"): the other candidate's code typed, then a confirmation; the other is merged into this one
// (its applications, general CVs, contacts and employee move here). The API checks again and audits it.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function MergeWithForm({ action, code }: { action: Action; code: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
        Merge with…
      </button>
    );
  }
  const typed = state.values?.code;
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const other = new FormData(e.currentTarget).get('code');
        if (!window.confirm(`Merge ${String(other ?? '').trim()} into ${code}? Its applications, general CVs, emails, mobiles and employee link move to ${code}. A Super Admin can undo it.`)) e.preventDefault();
      }}
      className="w-full max-w-md space-y-2 rounded-lg border border-line p-4"
    >
      <FormErrors errors={state.errors} />
      <label htmlFor={fid('code')} className="label">
        The other candidate’s code
      </label>
      <input id={fid('code')} name="code" required placeholder="CAN-0042" defaultValue={typeof typed === 'string' ? typed : ''} className="input" autoComplete="off" />
      <p className="text-xs text-muted">The other candidate is merged into {code}, which is kept.</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Merging…' : 'Merge'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
