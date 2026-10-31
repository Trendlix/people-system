'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { Select } from '@/components/select';
import { LEAVE_PATH } from '@/components/nav';
import { formatDate, parseDate } from '@/lib/format';
import type { LeaveFilter } from './list';
import { ORDER_CHOICES, SEARCH_MAX, type RequestOrder } from './request-filters';

// Leave Requests' Employee and Type filters (owner, 26 October 2026: "i need to filter either by employee or typ"): each a
// drop-down searched by typing; choosing one shows only its requests, beside the status chosen (?employee=<id>&type=<id>,
// so a link keeps them and a refresh too). A GET form, so it also works with the button alone; Clear filters goes back to
// the status alone. The people are those the user sees on this page (a C-level person only those who see them). Then From
// and To (owner, 26 October 2026: "add date filter too (from - to)"): typed or chosen from the calendar, applied once a
// whole day is in (or the field emptied), so a half-typed day doesn't reload the page.

export function RequestFiltersForm({
  status,
  employeeId,
  type,
  from,
  to,
  order = 'department',
  q = '',
  people,
  types,
  filtered,
}: {
  status: LeaveFilter;
  employeeId: string | null;
  type: string | null;
  /** The first and last day chosen (YYYY-MM-DD), or none. */
  from: string | null;
  to: string | null;
  /** By department (grouped), or one list by date (owner, 31 October 2026: "allow me to sort by date without grouping"). */
  order?: RequestOrder;
  /** Words of a name or a code searched (owner, 31 October 2026: "allow me to search by name too"). */
  q?: string;
  /** Null: the people couldn't be loaded, so the Employee filter is left out. */
  people: readonly { id: string; label: string }[] | null;
  types: readonly { value: string; label: string }[];
  filtered: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  // a day applied once it is whole (or emptied): never on each key of one being typed
  const dayChanged = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (parseDate(e.target.value) !== null) form.current?.requestSubmit();
  };
  return (
    // keyed by what is chosen, so following a link to other filters shows them, not what was picked before
    <form key={`${employeeId ?? ''}|${type ?? ''}|${from ?? ''}|${to ?? ''}|${order}|${q}`} ref={form} action={LEAVE_PATH} aria-label="Filter the requests" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="status" value={status} />
      {/* a name or a code, searched on Enter or on leaving the field (owner, 31 October 2026: "search by name too") */}
      <div className="min-w-56 flex-1 sm:max-w-xs">
        <label htmlFor="leave-filter-q" className="label">
          Search
        </label>
        <input
          id="leave-filter-q"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={SEARCH_MAX}
          placeholder="A name, then Enter"
          autoComplete="off"
          className="input"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          onBlur={(e) => {
            if (e.currentTarget.value.trim() !== q) form.current?.requestSubmit();
          }}
        />
      </div>
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
      <div className="w-full min-w-40 sm:w-44">
        <label htmlFor="leave-filter-from" className="label">
          From
        </label>
        <DateInput id="leave-filter-from" name="from" defaultValue={from ? formatDate(from) : ''} onChange={dayChanged} />
      </div>
      <div className="w-full min-w-40 sm:w-44">
        <label htmlFor="leave-filter-to" className="label">
          To
        </label>
        <DateInput id="leave-filter-to" name="to" defaultValue={to ? formatDate(to) : ''} onChange={dayChanged} />
      </div>
      <div className="w-full min-w-48 sm:w-56">
        <label htmlFor="leave-filter-order" className="label">
          Order
        </label>
        <Select id="leave-filter-order" name="order" defaultValue={order} onChange={() => form.current?.requestSubmit()} className="input">
          {ORDER_CHOICES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
        <Link href={`${LEAVE_PATH}?status=${status}${order !== 'department' ? `&order=${order}` : ''}`} className="inline-flex min-h-11 items-center text-sm font-semibold">
          Clear filters
        </Link>
      )}
    </form>
  );
}
