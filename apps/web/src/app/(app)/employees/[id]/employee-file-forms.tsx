'use client';

import { startTransition, useActionState, useRef, useState } from 'react';
import { PAPERWORK_KINDS, PAPERWORK_LABELS, type PaperworkKind } from '@trendlix/shared';
import { DateInput } from '@/components/date-time-inputs';
import { AdjustButton, type Adjusted } from '@/components/adjust/adjust-button';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import { FileCheck } from '@/components/scan/file-check';
import { ScanButton } from '@/components/scan/scan-dialog';
import { Select } from '@/components/select';
import type { ScanResult } from '@/lib/scan-helper';
import type { FormState } from '@/lib/types';
import { limitFileSize, PAPERWORK_ACCEPT, PDF_MAX_BYTES } from '../paperwork';
import { withSmallerPhotos } from '../shrink-photo';

// The HR-only parts of the employee file on the profile's Documents tab.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What the upload form takes: everything but the national ID, which is scanned (both sides together) on its own page. */
const UPLOAD_KINDS = PAPERWORK_KINDS.filter((k) => k !== 'national_id_front' && k !== 'national_id_back');

/** Scanned in colour: a photo and a card. Other papers are scanned in greyscale, which is smaller and reads as well. */
const COLOUR_KINDS: readonly string[] = ['personal_photo', 'syndicate_card'];

/** The file on the file box, to check before it is sent: from the scanner (`pages` known) or chosen or dropped. */
interface Chosen {
  file: File;
  pages: number | null;
  scanned: boolean;
  /** Why the form will not send it (limitFileSize), or ''. */
  problem: string;
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size;

/**
 * Uploading a scan: a file chosen, dropped, pasted or scanned (Scan, beside the file box: the PDF is put on the box as a
 * chosen file is, so it is sent the same way). Every file is shown to be checked first; the button then confirms it.
 */
export function UploadPaperworkForm({ action, defaultKind }: { action: Action; defaultKind: PaperworkKind }) {
  const [state, formAction, uploading] = useActionState(action, {});
  const fid = useFieldIds();
  const fileBox = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(defaultKind);
  const [chosen, setChosen] = useState<Chosen | null>(null);

  function fileChanged(e: React.ChangeEvent<HTMLInputElement>) {
    limitFileSize(e);
    const file = e.currentTarget.files?.[0];
    setChosen(file ? { file, pages: null, scanned: false, problem: e.currentTarget.validationMessage } : null);
  }

  /** Use this scan: the PDF goes on the file box (which runs fileChanged), then is marked as scanned, with its pages. */
  function scanned(take: (file: File) => void, result: ScanResult) {
    take(result.file);
    setChosen((c) => (c && sameFile(c.file, result.file) ? { ...c, pages: result.pages, scanned: true } : c));
  }

  /** Crop & adjust: the adjusted file takes the place of the chosen one on the file box (which runs fileChanged). */
  function adjusted(file: File, info: Adjusted) {
    const box = fileBox.current;
    if (!box) return;
    const files = new DataTransfer();
    files.items.add(file);
    box.files = files.files;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    setChosen((c) => (c && sameFile(c.file, file) ? { ...c, pages: info.pages } : c));
  }

  /** Choose another: the file box is emptied, and has the focus, to choose, drop or scan another file. */
  function chooseAnother() {
    const box = fileBox.current;
    if (!box) return;
    box.value = '';
    box.dispatchEvent(new Event('change', { bubbles: true }));
    box.focus();
  }

  // The form is emptied after it is sent: so is what was being checked, and the document chosen goes back to the first
  // still missing, which is read once the fields have been put back (after this event).
  function emptied(e: React.FormEvent<HTMLFormElement>) {
    setChosen(null);
    const select = e.currentTarget.elements.namedItem('kind');
    setTimeout(() => {
      if (select instanceof HTMLSelectElement) setKind(select.value);
    });
  }

  // a photo is made smaller first (see shrink-photo.ts), then sent
  async function upload(fd: FormData) {
    const ready = await withSmallerPhotos(fd, ['file']);
    startTransition(() => formAction(ready));
  }

  return (
    <form action={upload} onReset={emptied} className="space-y-4">
      <div>
        <h3 className="font-semibold">Upload a Scan</h3>
        <p className="mt-1 text-sm text-muted">
          A photo (JPEG, PNG or WebP) or a PDF of up to 4 MB, or press Scan to scan it from an office scanner. On a phone you can take a photo.
          Reading the text takes a few seconds.
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('kind')} className="label">
            Document
          </label>
          <Select id={fid('kind')} name="kind" defaultValue={defaultKind} onChange={(e) => setKind(e.currentTarget.value)} className="input">
            {UPLOAD_KINDS.map((k) => (
              <option key={k} value={k}>
                {PAPERWORK_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={fid('file')} className="label">
            File
          </label>
          <FileDrop ref={fileBox} id={fid('file')} name="file" accept={PAPERWORK_ACCEPT} required onChange={fileChanged}>
            {(take) => (
              <ScanButton
                title="Scan a Document"
                hint="Put the document face down on the glass, or its pages in the document feeder."
                purpose={COLOUR_KINDS.includes(kind) ? 'photo' : 'document'}
                maxBytes={PDF_MAX_BYTES}
                onScanned={(result) => scanned(take, result)}
              />
            )}
          </FileDrop>
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
      {chosen && (
        <FileCheck
          file={chosen.file}
          pages={chosen.pages}
          scanned={chosen.scanned}
          problem={chosen.problem || undefined}
          onChooseAnother={chooseAnother}
          actions={
            <AdjustButton file={chosen.file} title={PAPERWORK_LABELS[kind as PaperworkKind] ?? 'Document'} onAdjusted={adjusted} className="btn btn-secondary">
              Crop &amp; adjust
            </AdjustButton>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Uploading…" busy={uploading}>
          {chosen ? 'Confirm and upload' : 'Upload'}
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
