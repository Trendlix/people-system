'use client';

import { useActionState, useId } from 'react';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * Publish, for a draft (HR and Admin): asks first, as `confirmText` says. Disabled, with the reason beside it, while the
 * draft has unknown or broken tags (`blocked`); the API checks the tags again and its refusal shows here.
 */
export function PublishButton({ action, confirmText, blocked, label }: { action: Action; confirmText: string; blocked: string | null; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const reason = useId();
  if (blocked) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" disabled aria-describedby={reason} className="btn btn-primary">
          Publish<span className="sr-only"> {label}</span>
        </button>
        <p id={reason} className="text-sm text-danger">
          {blocked}
        </p>
      </div>
    );
  }
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Publishing…' : 'Publish'}
        <span className="sr-only"> {label}</span>
      </button>
    </form>
  );
}

/** Delete, for a draft in the list of versions: a Super Admin only. Asks first; the API's refusal shows beside it. */
export function DeleteDraftButton({ action, label, confirmText }: { action: Action; label: string; confirmText: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-9 items-center text-sm font-semibold text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Deleting…' : 'Delete'}
        <span className="sr-only"> {label}</span>
      </button>
      {state.errors && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}
