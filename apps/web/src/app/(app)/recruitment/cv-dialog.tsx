'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ScreeningComments, ScreeningCv } from '@trendlix/shared';
import { PdfView } from '@/components/pdf-view';
import { formatDate } from '@/lib/format';
import { CommentForm, CommentList } from './screening-ui';
import { commentsOfCv, cvBelongsTo, cvFileHref, cvIndexOf, cvPositionText, cvPreviewHref, CV_PARAM, defaultTargetKey, kb, readCvParam, stepCv, withCvParam } from './screening';

// A CV in a pop-up window over the page (owner, 24 October 2026, on a candidate's profile: "when opening a CV, open it in
// a popup window"; then "is there a way to add screening comments?"): a native modal <dialog> (focus stays in it, Esc
// or Close closes it, the page behind as it was), nearly the whole screen on a computer and all of it on a phone. The
// file's name and what it belongs to; the PDF drawn with pdf.js (zoom and its pages), a Word CV through the server's PDF
// service (when there is none, the window says so and Download is there); Download; the previous and next CV (arrows,
// and the ← and → keys) when the candidate sent several. Beside it on a computer, the screening comments of what the CV
// belongs to with the form; on a phone, a Comments button switches to them. The address carries ?cv=<the application's
// or general CV's id>: a link opens it, opening it adds a step to the browser's history (Back closes it), the previous
// and next replace it, closing it takes it away.

/** Whether the window put ?cv= in the history itself (so closing it goes back), or came with the address (closing takes it away). */
let pushedHere = false;

