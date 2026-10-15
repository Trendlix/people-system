'use client';

import { PAPERWORK_KINDS, PAPERWORK_LABELS, RESTRICTED_PAPERWORK, type PaperworkKind } from '@trendlix/shared';
import { useActionState, useState } from 'react';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// Small forms inside the profile's tabs: deleting an employment from the history, and a paper's number, expiry and kind.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Moves focus into the form when it opens (a stable function, so a later render doesn't move it again). */
const focusOnOpen = (el: HTMLInputElement | null) => el?.focus();

const textButton = 'inline-flex min-h-9 items-center text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-60';

/** Delete, as a link-like button in a table row; asks first, and shows the API's reason if deleting is refused. */
export function DeleteRowButton({ action, name, confirmText }: { action: Action; name: string; confirmText: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <button type="submit" disabled={pending} className={`${textButton} text-danger`}>
        {pending ? 'Deleting…' : 'Delete'}
        <span className="sr-only"> {name}</span>
      </button>
      {state.errors && (
        <p role="alert" className="max-w-xs text-xs whitespace-normal text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}

/**
 * The kinds a paper can be moved to when it was uploaded as the wrong one (owner, 16 October 2026): any but the national
 * ID's sides, which come only from scanning the card (it reads the card into the profile).
 */
const MOVABLE_KINDS = PAPERWORK_KINDS.filter((k) => !RESTRICTED_PAPERWORK.includes(k));

/**
 * A paper's number and expiry (`children`: how they read now) with "Edit details" for HR, which opens a small form in
 * their place, its kind too (a paper uploaded as the wrong document is moved to the right one). Saving shows the new
 * values and closes it; a refused save keeps it open with the reason.
 */
export function PaperDetails({
  action,
  name,
  kind,
  documentNo,
  expiresOn,
  children,
}: {
  /** null: the details cannot be changed here (not HR, or nothing uploaded yet). */
  action: Action | null;
  name: string;
  kind: PaperworkKind;
  documentNo: string | null;
  /** DD/MM/YYYY, or "". */
  expiresOn: string;
  children: React.ReactNode;
}) {
  if (!action) return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{children}</div>;
  return (
    <EditablePaperDetails action={action} name={name} kind={kind} documentNo={documentNo} expiresOn={expiresOn}>
      {children}
    </EditablePaperDetails>
  );
}

function EditablePaperDetails({
  action,
  name,
  kind,
  documentNo,
  expiresOn,
  children,
}: {
  action: Action;
  name: string;
  kind: PaperworkKind;
  documentNo: string | null;
  expiresOn: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // a save that went through closes the form (the page then shows the new values)
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state.message) setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {children}
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={`${textButton} text-accent`}>
          Edit details<span className="sr-only"> of {name}</span>
        </button>
      </div>
    );
  }

  return (
    <form {...form} aria-label={`Details of ${name}`} className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        {MOVABLE_KINDS.includes(kind) && (
          <div className="sm:col-span-2">
            <label htmlFor={fid('kind')} className="label">
              Document type
            </label>
            <select
              id={fid('kind')}
              name="kind"
              aria-describedby={fid('kind-hint')}
              defaultValue={valueOf(state, 'kind', kind)}
              className="input sm:max-w-xs"
            >
              {MOVABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PAPERWORK_LABELS[k]}
                </option>
              ))}
            </select>
            <p id={fid('kind-hint')} className="hint">
              Uploaded as the wrong document? Choose the right one and the file moves there.
            </p>
          </div>
        )}
        <div>
          <label htmlFor={fid('documentNo')} className="label">
            Document number
          </label>
          <input
            ref={focusOnOpen}
            id={fid('documentNo')}
            name="documentNo"
            maxLength={60}
            autoComplete="off"
            defaultValue={valueOf(state, 'documentNo', documentNo)}
            className="input tabular-nums"
          />
        </div>
        <div>
          <label htmlFor={fid('expiresOn')} className="label">
            Expiry date
          </label>
          <DateInput id={fid('expiresOn')} name="expiresOn" aria-describedby={fid('expiresOn-hint')} defaultValue={valueOf(state, 'expiresOn', expiresOn)} />
          <p id={fid('expiresOn-hint')} className="hint">
            Leave empty if it does not expire.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton busy={pending}>Save details</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
