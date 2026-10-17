'use client';

import { useRef } from 'react';
import { Select } from '@/components/select';
import { NEW_RAISE_REQUEST_PATH } from '../list';

// Who the raise is asked for, first on the request form (owner, 17 October 2026: raising a request moved to Requests →
// Raise Requests, "Under Requests"): the people the user may ask for, searched by typing; choosing one opens the form for
// them (?employee=<id>, so the address can be shared and the page reads what they may suggest). A GET form, so it also
// works with the button alone.

export interface PickerOption {
  id: string;
  label: string;
}

export function EmployeePicker({ options, chosen }: { options: readonly PickerOption[]; chosen: string | null }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    // keyed by the one chosen, so following a link to another shows it, not what was picked before
    <form key={chosen ?? ''} ref={form} action={NEW_RAISE_REQUEST_PATH} className="card flex flex-wrap items-end gap-3 p-5">
      <div className="min-w-64 flex-1">
        <label htmlFor="raise-request-employee" className="label">
          Employee
        </label>
        <Select
          id="raise-request-employee"
          name="employee"
          required
          defaultValue={chosen ?? ''}
          onChange={() => form.current?.requestSubmit()}
          aria-describedby="raise-request-employee-hint"
          className="input"
        >
          {!chosen && <option value="">Choose who the raise is for</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <p id="raise-request-employee-hint" className="hint">
          {options.length === 1 ? 'You may ask for a raise for yourself.' : 'Only the people you may ask for a raise for, employed now. Type to search.'}
        </p>
      </div>
      {options.length > 1 && (
        <button type="submit" className="btn btn-secondary">
          Choose
        </button>
      )}
    </form>
  );
}
