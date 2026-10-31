'use client';

import { useActionState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { chooseSource, clearSource, removeRecord, restoreRecord } from './actions';

// The Super Admin's buttons on a day's records (owner, 31 October 2026): Remove (with why), Restore, and which source the
// day uses (with why) or back to the usual. Each answer shown where it was pressed; the page reloads once done.

const REASON_MAX = 500;

/** Remove one record: why, then Remove. */
export function RemoveRecordForm({ employeeId, date, source, recordId, what }: { employeeId: string; date: string; source: string; recordId: string; what: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(removeRecord, {});
  const fid = useFieldIds();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-danger">Remove</summary>
      <form action={action} className="mt-2 space-y-2" aria-label={`Remove the ${what}`}>
        <input type="hidden" name="employeeId" value={employeeId} />
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="recordId" value={recordId} />
        <label htmlFor={fid('reason')} className="label">
          Why remove the {what}?
        </label>
        <input id={fid('reason')} name="reason" required maxLength={REASON_MAX} placeholder="E.g. A double press at the door" className="input" />
        <FormErrors errors={state.errors} />
        <button type="submit" disabled={pending} className="btn btn-danger min-h-10 px-3 text-xs">
          {pending ? 'Removing…' : `Remove the ${what}`}
        </button>
      </form>
    </details>
  );
}

/** Put a record removed back. */
export function RestoreRecordForm({ removalId }: { removalId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(restoreRecord, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="removalId" value={removalId} />
      <button type="submit" disabled={pending} className="btn btn-secondary min-h-9 px-3 text-xs">
        {pending ? 'Restoring…' : 'Restore'}
      </button>
      <FormErrors errors={state.errors} />
    </form>
  );
}

/** Which source the day uses: why, then Use Zoho's or Use the system's (the one not counting now). */
export function ChooseSourceForm({ employeeId, date, offer }: { employeeId: string; date: string; offer: ('zoho' | 'system')[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(chooseSource, {});
  const fid = useFieldIds();
  return (
    <form action={action} className="space-y-2" aria-label="Choose which records the day uses">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="date" value={date} />
      <label htmlFor={fid('reason')} className="label">
        Why
      </label>
      <input id={fid('reason')} name="reason" required maxLength={REASON_MAX} placeholder="E.g. The door reader missed the morning" className="input" />
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap gap-2">
        {offer.map((s) => (
          <button key={s} type="submit" name="source" value={s} disabled={pending} className="btn btn-secondary">
            {s === 'zoho' ? 'Use Zoho’s records' : 'Use the system’s records'}
          </button>
        ))}
      </div>
    </form>
  );
}

/** Back to the usual source for the day. */
export function ClearSourceForm({ employeeId, date }: { employeeId: string; date: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(clearSource, {});
  return (
    <form action={action}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="date" value={date} />
      <button type="submit" disabled={pending} className="btn btn-secondary">
        {pending ? 'Saving…' : 'Back to the usual'}
      </button>
      <FormErrors errors={state.errors} />
    </form>
  );
}
