'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '@/lib/types';

export function FormErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
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

export function SubmitButton({ children, pendingText = 'Saving…' }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? pendingText : children}
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

/** Value to show in a field: what the user just typed (after a failed save), else the saved value. */
export function valueOf(state: FormState, key: string, saved?: string | null): string {
  const typed = state.values?.[key];
  if (typeof typed === 'string') return typed;
  return saved ?? '';
}
