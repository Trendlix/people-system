'use client';

import { manualChangesHeading, type ManualChangesView } from '@trendlix/shared';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { trappedFocus } from '@/lib/check-in-reminder';
import { formatDateTime } from '@/lib/format';
import { askManualChanges, markManualChangesSeen } from '@/lib/manual-changes-actions';
import { notificationHref } from '@/lib/notifications';

// The manual changes popup (owner, 4 November 2026: "when HR corrects something manually, her manager has to be notified
// in a popup"; asked, "The HR person's manager", "Everything done for an employee", "Shows until marked seen"): asked
// once when the layout loads; shown while any change made by hand by someone the person manages is unseen, each with
// what was done, its days, when and its page. Seen marks them all read (on the bell too); × closes it until the next
// page load, and it comes back while they are unseen.

export function ManualChangesPopup({ big, surface }: { big: boolean; surface: 'site' | 'app' }) {
  const [view, setView] = useState<ManualChangesView | null>(null);

  useEffect(() => {
    let live = true;
    void askManualChanges()
      .catch(() => null)
      .then((v) => {
        if (live && v && v.total > 0) setView(v);
      });
    return () => {
      live = false;
    };
  }, []);

  const close = useCallback(() => setView(null), []);
  if (!view) return null;
  return <ChangesDialog view={view} big={big} surface={surface} onClosed={close} />;
}

function ChangesDialog({ view, big, surface, onClosed }: { view: ManualChangesView; big: boolean; surface: 'site' | 'app'; onClosed: () => void }) {
  const titleId = useId();
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

  function seen() {
    setErrors(null);
    startTransition(async () => {
      const r = await markManualChangesSeen();
      if (r.errors) setErrors(r.errors);
      else dialog.current?.close();
    });
  }

  const more = view.total - view.items.length;
  return createPortal(
    <dialog
      ref={attach}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClosed}
      onKeyDown={keepFocus}
      className="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/60"
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-warn-soft text-warn">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {manualChangesHeading(view.total)}
            </h2>
            <p className="mt-1 text-sm text-muted">By someone you manage, for an employee.</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="-mt-1 -mr-1 rounded-lg p-1.5 text-muted hover:bg-line-soft">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {view.items.map((c) => {
            const href = notificationHref(c.link, 'manual_change', surface);
            return (
              <li key={c.id} className="space-y-0.5 px-3 py-2.5 text-sm">
                <p className="font-medium">{c.title}</p>
                <p className="text-muted">
                  {c.body} · {formatDateTime(c.at)}
                  {href && (
                    <>
                      {' · '}
                      <Link href={href} onClick={() => dialog.current?.close()}>
                        Open
                      </Link>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
        {more > 0 && <p className="text-sm text-muted">And {more} more on your notifications.</p>}
        {errors && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {errors.join(' ')}
          </p>
        )}
        <div className={`flex gap-2 ${big ? 'flex-col' : 'flex-wrap justify-end'}`}>
          <button type="button" onClick={seen} disabled={pending} data-first="" className={`btn btn-primary ${big ? 'min-h-12 w-full' : 'min-h-11'}`}>
            {pending ? 'Saving…' : 'Seen'}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
