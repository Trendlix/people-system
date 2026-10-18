'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, addMonthsKeepingDay, MONTH_NAMES, monthGrid, shiftMonth, spokenDate, todayInCairo, WEEKDAY_NAMES, WEEKDAY_SHORT, yearPage } from '@/lib/date-picker';
import { formatDate, parseDate } from '@/lib/format';

// Date and time fields typed as DD/MM/YYYY and 12-hour time. The browser's own date and time pickers follow the
// computer's region settings (often MM/DD/YYYY or 24-hour), so plain text fields are used instead; the form
// action turns what was typed into the API's format with dateFrom / timeFrom (lib/form-data.ts).
//
// A date field also opens a mini calendar (owner, 19 October 2026: "open a date picker in a mini calendar when choosing
// any date"): clicking the field or its calendar button, or pressing ↓ in it, opens a month to choose a day from, with
// the months of a year and pages of years one click away for a far date (a birth date); choosing writes DD/MM/YYYY in
// the field as if typed, so the form's checks and onChange run as before. Typing still works, and the calendar follows
// what is typed. The arrows move through the days, Page Up / Page Down through the months (with Shift, the years),
// Enter chooses, Esc closes.

type FieldProps = {
  id: string;
  name: string;
  /** Already formatted for display: DD/MM/YYYY or "9:00 AM" (use formatDate / formatTime, or what was typed). */
  defaultValue: string;
  required?: boolean;
  'aria-describedby'?: string;
};

/** Writes `text` in the field as a person would: the input and change events fire, so React's onChange and onInput run. */
function typeInto(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

interface Opened {
  /** The field it is the calendar of. */
  input: HTMLInputElement;
  /** Opened from the keyboard: the focus goes to the day, not left in the field. */
  focusDay: boolean;
}

export function DateInput(props: FieldProps) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpened(null);
    if (refocus) field.current?.focus();
  }, []);

  return (
    <div className="relative">
      <input
        ref={field}
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        maxLength={10}
        className="input pe-11"
        onClick={(e) => !opened && setOpened({ input: e.currentTarget, focusDay: false })}
        onKeyDown={(e) => {
          if (opened || e.key !== 'ArrowDown') return;
          e.preventDefault();
          setOpened({ input: e.currentTarget, focusDay: true });
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Choose the date from a calendar"
        aria-haspopup="dialog"
        aria-expanded={opened !== null}
        // the field keeps the focus, so typing goes on
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (opened) return close(true);
          if (!field.current) return;
          field.current.focus();
          setOpened({ input: field.current, focusDay: false });
        }}
        className="absolute inset-y-0 end-0 flex w-11 cursor-pointer items-center justify-center rounded-e-lg text-muted hover:text-ink"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
          <path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" />
        </svg>
      </button>
      {opened && <Calendar input={opened.input} focusDay={opened.focusDay} onClose={close} />}
    </div>
  );
}

/** Where the calendar goes: under the field, or above it when there is more room there; never off the screen. */
interface Place {
  left: number;
  top?: number;
  bottom?: number;
}

const WIDTH = 296;
const HEIGHT = 380;
const GAP = 4;
const MARGIN = 8;

function placeUnder(input: HTMLInputElement): Place {
  const box = input.getBoundingClientRect();
  const left = Math.min(Math.max(box.left, MARGIN), window.innerWidth - WIDTH - MARGIN);
  const below = window.innerHeight - box.bottom - GAP - MARGIN;
  const above = box.top - GAP - MARGIN;
  return below >= HEIGHT || below >= above ? { left: Math.max(left, MARGIN), top: box.bottom + GAP } : { left: Math.max(left, MARGIN), bottom: window.innerHeight - box.top + GAP };
}

const monthOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

type View = 'days' | 'months' | 'years';

/**
 * The open calendar, over the page until a day is chosen (a click, or Enter), the field is cleared, or it is closed (Esc,
 * Tab, or a press anywhere else). Inside a pop-up window (a modal <dialog>) it is put in the window, as everything
 * outside one can't be used.
 */
