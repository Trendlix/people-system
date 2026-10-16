'use client';

import { useState } from 'react';
import { firstJanuaryFrom, form2Problem } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { focusFirstField, useClosesOnSave } from './contract-buttons';
import { monthOf } from './raise';

// A step on a change of pay in the Contract section (owner's decisions, 16 October 2026): HR records the Form 2 filed
// once the CEO approves it. The CEO's decision is approvals/raise-decision-form.tsx, as on Approvals. The small form
// opens in place and closes once it went through; a refused one stays open with the reason.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

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
