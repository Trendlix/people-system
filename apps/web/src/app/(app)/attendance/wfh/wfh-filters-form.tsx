'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { WFH_SOURCES } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { Select } from '@/components/select';
import { formatDate, parseDate } from '@/lib/format';
import { WFH_PATH, WFH_SOURCE_LABELS, wfhListHref, type WfhQuery } from './wfh';

// Work From Home's filters, as Leave Requests has them (owner, 26 October 2026: "add the filter here too, like we made on
// the other page"): an Employee, From and To (in place of the month), the department or team and where it came from, each
// applied once chosen (a day once whole, so a half-typed one doesn't reload the page), kept in the address with the status;
// Clear the filters goes back to the status alone. A GET form, so it works with the button alone without scripts.

export function WfhFiltersForm({
  q,
  people,
  places,
  filtered,
}: {
  q: WfhQuery;
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
      key={`${q.employeeId ?? ''}|${q.from ?? ''}|${q.to ?? ''}|${q.departmentId ?? ''}|${q.source ?? ''}`}
      ref={form}
      action={WFH_PATH}
      aria-label="Filter the work from home days"
      className="flex flex-wrap items-end gap-3"
    >
      {q.filter !== 'waiting' && <input type="hidden" name="status" value={q.filter} />}
      {people && (
        <div className="min-w-56 flex-1 sm:max-w-xs">
          <label htmlFor="wfh-employee" className="label">
            Employee
          </label>
          <Select id="wfh-employee" name="employee" defaultValue={q.employeeId ?? ''} onChange={submit} className="input">
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
        <label htmlFor="wfh-from" className="label">
          From
        </label>
        <DateInput id="wfh-from" name="from" defaultValue={q.from ? formatDate(q.from) : ''} onChange={dayChanged} />
      </div>
      <div className="w-full min-w-40 sm:w-44">
        <label htmlFor="wfh-to" className="label">
          To
        </label>
        <DateInput id="wfh-to" name="to" defaultValue={q.to ? formatDate(q.to) : ''} onChange={dayChanged} />
      </div>
      <div className="min-w-56 flex-1 sm:max-w-xs">
        <label htmlFor="wfh-department" className="label">
          Department or team
        </label>
        <Select id="wfh-department" name="department" defaultValue={q.departmentId ?? ''} onChange={submit} className="input">
          <option value="">Everyone</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-44">
        <label htmlFor="wfh-source" className="label">
          Came from
        </label>
        <Select id="wfh-source" name="source" defaultValue={q.source ?? ''} onChange={submit} className="input">
          <option value="">Anywhere</option>
          {WFH_SOURCES.map((s) => (
            <option key={s} value={s}>
              {WFH_SOURCE_LABELS[s]}
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
        <Link href={wfhListHref({ filter: q.filter })} className="inline-flex min-h-11 items-center text-sm font-semibold">
          Clear the filters
        </Link>
      )}
    </form>
  );
}