function setAddress(search: string, how: 'push' | 'replace') {
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  if (how === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

/** Opens the CV of an application or a general CV (by its id) in the window. */
export function openCv(recordId: string) {
  const open = readCvParam(window.location.search) !== null;
  setAddress(withCvParam(window.location.search, recordId), open ? 'replace' : 'push');
  if (!open) pushedHere = true;
}

function showCv(recordId: string) {
  setAddress(withCvParam(window.location.search, recordId), 'replace');
}

function closeCv() {
  if (pushedHere) {
    pushedHere = false;
    window.history.back();
  } else {
    setAddress(withCvParam(window.location.search, null), 'replace');
  }
}

/** A button that opens a CV in the window (`recordId`: its application's or general CV's id). */
export function CvOpenButton({ recordId, children, className = 'inline-flex min-h-9 cursor-pointer items-center font-semibold text-accent hover:underline' }: { recordId: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-haspopup="dialog" onClick={() => openCv(recordId)} className={className}>
      {children}
    </button>
  );
}

const subscribe = () => () => {};
/** True in the browser, false while the server renders the page (the window is put at the end of the page, there only). */
const useInBrowser = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/**
 * The CV window of a page, there while the address names one of `cvs` (?cv=). `data`: the screening comments (null when
 * they couldn't be loaded: the CV shows alone, with `commentsNotLoaded`); `pageKey`: the page's own record ("general"
 * on the profile), where a new comment goes when it is this CV's.
 */
export function CvDialogHost({ cvs, data, pageKey, commentsNotLoaded }: { cvs: readonly ScreeningCv[]; data: ScreeningComments | null; pageKey: string; commentsNotLoaded: string }) {
  const params = useSearchParams();
  const wanted = params.get(CV_PARAM);
  const inBrowser = useInBrowser();
  useEffect(() => {
    // closed by Back, or by a link without it: the next opening adds its own step again
    if (!wanted) pushedHere = false;
  }, [wanted]);
  const index = cvIndexOf(cvs, wanted);
  if (!inBrowser || index < 0) return null;
  return <CvWindow cvs={cvs} index={index} data={data} pageKey={pageKey} commentsNotLoaded={commentsNotLoaded} />;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const typingIn = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Whether a comment is typed in the window and not saved: closing it asks first. */
const unsaved = (dialog: HTMLDialogElement) => !!dialog.querySelector('textarea[data-unsaved="true"]');
const LEAVE = 'Close the CV? The comment you typed isn’t saved.';

const ICON = 'inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink hover:bg-canvas disabled:cursor-default disabled:opacity-40';

function CvWindow({ cvs, index, data, pageKey, commentsNotLoaded }: { cvs: readonly ScreeningCv[]; index: number; data: ScreeningComments | null; pageKey: string; commentsNotLoaded: string }) {
  const titleId = useId();
  const panelId = useId();
  const cv = cvs[index];
  const [zoom, setZoom] = useState<number>(1);
  const [pages, setPages] = useState<{ key: string; count: number } | null>(null);
  const [comments, setComments] = useState(false);
  const several = cvs.length > 1;

  const attach = useCallback((dialog: HTMLDialogElement | null) => {
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // focus goes back to what opened it (browsers do this for a modal dialog, but not all of them reliably)
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  const go = (step: -1 | 1) => {
    const next = cvs[stepCv(cvs.length, index, step)];
    if (next) showCv(next.id);
  };
  const zoomBy = (step: -1 | 1) => {
    const at = ZOOMS.findIndex((z) => z >= zoom);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (at < 0 ? ZOOMS.length - 1 : at) + step))]);
  };
  const onPages = useCallback((count: number) => setPages({ key: cv.key, count }), [cv.key]);
  const pageCount = pages?.key === cv.key ? pages.count : null;
  const word = cv.mimeType !== 'application/pdf';
  const shown = data ? commentsOfCv(data, cv) : [];

  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      onClose={closeCv}
      onCancel={(e) => {
        // Esc with a comment typed and not saved: asked first
        if (unsaved(e.currentTarget) && !window.confirm(LEAVE)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (!several || typingIn(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          go(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col sm:m-auto sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-xl"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2 pr-2 pl-4">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={titleId} className="truncate font-semibold" title={cv.cvFileName}>
            {cv.cvFileName}
          </h2>
          <p className="truncate text-xs text-muted">
            {cvBelongsTo(cv)} · sent {formatDate(cv.sentAt)} · {kb(cv.sizeBytes)}
            {word && ' · a Word file, shown as a PDF'}
          </p>
        </div>
        {several && (
          <div role="group" aria-label="The candidate’s CVs" className="flex items-center gap-1">
            <button type="button" onClick={() => go(-1)} className={ICON} aria-label="Previous CV" title="Previous CV (←)">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                <path d="M12.5 4.5 7 10l5.5 5.5" />
              </svg>
            </button>
            <span className="min-w-14 text-center text-sm tabular-nums" aria-live="polite">
              {cvPositionText(index, cvs.length)}
            </span>
            <button type="button" onClick={() => go(1)} className={ICON} aria-label="Next CV" title="Next CV (→)">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                <path d="M7.5 4.5 13 10l-5.5 5.5" />
              </svg>
            </button>
          </div>
        )}
        <div role="group" aria-label="Zoom" className="flex items-center gap-1">
          <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} className={ICON} aria-label="Zoom out">
            <span aria-hidden="true" className="text-lg leading-none">
              −
            </span>
          </button>
          <button type="button" onClick={() => setZoom(1)} className="min-h-10 min-w-16 cursor-pointer rounded-lg px-2 text-sm tabular-nums hover:bg-canvas" title="Fit to the width">
            {Math.round(zoom * 100)}%<span className="sr-only">: fit to the width</span>
          </button>
          <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} className={ICON} aria-label="Zoom in">
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
          </button>
          {pageCount !== null && (
            <span className="hidden text-sm text-muted sm:inline">
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
          )}
        </div>
        <a href={cvFileHref(cv, true)} className="btn btn-secondary min-h-10 no-underline">
          Download
        </a>
        <button type="button" onClick={() => setComments((c) => !c)} aria-expanded={comments} aria-controls={panelId} className="btn btn-secondary min-h-10 lg:hidden">
          {comments ? 'Show the CV' : `Comments${data ? ` (${shown.length})` : ''}`}
        </button>
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={(e) => {
            const dialog = e.currentTarget.closest('dialog');
            if (dialog && (!unsaved(dialog) || window.confirm(LEAVE))) dialog.close();
          }} className={`${ICON} size-11 text-muted hover:text-ink`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto bg-line-soft ${comments ? 'hidden lg:block' : ''}`}>
          <PdfView key={cv.key} src={cvPreviewHref(cv)} title={cv.cvFileName} notLoaded="This CV could not be shown. Download it instead." bleed={false} zoom={zoom} onPages={onPages} />
        </div>
        <aside id={panelId} aria-label="Screening comments" className={`min-h-0 w-full overflow-y-auto border-line p-4 lg:block lg:w-[26rem] lg:shrink-0 lg:border-l ${comments ? 'block' : 'hidden'}`}>
          <h3 className="mb-3 font-semibold">Screening Comments</h3>
          {!data ? (
            <p className="text-sm text-muted">{commentsNotLoaded}</p>
          ) : (
            <div className="space-y-4">
              <CommentList comments={shown} data={data} ownKey={cv.key} empty="No comments on this CV yet." />
              <CommentForm key={cv.key} data={data} defaultTarget={defaultTargetKey(data.targets, pageKey, cv)} />
            </div>
          )}
        </aside>
      </div>
    </dialog>,
    document.body,
  );
}
