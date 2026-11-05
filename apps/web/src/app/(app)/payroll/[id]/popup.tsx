'use client';

import { useId, useRef } from 'react';

// A popup window on the payroll page (owner, 5 November 2026: "HR can see batch details", "Preview in a popup window"):
// a button that opens a native modal <dialog> over the page (focus stays in it; Esc, Close or a click outside closes
// it; the page behind as it was). What it shows is given to it, rendered on the server; it stays open while an action
// in it refreshes the page, showing the change.

export function Popup({
  label,
  title,
  subtitle,
  buttonClassName = 'btn btn-secondary min-h-9 px-3',
  wide = false,
  children,
}: {
  /** The button's words, e.g. "View details". */
  label: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  buttonClassName?: string;
  /** Wider, for a form or a table with several columns. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} className={buttonClassName}>
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        // a click on the backdrop (the dialog itself, outside its box) closes it
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className={`m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] ${wide ? 'max-w-3xl' : 'max-w-2xl'} overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/60 open:flex open:flex-col sm:max-h-[calc(100dvh-4rem)]`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-semibold">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="-mt-1 -mr-1 rounded-lg p-1.5 text-muted hover:bg-line-soft">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </dialog>
    </>
  );
}

/** Closes the popup a control sits in (after a form in it is saved). */
export function closePopupOf(el: Element | null): void {
  el?.closest('dialog')?.close();
}
