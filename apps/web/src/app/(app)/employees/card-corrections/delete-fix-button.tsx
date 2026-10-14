'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/types';

const textButton = 'inline-flex min-h-9 items-center text-sm font-semibold text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-60';

/** Forgets one learned fix, after asking; shows the API's reason if deleting is refused. */
export function DeleteFixButton({ action, name, confirmText }: { action: () => Promise<FormState>; name: string; confirmText: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <button type="submit" disabled={pending} className={textButton}>
        {pending ? 'Deleting…' : 'Delete'}
        <span className="sr-only"> the fix of {name}</span>
      </button>
      {state.errors && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}
