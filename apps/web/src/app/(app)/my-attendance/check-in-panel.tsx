'use client';

import { useId, useRef, useState } from 'react';
import type { CheckInTodayView, PunchResultView } from '@/lib/attendance-types';
import { punchAttendance } from './actions';
import {
  buttonLabel,
  dayHoursText,
  dayTimesText,
  flagLabels,
  latestView,
  LOCATION_NOTE,
  OFFICE_NOT_SET_TEXT,
  placeLabel,
  punchBody,
  punchRows,
  readLocation,
  type PunchPhase,
} from './check-in';

// The Check in / Check out panel (owner, 19 October 2026: "Check-in through the system (phone or web with the office
// location check, or a device) to replace Zoho"): one big button, Check in or Check out as the day stands, mostly pressed
// on a phone. Each press asks the browser where it is, fresh ("Getting your location…"), then sends it ("Checking in…")
// with the press, never a time (the server's is the punch's), and says what the API kept in a status region: the time,
// office, remote or location unknown, a second check-in, a check-out without a check-in, a flag. Below it the day so far
// (the first check-in → the last check-out, the hours counted by the shift's rule) and today's punches with their place,
// the reading's accuracy and their flags. The page's data is read again after a press (the server action), and the
// newer of the page's view and the press's is shown. `compact`: the home page's card, without the punches' list.

export function CheckInPanel({ initial, compact = false }: { initial: CheckInTodayView; compact?: boolean }) {
  const [pressed, setPressed] = useState<PunchResultView | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<PunchPhase>('idle');
  const noteId = useId();
  const view = latestView(initial, pressed);
  const busy = phase !== 'idle';
  // a second tap while the first is on its way is ignored (the API keeps the same press twice in a minute once anyway)
  const going = useRef(false);

  async function press() {
    if (going.current) return;
    going.current = true;
    const kind = view.next;
    setErrors([]);
    setMessages([]);
    setPhase('locating');
    const location = await readLocation(typeof navigator === 'undefined' ? null : navigator.geolocation);
    setPhase('sending');
    try {
      const result = await punchAttendance(punchBody(kind, location));
      if ('errors' in result) setErrors(result.errors);
      else {
        setPressed(result.view);
        setMessages(result.view.messages);
      }
    } catch {
      setErrors(['The check-in couldn’t be sent: check your connection and try again.']);
    } finally {
      going.current = false;
      setPhase('idle');
    }
  }

  const day = view.day;
  const rows = punchRows(view.punches);
  const dayFlags = flagLabels(day?.flags);
  // the press's words in amber when what it kept is flagged or its place unknown, else in green
  const last = pressed ? [...pressed.punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1) : undefined;
  const warned = !!last && (last.flags.length > 0 || last.place === 'unknown');

  return (
    <div className="space-y-4">
      {view.expectedText && <p className="text-sm">{view.expectedText}</p>}

      <div>
        <button
          type="button"
          onClick={press}
          // not disabled while busy, so the focus stays on it for what is said next; a second press is ignored
          aria-disabled={busy || undefined}
          aria-describedby={noteId}
          className={`btn ${view.next === 'in' ? 'btn-primary' : 'btn-secondary border-accent text-accent'} min-h-14 w-full text-base sm:w-auto sm:min-w-60 ${busy ? 'cursor-wait opacity-60' : ''}`}
        >
          {buttonLabel(view.next, phase)}
        </button>
        <p id={noteId} className="hint max-w-md">
          {LOCATION_NOTE}
        </p>
      </div>

      {/* what the API kept, said as it comes (owner's brief: a status region) */}
      <div
        role="status"
        aria-live="polite"
        className={messages.length ? `rounded-lg px-4 py-3 text-sm ${warned ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}` : 'sr-only'}
      >
        {messages.length > 0 && (
          <ul className="space-y-1">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {errors.join(' ')}
        </div>
      )}

      {day && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Today so far</dt>
            <dd className="font-semibold tabular-nums">{dayTimesText(day)}</dd>
            {day.place && <dd className="text-xs text-muted">{placeLabel(day.place)}</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted">Hours counted</dt>
            <dd className="font-semibold tabular-nums">{dayHoursText(day)}</dd>
          </div>
          {dayFlags.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="sr-only">Flagged</dt>
              {dayFlags.map((f) => (
                <dd key={f} className="mr-1.5 inline-block">
                  <span className="badge bg-warn-soft whitespace-normal text-warn">{f}</span>
                </dd>
              ))}
            </div>
          )}
        </dl>
      )}

      {!compact && rows.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Today&apos;s Check-ins</h3>
          <ul className="mt-1 divide-y divide-line-soft text-sm">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span>
                  <span className="font-medium">{r.label}</span> <span className="tabular-nums">{r.time}</span>
                </span>
                <span className="text-muted">
                  {r.place}
                  {r.accuracy && <span className="tabular-nums"> · {r.accuracy}</span>}
                </span>
                {r.flags.length > 0 && (
                  <span className="flex w-full flex-wrap gap-1.5">
                    {r.flags.map((f) => (
                      <span key={f} className="badge bg-warn-soft whitespace-normal text-warn">
                        {f}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!view.officeLocationSet && <p className="text-xs text-muted">{OFFICE_NOT_SET_TEXT}</p>}
    </div>
  );
}
