'use client';

import Link from 'next/link';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, useFieldIds } from '@/components/form';
import { formatDate, titleCase } from '@/lib/format';
import type { HolidayImportPreview } from '@/lib/types';
import type { HolidayImportState } from './actions';
import { holidaysHref, weekdayOf } from './holidays';
import {
  dayNote,
  IMPORT_ACCEPT,
  IMPORT_MAX_MB,
  IMPORT_MAX_ROWS,
  importButtonText,
  importCounts,
  importedYears,
  importFileProblem,
  importGroups,
  previewSummary,
  templateHref,
} from './import';

// Importing a year's holidays from a file (owner's request, 16 October 2026: "allow me to import yearly holiday list"),
// for HR and Admin, under the year's holidays on Organization → Holidays. Download the template, fill it in, choose it
// (or drop it in) and preview it: each day is shown with what will happen to it, grouped (new, already on file,
// clashes, in the file twice) and the rows with problems, and nothing is saved. "Import N holidays" then sends the same
// file again with the preview's fingerprint, and the new days are added (actions.ts). Choosing another file hides the
// preview until that one is previewed. The form keeps the file between the two steps (it sends itself rather than
// letting React reset it), and is emptied once imported. Closed, it is two buttons: Download template and Import
// holidays, which opens it.

type Step = 'preview' | 'import';

/** A preview: the summary, each group's days in a table, and the rows with problems. */
function ImportPreview({ preview }: { preview: HolidayImportPreview }) {
  const groups = importGroups(preview);
  return (
    <div className="space-y-5">
      <p className="text-sm font-medium">{previewSummary(preview)}</p>
      {groups.map((g) => (
        <section key={g.status} aria-label={g.title} className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold">
              {titleCase(g.title)} <span className="font-normal text-muted tabular-nums">({g.days.length})</span>
            </h4>
            <p className="hint">{g.intro}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="text-right">
                    Row
                  </th>
                  <th scope="col">Date</th>
                  <th scope="col">Name in English</th>
                  <th scope="col">Name in Arabic</th>
                  {(g.status === 'clash' || g.status === 'duplicate') && <th scope="col">Note</th>}
                </tr>
              </thead>
              <tbody>
                {g.days.map((d) => (
                  <tr key={`${d.row}-${d.date}`}>
                    <td className="text-right text-muted tabular-nums">{d.row}</td>
                    <td className="whitespace-nowrap">
                      <span className="font-semibold tabular-nums">{formatDate(d.date)}</span>
                      <span className="text-muted"> · {weekdayOf(d.date)}</span>
                    </td>
                    <td>{d.nameEn}</td>
                    <td>
                      {d.nameAr ? (
                        <bdi lang="ar" dir="rtl">
                          {d.nameAr}
                        </bdi>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    {(g.status === 'clash' || g.status === 'duplicate') && <td className="text-muted">{dayNote(d)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {preview.problems.length > 0 && (
        <section aria-label="Problems" className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold">
              {titleCase('Problems')} <span className="font-normal text-muted tabular-nums">({preview.problems.length})</span>
            </h4>
            <p className="hint">These rows aren’t imported. Put them right in the file and import it again: the days imported already are then skipped.</p>
          </div>
          <ul className="list-disc space-y-1 rounded-lg bg-danger-soft py-3 pr-4 pl-8 text-sm text-danger">
            {preview.problems.map((p, i) => (
              <li key={`${p.row}-${i}`}>{p.message}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ImportHolidays({ action, year }: { action: (prev: HolidayImportState, fd: FormData) => Promise<HolidayImportState>; year: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('preview');
  // the answer that no longer goes with the box (another file was chosen, it is being previewed again, or the box was
  // closed): its preview and message aren't shown
  const [staleFor, setStaleFor] = useState<HolidayImportState | null>(null);
  const current = staleFor !== state;
  const preview = current && state.preview ? state.preview : null;
  const fresh = preview ? importCounts(preview).new : 0;

  // emptied once imported (each answer is a new object)
  useEffect(() => {
    if (state.result) form.current?.reset();
  }, [state.result]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const next: Step = submitter?.getAttribute('value') === 'import' ? 'import' : 'preview';
    const fd = new FormData(e.currentTarget, submitter);
    setStep(next);
    if (next === 'preview') setStaleFor(state);
    startTransition(() => formAction(fd));
  }

  const otherYears = state.result ? importedYears(state.result).filter((y) => y !== year) : [];
  // a plain link, never prefetched: the API makes the workbook on each download
  const download = (
    <a href={templateHref(year)} className="btn btn-secondary">
      Download template
    </a>
  );

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {download}
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className="btn btn-secondary">
          Import holidays
        </button>
        <p className="hint">The year’s list from a file: fill in the template, then import it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="font-semibold">Import a Year’s Holidays</h3>
          <p className="mt-1 text-sm text-muted">
            Fill in the template, one row for each holiday (a holiday of several days, such as Eid al-Adha, is one row with its last day under Until),
            and import it as it is or saved as CSV. Up to {IMPORT_MAX_ROWS} rows and {IMPORT_MAX_MB} MB. You see what will happen to each day before
            anything is saved.
          </p>
        </div>
        {download}
      </div>

      <form ref={form} action={formAction} onSubmit={onSubmit} aria-label="Import holidays" className="space-y-4">
        <FormErrors errors={current ? state.errors : undefined} />
        <div>
          <label htmlFor={fid('file')} className="label">
            Holiday list (.xlsx or .csv)
          </label>
          <FileDrop
            id={fid('file')}
            name="file"
            accept={IMPORT_ACCEPT}
            required
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.setCustomValidity(file ? importFileProblem(file) : '');
              setStaleFor(state);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" name="step" value="preview" disabled={pending} className={`btn ${preview ? 'btn-secondary' : 'btn-primary'}`}>
            {pending && step === 'preview' ? 'Reading the file…' : preview ? 'Preview again' : 'Preview import'}
          </button>
          <button
            type="button"
            aria-expanded
            disabled={pending}
            onClick={() => {
              // the file goes with the box: a preview isn't shown again without it
              setStaleFor(state);
              setOpen(false);
            }}
            className="btn btn-secondary"
          >
            Close
          </button>
          {current && state.message && !pending && (
            <p role="status" className="text-sm text-ok">
              {state.message}
              {otherYears.map((y) => (
                <span key={y}>
                  {' '}
                  <Link href={holidaysHref(y)} className="font-semibold">
                    Show {y}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>

        {preview && (
          <div className="space-y-4 border-t border-line pt-4">
            <ImportPreview preview={preview} />
            <input type="hidden" name="fingerprint" value={preview.fingerprint} />
            <div className="flex flex-wrap items-center gap-3">
              {fresh > 0 ? (
                <button type="submit" name="step" value="import" disabled={pending} className="btn btn-primary">
                  {pending && step === 'import' ? 'Importing…' : importButtonText(fresh)}
                </button>
              ) : (
                <p className="text-sm text-muted">Nothing new to import from this file.</p>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
