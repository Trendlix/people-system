'use client';

import { cairoClock } from '@trendlix/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { Ring } from '@/components/design';
import type { CheckInTodayView } from '@/lib/attendance-types';
import { counterShows, noteServerTime, workTime, type ServerClock } from './check-in';

// The check-in counter (owner, 20 October 2026: "employees need to see a checkin counter after their checkin"), in the
// check-in panel on the Dashboard, My Attendance and, big, the phone pages' Home: while checked in, "Worked today" with
// the time counted so far ticking each second, counted the way attendance will count it (check-in.ts checkInCount), and
// when the hours will be done; once checked out, the day's hours counted. The clock is the server's: each view's time
// from the server sets how far this device's clock is off (the newest view's only, so a page Next.js shows again from
// before doesn't set it back), and one timer for every counter on the page ticks while any is shown, cleared when the
// last one goes. The ticking seconds aren't read out (aria-live off); what is next is said politely, as it changes.
// Checked in again after a check-out, it counts from the day's first check-in, the break included (owner, 31 October
// 2026: "9:00, break included"; "dont calculate breaks, they are included in the working hours"), as the day is counted.
// On a new employee's first day (owner, 27 October 2026: "Counted from the shift start") it counts from the shift's start,
// as the day will be counted, and says so. The owner's design (30 October 2026, Figma "PeopleTrendlix", desktop): on the
// Dashboard the time worked fills a ring, "Work time 2:35 of 8 hours" (WorkRing, with its note and what is next beside it,
// CounterLines); on My Attendance it stands large under "Worked today" (`look="plain"`), and before a check-in the time
// now, "Current time" (CurrentTime), from the same server clock.

