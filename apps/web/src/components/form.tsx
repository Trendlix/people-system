'use client';

import { startTransition, useActionState, useEffect, useId, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/lib/types';

export function FormErrors({ errors }: { errors?: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  // a refused save lists its reasons here, at the top of the form, while the person is at the button below: bring them
  // into view each time (owner, 15 October 2026: "editing a job offer is not saved" was a refusal out of sight)
  useEffect(() => {
    if (!errors?.length) return;
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.current?.focus({ preventScroll: true });
  }, [errors]);
  if (!errors?.length) return null;
  return (
    <div ref={box} tabIndex={-1} role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger outline-none">
      {errors.length === 1 ? (
        errors[0]
      ) : (
        <ul className="list-disc pl-4">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `busy`: also pending while something started by the form is still running (e.g. an upload after photos are resized). */
export function SubmitButton({
  children,
  pendingText = 'Saving…',
  busy = false,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingText?: string;
  busy?: boolean;
  /** Held back while what is typed can't be sent, e.g. past the law's limit (the form says why). */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || busy || disabled} className="btn btn-primary">
      {pending || busy ? pendingText : children}
    </button>
  );
}

/** Delete button that asks for confirmation and shows the API's reason if deleting is refused. */
export function DeleteForm({
  action,
  confirmText,
  label = 'Delete',
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  confirmText: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className="btn btn-danger">
        {pending ? 'Deleting…' : label}
      </button>
    </form>
  );
}

/**
 * A form whose fields keep what was chosen when the API refuses a save. React resets a form after its action has run,
 * which puts selects (and anything else not refilled from `state.values`) back to how they started. Spread `form` on
 * the `<form>`: its onSubmit sends the action itself and stops the submission, which React then leaves alone (no
 * reset); `action` is still there for a submission made before the page has loaded its scripts.
 */
export function useKeptForm(action: (prev: FormState, fd: FormData) => Promise<FormState>) {
  const [state, formAction, pending] = useActionState(action, {});
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }
  return { state, pending, form: { action: formAction, onSubmit } };
}

/** Value to show in a field: what the user just typed (after a failed save), else the saved value. */
export function valueOf(state: FormState, key: string, saved?: string | null): string {
  const typed = state.values?.[key];
  if (typeof typed === 'string') return typed;
  return saved ?? '';
}

/**
 * Unique field ids per form instance. Next.js keeps recently visited pages mounted (hidden) for
 * back/forward navigation, so fixed ids like "duties" could appear twice and break label links.
 */
export function useFieldIds(): (name: string) => string {
  const base = useId();
  return (name) => `${base}${name}`;
}
