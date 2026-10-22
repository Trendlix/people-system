'use client';

import { useActionState, useState } from 'react';
import { APPLICATION_SOURCE_LABELS, RECRUITMENT_LIMITS, type ApplicationSource } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';

// Recruitment's buttons (owner, 22 October 2026: "where will we include the ATS?"): a vacancy's moves (sent to the CEO,
// approved, sent back or closed with a reason, held, reopened), deleting one nobody applied to, an applicant's stages
// (shortlisted, interview, rejected with a reason, restored), HR's notes, and copying a channel's apply link. The API
// checks each again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** A button doing one thing, with the API's reason if refused; `confirm`: asked first. */
export function ActionButton({ action, label, pendingLabel, kind = 'secondary', confirm }: { action: Action; label: string; pendingLabel: string; kind?: 'primary' | 'secondary' | 'danger'; confirm?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <FormErrors errors={state.errors} />
      <button type="submit" disabled={pending} className={`btn btn-${kind}`}>
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}

/** A button that opens a reason to type, then sends it: send back (required), close (optional), reject (required). */
export function ReasonButton({
  action,
  label,
  pendingLabel,
  reasonLabel,
  required,
  kind = 'secondary',
}: {
  action: Action;
  label: string;
  pendingLabel: string;
  reasonLabel: string;
  required: boolean;
  kind?: 'secondary' | 'danger';
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`btn btn-${kind}`}>
        {label}
      </button>
    );
  }
  return (
    <form action={formAction} className="w-full space-y-2 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      <label htmlFor={fid('reason')} className="label">
        {reasonLabel}
        {!required && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      <textarea id={fid('reason')} name="reason" rows={2} required={required} maxLength={RECRUITMENT_LIMITS.reason} className="input" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={`btn btn-${kind === 'danger' ? 'danger' : 'primary'}`}>
          {pending ? pendingLabel : label}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** HR's notes on an applicant. */
export function NotesForm({ action, notes }: { action: Action; notes: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <label htmlFor={fid('notes')} className="sr-only">
        Notes
      </label>
      <textarea id={fid('notes')} name="notes" rows={4} maxLength={RECRUITMENT_LIMITS.notes} defaultValue={notes ?? ''} className="input" placeholder="What stood out, what to ask at the interview …" />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Saving…' : 'Save notes'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/** A channel's apply link, with Copy. */
export function CopyLink({ source, href }: { source: ApplicationSource; href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{APPLICATION_SOURCE_LABELS[source]}</p>
        <p className="truncate text-xs text-muted">{href}</p>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(href);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt('Copy the link:', href);
          }
        }}
        className="btn btn-secondary min-h-9 px-3 text-sm"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </li>
  );
}
