'use client';

import { ZOHO_OD_TARGET, ZOHO_OD_TARGET_LABEL, ZOHO_WFH_TARGET, ZOHO_WFH_TARGET_LABEL } from '@trendlix/shared';
import { useActionState, useRef, useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import { Select } from '@/components/select';
import type { FormState } from '@/lib/types';
import { UPLOAD_ACCEPT, uploadProblem } from './import';

// The leave import's forms (owner, 21 October 2026: "how to import bulk leaves?"): the upload, checked here for a quick
// answer (an .xlsx of up to 5 MB) and again by the API, which reads it by its content; and a Zoho leave type's mapping,
// saved as soon as it is chosen (a searchable list: Skip, work-from-home days, which Working from home is by default,
// official duty days, which On Duty is by default (26 October 2026: "Import (template + Zoho)"),
// owner, 21 October 2026: "Yes, as approved WFH days", and the leave types on). The people's choices and Apply, Undo
// and Delete use the attendance import's and the contracts' buttons.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function UploadLeaveForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  const [problem, setProblem] = useState<string | null>(null);
  const fid = useFieldIds();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const box = e.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
        const found = uploadProblem(box?.files?.[0]);
        setProblem(found);
        if (found) e.preventDefault();
      }}
      className="space-y-4"
    >
      <FormErrors errors={problem ? [problem] : state.errors} />
      <div>
        <label htmlFor={fid('file')} className="label">
          The leave file
        </label>
        <input
          id={fid('file')}
          name="file"
          type="file"
          required
          accept={UPLOAD_ACCEPT}
          aria-describedby={fid('file-hint')}
          onChange={() => setProblem(null)}
          className="block w-full text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-white file:px-4 file:text-sm file:font-semibold"
        />
        <p id={fid('file-hint')} className="hint">
          The template filled in, or Zoho People&apos;s leave export as it is (Excel, .xlsx, up to 5 MB). Nothing is saved to anyone&apos;s leave until
          you apply the review.
        </p>
      </div>
      <SubmitButton pendingText="Reading the file…">Read the file</SubmitButton>
    </form>
  );
}

/** A Zoho leave type's mapping: the system's type its rows are imported as, work-from-home days, official duty days, or Skip; saved when chosen. */
export function TypeMapForm({
  action,
  zohoType,
  value,
  options,
  disabled,
}: {
  action: Action;
  zohoType: string;
  /** What it is imported as now: a type's id, ZOHO_WFH_TARGET (work-from-home days), ZOHO_OD_TARGET (official duty days), or 'skip'. */
  value: string;
  options: readonly { id: string; nameEn: string; kind: string }[];
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const fid = useFieldIds();
  const law = options.filter((o) => o.kind !== 'custom');
  const own = options.filter((o) => o.kind === 'custom');
  return (
    <form ref={form} action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="zohoType" value={zohoType} />
      <div className="min-w-56 flex-1">
        <label htmlFor={fid('type')} className="label">
          Imported as
        </label>
        <Select id={fid('type')} name="typeId" defaultValue={value} disabled={disabled || pending} onChange={() => form.current?.requestSubmit()} className="input">
          <option value="skip">Skip: not imported</option>
          <option value={ZOHO_WFH_TARGET}>{ZOHO_WFH_TARGET_LABEL}</option>
          <option value={ZOHO_OD_TARGET}>{ZOHO_OD_TARGET_LABEL}</option>
          <optgroup label="The law’s leave types">
            {law.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nameEn}
              </option>
            ))}
          </optgroup>
          {own.length > 0 && (
            <optgroup label="Your own types (Leave Setup)">
              {own.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameEn}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
      <button type="submit" disabled={disabled || pending} className="btn btn-secondary min-h-9 px-3">
        {pending ? 'Saving…' : 'Save'}
        <span className="sr-only"> the type for {zohoType}</span>
      </button>
      {state.errors && (
        <p role="alert" className="w-full text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}
