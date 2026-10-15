'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import { AdjustButton, type Adjusted } from '@/components/adjust/adjust-button';
import { DateInput } from '@/components/date-time-inputs';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import { FileCheck } from '@/components/scan/file-check';
import { ScanButton } from '@/components/scan/scan-dialog';
import type { ScanResult } from '@/lib/scan-helper';
import type { FormState } from '@/lib/types';
import { focusFirstField, useClosesOnSave } from '../contracts/contract-buttons';
import { limitFileSize, PAPERWORK_ACCEPT, PDF_MAX_BYTES } from '../../paperwork';
import { withSmallerPhotos } from '../../shrink-photo';
import { INPUT_LABELS, inputLabel, type CheckResult, type GenerateResult, type MissingLink } from './wording';

// The HR-only parts of a document row on the Contracts tab: Generate (check first, then what is typed and the date) and
// uploading the signed copy (chosen, dropped or scanned, checked, then confirmed).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const small = 'btn min-h-9 px-3';
const TRY_AGAIN = 'Cannot reach the server. Please try again in a moment.';

/** The details a template still lacks, each linked to where it is filled in. Nothing was generated. */
function MissingList({ missing }: { missing: MissingLink[] }) {
  return (
    <div role="alert" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      <p className="font-semibold">Fill these in first. Nothing was generated.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {missing.map((m, i) => (
          <li key={`${m.tag}-${i}`}>
            {m.href ? (
              <Link href={m.href} className="font-medium text-warn underline">
                {m.label}
              </Link>
            ) : (
              <span className="font-medium">{m.label}</span>
            )}
            {m.place && <span className="text-xs"> · {m.place}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Phase =
  | { at: 'closed' }
  | { at: 'checking' }
  | { at: 'missing'; missing: MissingLink[] }
  | { at: 'refused'; errors: string[] }
  | { at: 'form'; usesRestricted: boolean; errors?: string[] };

/**
 * Generate (or Generate again): first checks what the published template needs. If anything is missing it lists it,
 * each linked to where it is filled in, and generates nothing; otherwise it asks for what is typed (`needsInputs`, an
 * HR letter's "Addressed to" and "Purpose") and the document's date (today, to start with), then generates it.
 */
export function GenerateDocument({
  check,
  generate,
  name,
  needsInputs,
  today,
  again,
}: {
  check: () => Promise<CheckResult>;
  generate: (fd: FormData) => Promise<GenerateResult>;
  name: string;
  needsInputs: string[];
  /** DD/MM/YYYY */
  today: string;
  /** Documents were generated from it before: they stay, and this adds one. */
  again: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ at: 'closed' });
  const [done, setDone] = useState('');
  const [pending, start] = useTransition();
  const fid = useFieldIds();

  function runCheck() {
    setDone('');
    setPhase({ at: 'checking' });
    start(async () => {
      let result: CheckResult;
      try {
        result = await check();
      } catch {
        result = { errors: [TRY_AGAIN] };
      }
      if (result.errors?.length) setPhase({ at: 'refused', errors: result.errors });
      else if (result.missing?.length) setPhase({ at: 'missing', missing: result.missing });
      else setPhase({ at: 'form', usesRestricted: Boolean(result.usesRestricted) });
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      let result: GenerateResult;
      try {
        result = await generate(fd);
      } catch {
        result = { errors: [TRY_AGAIN] };
      }
      if (result.message) {
        setPhase({ at: 'closed' });
        setDone(result.message);
      } else if (result.missing?.length) {
        setPhase({ at: 'missing', missing: result.missing });
      } else {
        setPhase((p) => (p.at === 'form' ? { ...p, errors: result.errors } : { at: 'refused', errors: result.errors ?? [] }));
      }
    });
  }

  const close = () => setPhase({ at: 'closed' });

  if (phase.at === 'closed') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-expanded={false} onClick={runCheck} className={`${small} ${again ? 'btn-secondary' : 'btn-primary'}`}>
          {again ? 'Generate again' : 'Generate'}
          <span className="sr-only"> {name}</span>
        </button>
        {done && (
          <p role="status" className="text-sm text-ok">
            {done}
          </p>
        )}
      </div>
    );
  }

  if (phase.at !== 'form') {
    return (
      <div role="group" aria-label={`Generate ${name}`} className="w-full space-y-3 rounded-lg border border-line bg-canvas p-4">
        {phase.at === 'checking' && (
          <p role="status" className="text-sm text-muted">
            Checking the details the template needs…
          </p>
        )}
        {phase.at === 'missing' && <MissingList missing={phase.missing} />}
        {phase.at === 'refused' && <FormErrors errors={phase.errors} />}
        {phase.at !== 'checking' && (
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={runCheck} disabled={pending} className="btn btn-secondary">
              Check again
            </button>
            <button type="button" onClick={close} disabled={pending} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} ref={focusFirstField} aria-label={`Generate ${name}`} className="w-full space-y-4 rounded-lg border border-line bg-canvas p-4">
      <FormErrors errors={phase.errors} />
      {needsInputs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {needsInputs.map((tag) => {
            const hint = INPUT_LABELS[tag]?.hint;
            return (
              <div key={tag}>
                <label htmlFor={fid(tag)} className="label">
                  {inputLabel(tag)}
                </label>
                <input
                  id={fid(tag)}
                  name={tag}
                  required
                  maxLength={300}
                  autoComplete="off"
                  aria-describedby={hint ? fid(`${tag}-hint`) : undefined}
                  className="input"
                />
                {hint && (
                  <p id={fid(`${tag}-hint`)} className="hint">
                    {hint}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="max-w-60">
        <label htmlFor={fid('documentDate')} className="label">
          Document date <span className="font-normal text-muted">(optional)</span>
        </label>
        <DateInput id={fid('documentDate')} name="documentDate" defaultValue={today} aria-describedby={fid('documentDate-hint')} />
      </div>
      <p id={fid('documentDate-hint')} className="hint">
        The date written on the document: today, unless it should carry another date.
      </p>
      {phase.usesRestricted && <p className="text-sm text-muted">The template uses restricted details (the national ID, the salary or the bank account).</p>}
      {again && <p className="text-sm text-muted">The documents generated before stay as they are: this adds a new one.</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Generating…' : 'Generate'}
        </button>
        <button type="button" onClick={close} disabled={pending} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

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
 * Upload signed copy (or Upload again, before it is verified): a photo or a PDF chosen, dropped, pasted or scanned, shown
 * to be checked first (with Crop & adjust), then confirmed. The upload form of the employee file, for one document.
 */
export function UploadSignedCopy({ action, name, again }: { action: Action; name: string; again: boolean }) {
  const [state, formAction, uploading] = useActionState(action, {});
  const [open, setOpen] = useClosesOnSave(state);
  const fid = useFieldIds();
  const fileBox = useRef<HTMLInputElement>(null);
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

  // a photo is made smaller first (see shrink-photo.ts), then sent
  async function upload(fd: FormData) {
    const ready = await withSmallerPhotos(fd, ['file']);
    startTransition(() => formAction(ready));
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => {
            setChosen(null);
            setOpen(true);
          }}
          className={`${small} ${again ? 'btn-secondary' : 'btn-primary'}`}
        >
          {again ? 'Upload again' : 'Upload signed copy'}
          <span className="sr-only"> of {name}</span>
        </button>
        {state.message && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      action={upload}
      onReset={() => setChosen(null)}
      ref={focusFirstField}
      aria-label={`Upload the signed copy of ${name}`}
      className="w-full basis-full space-y-4 rounded-lg border border-line bg-canvas p-4"
    >
      <div>
        <h4 className="font-semibold">Signed Copy</h4>
        <p className="mt-1 text-sm text-muted">
          A photo (JPEG, PNG or WebP) or a PDF of up to 4 MB of the signed document, every page, or press Scan to scan it from an office scanner.
          {again && ' It replaces the signed copy uploaded before.'}
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('file')} className="label">
          File
        </label>
        <FileDrop ref={fileBox} id={fid('file')} name="file" accept={PAPERWORK_ACCEPT} required onChange={fileChanged}>
          {(take) => (
            <ScanButton
              title="Scan the Signed Copy"
              hint="Put the signed document face down on the glass, or its pages in the document feeder."
              purpose="document"
              maxBytes={PDF_MAX_BYTES}
              onScanned={(result) => scanned(take, result)}
            />
          )}
        </FileDrop>
      </div>
      {chosen && (
        <FileCheck
          file={chosen.file}
          pages={chosen.pages}
          scanned={chosen.scanned}
          problem={chosen.problem || undefined}
          onChooseAnother={chooseAnother}
          actions={
            <AdjustButton file={chosen.file} title={name} onAdjusted={adjusted} className="btn btn-secondary">
              Crop &amp; adjust
            </AdjustButton>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Uploading…" busy={uploading}>
          {chosen ? 'Confirm and upload' : 'Upload'}
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} disabled={uploading} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
