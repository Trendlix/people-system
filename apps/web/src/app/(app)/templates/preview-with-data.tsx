'use client';

import { useId, useState } from 'react';
import { dataPreviewHref, personOption, previewPeopleHref, readPeople, type PreviewPerson } from './preview-people';

// "Preview with data" beside a version's Preview (owner's request, 15 October 2026: "When previewing a template, fetch
// any demo data already uploaded"): the version filled in with the data of the best person to preview it with, as a
// PDF in a new tab; and "Preview as…", which loads the people to choose from and opens the preview for the one chosen,
// or its Word file. The people are loaded only when asked: working out how much of the template each has filled in
// takes the server a moment. Nothing is saved; the API masks restricted data the viewer may not see.

const textButton = 'inline-flex min-h-9 items-center text-sm font-semibold whitespace-nowrap hover:underline disabled:cursor-not-allowed disabled:opacity-60';

const focusOnLoad = (el: HTMLSelectElement | null) => el?.focus();

type People = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; people: PreviewPerson[] } | { kind: 'failed'; message: string };

const NOT_LOADED = 'The people could not be loaded. Please try again.';

async function loadPeople(versionId: string): Promise<People> {
  try {
    const res = await fetch(previewPeopleHref(versionId), { cache: 'no-store' });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : NOT_LOADED;
      return { kind: 'failed', message };
    }
    return { kind: 'ok', people: readPeople(body) };
  } catch {
    return { kind: 'failed', message: NOT_LOADED };
  }
}

/** `label` names the version for screen readers, e.g. "v3 (Contract.docx)"; `align` lines the links up at the row's end or start. */
export function PreviewWithData({ versionId, label, align = 'end' }: { versionId: string; label: string; align?: 'start' | 'end' }) {
  const [people, setPeople] = useState<People>({ kind: 'idle' });
  const selectId = useId();
  const href = dataPreviewHref(versionId);

  async function load() {
    setPeople({ kind: 'loading' });
    setPeople(await loadPeople(versionId));
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      {/* a plain link: never prefetched */}
      <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-sm font-semibold whitespace-nowrap">
        Preview with data<span className="sr-only"> of {label}: filled in with an employee&apos;s data, as a PDF, in a new tab</span>
      </a>
      {people.kind === 'ok' && people.people.length > 0 ? (
        // a plain GET form: the chosen person's preview opens in a new tab, as many times as wanted
        <form action={href} method="get" target="_blank" className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
          <label htmlFor={selectId} className="text-sm whitespace-nowrap text-muted">
            Preview as<span className="sr-only"> ({label})</span>
          </label>
          <select ref={focusOnLoad} id={selectId} name="employeeId" defaultValue={people.people[0].id} className="input min-h-9 w-auto max-w-72 py-1">
            {people.people.map((p) => (
              <option key={p.id} value={p.id}>
                {personOption(p)}
              </option>
            ))}
          </select>
          <button type="submit" className={`${textButton} text-accent`}>
            Open<span className="sr-only"> the preview as a PDF, in a new tab</span>
          </button>
          <button type="submit" name="format" value="docx" className={`${textButton} text-accent`}>
            Word file<span className="sr-only"> of the preview, to download</span>
          </button>
        </form>
      ) : people.kind === 'ok' ? (
        <span className="text-sm text-muted">No one to preview with yet</span>
      ) : (
        <button type="button" onClick={load} disabled={people.kind === 'loading'} className={`${textButton} text-accent`}>
          {people.kind === 'loading' ? 'Loading people…' : 'Preview as…'}
          <span className="sr-only"> {label}: choose whose data</span>
        </button>
      )}
      {people.kind === 'failed' && (
        <p role="alert" className="max-w-xs text-xs text-danger">
          {people.message}
        </p>
      )}
    </div>
  );
}
