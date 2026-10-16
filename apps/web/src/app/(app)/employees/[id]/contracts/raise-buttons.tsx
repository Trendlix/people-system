'use client';

import { useState } from 'react';
import { firstJanuaryFrom, form2Problem } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { ActionButton, focusFirstField, useClosesOnSave } from './contract-buttons';
import { monthOf } from './raise';

// The steps on a change of pay in the Contract section (owner's decisions, 16 October 2026: "HR, then the CEO"): the
// CEO approves it, returns it to HR with a reason, or declines it with a reason (the draft is deleted), worded as a
// payroll run's and an ending's; HR records the Form 2 filed once it is approved. Each small form opens in place and
// closes once its action went through; a refused one stays open with the reason.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';
const panel = 'w-full max-w-xl space-y-3 rounded-lg border border-line bg-canvas p-4';

/** A reason and the button that sends it, with Cancel. */
function ReasonForm({
  action,
  label,
  hint,
  submitLabel,
  pendingText,
  danger = false,
  onCancel,
}: {
  action: Action;
  /** What the form is, for screen readers. */
  label: string;
  hint: string;
  submitLabel: string;
  pendingText: string;
  danger?: boolean;
  onCancel: () => void;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} ref={focusFirstField} aria-label={label} className={panel}>
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('reason')} className="label">
          Reason
        </label>
        <textarea
          id={fid('reason')}
          name="reason"
          rows={3}
          required
          maxLength={1000}
          aria-describedby={fid('reason-hint')}
          defaultValue={valueOf(state, 'reason', '')}
          className="input"
        />
        <p id={fid('reason-hint')} className="hint">
          {hint}
        </p>
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

/** The CEO's Approve (after a confirmation), Return with a reason and Decline with a reason, on a change of pay with the CEO. */
export function RaiseDecision({
  approve,
  returnToHr,
  decline,
  name,
  approveText,
}: {
  approve: (prev: FormState) => Promise<FormState>;
  returnToHr: Action;
  decline: Action;
  /** What it is, e.g. "the salary amendment of version 3 (CON-2026-0007-A1)". */
  name: string;
  /** The confirmation before approving. */
  approveText: string;
}) {
  const [open, setOpen] = useState<'return' | 'decline' | null>(null);
  if (open === 'return') {
    return (
      <ReasonForm
        action={returnToHr}
        label={`Return ${name} to HR`}
        hint="What HR should look at or change. It goes back to HR, with this reason on it, to change and send again."
        submitLabel="Return to HR"
        pendingText="Returning…"
        onCancel={() => setOpen(null)}
      />
    );
  }
  if (open === 'decline') {
    return (
      <ReasonForm
        action={decline}
        label={`Decline ${name}`}
        hint="HR sees this reason. The draft is deleted and the pay stays as it is; a raise request it was prepared from is declined with it."
        submitLabel="Decline the raise"
        pendingText="Declining…"
        danger
        onCancel={() => setOpen(null)}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionButton action={approve} pendingText="Approving…" variant="primary" confirmText={approveText}>
        Approve<span className="sr-only"> {name}</span>
      </ActionButton>
      <button type="button" aria-expanded={false} onClick={() => setOpen('return')} className={`${small} btn-secondary`}>
        Return with a reason<span className="sr-only">: {name}</span>
      </button>
      <button type="button" aria-expanded={false} onClick={() => setOpen('decline')} className={`${small} btn-danger`}>
        Decline<span className="sr-only"> {name}</span>
      </button>
    </div>
  );
}

/**
 * Record Form 2, on an approved raise (signed or not): the 1st of the month the insured wage follows the new pay from,
 * as filed with social insurance Form 2 (owner's decision, 16 October 2026: "From the next January unless amended in
 * Form 2"); from the effective date up to the next January. Left empty, none was filed after all.
 */
export function RecordForm2({ action, effective, form2From, name }: { action: Action; effective: string; form2From: string | null; name: string }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  const [typed, setTyped] = useState(() => valueOf(state, 'form2From', formatDate(form2From ?? effective)));
  const date = parseDate(typed);
  const problem = date ? form2Problem(date, effective) : date === null ? 'Enter the date as DD/MM/YYYY, e.g. 01/12/2026.' : null;

  if (!open) {
    return (
      <div className="space-y-1">
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center text-sm font-semibold">
          {form2From ? 'Change Form 2' : 'Record Form 2'}
          <span className="sr-only"> of {name}</span>
        </button>
        {state.message && (
          <p role="status" className="text-xs text-ok">
            {state.message}
          </p>
        )}
      </div>
    );
  }
  return (
    <form
      {...form}
      ref={focusFirstField}
      onChange={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.name === 'form2From') setTyped(e.target.value);
      }}
      aria-label={`Form 2 of ${name}`}
      className="w-72 space-y-3 rounded-lg border border-line bg-canvas p-3 whitespace-normal"
    >
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('form2From')} className="label">
          Insured wage follows from
        </label>
        <DateInput
          id={fid('form2From')}
          name="form2From"
          aria-describedby={`${fid('form2From-hint')}${problem ? ` ${fid('form2From-problem')}` : ''}`}
          defaultValue={typed}
        />
      </div>
      <p id={fid('form2From-hint')} className="hint">
        The 1st of the month given with the Form 2 filed (wage change), from {formatDate(effective)}. Without it, the insured wage follows the new pay from{' '}
        {monthOf(firstJanuaryFrom(effective))}. Leave empty if no Form 2 was filed.
      </p>
      <div role="status">
        {problem && (
          <p id={fid('form2From-problem')} className="hint text-warn">
            {problem}
          </p>
        )}
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
