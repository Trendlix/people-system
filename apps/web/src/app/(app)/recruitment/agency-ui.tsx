'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/types';

// HR's small buttons on marketing agencies (owner, 27 October 2026: "Name words + your list"): Mark as agency, Not an
// agency and Remove mark on a job of a CV's work history, and Remove on Recruitment Settings' list. Each asks first (a
// mark counts in every CV naming the company), then says the API's reason if refused; the page refreshes once done.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** A small button doing one thing, asked first, with the API's reason under it if refused. */
export function SmallActionButton({ action, label, pendingLabel, confirm, srLabel }: { action: Action; label: string; pendingLabel: string; confirm: string; srLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col gap-1"
    >
      <button type="submit" disabled={pending} className="btn btn-secondary min-h-9 px-3 text-sm">
        {pending ? pendingLabel : label}
        {srLabel && !pending && <span className="sr-only"> {srLabel}</span>}
      </button>
      {state.errors?.length ? (
        <span role="alert" className="text-xs text-danger">
          {state.errors.join(' ')}
        </span>
      ) : null}
    </form>
  );
}

/** A job's mark buttons, side by side. */
export function AgencyMarkButtons({ actions, company }: { actions: { key: string; action: Action; label: string; pendingLabel: string; confirm: string }[]; company: string }) {
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <SmallActionButton key={a.key} action={a.action} label={a.label} pendingLabel={a.pendingLabel} confirm={a.confirm} srLabel={`(${company})`} />
      ))}
    </div>
  );
}
