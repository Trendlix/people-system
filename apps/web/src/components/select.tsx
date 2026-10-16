'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nextChoosable, shownOptions, startingOption, type ListOption } from '@/lib/select-search';

// A drop-down list that is searched by typing (owner's request, 16 October 2026: "make any drop list searchable when
// typing anything in the field"). Use it wherever a <select> would go, with the same props and <option>s: the page
// still has the real <select>, which the form sends, validates (required) and resets, and whose onChange fires as
// before. Only its list is different: clicking the field, or typing in it, opens a list with a search box over the
// options instead of the browser's own; every word typed narrows it (lib/select-search.ts). On a touch screen the
// phone's own picker opens, as it is easier to use there. A list of several choices (`multiple`) stays as it is.

interface Opened {
  /** The field it is the list of. */
  select: HTMLSelectElement;
  /** What was typed to open it, e.g. the first letter. */
  query: string;
}

/** The options of a <select> as the list shows them: the hidden ones left out, a disabled group's options disabled. */
function optionsOf(select: HTMLSelectElement): ListOption[] {
  return Array.from(select.options)
    .filter((o) => !o.hidden)
    .map((o) => {
      const group = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
      return { value: o.value, label: o.label || o.text, disabled: o.disabled || !!group?.disabled, group: group?.label ?? null };
    });
}

/** Chooses `value` in the <select> as a person would: the change and input events fire, so React's onChange runs. */
function choose(select: HTMLSelectElement, value: string) {
  if (select.value === value) return;
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Keys that open the list on the field, as they open the browser's own: Enter, Space, the arrows, F4. */
const OPENING_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4']);

export function Select({ ref, multiple, size, onMouseDown, onPointerDown, onKeyDown, children, ...props }: React.ComponentProps<'select'>) {
  const own = useRef<HTMLSelectElement | null>(null);
  const pointer = useRef<string>('mouse');
  const [opened, setOpened] = useState<Opened | null>(null);
  const plain = !!multiple || (size !== undefined && size > 1);

  const attach = useCallback(
    (el: HTMLSelectElement | null) => {
      own.current = el;
      if (typeof ref === 'function') return ref(el);
      if (ref) ref.current = el;
    },
    [ref],
  );

  const close = useCallback((refocus: boolean) => {
    setOpened(null);
    if (refocus) own.current?.focus();
  }, []);

  return (
    <>
      <select
        ref={attach}
        multiple={multiple}
        size={size}
        {...props}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
          onPointerDown?.(e);
        }}
        onMouseDown={(e) => {
          onMouseDown?.(e);
          if (plain || e.defaultPrevented || e.button !== 0 || e.currentTarget.disabled || pointer.current === 'touch') return;
          // the browser's own list would open on this press: ours opens instead (or closes, when it is open)
          e.preventDefault();
          if (opened) close(true);
          else setOpened({ select: e.currentTarget, query: '' });
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (plain || e.defaultPrevented || e.currentTarget.disabled || e.ctrlKey || e.metaKey) return;
          const typed = e.key.length === 1 && e.key !== ' ' && !e.altKey;
          if (!typed && !OPENING_KEYS.has(e.key)) return;
          e.preventDefault();
          setOpened({ select: e.currentTarget, query: typed ? e.key : '' });
        }}
      >
        {children}
      </select>
      {opened && <SearchList select={opened.select} query={opened.query} onClose={close} />}
    </>
  );
}

/** Where the list goes: under the field, or above it when there is more room there; never off the screen. */
interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const GAP = 4;
const MARGIN = 8;
const MAX_HEIGHT = 320;
const MIN_WIDTH = 240;

function placeUnder(select: HTMLSelectElement): Place {
  const box = select.getBoundingClientRect();
  const width = Math.min(Math.max(box.width, MIN_WIDTH), window.innerWidth - 2 * MARGIN);
  const left = Math.min(Math.max(box.left, MARGIN), window.innerWidth - width - MARGIN);
  const below = window.innerHeight - box.bottom - GAP - MARGIN;
  const above = box.top - GAP - MARGIN;
  return below >= Math.min(MAX_HEIGHT, 200) || below >= above
    ? { left, width, top: box.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) }
    : { left, width, bottom: window.innerHeight - box.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) };
}

