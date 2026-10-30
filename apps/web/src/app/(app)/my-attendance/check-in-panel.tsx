'use client';

import { ArrowRight, Clock, LogOut, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { cairoClock, LOCATION_NEEDED_TEXT } from '@trendlix/shared';
import { MY_ATTENDANCE } from '@/components/nav';
import { ArrowLink, PanelHead, Pill } from '@/components/design';
import type { CheckInTodayView, PunchResultView } from '@/lib/attendance-types';
import { getPosition } from '@/lib/native';
import { saveRequestedPlace } from '@/lib/requested-place';
import { useNativeApp } from '@/lib/use-native';
import { punchAttendance } from './actions';
import { CheckInCounter, CounterLines, CurrentTime, WorkRing } from './check-in-counter';
import {
  buttonLabel,
  dayBreakText,
  dayHoursText,
  dayPlaceLabel,
  dayTimesText,
  dayTitle,
  exemptToday,
  expectedTextOf,
  firstDayNote,
  flagLabels,
  latestView,
  locationHelpText,
  LOCATION_NOTE,
  LOCATION_NOTE_IN_APP,
  lockNote,
  longDayTitle,
  OFFICE_NOT_SET_TEXT,
  punchBody,
  punchRows,
  todayBadge,
  todayHeadline,
  workLocationText,
  type PunchPhase,
} from './check-in';
import { appLocationRefusal, correctionLinkFor, requestPlaceHref } from './network-lock';

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
// same day: "Yes, keep the spot"): the note under the button says so, and today's list opens each on a map. A work from
// home day approved for them (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"): "Working from home today" above it on the site (the phone pages' Home says it on its own), and the office
// network's lock waived. The GPS lock (owner, 24 October 2026: "Yes, add a GPS lock too"): a person held to the check-in
// locations is told before pressing (with the office network's lock too, either passing is enough), and a press refused
// outside them says how far they are and links to ask for a correction; refused for where it was (outside them, or off
// the office network) with a reading, "Request this place" (the same day: "allow the employee to request adding this
// location to his profile") opens the request form with that reading handed over in the tab (lib/requested-place.ts).
// A day as the sum of its pairs (owner, 25 October 2026: "the working hours to be calculated between the checkin and out
// only, not the first and last"): today so far lists its pairs and its break, the counter counts the pairs' hours and the
// time since the last check-in. Exempt from check-in today (owner, 25 October 2026: "Optional check-in"): an "Exempt"
// badge with the period, and that checking in is optional; the button stays, no lock is said.

/** One card's press and what came of it: the view to show (the page's or the press's, the newer), the phase, the words. */
function usePunch(initial: CheckInTodayView) {
  const [pressed, setPressed] = useState<PunchResultView | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [help, setHelp] = useState<string | null>(null);
  const [phase, setPhase] = useState<PunchPhase>('idle');
  // each press counted, so what came of one can be closed until the next (the Dashboard head's button)
  const [pressCount, setPressCount] = useState(0);
  // refused off the office network or without a location: the day's correction a click away
  const [askCorrection, setAskCorrection] = useState(false);
  // refused for where it was, with a reading: that reading, to ask for the place (24 October 2026)
  const [refusedAt, setRefusedAt] = useState<{ latitude: number; longitude: number; accuracy: number | null } | null>(null);
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
    setPressCount((n) => n + 1);
    setErrors([]);
    setMessages([]);
    setHelp(null);
    setAskCorrection(false);
    setRefusedAt(null);
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
        setAskCorrection(!!result.offNetwork || !!result.noLocation || !!result.locationLock);
        if (result.placeRefused && !('locationError' in location)) setRefusedAt({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy ?? null });
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

  // the press's words in amber when what it kept is flagged or its place unknown, else in green
  const last = pressed ? [...pressed.punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1) : undefined;
  const warned = !!last && (last.flags.length > 0 || last.place === 'unknown');
  return { view, press, phase, busy, messages, errors, help, askCorrection, refusedAt, inApp, noteId, warned, pressCount };
}

type Punch = ReturnType<typeof usePunch>;

/**
 * What is said before a press: working from home today (the phone pages' Home says it on its own), exempt today, where
 * they are expected (`quiet`: in grey, as the design's cards say it), their first day, a lock, the location needed.
 */
function BeforePress({ p, big = false, quiet = false, className = 'space-y-4' }: { p: Punch; big?: boolean; quiet?: boolean; className?: string }) {
  const { view, inApp } = p;
  // locked to the office network or the check-in locations (either passing is enough): told before pressing
  const note = lockNote(view);
  const exempt = exemptToday(view);
  const expectedText = expectedTextOf(view);
  // their first working day (owner, 27 October 2026): counted from the shift's start whatever time they check in
  const firstDayText = firstDayNote(view);
  // on the website, when presses without a location are refused for them (inside the app it is always needed); the GPS
  // lock's note says so already
  const locationNeeded = view.location?.required && !inApp && !view.gps?.locked;
  if (!(view.workingFromHome && !big) && !exempt && !expectedText && !firstDayText && !note && !locationNeeded) return null;
  return (
    <div className={className}>
      {view.workingFromHome && !big && (
        <p className="w-fit rounded-full border border-dashed border-accent px-3 py-1 text-sm font-semibold text-accent">Working from home today</p>
      )}
      {exempt && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="badge border border-line bg-card text-ink" title={exempt.title}>
            {exempt.label}
            <span className="sr-only"> ({exempt.title})</span>
          </span>
          <span className="text-muted">{exempt.when}</span>
        </p>
      )}
      {expectedText && <p className={`text-sm ${quiet ? 'text-muted' : ''}`}>{expectedText}</p>}
      {firstDayText && <p className="text-sm font-medium">{firstDayText}</p>}
      {note && <p className="text-sm">{note}</p>}
      {locationNeeded && <p className="text-sm">{LOCATION_NEEDED_TEXT}</p>}
    </div>
  );
}

