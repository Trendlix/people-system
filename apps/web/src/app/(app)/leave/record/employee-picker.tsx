'use client';

import { useRef } from 'react';
import { Select } from '@/components/select';
import { RECORD_LEAVE_PATH } from '../list';

// Who HR records leave for, first on Record leave (owner, 18 October 2026: leave recorded by HR on an employee's
// behalf, e.g. sick leave reported afterwards): everyone employed now, searched by typing; choosing one opens the form for
// them (?employee=<id>, so the address can be shared and the page reads their balance and shift). A GET form, so it also
// works with the button alone. Record permission (owner, 19 October 2026: HR records permission on an employee's behalf,
// as leave) uses it too, opening its own form (`action`, `what`), and Record a WFH day (owner, 21 October 2026: HR
// records a work from home day for someone, "with a warning and a reason").

export function LeaveEmployeePicker({
  options,
  chosen,
  action = RECORD_LEAVE_PATH,
  what = 'leave',
}: {
  options: readonly { id: string; label: string }[];
  chosen: string | null;
  /** The form it opens: Record leave's, Record permission's, or Record a WFH day's. */
  action?: string;
  what?: 'leave' | 'permission' | 'work from home day' | 'compensatory day';
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    // keyed by the one chosen, so following a link to another shows it, not what was picked before
    <form key={chosen ?? ''} ref={form} action={action} className="card flex flex-wrap items-end gap-3 p-5">
      <div className="min-w-64 flex-1">
        <label htmlFor="record-leave-employee" className="label">
          Employee
        </label>
        <Select
          id="record-leave-employee"
          name="employee"
          required
          defaultValue={chosen ?? ''}
          onChange={() => form.current?.requestSubmit()}
          aria-describedby="record-leave-employee-hint"
          className="input"
        >
          {!chosen && <option value="">Choose who the {what} is for</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <p id="record-leave-employee-hint" className="hint">
          Everyone employed now. Type to search.
        </p>
      </div>
      <button type="submit" className="btn btn-secondary">
        Choose
      </button>
    </form>
  );
}