/**
 * The open list: a search box and the options that match it, over the page, until one is chosen (a click, or Enter),
 * or it is closed (Esc, Tab, or a click anywhere else). The arrows move through the options; the one chosen is ticked.
 * Inside a pop-up window (a modal <dialog>) it is put in the window, as everything outside one can't be used.
 */
function SearchList({ select, query: typed, onClose }: { select: HTMLSelectElement; query: string; onClose: (refocus: boolean) => void }) {
  const id = useId();
  const [options] = useState(() => optionsOf(select));
  const [query, setQuery] = useState(typed);
  const shown = shownOptions(options, query);
  const [active, setActive] = useState(() => startingOption(shownOptions(options, typed), select.value));
  const [place, setPlace] = useState<Place>(() => placeUnder(select));
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const rtl = getComputedStyle(select).direction === 'rtl';

  // kept under the field while the page scrolls or the window changes size
  useLayoutEffect(() => {
    const follow = () => setPlace(placeUnder(select));
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [select]);

  // a press anywhere else closes it, leaving the focus where that press puts it (the field's own press closes it too)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !select.contains(target)) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [select, onClose]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  function pick(option: ListOption | undefined) {
    if (!option || option.disabled) return;
    choose(select, option.value);
    onClose(true);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => nextChoosable(shown, a, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      const step = e.key === 'PageDown' ? 1 : -1;
      setActive((a) => {
        let at = a;
        for (let i = 0; i < 8; i++) at = nextChoosable(shown, at, step);
        return at;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape') {
      // closes the list only, not a pop-up window it is in
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === 'Tab') {
      // back on the field, so that Tab goes on from there to the next one
      onClose(true);
    }
  }

  const listId = `${id}list`;
  const optionId = (i: number) => `${id}o${i}`;
  // a group's name above its first option shown
  const headings = shown.map((o, i) => (o.group !== null && o.group !== shown[i - 1]?.group ? o.group : null));

  return createPortal(
    <div
      ref={box}
      dir={rtl ? 'rtl' : undefined}
      style={{ position: 'fixed', left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
      className="z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-card text-sm text-ink shadow-lg"
    >
      <div className="border-b border-line p-1.5">
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          aria-label={`Search ${select.labels?.[0]?.textContent?.trim() || select.getAttribute('aria-label') || 'the list'}`}
          placeholder="Type to search"
          value={query}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setQuery(next);
            setActive(nextChoosable(shownOptions(options, next), -1, 1));
          }}
          onKeyDown={onKey}
          className="block min-h-9 w-full rounded-md border border-line bg-white px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <ul ref={list} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.length === 0 && <li className="px-3 py-2 text-muted">No matches</li>}
        {shown.map((o, i) => {
          const heading = headings[i];
          const chosen = o.value === select.value;
          return (
            <li key={i} role="presentation">
              {heading && (
                <div role="presentation" className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                  {heading}
                </div>
              )}
              <div
                id={optionId(i)}
                role="option"
                aria-selected={chosen}
                aria-disabled={o.disabled || undefined}
                data-active={i === active}
                // the search box keeps the focus
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => !o.disabled && i !== active && setActive(i)}
                onClick={() => pick(o)}
                className={`flex min-h-9 items-center justify-between gap-3 px-3 py-1.5 ${o.group !== null ? 'ps-5' : ''} ${
                  o.disabled ? 'cursor-default text-muted opacity-60' : 'cursor-pointer'
                } ${i === active ? 'bg-accent-soft' : ''} ${chosen ? 'font-semibold' : ''}`}
              >
                <span dir="auto" className="min-w-0 break-words">
                  {o.label || ' '}
                </span>
                {chosen && (
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-accent">
                    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                  </svg>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>,
    select.closest('dialog') ?? document.body,
  );
}
