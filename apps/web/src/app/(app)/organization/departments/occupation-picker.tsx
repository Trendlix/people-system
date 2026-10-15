'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { occupationName, searchOccupations } from '@trendlix/shared';
import { listStatus, moveActive, occupationLabel, pickerOptions, startActive, typedQuery, type Occupation } from './occupation';

/**
 * A job title's Insurance occupation: one of the 3,052 occupations in the social insurance table, found by typing part
 * of its Arabic name or its code (spelt either way: أ or ا, ة or ه, ى or ي), then picked with the arrow keys and Enter, or
 * a click. An editable combobox with a list (WAI-ARIA's "list autocomplete with automatic selection"): the best match is
 * highlighted as you type, so Enter takes it; Esc puts back the one chosen; emptying the box and leaving it, or Clear,
 * chooses none.
 *
 * The job title form loads this lazily (next/dynamic), so the table ships only with the pages that have the picker.
 * The form gets the code in a hidden field named `name`, '' for none.
 */
export function OccupationPicker({
  id,
  name,
  defaultValue,
  describedBy,
}: {
  /** Goes on the text box, for the field's label. */
  id: string;
  name: string;
  /** The code chosen so far, if any. */
  defaultValue?: string | null;
  describedBy?: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(defaultValue ?? '');
  // what was typed; null while the box shows the occupation chosen
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const chosenName = occupationName(code);
  const label = occupationLabel(code, chosenName);
  const { options, more } = useMemo(() => {
    const chosen: Occupation | null = code && chosenName ? [code, chosenName] : null;
    return pickerOptions(query ?? '', chosen, searchOccupations);
  }, [query, code, chosenName]);
  const current = open && options.length ? Math.min(active, options.length - 1) : -1;
  const status = listStatus(query ?? '', options.length, more);
  const optionId = (c: string) => `${listId}-${c}`;

  // the option moved to stays in view as the list scrolls
  useEffect(() => {
    if (current < 0) return;
    document.getElementById(`${listId}-${options[current][0]}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, options, listId]);

  function openList() {
    setOpen(true);
    setActive(startActive(options, code));
  }

  function pick(o: Occupation) {
    setCode(o[0]);
    setQuery(null);
    setOpen(false);
  }

  function clear() {
    setCode('');
    setQuery(null);
    setOpen(false);
    input.current?.focus();
  }

  /** Leaves what was typed: an emptied box chooses none; anything else puts back the one chosen. */
  function settle() {
    if (query !== null && query.trim() === '') setCode('');
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const moved = moveActive(e.key, current, options.length);
    if (moved !== undefined) {
      e.preventDefault();
      if (!open) openList();
      else setActive(moved);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault(); // picks, rather than sending the form
      if (current >= 0) pick(options[current]);
      else settle();
    } else if (e.key === 'Escape' && (open || query !== null)) {
      e.preventDefault();
      setQuery(null);
      setOpen(false);
    }
  }

  return (
    <div className="relative max-w-lg">
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? optionId(options[current][0]) : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        // the chosen one reads "212300 · مدير مبيعات", code first; what is typed takes its own direction
        dir={query === null ? 'ltr' : 'auto'}
        value={query ?? label}
        placeholder="Type part of the name, or the code"
        onChange={(e) => {
          // typing in the chosen one starts a search of its own
          const deleted = (e.nativeEvent as InputEvent).inputType?.startsWith('delete') ?? false;
          const typed = query === null ? typedQuery(label, e.target.value, deleted) : e.target.value;
          setQuery(typed);
          setOpen(true);
          setActive(typed.trim() ? 0 : -1);
        }}
        onClick={(e) => {
          if (query === null) {
            // the whole of the chosen one is selected, so typing replaces it; a click opens the list, or closes it
            e.currentTarget.select();
            if (open) setOpen(false);
            else openList();
          } else if (!open) {
            openList();
          }
        }}
        onFocus={(e) => {
          if (query === null) e.currentTarget.select();
        }}
        onBlur={settle}
        onKeyDown={onKeyDown}
        className={`input ${code ? 'pr-10' : ''}`}
      />
      {code && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear the occupation"
          title="Clear"
          className="absolute top-0 right-0 flex size-11 items-center justify-center rounded-lg text-lg leading-none text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
      <input type="hidden" name={name} value={code} />

      {/* a press anywhere in the list, its scroll bar too, leaves the keyboard in the text box */}
      <div hidden={!open} onMouseDown={(e) => e.preventDefault()} className="absolute inset-x-0 z-20 mt-1 overflow-hidden rounded-lg border border-line bg-white shadow-lg">
        <ul id={listId} role="listbox" aria-label="Occupations" className={`max-h-72 overflow-y-auto ${options.length ? 'border-b border-line-soft py-1' : ''}`}>
          {options.map((o, i) => (
            <li
              key={o[0]}
              id={optionId(o[0])}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => {
                if (i !== current) setActive(i);
              }}
              onClick={() => pick(o)}
              className={`grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-3 px-3 py-1.5 text-sm ${i === current ? 'bg-accent-soft' : ''}`}
            >
              <span className={`font-mono text-xs tabular-nums ${o[0] === code ? 'font-semibold text-accent' : 'text-muted'}`}>
                {o[0]}
                {o[0] === code && <span className="sr-only"> (chosen)</span>}
              </span>
              <span lang="ar" dir="rtl" className={`text-right ${o[0] === code ? 'font-semibold' : ''}`}>
                {o[1]}
              </span>
            </li>
          ))}
        </ul>
        <p className="px-3 py-1.5 text-xs text-muted">{status}</p>
      </div>
      {/* the count, read out as the list changes */}
      <p role="status" className="sr-only">
        {open ? status : ''}
      </p>
    </div>
  );
}
