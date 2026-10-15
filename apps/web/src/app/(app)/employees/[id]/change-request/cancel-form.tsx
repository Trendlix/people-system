'use client';

import { useActionState } from 'react';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';

/** Cancel request, for the employee's request while it waits for HR. Asks first, and shows the API's reason if refused. */
export function CancelRequestForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Cancel this change request? HR will no longer be asked to decide on it.')) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Cancelling…' : 'Cancel request'}
      </button>
    </form>
  );
}
