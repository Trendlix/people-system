'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { Select } from '@/components/select';
import { LEAVE_PATH } from '@/components/nav';
import type { LeaveFilter } from './list';

// Leave Requests' Employee and Type filters (owner, 26 October 2026: "i need to filter either by employee or typ"): each a
// drop-down searched by typing; choosing one shows only its requests, beside the status chosen (?employee=<id>&type=<id>,
// so a link keeps them and a refresh too). A GET form, so it also works with the button alone; Clear filters goes back to
// the status alone. The people are those the user sees on this page (a C-level person only those who see them).

export function RequestFiltersForm({
  status,
  employeeId,
  type,
  people,
  types,
  filtered,
}: {
  status: LeaveFilter;
  employeeId: string | null;
  type: string | null;
  /** Null: the people couldn't be loaded, so the Employee filter is left out. */
  people: readonly { id: string; label: string }[] | null;
  types: readonly { value: string; label: string }[];
  filtered: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    // keyed by what is chosen, so following a link to other filters shows them, not what was picked before
    <form key={`${employeeId ?? ''}|${type ?? ''}`} ref={form} action={LEAVE_PATH} aria-label="Filter the requests" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="status" value={status} />
      {people && (
        <div className="min-w-56 flex-1 sm:max-w-xs">
          <label htmlFor="leave-filter-employee" className="label">
            Employee
          </label>
          <Select id="leave-filter-employee" name="employee" defaultValue={employeeId ?? ''} onChange={() => form.current?.requestSubmit()} className="input">
            <option value="">All employees</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="min-w-56 flex-1 sm:max-w-xs">
        <label htmlFor="leave-filter-type" className="label">
          Type
        </label>
        <Select id="leave-filter-type" name="type" defaultValue={type ?? ''} onChange={() => form.current?.requestSubmit()} className="input">
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          Filter
        </button>
      </noscript>
      {filtered && (
        <Link href={`${LEAVE_PATH}?status=${status}`} className="inline-flex min-h-11 items-center text-sm font-semibold">
          Clear filters
        </Link>
      )}
    </form>
  );
}
