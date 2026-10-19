'use client';

import { useActionState } from 'react';
import { Select } from '@/components/select';
import { useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';

// HR's choices on an attendance import's review (owner, 19 October 2026: a close name is HR's to confirm, "Did you mean
// …?"; none is HR's to pick or skip): Confirm a suggestion, choose someone else from the payroll's people, Skip, Undo
// (back to the match by name), and Apply, which asks first (attendance-imports in the API decides whose lines it fills).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';

function Refusal({ state }: { state: FormState }) {
  return state.errors ? (
    <p role="alert" className="max-w-sm text-xs text-danger">
      {state.errors.join(' ')}
    </p>
  ) : null;
}

/** One button sending the person's key with a choice: Confirm (an employee), Skip or Undo. */
export function ChoiceButton({
  action,
  personKey,
  employeeId,
  choice,
  label,
  srLabel,
  variant = 'secondary',
}: {
  action: Action;
  personKey: string;
  employeeId?: string;
  choice?: 'skip' | 'undo';
  label: string;
  srLabel?: string;
  variant?: 'primary' | 'secondary';
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="key" value={personKey} />
      {employeeId && <input type="hidden" name="employeeId" value={employeeId} />}
      {choice && <input type="hidden" name="choice" value={choice} />}
      <button type="submit" disabled={pending} className={`${small} ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}>
        {pending ? 'Saving…' : label}
        {srLabel && <span className="sr-only"> {srLabel}</span>}
      </button>
      <Refusal state={state} />
    </form>
  );
}

/** Choose who a person of the files is, from the payroll's people (searched by typing). */
export function PickPerson({
  action,
  personKey,
  zohoName,
  options,
}: {
  action: Action;
  personKey: string;
  zohoName: string;
  options: readonly { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="key" value={personKey} />
      <div className="min-w-56 flex-1">
        <label htmlFor={fid('employee')} className="label">
          Who is {zohoName}?
        </label>
        <Select id={fid('employee')} name="employeeId" required defaultValue="" className="input">
          <option value="" disabled>
            Choose the employee
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" disabled={pending} className={`${small} btn-secondary`}>
        {pending ? 'Saving…' : 'Choose'}
      </button>
      <Refusal state={state} />
    </form>
  );
}

/** Apply, after a confirmation; what it did shows under it. */
export function ApplyButton({ action, confirmText }: { action: () => Promise<FormState>; confirmText: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-2"
    >
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Applying…' : 'Apply to the payroll'}
      </button>
      <Refusal state={state} />
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