function Calendar({ input, focusDay, onClose }: { input: HTMLInputElement; focusDay: boolean; onClose: (refocus: boolean) => void }) {
  const today = todayInCairo();
  const [chosen, setChosen] = useState<string | null>(() => parseDate(input.value) || null);
  const [active, setActive] = useState(() => chosen ?? today);
  const [shown, setShown] = useState(() => monthOf(chosen ?? today));
  const [view, setView] = useState<View>('days');
  const [yearsFrom, setYearsFrom] = useState(() => monthOf(chosen ?? today).year);
  const [place, setPlace] = useState<Place>(() => placeUnder(input));
  // each key that moves the active day counts one, and the focus goes to it (not when the mouse or the typing moved it)
  const [keyed, setKeyed] = useState(focusDay ? 1 : 0);
  const box = useRef<HTMLDivElement>(null);

  // kept under the field while the page scrolls or the window changes size
  useLayoutEffect(() => {
    const follow = () => setPlace(placeUnder(input));
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [input]);

  // the calendar follows what is typed; ↓ in the field goes to the days, Esc closes
  useEffect(() => {
    const typed = () => {
      const date = parseDate(input.value);
      setChosen(date || null);
      if (date) {
        setActive(date);
        setShown(monthOf(date));
        setView('days');
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setView('days');
        setKeyed((n) => n + 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // closes the calendar only, not a pop-up window it is in
        onClose(true);
      } else if (e.key === 'Tab') {
        onClose(false);
      }
    };
    input.addEventListener('input', typed);
    input.addEventListener('keydown', key);
    return () => {
      input.removeEventListener('input', typed);
      input.removeEventListener('keydown', key);
    };
  }, [input, onClose]);

  // a press anywhere else closes it, leaving the focus where that press puts it (the field and its button are its own)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !input.parentElement?.contains(target)) onClose(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [input, onClose]);

  useEffect(() => {
    if (keyed) box.current?.querySelector<HTMLButtonElement>('[data-date][tabindex="0"]')?.focus();
  }, [keyed]);

  function choose(date: string) {
    typeInto(input, formatDate(date));
    onClose(true);
  }

  /** Moves the active day by the keyboard, showing its month. */
  function moveTo(date: string) {
    setActive(date);
    setShown(monthOf(date));
    setKeyed((n) => n + 1);
  }

  function onDayKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const weekday = new Date(`${active}T00:00:00Z`).getUTCDay();
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(active, -1),
      ArrowRight: () => addDays(active, 1),
      ArrowUp: () => addDays(active, -7),
      ArrowDown: () => addDays(active, 7),
      Home: () => addDays(active, -weekday),
      End: () => addDays(active, 6 - weekday),
      PageUp: () => addMonthsKeepingDay(active, e.shiftKey ? -12 : -1),
      PageDown: () => addMonthsKeepingDay(active, e.shiftKey ? 12 : 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moveTo(moves[e.key]());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === 'Tab') {
      // back on the field, so that Tab goes on from there to the next one
      e.preventDefault();
      onClose(true);
    }
  }

  const step = (n: number) => {
    if (view === 'days') {
      const next = shiftMonth(shown.year, shown.month, n);
      setShown(next);
      setActive(addMonthsKeepingDay(active, n));
    } else if (view === 'months') setShown({ ...shown, year: shown.year + n });
    else setYearsFrom(yearsFrom + n * 12);
  };
  const years = yearPage(yearsFrom);
  const title =
    view === 'days' ? `${MONTH_NAMES[shown.month - 1]} ${shown.year}` : view === 'months' ? String(shown.year) : `${years[0]} – ${years[years.length - 1]}`;
  const stepWord = view === 'days' ? 'month' : view === 'months' ? 'year' : 'twelve years';

  const cell = 'flex cursor-pointer items-center justify-center rounded-md tabular-nums hover:bg-canvas focus-visible:outline-2 focus-visible:outline-accent';

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Choose a date"
      style={{ position: 'fixed', left: place.left, top: place.top, bottom: place.bottom, width: WIDTH }}
      className="z-50 rounded-lg border border-line bg-card p-3 text-sm text-ink shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" onClick={() => step(-1)} aria-label={`Previous ${stepWord}`} className={`${cell} size-9`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
            <path d="M12.5 4.5L7 10l5.5 5.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => {
            if (view === 'days') setView('months');
            else if (view === 'months') {
              setYearsFrom(shown.year);
              setView('years');
            }
          }}
          disabled={view === 'years'}
          aria-live="polite"
          aria-label={view === 'years' ? title : `${title}: choose ${view === 'days' ? 'the month' : 'the year'}`}
          className={`${cell} min-h-9 flex-1 px-2 font-semibold disabled:cursor-default disabled:hover:bg-transparent`}
        >
          {title}
        </button>
        <button type="button" onClick={() => step(1)} aria-label={`Next ${stepWord}`} className={`${cell} size-9`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
            <path d="M7.5 4.5L13 10l-5.5 5.5" />
          </svg>
        </button>
      </div>

      {view === 'days' && (
        <div role="grid" aria-label={title} onKeyDown={onDayKey}>
          <div role="row" className="grid grid-cols-7 text-center text-xs font-semibold text-muted">
            {WEEKDAY_SHORT.map((d, i) => (
              <span key={d} role="columnheader" aria-label={WEEKDAY_NAMES[i]} className="py-1">
                {d}
              </span>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, week) => (
            <div key={week} role="row" className="grid grid-cols-7">
              {monthGrid(shown.year, shown.month)
                .slice(week * 7, week * 7 + 7)
                .map((d) => {
                  const isChosen = d.date === chosen;
                  const isToday = d.date === today;
                  return (
                    <span key={d.date} role="gridcell" aria-selected={isChosen} className="p-0.5">
                      <button
                        type="button"
                        data-date={d.date}
                        tabIndex={d.date === active ? 0 : -1}
                        aria-label={spokenDate(d.date)}
                        aria-current={isToday ? 'date' : undefined}
                        onClick={() => choose(d.date)}
                        className={`${cell} size-9 w-full ${isChosen ? 'bg-accent font-semibold text-white hover:bg-accent' : ''} ${
                          !isChosen && isToday ? 'font-semibold text-accent ring-1 ring-accent ring-inset' : ''
                        } ${!d.inMonth && !isChosen ? 'text-muted opacity-60' : ''} ${d.date === active && !isChosen ? 'bg-accent-soft' : ''}`}
                      >
                        {d.day}
                      </button>
                    </span>
                  );
                })}
            </div>
          ))}
        </div>
      )}

      {view === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES.map((name, i) => {
            const here = shown.month === i + 1;
            return (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setShown({ year: shown.year, month: i + 1 });
                  setActive(addMonthsKeepingDay(active, (shown.year - monthOf(active).year) * 12 + (i + 1 - monthOf(active).month)));
                  setView('days');
                }}
                aria-label={`${name} ${shown.year}`}
                className={`${cell} min-h-11 ${here ? 'bg-accent-soft font-semibold' : ''}`}
              >
                {name.slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}

      {view === 'years' && (
        <div className="grid grid-cols-3 gap-1">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                setShown({ year: y, month: shown.month });
                setView('months');
              }}
              className={`${cell} min-h-11 tabular-nums ${y === shown.year ? 'bg-accent-soft font-semibold' : ''} ${y === monthOf(today).year ? 'text-accent' : ''}`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <button type="button" onClick={() => choose(today)} className="inline-flex min-h-9 cursor-pointer items-center rounded-md px-2 font-semibold text-accent hover:bg-canvas">
          Today
        </button>
        <button
          type="button"
          onClick={() => {
            typeInto(input, '');
            onClose(true);
          }}
          className="inline-flex min-h-9 cursor-pointer items-center rounded-md px-2 text-muted hover:bg-canvas hover:text-ink"
        >
          Clear
        </button>
      </div>
    </div>,
    input.closest('dialog') ?? document.body,
  );
}

export function TimeInput(props: FieldProps) {
  return <input {...props} type="text" autoComplete="off" placeholder="9:00 AM" maxLength={8} className="input" />;
}