/** Where the location goes, asked each press and the spot kept (the button's description). */
function LocationNote({ p, className = 'hint max-w-md' }: { p: Punch; className?: string }) {
  return (
    <p id={p.noteId} className={className}>
      {p.inApp ? LOCATION_NOTE_IN_APP : LOCATION_NOTE}
    </p>
  );
}

/**
 * Check in / Check out: the phone's big button across the screen, the panel's own, the design's underlined "Check in now
 * →" (`link`, the Dashboard) or its black button with the clock (`solid`, My Attendance). Not disabled while busy, so
 * the focus stays on it for what is said next; a second press is ignored.
 */
function PressButton({ p, look }: { p: Punch; look: 'big' | 'box' | 'link' | 'solid' }) {
  const { view, phase, busy } = p;
  const label = buttonLabel(view.next, phase);
  const wait = busy ? 'cursor-wait opacity-60' : '';
  const common = { type: 'button' as const, onClick: p.press, 'aria-disabled': busy || undefined, 'aria-describedby': p.noteId };
  if (look === 'link') {
    return (
      <button {...common} className={`inline-flex min-h-11 items-center text-sm text-ink ${wait}`}>
        <span className="inline-flex items-center gap-2 border-b border-ink pb-0.5">
          {label}
          {phase === 'idle' && view.next === 'in' && ' now'}
          <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.6} />
        </span>
      </button>
    );
  }
  if (look === 'solid') {
    const Icon = view.next === 'in' ? Clock : LogOut;
    return (
      <button {...common} className={`btn ${view.next === 'in' ? 'btn-primary' : 'btn-secondary border-ink'} min-w-[150px] rounded-[10px] ${wait}`}>
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.6} />
        {label}
      </button>
    );
  }
  return (
    <button
      {...common}
      className={`btn ${view.next === 'in' ? 'btn-primary' : 'btn-secondary border-accent text-accent'} ${look === 'big' ? 'min-h-16 w-full rounded-xl text-lg' : 'min-h-14 w-full text-base sm:w-auto sm:min-w-60'} ${wait}`}
    >
      {label}
    </button>
  );
}

