'use client';

import { startTransition, useActionState } from 'react';
import { PAPERWORK_KINDS, PAPERWORK_LABELS, type PaperworkKind } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { limitFileSize, PAPERWORK_ACCEPT } from '../paperwork';
import { withSmallerPhotos } from '../shrink-photo';

// The HR-only parts of the employee file on the profile's Documents tab.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function UploadPaperworkForm({ action, defaultKind }: { action: Action; defaultKind: PaperworkKind }) {
  const [state, formAction, uploading] = useActionState(action, {});
  const fid = useFieldIds();

  // a photo is made smaller first (see shrink-photo.ts), then sent
  async function upload(fd: FormData) {
    const ready = await withSmallerPhotos(fd, ['file']);
    startTransition(() => formAction(ready));
  }

  return (
    <form action={upload} className="space-y-4">
      <div>
        <h3 className="font-semibold">Upload a Scan</h3>
        <p className="mt-1 text-sm text-muted">
          A photo (JPEG, PNG or WebP) or a PDF of up to 4 MB. On a phone you can take a photo. Reading the text takes a few seconds.
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('kind')} className="label">
            Document
          </label>
          <select id={fid('kind')} name="kind" defaultValue={defaultKind} className="input">
            {PAPERWORK_KINDS.map((k) => (
              <option key={k} value={k}>
                {PAPERWORK_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid('file')} className="label">
            File
          </label>
          <FileDrop id={fid('file')} name="file" accept={PAPERWORK_ACCEPT} required onChange={limitFileSize} />
        </div>
        <div>
          <label htmlFor={fid('documentNo')} className="label">
            Document number <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id={fid('documentNo')} name="documentNo" maxLength={60} autoComplete="off" className="input tabular-nums" />
        </div>
        <div>
          <label htmlFor={fid('expiresOn')} className="label">
            Expiry date <span className="font-normal text-muted">(optional)</span>
          </label>
          <DateInput id={fid('expiresOn')} name="expiresOn" aria-describedby={fid('expiresOn-hint')} defaultValue="" />
          <p id={fid('expiresOn-hint')} className="hint">
            For a paper that stops being valid, e.g. a criminal record certificate.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Uploading…" busy={uploading}>
          Upload
        </SubmitButton>
        {state.message && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

const textButton = 'inline-flex min-h-9 items-center text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-60';

/** Asks the OCR service to read the file again; shown while its text has not been read. */
export function RereadButton({ action, name }: { action: Action; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className={`${textButton} text-accent`}>
        {pending ? 'Reading…' : 'Read text again'}
        <span className="sr-only"> ({name})</span>
      </button>
      {state.errors && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}

export function DeleteFileButton({ action, name, confirmText }: { action: Action; name: string; confirmText: string }) {
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
        <span className="sr-only"> ({name})</span>
      </button>
      {state.errors && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {state.errors.join(' ')}
        </p>
      )}
    </form>
  );
}
