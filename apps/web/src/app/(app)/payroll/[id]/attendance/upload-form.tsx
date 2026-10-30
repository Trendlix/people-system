'use client';

import { useActionState, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { UPLOAD_ACCEPT, UPLOAD_MAX_MB, uploadProblems, ZOHO_MAX_FILES, ZOHO_MAX_MB } from './attendance';

// Uploading Zoho People's attendance entries on a draft run (owner, 19 October 2026: "Accept one file with everyone, or
// many files at once"): the files chosen together, checked here for a quick answer (their kind, size and number) and
// again by the API, which reads them by their content; once read, their review opens (actions.ts).

export function UploadAttendanceForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
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
      <div>
        <label htmlFor={fid('files')} className="label">
          Zoho People&apos;s attendance entries
        </label>
        <input
          id={fid('files')}
          name="files"
          type="file"
          multiple
          required
          accept={UPLOAD_ACCEPT}
          aria-describedby={fid('files-hint')}
          onChange={(e) => {
            setProblems([]);
            setChosen(e.target.files?.length ?? 0);
          }}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:text-sm file:font-semibold"
        />
        <p id={fid('files-hint')} className="hint">
          In Zoho People, export the month&apos;s attendance entries as Excel (XLSX): one file with everyone, or a file per person, up to {ZOHO_MAX_FILES}{' '}
          files of {ZOHO_MAX_MB} MB each and {UPLOAD_MAX_MB} MB in all at once. Only this payroll&apos;s month is read; days of another month are left
          out. Nothing changes on the payroll until you apply the review.
        </p>
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
