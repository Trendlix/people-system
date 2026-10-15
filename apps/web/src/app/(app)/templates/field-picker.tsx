'use client';

import { useId, useState } from 'react';
import { TEMPLATE_TAGS } from '@trendlix/shared';
import { braces, knownTag, pickerGroups } from './mapping';
import { count } from './tag-check';

/**
 * Choosing a field for Map Fields: the tag list by group, as the tag reference shows it, with a search box (by tag, or
 * by English or Arabic label); each field with both labels, and restricted ones marked. One choice, as radio buttons
 * (the arrow keys move between them). The chosen field is named under the list, also while a search hides it.
 */
export function FieldPicker({ value, onChange, legend = 'Field', autoFocus = false }: { value: string | null; onChange: (tag: string) => void; legend?: string; autoFocus?: boolean }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const groups = pickerGroups(query);
  const shown = groups.reduce((n, g) => n + g.tags.length, 0);
  const chosen = value ? knownTag(value) : undefined;

  return (
    <fieldset className="min-w-0">
      <legend className="label">{legend}</legend>
      <label htmlFor={`${id}-search`} className="sr-only">
        Search fields
      </label>
      <input
        id={`${id}-search`}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search, e.g. national_id, salary or الاسم"
        autoComplete="off"
        spellCheck={false}
        // a panel opens on a click, to choose a field: the search box is where that starts
        autoFocus={autoFocus}
        aria-describedby={`${id}-count`}
        className="input"
      />
      <p id={`${id}-count`} role="status" className="hint">
        {query.trim() ? (shown ? `${count(shown, 'field')} of ${TEMPLATE_TAGS.length} match.` : `No fields match “${query.trim()}”.`) : `${count(TEMPLATE_TAGS.length, 'field')}.`}
      </p>
      {shown > 0 && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line bg-white">
          {groups.map((g) => (
            <div key={g.group} role="group" aria-labelledby={`${id}-${g.group}`}>
              <p id={`${id}-${g.group}`} className="sticky top-0 z-10 border-b border-line-soft bg-canvas px-3 py-1 text-xs font-semibold text-muted">
                {g.label}
              </p>
              {g.tags.map((t) => (
                <label
                  key={t.tag}
                  className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm hover:bg-canvas has-checked:bg-accent-soft"
                >
                  <input type="radio" name={`${id}-field`} value={t.tag} checked={value === t.tag} onChange={() => onChange(t.tag)} className="size-4 accent-accent" />
                  <code dir="ltr" className="font-mono text-xs text-accent">
                    {braces(t.tag)}
                  </code>
                  <span className="min-w-0 flex-1">{t.labelEn}</span>
                  <span lang="ar" dir="rtl" className="text-muted">
                    {t.labelAr}
                  </span>
                  {t.restricted && <span className="badge bg-warn-soft text-warn">Restricted</span>}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      {chosen && (
        <p className="hint">
          Chosen: <code className="font-mono">{braces(chosen.tag)}</code> · {chosen.labelEn}
          {chosen.restricted && ': restricted (national ID, salary or bank data), so only those who may see it can make a document with it'}
          {chosen.note && ` · ${chosen.note}`}
        </p>
      )}
    </fieldset>
  );
}
