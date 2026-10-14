'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Viewing a document: a button that opens it in a pop-up window over the page (a native modal <dialog>: focus stays in
// it, Esc or a click outside closes it, and focus goes back to the button), one file, or the two sides of an ID card
// side by side (stacked on narrow screens). Pictures are fitted to the window; a PDF fills it, with Open in a new tab for
// browsers that cannot show one inside a page. Nothing is loaded until it is opened, and it is loaded again at each
// opening: opening a national ID scan from the employee file is written to the audit log (app/paperwork/[itemId]).

/** One file to show. */
export interface ViewerFile {
  /** Shown above it when several are shown together, e.g. Front and Back. */
  label?: string;
  /** What it shows, for those who cannot see it. */
  alt: string;
  /** Its address (e.g. /paperwork/<itemId>, loaded only once the window opens), or a file made or chosen in this page. */
  src: string | Blob;
  /** A PDF is shown in a frame, anything else as a picture. A Blob's own type is used when it is left out. */
  mimeType?: string;
}

const CAPTION = 'text-xs font-semibold tracking-wide text-muted uppercase';
const SMALL_LINK = 'inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline';
/** The look of the button that opens it, as the View links next to a file. */
export const VIEW_BUTTON = 'inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold hover:underline';

const isPdf = (f: ViewerFile) => (f.mimeType ?? (typeof f.src === 'string' ? '' : f.src.type)) === 'application/pdf';

/** A Blob gets an address of its own while it is shown, let go when it is not; an address is used as it is. */
function useAddress(src: string | Blob) {
  return useCallback(
    (el: HTMLImageElement | HTMLIFrameElement | null): void | (() => void) => {
      if (!el || typeof src === 'string') return;
      const address = URL.createObjectURL(src);
      el.src = address;
      return () => URL.revokeObjectURL(address);
    },
    [src],
  );
}

function Shown({ file }: { file: ViewerFile }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  const attach = useAddress(file.src);
  const src = typeof file.src === 'string' ? file.src : undefined;

  if (state === 'failed') {
    return (
      <p role="alert" className="m-auto max-w-sm p-4 text-center text-sm text-danger">
        This file could not be loaded. Close the window and try again.
      </p>
    );
  }
  if (isPdf(file)) return <iframe ref={attach} src={src} title={file.alt} className="min-h-0 w-full flex-1 rounded-md border border-line bg-white" />;
  return (
    // the picture fills what is left of the window and is fitted into it, whatever its own size: right under its label,
    // or in the middle when it has none
    <div className="relative min-h-0 flex-1">
      {state === 'loading' && <p className="absolute inset-0 m-auto h-fit text-center text-sm text-muted">Loading…</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- a file of the employee file or of this page, shown as it is */}
      <img
        ref={attach}
        src={src}
        alt={file.alt}
        onLoad={() => setState('shown')}
        onError={() => setState('failed')}
        className={`absolute inset-0 size-full object-contain ${file.label ? 'object-top' : ''}`}
      />
    </div>
  );
}

const close = (e: React.MouseEvent<HTMLElement>) => e.currentTarget.closest('dialog')?.close();

/**
 * The pop-up window, only in the page while it is open: shown as a modal as soon as it is added, at the end of the page
 * so that it takes nothing from where its button is (e.g. a table cell's styles). `onClosed`: it was closed (the close
 * buttons, Esc, or a click on the dark area around it).
 */
function ViewerWindow({ title, files, onClosed }: { title: React.ReactNode; files: ViewerFile[]; onClosed: () => void }) {
  const titleId = useId();
  const attach = useCallback((dialog: HTMLDialogElement | null) => {
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      onClose={onClosed}
      // the dark area around the window is the dialog itself, not what is in it
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto h-[calc(100dvh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-6xl overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col sm:h-[calc(100dvh-4rem)] sm:w-[calc(100vw-4rem)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="min-w-0 self-center font-semibold break-words">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      {/* two files side by side on wide screens, one above the other on narrow ones */}
      <div className={`grid min-h-0 flex-1 gap-4 overflow-auto p-4 ${files.length > 1 ? 'grid-rows-2 sm:grid-cols-2 sm:grid-rows-1' : 'grid-rows-1'}`}>
        {files.map((file, i) => {
          const newTab = isPdf(file) && typeof file.src === 'string' ? file.src : null;
          return (
            <figure key={i} className="m-0 flex min-h-0 min-w-0 flex-col gap-2">
              {(file.label || newTab) && (
                <figcaption className="flex flex-wrap items-center justify-between gap-x-4">
                  {file.label && <span className={CAPTION}>{file.label}</span>}
                  {newTab && (
                    <a href={newTab} target="_blank" rel="noopener" className={SMALL_LINK}>
                      Open in a new tab<span className="sr-only">: {file.alt}</span>
                    </a>
                  )}
                </figcaption>
              )}
              <Shown file={file} />
            </figure>
          );
        })}
      </div>

      <div className="flex justify-end border-t border-line px-5 py-3">
        <button type="button" onClick={close} className="btn btn-secondary">
          Close
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * A button (`children`: what it says) that opens `files` in a pop-up window titled `title`: one file, or the two sides
 * of an ID card side by side. Closing it puts the focus back on the button.
 */
export function DocumentViewer({
  title,
  files,
  children,
  className = VIEW_BUTTON,
}: {
  title: React.ReactNode;
  files: ViewerFile[];
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  function closed() {
    setOpen(false);
    opener.current?.focus(); // browsers do this too, but not all of them reliably
  }

  return (
    <>
      <button ref={opener} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && <ViewerWindow title={title} files={files} onClosed={closed} />}
    </>
  );
}
