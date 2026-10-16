'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { monthName } from './list';

/**
 * New payroll run (HR): the month, from 12 months back to next month; a month that has a run already is shown but
 * can't be chosen. Making it takes everyone employed in the month on a signed contract, then opens the run.
 */
export function NewRunForm({
  action,
  months,
  taken,
  suggested,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  /** Newest first. */
  months: string[];
  taken: string[];
  suggested: string | null;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  if (suggested === null) {
    return <p className="text-sm text-muted">Every month a run can be made for has one already.</p>;
  }
  return (
    <form {...form} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <label htmlFor={fid('month')} className="label">
            Month
          </label>
          <select id={fid('month')} name="month" required defaultValue={valueOf(state, 'month', suggested)} aria-describedby={fid('month-hint')} className="input">
            {months.map((m) => (
              <option key={m} value={m} disabled={taken.includes(m)}>
                {monthName(m)}
                {taken.includes(m) ? ' (has a run)' : ''}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton busy={pending} pendingText="Making the run…">
          New payroll run
        </SubmitButton>
      </div>
      <p id={fid('month-hint')} className="hint">
        Everyone employed in the month on a signed contract is on it, with the month&apos;s figures empty for you to type.
      </p>
    </form>
  );
}
