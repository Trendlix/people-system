'use client';

import { useRef } from 'react';
import { Select } from '@/components/select';

// The calendar's department filter (owner, 18 October 2026: the month's calendar of who is off, "by department/team"):
// a department, or one of its teams, searched by typing; choosing one shows only its people (?department=<id>, so a link
// keeps it). A GET form, so it also works with the button alone; the month and the view stay as they are.

/** A department ("Marketing") or a team ("Marketing › Content Team"), as lib/departments.ts departmentOptions gives them. */
export interface DepartmentChoice {
  id: string;
  label: string;
}

export function CalendarDepartmentFilter({
  action,
  hidden,
  departments,
  chosen,
}: {
  action: string;
  hidden: Record<string, string>;
  departments: readonly DepartmentChoice[];
  chosen: string | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form key={chosen ?? ''} ref={form} action={action} className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="min-w-56">
        <label htmlFor="leave-calendar-department" className="label">
          Department or team
        </label>
        <Select
          id="leave-calendar-department"
          name="department"
          defaultValue={chosen ?? ''}
          onChange={() => form.current?.requestSubmit()}
          className="input"
        >
          <option value="">Everyone</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
      </div>
      <noscript>
        <button type="submit" className="btn btn-secondary">
          Show
        </button>
      </noscript>
    </form>
  );
}
