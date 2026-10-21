'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { LOCATION_NEEDED_TEXT } from '@trendlix/shared';
import type { CheckInTodayView, PunchResultView } from '@/lib/attendance-types';
import { getPosition } from '@/lib/native';
import { useNativeApp } from '@/lib/use-native';
import { punchAttendance } from './actions';
import { CheckInCounter } from './check-in-counter';
import {
  buttonLabel,
  dayHoursText,
  dayPlaceLabel,
  dayTimesText,
  flagLabels,
  latestView,
  locationHelpText,
  LOCATION_NOTE,
  LOCATION_NOTE_IN_APP,
  networkNote,
  OFFICE_NOT_SET_TEXT,
  punchBody,
  punchRows,
  type PunchPhase,
} from './check-in';
import { appLocationRefusal, correctionLinkFor } from './network-lock';

// The Check in / Check out panel (owner, 19 October 2026: "Check-in through the system (phone or web with the office
// location check, or a device) to replace Zoho"): one big button, Check in or Check out as the day stands, mostly pressed
// on a phone. Each press asks the browser where it is, fresh ("Getting your location…"), then sends it ("Checking in…")
// with the press, never a time (the server's is the punch's), and says what the API kept in a status region: the time,
// office, remote or location unknown, a second check-in, a check-out without a check-in, a flag. Below it the day so far
// (the first check-in → the last check-out, the hours counted by the shift's rule) and today's punches with their place,
// the reading's accuracy and their flags. The page's data is read again after a press (the server action), and the
// newer of the page's view and the press's is shown. `compact`: the home page's card, without the punches' list. The
// location is read through the one bridge to the phone (lib/native.ts): the employee app's own when it has it, else the
// browser's. `big`: the phone pages' Home (owner, 20 October 2026: the employee app, "to enable them to check in and
// out"), a larger button across the screen and a larger counter. When the location couldn't be read, what to do about
// it is said under what was kept (inside the app: the phone's settings for Trendlix People; the app's Phase 2, "a clear
// message when refused"). Under the button, the check-in counter (owner, 20 October 2026: "employees need to see a
// checkin counter after their checkin", check-in-counter.tsx): the time worked so far while checked in, and the day's
// hours counted once checked out, in place of the hours counted below. Check-ins locked to the office network (owner, 20
// October 2026): a locked person is told so before pressing, and a press refused off it links to ask for a correction
// of the day. Inside the app a press without a location isn't sent (owner, 20 October 2026: "Refuse without location",
// "App only"): it says how to turn the location on; the API refuses it all the same. On the website, with Check-in
// Setup's switch refusing presses without a location for the person (owner, 20 October 2026: "Company switch +
// exceptions"), they are told before pressing to allow it when the browser asks, and a press refused for it says how to
// allow it in the browser and links to ask for a correction of the day. The spot is kept with each press (owner, the
// same day: "Yes, keep the spot"): the note under the button says so, and today's list opens each on a map.

export function CheckInPanel({ initial, compact = false, big = false }: { initial: CheckInTodayView; compact?: boolean; big?: boolean }) {
  const [pressed, setPressed] = useState<PunchResultView | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [help, setHelp] = useState<string | null>(null);
  const [phase, setPhase] = useState<PunchPhase>('idle');
  // refused off the office network or without a location: the day's correction a click away
  const [askCorrection, setAskCorrection] = useState(false);
  const pathname = usePathname();
  const inApp = useNativeApp();
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
    setHelp(null);
    setAskCorrection(false);
    setPhase('locating');
    const location = await getPosition();
    const help = 'locationError' in location ? locationHelpText(location.locationError, inApp) : null;
    // inside the app, no press without the location (20 October 2026)
    const refused = appLocationRefusal(inApp, location, help);
    if (refused) {
      setErrors(refused);
      going.current = false;
      setPhase('idle');
      return;
    }
    setHelp(help);
    setPhase('sending');
    try {
      const result = await punchAttendance(punchBody(kind, location));
      if ('errors' in result) {
        setErrors(result.errors);
        setAskCorrection(!!result.offNetwork || !!result.noLocation);
      } else {
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
      {view.network?.locked && <p className="text-sm">{networkNote(view)}</p>}
      {/* on the website, when the company refuses presses without a location for them (inside the app it is always needed) */}
      {view.location?.required && !inApp && <p className="text-sm">{LOCATION_NEEDED_TEXT}</p>}

      <div>
        <button
          type="button"
          onClick={press}
          // not disabled while busy, so the focus stays on it for what is said next; a second press is ignored
          aria-disabled={busy || undefined}
          aria-describedby={noteId}
          className={`btn ${view.next === 'in' ? 'btn-primary' : 'btn-secondary border-accent text-accent'} ${big ? 'min-h-16 w-full rounded-xl text-lg' : 'min-h-14 w-full text-base sm:w-auto sm:min-w-60'} ${busy ? 'cursor-wait opacity-60' : ''}`}
        >
          {buttonLabel(view.next, phase)}
        </button>
        <p id={noteId} className="hint max-w-md">
          {inApp ? LOCATION_NOTE_IN_APP : LOCATION_NOTE}
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
            {help && <li>{help}</li>}
          </ul>
        )}
      </div>
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {errors.join(' ')}
          {askCorrection && (
            <>
              {' '}
              <Link href={correctionLinkFor(pathname, view.date)} className="font-semibold text-danger">
                Ask for a correction
              </Link>
            </>
          )}
        </div>
      )}

      <CheckInCounter view={view} big={big} />

      {day && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Today so far</dt>
            <dd className="font-semibold tabular-nums">{dayTimesText(day)}</dd>
            {day.place && <dd className="text-xs text-muted">{dayPlaceLabel(day, view.punches)}</dd>}
          </div>
          {/* with a check-in, the counter above says the hours */}
          {!day.checkIn && (
            <div>
              <dt className="text-xs text-muted">Hours counted</dt>
              <dd className="font-semibold tabular-nums">{dayHoursText(day)}</dd>
            </div>
          )}
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
                  {r.map && (
                    <>
                      {' · '}
                      <a href={r.map.href} target="_blank" rel="noopener noreferrer" title={r.map.title} className="font-semibold">
                        Map<span className="sr-only"> of the {r.label.toLowerCase()} at {r.time} (opens in a new tab)</span>
                      </a>
                    </>
                  )}
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
