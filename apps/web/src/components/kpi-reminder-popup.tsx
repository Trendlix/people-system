'use client';

import { kpiPopupShows, type KpiReminderView } from '@trendlix/shared';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { trappedFocus } from '@/lib/check-in-reminder';
import { kpiReminderHref, kpiReminderLine, markSeen, seenThisSignIn } from '@/lib/kpi-reminder';
import { askKpiReminder, postponeKpiReminder } from '@/lib/kpi-reminder-actions';

// The KPI reminder as a popup (owner, 1 November 2026: "when there is a KPI Scoring Pending make it in a floater, can
// be postponed for 1 day only"; "and can be done before the postponed date"; "in a popup reminder on each login"): asked
// once when the layout loads; shown once in each sign-in while scorecards wait and it isn't postponed. Score now opens
// them; Postpone 1 day (once a month's round) puts it off for a day on every device; × closes it until the next sign-in.
// The scorecards can be done at any time meanwhile.

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function KpiReminderPopup({ sessionId, big }: { sessionId: string; big: boolean }) {
  const [view, setView] = useState<KpiReminderView | null>(null);

  useEffect(() => {
    if (seenThisSignIn(storage(), sessionId)) return;
    let live = true;
    void askKpiReminder()
      .catch(() => null)
      .then((v) => {
        if (!live || !v || !kpiPopupShows(v, Date.now())) return;
        markSeen(storage(), sessionId);
        setView(v);
      });
    return () => {
      live = false;
    };
  }, [sessionId]);

  const close = useCallback(() => setView(null), []);
  if (!view) return null;
  return <ReminderDialog view={view} big={big} onClosed={close} />;
}

function ReminderDialog({ view, big, onClosed }: { view: KpiReminderView; big: boolean; onClosed: () => void }) {
  const titleId = useId();
  const lineId = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[] | null>(null);
  const attach = useCallback((el: HTMLDialogElement | null) => {
    dialog.current = el;
    if (el && !el.open) {
      el.showModal();
      el.querySelector<HTMLElement>('[data-first]')?.focus();
    }
  }, []);

  function keepFocus(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Tab' || !dialog.current) return;
    const controls = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const next = trappedFocus(controls.indexOf(document.activeElement as HTMLElement), controls.length, e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    controls[next].focus();
  }

  function postpone() {
    setErrors(null);
    startTransition(async () => {
      const r = await postponeKpiReminder();
      if (r.errors) setErrors(r.errors);
      else dialog.current?.close();
    });
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
          <span aria-hidden="true" className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19h16M7 16V10M12 16V6M17 16v-4" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              KPI Scoring Pending
            </h2>
            <p id={lineId} className="mt-1 text-sm text-muted">
              {kpiReminderLine(view)}
            </p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="-mt-1 -mr-1 rounded-lg p-1.5 text-muted hover:bg-line-soft">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        {errors && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {errors.join(' ')}
          </p>
        )}
        <div className={`flex gap-2 ${big ? 'flex-col' : 'flex-wrap justify-end'}`}>
          {view.canPostpone && (
            <button type="button" onClick={postpone} disabled={pending} className={`btn btn-secondary ${button}`}>
              {pending ? 'Postponing…' : 'Postpone 1 day'}
            </button>
          )}
          <Link href={kpiReminderHref(view)} data-first="" onClick={() => dialog.current?.close()} className={`btn btn-primary no-underline ${button}`}>
            Score now
          </Link>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
