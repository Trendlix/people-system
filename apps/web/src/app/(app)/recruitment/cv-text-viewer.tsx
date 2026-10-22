'use client';

import { Fragment, useMemo, useState } from 'react';
import { useFieldIds } from '@/components/form';
import { findParts, foundText } from './cv-reading';

// "Show the CV's text" on the "From the CV" card (owner, 22 October 2026: "make the OCR egine reads the CV and analyse
// it"): the text kept from the CV, folded until opened, with words found in it marked as they're typed.

export function CvTextViewer({ text }: { text: string }) {
  const fid = useFieldIds();
  const [query, setQuery] = useState('');
  const { parts, count } = useMemo(() => findParts(text, query), [text, query]);
  const searching = query.trim().length >= 2;
  return (
    <details className="rounded-lg border border-line">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Show the CV&apos;s text</summary>
      <div className="space-y-3 border-t border-line px-4 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-sm">
            <label htmlFor={fid('find')} className="label">
              Find in the text
            </label>
            <input id={fid('find')} type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="input" autoComplete="off" />
          </div>
          <p className="pb-2 text-sm text-muted" aria-live="polite">
            {searching ? foundText(count) : ''}
          </p>
        </div>
        <pre dir="auto" className="max-h-[28rem] overflow-auto rounded-lg bg-canvas p-4 font-sans text-sm break-words whitespace-pre-wrap">
          {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}
        </pre>
      </div>
    </details>
  );
}
