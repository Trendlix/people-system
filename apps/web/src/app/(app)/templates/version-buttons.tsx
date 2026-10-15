'use client';

import { useActionState, useId, useState } from 'react';
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

/**
 * Rename, under a version's file name (HR, Admin): a small form with the name without ".docx", which the API keeps.
 * Closes once saved; a refused name stays open with the reason.
 */
export function RenameFileButton({ action, fileName }: { action: Action; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await action(prev, fd);
    if (next.message) setOpen(false);
    return next;
  }, {});
  const stem = fileName.replace(/\.docx$/i, '');
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-accent hover:underline">
        Rename<span className="sr-only"> {fileName}</span>
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-1 flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`rename-${stem}`}>
        New file name
      </label>
      <input id={`rename-${stem}`} name="fileName" defaultValue={state.values?.fileName as string | undefined ?? stem} maxLength={150} required className="input min-h-9 w-56 py-1 text-sm" autoFocus />
      <span className="text-xs text-muted">.docx</span>
      <button type="submit" disabled={pending} className="btn btn-primary min-h-9 px-3 text-sm">
        {pending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary min-h-9 px-3 text-sm">
        Cancel
      </button>
      {state.errors && (
        <p role="alert" className="w-full text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}
