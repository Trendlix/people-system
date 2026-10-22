'use client';

import { useActionState } from 'react';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';

// "Mark as labelled" for the label sheets (Assets step 5; spec §5: "after printing set labeled_at"): asked once the
// sheets came out right and the labels are stuck on, rather than on Print, so a sheet that didn't print isn't counted.

export function MarkPrintedForm({ codes, action }: { codes: readonly string[]; action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="codes" value={JSON.stringify(codes)} />
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !codes.length} className="btn btn-secondary">
          {pending ? 'Saving…' : `Mark ${codes.length} as labelled`}
        </button>
        {state.message && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