/** What the API kept, said as it comes (owner's brief: a status region), and a refusal with its way out. */
function PressOutcome({ p }: { p: Punch }) {
  const { view, messages, errors, help, askCorrection, refusedAt, warned } = p;
  const pathname = usePathname();
  const router = useRouter();
  return (
    <>
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
          {refusedAt && (
            <p className="mt-2">
              Work here often?{' '}
              <button
                type="button"
                className="font-semibold text-danger underline"
                onClick={() => {
                  saveRequestedPlace(refusedAt);
                  router.push(requestPlaceHref(pathname));
                }}
              >
                Request this place
              </button>{' '}
              as your home, a remote site or a client&apos;s location: HR, then the CEO, decide it.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** The day so far: its times (its pairs and break), its place, the hours counted before a check-in, its flags. */
function DaySoFar({ view }: { view: CheckInTodayView }) {
  const day = view.day;
  if (!day) return null;
  const dayFlags = flagLabels(day.flags);
  const breakTime = dayBreakText(day);
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted">Today so far</dt>
        <dd className="font-semibold tabular-nums">{dayTimesText(day)}</dd>
        {/* the break between today's pairs (25 October 2026), not counted */}
        {breakTime && <dd className="text-xs text-muted">{breakTime}, not counted</dd>}
        {day.place && <dd className="text-xs text-muted">{dayPlaceLabel(day, view.punches)}</dd>}
      </div>
      {/* with a check-in, the counter says the hours */}
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
  );
}

/** Today's check-ins, each its time, place, accuracy, Map and flags. */
function TodayPunches({ view }: { view: CheckInTodayView }) {
  const rows = punchRows(view.punches);
  if (!rows.length) return null;
  return (
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
  );
}

/** The panel as it was: the button, the counter, the day so far and (`compact`: not) today's check-ins. The phone's, big. */
export function CheckInPanel({ initial, compact = false, big = false }: { initial: CheckInTodayView; compact?: boolean; big?: boolean }) {
  const p = usePunch(initial);
  const { view } = p;
  return (
    <div className="space-y-4">
      <BeforePress p={p} big={big} />
      <div>
        <PressButton p={p} look={big ? 'big' : 'box'} />
        <LocationNote p={p} />
      </div>
      <PressOutcome p={p} />
      <CheckInCounter view={view} big={big} />
      <DaySoFar view={view} />
      {!compact && <TodayPunches view={view} />}
      {!view.officeLocationSet && <p className="text-xs text-muted">{OFFICE_NOT_SET_TEXT}</p>}
    </div>
  );
}

/**
 * Today's card in the owner's design (30 October 2026): `dashboard`, the Dashboard's Today (the ring; `compact`: without
 * today's check-ins, `home`: with the way to My Attendance, for the staff home page); `attendance`, My Attendance's
 * "Ready to start?".
 */
export function TodayCard({
  initial,
  variant,
  compact = false,
  home = false,
  className = '',
}: {
  initial: CheckInTodayView;
  variant: 'dashboard' | 'attendance';
  compact?: boolean;
  home?: boolean;
  className?: string;
}) {
  const p = usePunch(initial);
  const { view } = p;
  const badge = todayBadge(view);
  const location = workLocationText(view);
  const hasPunches = !compact && view.punches.length > 0;
  const below = (view.day || hasPunches) && (
    <div className="mt-6 space-y-4 border-t border-line-soft pt-4">
      <DaySoFar view={view} />
      {!compact && <TodayPunches view={view} />}
    </div>
  );
  const notSet = !view.officeLocationSet && <p className="mt-4 text-xs text-muted">{OFFICE_NOT_SET_TEXT}</p>;
  const pill = (
    <Pill strong={badge.strong}>{badge.label}</Pill>
  );

  if (variant === 'attendance') {
    // checked in or out today: the time worked, else the time now
    const counted = !!view.day?.checkIn && (view.next === 'out' || !!view.day.checkOut);
    return (
      <section aria-label="Today's check-in" className={`card @container p-[22px] ${className}`}>
        <PanelHead eyebrow={`Today · ${dayTitle(view.date)}`} title={todayHeadline(view)} aside={pill} />
        <div className="mt-7 grid gap-6 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @xl:gap-0">
          <div className="@xl:pr-7">
            {counted ? <CheckInCounter view={view} look="plain" /> : <CurrentTime now={view.now} />}
            {location && (
              <p className="mt-2.5 text-xs text-muted">
                <span className="sr-only">Work location: </span>
                {location}
              </p>
            )}
          </div>
          <div className="space-y-4 border-line @xl:border-l @xl:pl-7">
            <BeforePress p={p} quiet className="space-y-2" />
            <LocationNote p={p} className="max-w-md text-xs text-muted" />
            <PressButton p={p} look="solid" />
            <PressOutcome p={p} />
          </div>
        </div>
        {below}
        {notSet}
      </section>
    );
  }

  return (
    <section aria-label="Today's check-in" className={`card @container p-[22px] ${className}`}>
      <PanelHead eyebrow="Today" title={longDayTitle(view.date)} aside={pill} />
      <div className="mt-6 flex flex-col gap-6 @xl:flex-row @xl:items-center @xl:gap-14 @xl:pl-3">
        <div className="self-center @xl:self-auto">
          <WorkRing view={view} />
        </div>
        <div className="min-w-0 flex-1">
          {location && (
            <>
              <p className="text-sm text-muted">Work location</p>
              <p className="mt-1.5 text-[1.05rem] text-ink">{location}</p>
            </>
          )}
          <CounterLines view={view} className="mt-2" />
          <BeforePress p={p} quiet className="mt-3 space-y-2" />
          <LocationNote p={p} className="mt-2.5 max-w-md text-xs text-muted" />
          <div className="mt-3">
            <PressButton p={p} look="link" />
          </div>
          <div className="mt-2 space-y-3 empty:hidden">
            <PressOutcome p={p} />
          </div>
        </div>
      </div>
      {below}
      {notSet}
      {home && (
        <p className="mt-5">
          <ArrowLink href={MY_ATTENDANCE}>Open my attendance</ArrowLink>
        </p>
      )}
    </section>
  );
}

/**
 * The Dashboard head's button (the owner's design, 30 October 2026: "Check in for work", and once checked in "Checked
 * in · 08:57"): the same press as the card's (usePunch), what came of it under the button until closed; the page is
 * read again after a press, so the Today card follows. Checked in, it is the time of the check-in, not a button (Check
 * out is on the card).
 */
export function TodayHeadButton({ initial }: { initial: CheckInTodayView }) {
  const p = usePunch(initial);
  const { view, phase, busy } = p;
  const [closed, setClosed] = useState(0);
  const said = p.messages.length + p.errors.length > 0 && closed !== p.pressCount;
  const open = view.next === 'out' ? [...view.punches].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1) : undefined;
  return (
    <div className="relative">
      {view.next === 'out' ? (
        <p className="btn btn-primary min-h-11 cursor-default rounded-xl px-4 font-normal tabular-nums">
          <Clock aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
          Checked in{open?.kind === 'in' ? ` · ${cairoClock(open.at)}` : ''}
        </p>
      ) : (
        <button
          type="button"
          onClick={p.press}
          aria-disabled={busy || undefined}
          aria-describedby={p.noteId}
          className={`btn btn-primary min-h-11 rounded-xl px-4 font-normal ${busy ? 'cursor-wait opacity-60' : ''}`}
        >
          <Clock aria-hidden="true" className="size-[18px]" strokeWidth={1.5} />
          {phase === 'idle' ? 'Check in for work' : buttonLabel('in', phase)}
        </button>
      )}
      <LocationNote p={p} className="sr-only" />
      {/* what came of the press, under the button until closed (closed: hidden, its words said already) */}
      <div
        className={
          said
            ? 'absolute top-full right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border border-line bg-card p-2 shadow-card'
            : p.messages.length + p.errors.length > 0
              ? 'hidden'
              : ''
        }
      >
        <PressOutcome p={p} />
        {said && (
          <button type="button" onClick={() => setClosed(p.pressCount)} className="ml-auto flex min-h-8 items-center gap-1 px-2 text-xs text-muted">
            <X aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
            Close
          </button>
        )}
      </div>
    </div>
  );
}
