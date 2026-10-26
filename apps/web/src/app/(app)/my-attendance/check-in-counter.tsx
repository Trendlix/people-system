'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { CheckInTodayView } from '@/lib/attendance-types';
import { counterShows, noteServerTime, type ServerClock } from './check-in';

// The check-in counter (owner, 20 October 2026: "employees need to see a checkin counter after their checkin"), in the
// check-in panel on the Dashboard, My Attendance and, big, the phone pages' Home: while checked in, "Worked today" with
// the time counted so far ticking each second, counted the way attendance will count it (check-in.ts checkInCount), and
// when the hours will be done; once checked out, the day's hours counted. The clock is the server's: each view's time
// from the server sets how far this device's clock is off (the newest view's only, so a page Next.js shows again from
// before doesn't set it back), and one timer for every counter on the page ticks while any is shown, cleared when the
// last one goes. The ticking seconds aren't read out (aria-live off); what is next is said politely, as it changes.
// Checked in again after a check-out (owner, 25 October 2026: "the working hours to be calculated between the checkin
// and out only, not the first and last"), it counts today's closed pairs and the time since that check-in, never the break.
// On a new employee's first day (owner, 27 October 2026: "Counted from the shift start") it counts from the shift's start,
// as the day will be counted, and says so.

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

/** On the server and while hydrating: none, so the view's own time is used. */
const noTime = () => 0;

export function CheckInCounter({ view, big = false }: { view: Pick<CheckInTodayView, 'date' | 'now' | 'next' | 'day' | 'shift' | 'firstDay'>; big?: boolean }) {
  const shows = counterShows(view, Date.parse(view.now));
  if (!shows) return null;
  if (shows.kind === 'total') {
    return <p className={`font-semibold tabular-nums ${big ? 'text-xl' : 'text-base'}`}>{shows.text}</p>;
  }
  return <LiveCounter view={view} big={big} />;
}

function LiveCounter({ view, big }: { view: Pick<CheckInTodayView, 'date' | 'now' | 'next' | 'day' | 'shift' | 'firstDay'>; big: boolean }) {
  const server = Date.parse(view.now);
  // before the clock is read: how far this device's is off, from the view's server time
  useEffect(() => {
    clock = noteServerTime(clock, server, Date.now());
  }, [server]);
  const ticked = useSyncExternalStore(subscribe, serverNow, noTime);
  const shows = counterShows(view, ticked || server);
  if (shows?.kind !== 'live') return null;
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
