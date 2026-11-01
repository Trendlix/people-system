'use client';

import { useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { formatDate } from '@/lib/format';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { focusFirstField } from '../contracts/contract-buttons';

// The decisions on an ending, in its panel on the Employment tab: the CEO approves (with an optional note) or rejects
// (with a note saying why); HR withdraws one, e.g. when the employee withdraws the resignation. Each opens a small form
// in place; the panel then shows the new status.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

/** A note and the button that sends it, with Cancel. */
function NoteForm({
  action,
  label,
  noteLabel,
  required,
  submitLabel,
  pendingText,
  danger = false,
  onCancel,
}: {
  action: Action;
  /** What the form is, for screen readers. */
  label: string;
  noteLabel: string;
  required: boolean;
  submitLabel: string;
  pendingText: string;
  danger?: boolean;
  onCancel: () => void;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} ref={focusFirstField} aria-label={label} className="w-full max-w-xl space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('note')} className="label">
          {noteLabel} {!required && <span className="font-normal text-muted">(optional)</span>}
        </label>
        <textarea
          id={fid('note')}
          name="note"
          rows={3}
          maxLength={500}
          required={required}
          defaultValue={valueOf(state, 'note')}
          className="input"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        {danger ? (
          <button type="submit" disabled={pending} className="btn btn-danger">
            {pending ? pendingText : submitLabel}
          </button>
        ) : (
          <SubmitButton busy={pending} pendingText={pendingText}>
            {submitLabel}
          </SubmitButton>
        )}
        <button type="button" onClick={onCancel} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The CEO's Approve and Reject. */
export function EndingDecision({ approve, reject, name }: { approve: Action; reject: Action; name: string }) {
  const [open, setOpen] = useState<'approve' | 'reject' | null>(null);
  if (open === 'approve') {
    return (
      <NoteForm
        action={approve}
        label={`Approve ${name}`}
        noteLabel="Note"
        required={false}
        submitLabel="Approve the ending"
        pendingText="Approving…"
        onCancel={() => setOpen(null)}
      />
    );
  }
  if (open === 'reject') {
    return (
      <NoteForm
        action={reject}
        label={`Reject ${name}`}
        noteLabel="Why it is rejected"
        required
        submitLabel="Reject the ending"
        pendingText="Rejecting…"
        danger
        onCancel={() => setOpen(null)}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-expanded={false} onClick={() => setOpen('approve')} className={`${small} btn-primary`}>
        Approve<span className="sr-only"> {name}</span>
      </button>
      <button type="button" aria-expanded={false} onClick={() => setOpen('reject')} className={`${small} btn-danger`}>
        Reject<span className="sr-only"> {name}</span>
      </button>
    </div>
  );
}

/**
 * HR's and an Admin's agreed last working day (owner, 26 October 2026: "only by admin and HR"): set, changed or cleared
 * until the ending is completed. While it waits for the CEO the change is just saved; once approved it goes back to the
 * CEO, who is told what changed.
 */
export function ChangeLastDay({
  action,
  name,
  agreed,
  lastWorkingDay,
  approved,
}: {
  action: Action;
  name: string;
  /** The ending's last working day is an agreed one. */
  agreed: boolean;
  /** YYYY-MM-DD. */
  lastWorkingDay: string;
  /** The CEO already approved it: the change sends it back. */
  approved: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
        {agreed ? 'Change the agreed last working day' : 'Agree a last working day'}
        <span className="sr-only"> of {name}</span>
      </button>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Agreed last working day of ${name}`} className="w-full max-w-xl space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('agreedLastWorkingDay')} className="label">
          Agreed last working day
        </label>
        <DateInput
          id={fid('agreedLastWorkingDay')}
          name="agreedLastWorkingDay"
          defaultValue={agreed ? formatDate(lastWorkingDay) : valueOf(state, 'agreedLastWorkingDay')}
        />
      </div>
      <div>
        <label htmlFor={fid('note')} className="label">
          Why <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={500} defaultValue={valueOf(state, 'note')} className="input" />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Saving…">
          {approved ? 'Save and send back to the CEO' : 'Save'}
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** HR's Withdraw, while the ending waits for the CEO or is approved. */
export function WithdrawEnding({ action, name }: { action: Action; name: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
        Withdraw<span className="sr-only"> {name}</span>
      </button>
    );
  }
  return (
    <NoteForm
      action={action}
      label={`Withdraw ${name}`}
      noteLabel="Note"
      required={false}
      submitLabel="Withdraw the ending"
      pendingText="Withdrawing…"
      danger
      onCancel={() => setOpen(false)}
    />
  );
}
