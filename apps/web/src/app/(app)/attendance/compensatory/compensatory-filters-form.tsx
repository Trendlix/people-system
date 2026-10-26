'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import { COMPENSATORY_PATH, compensatoryListHref, type CompensatoryQuery } from './compensatory';

// Compensatory Days' filters, as Leave Requests has them (owner, 26 October 2026: "add the filter here too, like we made on
// the other page"): an Employee, From and To (in place of the month), the department or team and where it came from, each
// applied once chosen (a day once whole, so a half-typed one doesn't reload the page), kept in the address with the status;
// Clear the filters goes back to the status alone. A GET form, so it works with the button alone without scripts.

export function CompensatoryFiltersForm({
  q,
  people,
  places,
  filtered,
}: {
  q: CompensatoryQuery;
  /** Null: the people couldn't be loaded, so the Employee filter is left out. */
  people: readonly { id: string; label: string }[] | null;
  places: readonly { id: string; label: string }[];
  filtered: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const submit = () => form.current?.requestSubmit();
  const dayChanged = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (parseDate(e.target.value) !== null) submit();
  };
  return (
    // keyed by what is chosen, so following a link to other filters shows them, not what was picked before
    <form
      key={`${q.employeeId ?? ''}|${q.from ?? ''}|${q.to ?? ''}|${q.departmentId ?? ''}`}
      ref={form}
      action={COMPENSATORY_PATH}
      aria-label="Filter the compensatory days"
      className="flex flex-wrap items-end gap-3"
    >
      {q.filter !== 'waiting' && <input type="hidden" name="status" value={q.filter} />}
      {people && (
        <div className="min-w-56 flex-1 sm:max-w-xs">
          <label htmlFor="compensatory-employee" className="label">
            Employee
          </label>
          <Select id="compensatory-employee" name="employee" defaultValue={q.employeeId ?? ''} onChange={submit} className="input">
            <option value="">All employees</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="w-full min-w-40 sm:w-44">
        <label htmlFor="compensatory-from" className="label">
          From
        </label>
        <DateInput id="compensatory-from" name="from" defaultValue={q.from ? formatDate(q.from) : ''} onChange={dayChanged} />
      </div>
      <div className="w-full min-w-40 sm:w-44">
        <label htmlFor="compensatory-to" className="label">
          To
        </label>
        <DateInput id="compensatory-to" name="to" defaultValue={q.to ? formatDate(q.to) : ''} onChange={dayChanged} />
      </div>
      <div className="min-w-56 flex-1 sm:max-w-xs">
        <label htmlFor="compensatory-department" className="label">
          Department or team
        </label>
        <Select id="compensatory-department" name="department" defaultValue={q.departmentId ?? ''} onChange={submit} className="input">
          <option value="">Everyone</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          Show
        </button>
      </noscript>
      {filtered && (
        <Link href={compensatoryListHref({ filter: q.filter })} className="inline-flex min-h-11 items-center text-sm font-semibold">
          Clear the filters
        </Link>
      )}
    </form>
  );
}
