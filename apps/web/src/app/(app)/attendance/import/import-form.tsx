'use client';

import { useActionState, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { UPLOAD_ACCEPT, uploadProblems } from '../../payroll/[id]/attendance/attendance';
import type { ImportMonthChoice } from '../attendance';

// The Import page's form (owner, 19 October 2026: "where am i going to import the sheets?"): the month, each saying what
// its payroll run is (a draft takes the files, none yet gets one, a locked one can't be chosen), and Zoho People's
// files, checked here for a quick answer (their kind, size and number) and again by the API, which reads them by their
// content; once read, their review opens (actions.ts).

export function ImportForm({ action, months, suggested }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; months: readonly ImportMonthChoice[]; suggested: string }) {
  const [state, formAction] = useActionState(action, {});
  const [problems, setProblems] = useState<string[]>([]);
  const [chosen, setChosen] = useState(0);
  const fid = useFieldIds();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const box = e.currentTarget.elements.namedItem('files') as HTMLInputElement | null;
        const found = uploadProblems(Array.from(box?.files ?? []));
        setProblems(found);
        if (found.length) e.preventDefault();
      }}
      className="space-y-4"
    >
      <FormErrors errors={problems.length ? problems : state.errors} />
      <div className="max-w-md">
        <label htmlFor={fid('month')} className="label">
          Month
        </label>
        <Select id={fid('month')} name="month" required defaultValue={valueOf(state, 'month', suggested)} className="input">
          {months.map((m) => (
            <option key={m.month} value={m.month} disabled={m.locked}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={fid('files')} className="label">
          Zoho People&apos;s attendance entries (XLSX)
        </label>
        <input
          id={fid('files')}
          name="files"
          type="file"
          multiple
          required
          accept={UPLOAD_ACCEPT}
          onChange={(e) => {
            setProblems([]);
            setChosen(e.target.files?.length ?? 0);
          }}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold"
        />
        {chosen > 0 && (
          <p role="status" className="mt-1 text-sm text-muted">
            {chosen} {chosen === 1 ? 'file' : 'files'} chosen
          </p>
        )}
      </div>
      <SubmitButton pendingText="Reading the files…">Read the files</SubmitButton>
    </form>
  );
}