let clock: ServerClock = { newest: Number.NEGATIVE_INFINITY, skew: 0 };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** Ticks a few times a second; the counter changes only as the second does (the snapshot is to the second). */
function subscribe(onTick: () => void) {
  listeners.add(onTick);
  timer ??= setInterval(() => listeners.forEach((l) => l()), 250);
  return () => {
    listeners.delete(onTick);
    if (!listeners.size && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** The server's time now, to the second. */
const serverNow = () => Math.floor((Date.now() + clock.skew) / 1000) * 1000;

/** The server's time now, to the minute (the clock on My Attendance changes only as the minute does). */
const serverMinute = () => Math.floor((Date.now() + clock.skew) / 60_000) * 60_000;

/** On the server and while hydrating: none, so the view's own time is used. */
const noTime = () => 0;

/** The server's time (ms), ticking: to the second, or to the minute; the view's own (`server`) until the clock is read. */
function useServerNow(server: number, step: 'second' | 'minute' = 'second'): number {
  // before the clock is read: how far this device's is off, from the view's server time
  useEffect(() => {
    clock = noteServerTime(clock, server, Date.now());
  }, [server]);
  const ticked = useSyncExternalStore(subscribe, step === 'minute' ? serverMinute : serverNow, noTime);
  return ticked || server;
}

type CounterView = Pick<CheckInTodayView, 'date' | 'now' | 'next' | 'day' | 'shift' | 'firstDay'>;

/** Checked in now: the counter ticks. */
const checkedInNow = (view: CounterView) => view.next === 'out' && !!view.day?.checkIn;

export function CheckInCounter({ view, big = false, look = 'box' }: { view: CounterView; big?: boolean; look?: 'box' | 'plain' }) {
  const shows = counterShows(view, Date.parse(view.now));
  if (!shows) return null;
  if (shows.kind === 'total') {
    // checked out: the hours the server counted, as the ring says them
    if (look === 'plain') return <PlainCounter label="Worked today" value={workTime(view, Date.parse(view.now)).value} />;
    return <p className={`font-semibold tabular-nums ${big ? 'text-xl' : 'text-base'}`}>{shows.text}</p>;
  }
  return <LiveCounter view={view} big={big} look={look} />;
}

function LiveCounter({ view, big, look }: { view: CounterView; big: boolean; look: 'box' | 'plain' }) {
  const now = useServerNow(Date.parse(view.now));
  const shows = counterShows(view, now);
  if (shows?.kind !== 'live') return null;
  if (look === 'plain') {
    return (
      <PlainCounter label="Worked today" value={shows.value}>
        {shows.note && <p className="mt-1 text-xs text-muted">{shows.note}</p>}
        <p role="status" aria-live="polite" className={shows.status ? 'mt-1 text-sm' : 'sr-only'}>
          {shows.status}
        </p>
      </PlainCounter>
    );
  }
  return (
    <div className={big ? 'rounded-xl bg-accent-soft px-4 py-4 text-center' : 'rounded-lg bg-accent-soft px-4 py-3'}>
      <p className={`text-muted ${big ? 'text-sm' : 'text-xs'}`}>Worked today</p>
      <p aria-live="off" className={`font-semibold tabular-nums text-ink ${big ? 'text-5xl leading-tight' : 'text-3xl'}`}>
        {shows.value}
      </p>
      {shows.note && <p className="mt-1 text-xs text-muted">{shows.note}</p>}
      <p role="status" aria-live="polite" className={shows.status ? `mt-1 ${big ? 'text-base' : 'text-sm'}` : 'sr-only'}>
        {shows.status}
      </p>
    </div>
  );
}

/** My Attendance's large figure: what it is ("Current time", "Worked today") over it. */
function PlainCounter({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p aria-live="off" className="mt-2 text-[2.9rem] leading-none font-normal tracking-[-0.065em] tabular-nums text-ink">
        {value}
      </p>
      {children}
    </div>
  );
}

/**
 * My Attendance before a check-in (the owner's design, 30 October 2026: "Current time 08:57"): the time now in Cairo,
 * by the server's clock, changing as the minute does.
 */
export function CurrentTime({ now }: { now: string }) {
  const at = useServerNow(Date.parse(now), 'minute');
  const [clockTime, half] = cairoClock(at).split(/\s/);
  return (
    <div>
      <p className="text-xs text-muted">Current time</p>
      <p aria-live="off" className="mt-2 text-[2.9rem] leading-none font-normal tracking-[-0.065em] tabular-nums text-ink">
        <time dateTime={new Date(at).toISOString()}>
          {clockTime}
          {half && <span className="ml-1.5 text-base tracking-normal text-muted">{half}</span>}
        </time>
      </p>
    </div>
  );
}

/**
 * The Dashboard's ring (the owner's design, 30 October 2026): "Work time", the time worked today (ticking while checked
 * in, its seconds small), "of 8 hours", the ring filled by the share of them. Its words for a screen reader as the
 * ring's label; what is next is said by CounterLines.
 */
export function WorkRing({ view, size = 170 }: { view: CounterView; size?: number }) {
  return checkedInNow(view) ? <LiveRing view={view} size={size} /> : <RingOf view={view} now={Date.parse(view.now)} size={size} />;
}

function LiveRing({ view, size }: { view: CounterView; size: number }) {
  const now = useServerNow(Date.parse(view.now));
  return <RingOf view={view} now={now} size={size} />;
}

function RingOf({ view, now, size }: { view: CounterView; now: number; size: number }) {
  const time = workTime(view, now);
  return (
    <Ring share={time.share} size={size} label={time.label}>
      <span className="text-[11px] text-muted">Work time</span>
      <span className="mt-1 text-[2.1rem] leading-tight font-normal tracking-[-0.05em] tabular-nums text-ink">
        {time.value}
        {time.seconds && <span className="text-sm tracking-normal text-muted">{time.seconds}</span>}
      </span>
      {time.of && <span className="mt-0.5 text-[11px] text-muted">{time.of}</span>}
    </Ring>
  );
}

/**
 * Beside the ring, while checked in: where the counting starts when not from the check-in, and what is next ("Your 9
 * hours are done at 6:15 PM"), said politely as it changes; once checked out, "Worked 8:52 today". Nothing before a
 * check-in.
 */
export function CounterLines({ view, className = '' }: { view: CounterView; className?: string }) {
  const shows = counterShows(view, Date.parse(view.now));
  if (!shows) return null;
  if (shows.kind === 'total') return <p className={`text-sm ${className}`}>{shows.text}</p>;
  return <LiveLines view={view} className={className} />;
}

function LiveLines({ view, className }: { view: CounterView; className: string }) {
  const now = useServerNow(Date.parse(view.now));
  const shows = counterShows(view, now);
  if (shows?.kind !== 'live') return null;
  return (
    <div className={`space-y-1 ${className}`}>
      {shows.note && <p className="text-xs text-muted">{shows.note}</p>}
      <p role="status" aria-live="polite" className={shows.status ? 'text-sm' : 'sr-only'}>
        {shows.status}
      </p>
    </div>
  );
}
