'use client';

import { HOLD_PATH, type CheckInReminderView } from '@trendlix/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { askCheckInReminder } from '@/lib/check-in-reminder-actions';
import { checkInHref, nextAskIn, POPUP_EVERY_MS, POPUP_TEXT, popupLine, popupShows, snooze, snoozedUntil, trappedFocus, type ReminderSurface } from '@/lib/check-in-reminder';

// The check-in reminder as a popup (owner, 20 October 2026: "a reminder for people that didn't checkin and not on a leave
// every 10 minutes. like a popup"; asked, from the "Shift start", stopping "After 2 hours", "No, always on"), on the
// site and the phone pages: it asks the API on load and every 10 minutes (a background request, lib/check-in-reminder-
// actions.ts) and, while it is due, shows a modal window: "You Haven't Checked In Yet", "Your shift started at 9:00 AM",
// Check in (the check-in panel) and Remind me in 10 minutes (it closes, and is put off for 10 minutes in every tab).
// Accessible: an alert dialog, announced with its heading and line, the focus kept inside it (Tab and Shift+Tab wrap
// round), Esc closes it as Remind me in 10 minutes does, and the focus goes back where it was.

/** Reads the browser's storage, or none (a private window, storage blocked). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `held`: their access is on hold (owner, 23 October 2026: "Check-in/out only"): Check in opens the Hold page's panel. */
export function CheckInReminderPopup({ surface, held = false }: { surface: ReminderSurface; held?: boolean }) {
  const pathname = usePathname();
  const [reminder, setReminder] = useState<CheckInReminderView | null>(null);
  const [open, setOpen] = useState(false);
  // until when this page put the popup off, should the browser's storage be blocked
  const until = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ask = useRef<() => void>(() => {});
  // the page shown when an answer comes (the layout stays as the person moves between pages)
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let live = true;
    const schedule = (ms: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), ms);
    };
    const run = async () => {
      let answer: CheckInReminderView | null = null;
      try {
        answer = await askCheckInReminder();
      } catch {
        answer = null;
      }
      if (!live) return;
      const now = Date.now();
      const putOff = Math.max(until.current, snoozedUntil(storage()));
      setReminder(answer);
      setOpen(popupShows(answer, { now, until: putOff, pathname: path.current }));
      schedule(nextAskIn(now, putOff));
    };
    ask.current = () => schedule(POPUP_EVERY_MS);
    void run();
    return () => {
      live = false;
      clearTimeout(timer.current);
    };
  }, []);

  /** Closed (Remind me in 10 minutes, Esc, or Check in): put off for 10 minutes, and asked again then. */
  const putOff = useCallback(() => {
    until.current = snooze(storage(), Date.now());
    setOpen(false);
    ask.current();
  }, []);

  if (!open || !reminder) return null;
  return <ReminderDialog href={held ? HOLD_PATH : checkInHref(surface, reminder)} line={popupLine(reminder.shiftStart)} big={surface === 'app'} onClosed={putOff} />;
}

function ReminderDialog({ href, line, big, onClosed }: { href: string; line: string; big: boolean; onClosed: () => void }) {
  const titleId = useId();
  const lineId = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  // opened as a modal window, the focus on Check in (React's autoFocus would come before it opens)
  const attach = useCallback((el: HTMLDialogElement | null) => {
    dialog.current = el;
    if (el && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>('[data-first]')?.focus();
    }
  }, []);

  // Tab and Shift+Tab stay among the popup's controls
  function keepFocus(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Tab' || !dialog.current) return;
    const controls = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const next = trappedFocus(controls.indexOf(document.activeElement as HTMLElement), controls.length, e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    controls[next].focus();
  }

  const button = big ? 'min-h-12 w-full' : 'min-h-11';
  return createPortal(
    <dialog
      ref={attach}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={lineId}
      onClose={onClosed}
      onKeyDown={keepFocus}
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/60"
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">
              {POPUP_TEXT.title}
            </h2>
            <p id={lineId} className="mt-1 text-sm text-muted">
              {line}
            </p>
          </div>
        </div>
        <div className={`flex gap-2 ${big ? 'flex-col' : 'flex-wrap justify-end'}`}>
          <button type="button" onClick={() => dialog.current?.close()} className={`btn btn-secondary ${button}`}>
            {POPUP_TEXT.later}
          </button>
          {/* closes the popup (put off for 10 minutes) and opens the check-in panel */}
          <Link href={href} data-first="" onClick={() => dialog.current?.close()} className={`btn btn-primary no-underline ${button}`}>
            {POPUP_TEXT.checkIn}
          </Link>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
