'use client';

import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { formatDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { focusFirstField, useClosesOnSave } from '../../employees/[id]/contracts/contract-buttons';

// The actions on a run that take a few words: the CEO's Return with a reason, and HR's Mark as paid with the day the
// bank paid it. Each small form opens from its button and closes once its action went through; a refused one stays open
// with the reason. One-click actions (Refresh, Send to the CEO, Approve, Delete draft) use the profile's ActionButton.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';
const panel = 'w-full space-y-3 rounded-lg border border-line bg-canvas p-4';

/** The CEO returns the run to HR as a draft, saying why: HR sees the reason on the run. */
export function ReturnRun({ action, title }: { action: Action; title: string }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-secondary`}>
        Return with a reason
      </button>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Return ${title} to HR`} className={panel}>
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
          What HR should look at or change. The run goes back to HR as a draft, with this reason on it.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Returning…">
          Return to HR
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** HR marks an approved run paid: the day the bank paid it (today, to start with). */
export function MarkPaid({ action, today, title }: { action: Action; today: string; title: string }) {
  const { state, pending, form } = useKeptForm(action);
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${small} btn-primary`}>
        Mark as paid
      </button>
    );
  }
  return (
    <form {...form} ref={focusFirstField} aria-label={`Mark ${title} as paid`} className={panel}>
      <FormErrors errors={state.errors} />
      <div className="max-w-60">
        <label htmlFor={fid('paidOn')} className="label">
          Paid on
        </label>
        <DateInput id={fid('paidOn')} name="paidOn" required aria-describedby={fid('paidOn-hint')} defaultValue={valueOf(state, 'paidOn', formatDate(today))} />
      </div>
      <p id={fid('paidOn-hint')} className="hint">
        The day the bank paid the salaries. The run stays as it is; this records that it was paid.
      </p>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending} pendingText="Saving…">
          Mark as paid
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
