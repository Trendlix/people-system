'use client';

import { useId, useState } from 'react';
import { Select } from '@/components/select';
import { choiceOption, choiceParam, dataPreviewHref, previewPeopleHref, readPeople, type PreviewChoice } from './preview-people';

// "Preview with data" beside a version's Preview (owner's request, 15 October 2026: "When previewing a template, fetch
// any demo data already uploaded"): the version filled in with the data of the best person to preview it with, as a
// PDF in a new tab; and "Preview as…", which loads the people to choose from and opens the preview for the one chosen,
// or saves it (Download PDF). Filled in, it is only ever a protected PDF, never a Word file (owner's request, 15 October
// 2026: "No doc file export, just a protected PDF"). The people are loaded only when asked: working out how much of the
// template each has filled in takes the server a moment. Nothing is saved; the API masks restricted data the viewer may not see. A job offer
// template (`offers`) is previewed with a job offer's data: the list holds the offers of its employment type, or the
// people while there is none.

const textButton = 'inline-flex min-h-9 items-center text-sm font-semibold whitespace-nowrap hover:underline disabled:cursor-not-allowed disabled:opacity-60';

const focusOnLoad = (el: HTMLSelectElement | null) => el?.focus();

type People = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; people: PreviewChoice[] } | { kind: 'failed'; message: string };

const NOT_LOADED = 'The list could not be loaded. Please try again.';

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

/**
 * `label` names the version for screen readers, e.g. "v3 (Contract.docx)"; `align` lines the links up at the row's end
 * or start; `offers`: a job offer template.
 */
export function PreviewWithData({
  versionId,
  label,
  align = 'end',
  offers = false,
}: {
  versionId: string;
  label: string;
  align?: 'start' | 'end';
  offers?: boolean;
}) {
  const [people, setPeople] = useState<People>({ kind: 'idle' });
  const selectId = useId();
  const href = dataPreviewHref(versionId);
  // the API answers one kind at a time: a job offer template's offers, or the people
  const kind = people.kind === 'ok' ? people.people[0]?.kind : undefined;
  const choices = people.kind === 'ok' ? people.people.filter((p) => p.kind === kind) : [];

  async function load() {
    setPeople({ kind: 'loading' });
    setPeople(await loadPeople(versionId));
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      {/* a plain link: never prefetched */}
      <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center text-sm font-semibold whitespace-nowrap">
        Preview with data<span className="sr-only"> of {label}: filled in with {offers ? "a job offer's" : "an employee's"} data, as a PDF, in a new tab</span>
      </a>
      {kind && choices.length > 0 ? (
        // a plain GET form: the chosen person's (or offer's) preview opens in a new tab, as many times as wanted
        <form action={href} method="get" target="_blank" className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
          <label htmlFor={selectId} className="text-sm whitespace-nowrap text-muted">
            Preview as<span className="sr-only"> ({label})</span>
          </label>
          <Select ref={focusOnLoad} id={selectId} name={choiceParam(kind)} defaultValue={choices[0].id} className="input min-h-9 w-auto max-w-72 py-1">
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {choiceOption(p)}
              </option>
            ))}
          </Select>
          <button type="submit" className={`${textButton} text-accent`}>
            Open<span className="sr-only"> the preview as a PDF, in a new tab</span>
          </button>
          <button type="submit" name="download" value="1" className={`${textButton} text-accent`}>
            Download PDF<span className="sr-only"> of the preview</span>
          </button>
        </form>
      ) : people.kind === 'ok' ? (
        <span className="text-sm text-muted">{offers ? 'No offer or employee to preview with yet' : 'No one to preview with yet'}</span>
      ) : (
        <button type="button" onClick={load} disabled={people.kind === 'loading'} className={`${textButton} text-accent`}>
          {people.kind === 'loading' ? (offers ? 'Loading offers…' : 'Loading people…') : 'Preview as…'}
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
