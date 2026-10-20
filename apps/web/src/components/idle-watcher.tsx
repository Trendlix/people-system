'use client';

import { IDLE_WARNING_MS } from '@trendlix/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { firstCheckInMs, GRACE_MS, stepAfter, warningText, type SessionCheck, type WatchStep } from '@/lib/idle-watch';
import { checkSession, staySignedIn } from '@/lib/session-actions';
import { signInPath } from '@/lib/signed-out';

// The idle warning (owner, 20 October 2026: "make any admin or HR session to be valid for 15 minutes inactive, then
// session to be terminated"; for HR, Admin and Super Admin). A minute before the API's 15 minutes are up: "You'll be
// signed out in 1 minute" with Stay signed in (a request that counts as activity); then the sign-in page, saying why.
// Before warning and before leaving it asks the API (lib/idle-watch.ts), so the page never signs anyone out by itself:
// activity in another tab keeps it open. Every page shown starts it again (its requests counted as activity).

/** Started again on every page: the page's requests were activity. */
export function IdleWatcher({ timeoutMs }: { timeoutMs: number }) {
  const pathname = usePathname();
  return <Watch key={pathname} timeoutMs={timeoutMs} />;
}

function Watch({ timeoutMs }: { timeoutMs: number }) {
  // while the warning shows: when the session ends (this device's clock), and the clock for the countdown
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [staying, setStaying] = useState(false);
  const textId = useId();
  // what to do with an answer from the API, for Stay signed in (set up by the effect below)
  const apply = useRef<((check: SessionCheck | undefined) => void) | null>(null);

  useEffect(() => {
    let over = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      let check: SessionCheck | undefined;
      try {
        check = await checkSession();
      } catch {
        check = { status: 'unknown' };
      }
      next(check);
    };
    // undefined: the action went to the sign-in page (the session had ended)
    const next = (check: SessionCheck | undefined) => {
      if (over || !check) return;
      clearTimeout(timer);
      const step: WatchStep = stepAfter(check, IDLE_WARNING_MS);
      if (step.kind === 'signedOut') {
        // the actions go to the sign-in page themselves once the session has ended; this only in case one didn't
        window.location.assign(signInPath(step.reason));
        return;
      }
      if (step.kind === 'warn') {
        setEndsAt(Date.now() + step.endsInMs);
        setNow(Date.now());
        timer = setTimeout(ask, step.endsInMs + GRACE_MS);
      } else {
        setEndsAt(null);
        timer = setTimeout(ask, step.checkInMs);
      }
    };
    apply.current = next;
    timer = setTimeout(ask, firstCheckInMs(timeoutMs, IDLE_WARNING_MS));
    return () => {
      over = true;
      clearTimeout(timer);
      apply.current = null;
    };
  }, [timeoutMs]);

  // the countdown, while the warning shows
  useEffect(() => {
    if (endsAt === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [endsAt]);

  async function stay() {
    setStaying(true);
    let check: SessionCheck | undefined;
    try {
      check = await staySignedIn();
    } catch {
      check = { status: 'unknown' };
    } finally {
      setStaying(false);
    }
    apply.current?.(check);
  }

  if (endsAt === null) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby={textId}
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(30rem,calc(100%-2rem))] flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-card p-4 shadow-lg"
    >
      <p id={textId} aria-live="polite" className="min-w-0 flex-1 text-sm font-medium">
        {warningText(endsAt - now)}
      </p>
      <button type="button" onClick={stay} disabled={staying} className="btn btn-primary">
        {staying ? 'Staying…' : 'Stay signed in'}
      </button>
    </div>
  );
}
