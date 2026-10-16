'use client';

import { useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { useFieldIds } from '@/components/form';
import { formatDate, parseDate } from '@/lib/format';
import { fileHref } from '../files';

// The CIB Payroll System file, asked for with its value date: the day the bank is to pay the salaries (today, to start
// with). A plain GET form to the file's address under the web domain, which passes the file on from the API with the
// caller's session; the page stays where it is while the file is saved. The date is checked here first, so a mistake
// is shown in place rather than on a page of its own.

export function CibFileForm({ runId, today }: { runId: string; today: string }) {
  const fid = useFieldIds();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={fileHref(runId, 'cib')}
      method="get"
      onSubmit={(e) => {
        const typed = String(new FormData(e.currentTarget).get('valueDate') ?? '');
        if (!parseDate(typed)) {
          e.preventDefault();
          setError('Enter the value date as DD/MM/YYYY, e.g. 16/10/2026.');
        } else {
          setError(null);
        }
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="w-44">
        <label htmlFor={fid('valueDate')} className="label">
          Value date
        </label>
        <DateInput id={fid('valueDate')} name="valueDate" required aria-describedby={fid('valueDate-hint')} defaultValue={formatDate(today)} />
      </div>
      <button type="submit" className="btn btn-secondary">
        Download CIB file
      </button>
      <p id={fid('valueDate-hint')} className="hint w-full">
        The day CIB is to pay the salaries.
      </p>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
