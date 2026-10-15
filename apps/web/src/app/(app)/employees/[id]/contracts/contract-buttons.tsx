'use client';

import { useActionState, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { Contract, FormState } from '@/lib/types';

// Small actions on the profile's Contracts and Employment tabs: a button that runs one action (after a confirmation, if
// it needs one), signing a draft contract, and a signed contract's dates and note. The endings' own are in
// ../ending/ending-buttons.tsx.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';
const VARIANTS = { primary: 'btn-primary', secondary: 'btn-secondary', danger: 'btn-danger' } as const;

/** Moves focus to a small form's first field when it opens (a stable function, so a later render doesn't move it again). */
export const focusFirstField = (form: HTMLFormElement | null) => form?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus();

/** A small form that closes once its action went through (`state.message`); a refused one stays open with the reason. */
export function useClosesOnSave(state: FormState): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) setOpen(false);
  }
  return [open, setOpen];
}

/**
 * One button that runs an action, e.g. Confirm probation or Complete; asks `confirmText` first when given, and shows
 * the API's reason when it is refused. `disabled` with `disabledNote`: why it can't be pressed yet.
 */
export function ActionButton({
  action,
  children,
  pendingText,
  confirmText,
  variant = 'secondary',
  disabled = false,
  disabledNote,
}: {
  action: (prev: FormState) => Promise<FormState>;
  children: React.ReactNode;
  pendingText: string;
  confirmText?: string;
  variant?: keyof typeof VARIANTS;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-1"
    >
      <button
        type="submit"
        disabled={pending || disabled}
        aria-describedby={disabled && disabledNote ? fid('why') : undefined}
        className={`${small} ${VARIANTS[variant]}`}
      >
        {pending ? pendingText : children}
      </button>
      {disabled && disabledNote && (
        <p id={fid('why')} className="text-xs text-muted">
          {disabledNote}
        </p>
      )}
      {state.errors && (
        <p role="alert" className="max-w-sm text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}

/** Sign, on a draft: asks for the date it was signed (today, to start with). */
export function SignContract({ action, today, name }: { action: Action; today: string; name: string }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();

  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-primary`}>
        Sign<span className="sr-only"> {name}</span>
      </button>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Sign ${name}`} className="w-full space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="max-w-60">
        <label htmlFor={fid('signedOn')} className="label">
          Signed on
        </label>
        <DateInput
          id={fid('signedOn')}
          name="signedOn"
          required
          aria-describedby={fid('signedOn-hint')}
          defaultValue={valueOf(state, 'signedOn', formatDate(today))}
        />
      </div>
      <p id={fid('signedOn-hint')} className="hint">
        The day the employee and the company signed it. A first contract starts the probation it sets; a renewal replaces the version before it. A signed
        contract can&apos;t be changed, except its filing dates and note.
      </p>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Signing…">
          Mark as signed
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A signed contract's dates (signed, filed with the social insurance office and the labour office) and note, for HR. */
export function SignedContractDetails({ action, contract }: { action: Action; contract: Contract }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  const name = `contract ${contract.number}`;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
          Edit filing dates and note<span className="sr-only"> of {name}</span>
        </button>
        {state.message && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Filing dates and note of ${name}`} className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('signedOn')} className="label">
            Signed on
          </label>
          <DateInput id={fid('signedOn')} name="signedOn" required defaultValue={valueOf(state, 'signedOn', formatDate(contract.signedOn))} />
        </div>
        <div>
          <label htmlFor={fid('insuranceFiledOn')} className="label">
            Filed with social insurance on
          </label>
          <DateInput
            id={fid('insuranceFiledOn')}
            name="insuranceFiledOn"
            aria-describedby={fid('filed-hint')}
            defaultValue={valueOf(state, 'insuranceFiledOn', formatDate(contract.insuranceFiledOn))}
          />
        </div>
        <div>
          <label htmlFor={fid('labourOfficeFiledOn')} className="label">
            Filed with the labour office on
          </label>
          <DateInput
            id={fid('labourOfficeFiledOn')}
            name="labourOfficeFiledOn"
            aria-describedby={fid('filed-hint')}
            defaultValue={valueOf(state, 'labourOfficeFiledOn', formatDate(contract.labourOfficeFiledOn))}
          />
        </div>
      </div>
      <p id={fid('filed-hint')} className="hint">
        Leave a filing date empty until the copy is filed.
      </p>
      <div>
        <label htmlFor={fid('note')} className="label">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={500} defaultValue={valueOf(state, 'note', contract.note)} className="input" />
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>Save</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
