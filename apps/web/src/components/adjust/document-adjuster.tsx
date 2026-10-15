'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { preparePaperworkPages, prepareStoredPages } from '@/app/(app)/employees/adjust-actions';
import { paperworkHref, PAPERWORK_MAX_BYTES, PDF_MAX_BYTES, PDF_TOO_LARGE } from '@/app/(app)/employees/paperwork';
import { Cropper, degrees } from '@/app/(app)/employees/scan/crop';
import { pixelsOf } from '@/app/(app)/employees/scan/edges';
import { base64File, turnCanvas } from '@/app/(app)/employees/scan/image';
import { FormErrors } from '@/components/form';
import { fitPage, STRAIGHTEN_MAX, straightenOf, type PageFit } from '@/lib/page-edges';
import { cutSize, isWhole, MAX_SIDE, PRESETS, ratioRect, shapeOf, turnRect, wholeRect, type Rect } from '@/lib/page-frame';
import type { PagesState } from '@/lib/paperwork-pages';
import { cutFrame, makeDocument, openedSize, openPage, thumbOf, turned, type Adjusted } from './canvas';

// The document adjuster (owner's request: "allow me to crop and adjust all other uploaded documents", e.g. a birth
// certificate scanned with wide white margins, slightly tilted): a window over the page with every page of a document
// (a photo, or a PDF the API turns into pages), each of which can be cropped with a frame of any shape, turned by a
// quarter, straightened by up to 10° either way in tenths of a degree, or fitted to the paper's own edges and levelled
// (lib/page-edges.ts), and pages that aren't needed removed (a blank back side). Save makes the adjusted document in the
// browser: one page as a JPEG, several as one PDF (lib/pdf-writer.ts), under the upload limit. Nothing leaves the page
// until the one using this does something with the file (`onDone`); Cancel changes nothing.
//
// The frame, its handles and its keys are the ID scan's (employees/scan/crop.tsx); only the shape is free here.

/** What is adjusted: a file chosen in the page (a photo or a PDF), or a document stored in the employee file. */
export type AdjustSource = { file: File } | { itemId: string; fileName: string; mimeType: string };

/**
 * The most an adjusted document may weigh: an upload passes through the web app on Vercel, which takes at most 4.5 MB a
 * request (paperwork.ts), and the API takes 10 MB.
 */
export const ADJUSTED_MAX_BYTES = Math.min(PAPERWORK_MAX_BYTES, PDF_MAX_BYTES);
const LIMIT_TEXT = `${Math.round(ADJUSTED_MAX_BYTES / (1024 * 1024))} MB`;

/** A page as it is being adjusted: its picture as given, its small picture, and how it is turned, straightened and framed. */
interface Page {
  key: number;
  source: Blob;
  /** The picture's own size, as given. */
  width: number;
  height: number;
  thumb: HTMLCanvasElement;
  /** Turned clockwise by this, in degrees: 0, 90, 180 or 270. */
  quarter: number;
  /** Straightened by this, in degrees: the slider, ±10 in tenths. */
  fine: number;
  /** The frame, as shares of the page turned by `quarter`. */
  rect: Rect;
  removed: boolean;
}

/** The page on screen, opened at its full size (at most MAX_AREA points), turned by `quarter`. */
interface Work {
  key: number;
  quarter: number;
  canvas: HTMLCanvasElement;
}

/** What the adjuster says about the page: news (`ok`) or a warning; after a fit, the frame from before, for Undo the fit. */
interface Said {
  text: string;
  tone: 'ok' | 'warn';
  undo?: { key: number; rect: Rect; fine: number };
}

const UNOPENED = 'The document could not be opened to adjust it. Please try again.';
const READABLE = /^image\/(jpeg|png|webp)$/;

/** The page's size once turned by its quarter, as the frame is measured on it (at most MAX_AREA points). */
function turnedSize(p: Page): [number, number] {
  const [w, h] = openedSize(p.width, p.height);
  return p.quarter === 90 || p.quarter === 270 ? [h, w] : [w, h];
}

const changed = (p: Page) => p.removed || p.quarter !== 0 || p.fine !== 0 || !isWhole(p.rect);

/** The pages of a source, as pictures: a photo is opened here; a PDF, or a stored file that can't be, is prepared by the API. */
async function picturesOf(source: AdjustSource): Promise<Blob[] | { errors: string[] }> {
  const fromApi = (got: PagesState) =>
    got.pages?.length ? got.pages.map((p, i) => base64File(p.image, `page-${i + 1}.jpg`)) : { errors: got.errors?.length ? got.errors : [UNOPENED] };
  if ('file' in source) {
    const { file } = source;
    if (READABLE.test(file.type)) return [file];
    if (file.type !== 'application/pdf') return { errors: ['Choose a JPG, PNG or WebP photo, or a PDF.'] };
    if (file.size > PDF_MAX_BYTES) return { errors: [PDF_TOO_LARGE] };
    const fd = new FormData();
    fd.append('file', file, file.name);
    return fromApi(await preparePaperworkPages(fd));
  }
  if (READABLE.test(source.mimeType)) {
    // a stored photo is opened as the document viewer opens it, at its own size; if that fails, the API prepares it
    try {
      const res = await fetch(paperworkHref(source.itemId), { cache: 'no-store' });
      const blob = res.ok ? await res.blob() : null;
      if (blob && READABLE.test(blob.type)) return [blob];
    } catch {
      // the API is asked below
    }
  }
  return fromApi(await prepareStoredPages(source.itemId));
}

/** The pages of a source, ready to adjust: each with its small picture, as given, framed whole. */
async function pagesOf(source: AdjustSource): Promise<Page[] | { errors: string[] }> {
  const pictures = await picturesOf(source);
  if (!Array.isArray(pictures)) return pictures;
  const pages: Page[] = [];
  try {
    for (const [key, blob] of pictures.entries()) {
      const { thumb, width, height } = await thumbOf(blob);
      pages.push({ key, source: blob, width, height, thumb, quarter: 0, fine: 0, rect: wholeRect(), removed: false });
    }
  } catch {
    return { errors: ['This document could not be opened in this browser. Try another browser, or upload it as it is.'] };
  }
  return pages;
}

/** Straightens the page by hand: the look of the ID scan's RotateBar, for a page. */
function StraightenBar({ fine, onFine }: { fine: number; onFine: (fine: number) => void }) {
  const id = useId();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="inline-flex min-w-0 flex-[1_1_13rem] items-center gap-2 text-sm">
        <span>Straighten</span>
        <input
          id={id}
          className="w-[min(14rem,40vw)] accent-accent"
          type="range"
          min={-STRAIGHTEN_MAX}
          max={STRAIGHTEN_MAX}
          step="0.1"
          value={fine}
          aria-valuetext={degrees(fine)}
          onChange={(e) => onFine(+e.target.value)}
        />
      </label>
      <button type="button" className="btn btn-secondary" aria-label="Straighten a tenth of a degree anticlockwise" onClick={() => onFine(fine - 0.1)}>
        −0.1°
      </button>
      <output htmlFor={id} className="min-w-[3.4rem] text-center text-sm tabular-nums">
        {degrees(fine)}
      </output>
      <button type="button" className="btn btn-secondary" aria-label="Straighten a tenth of a degree clockwise" onClick={() => onFine(fine + 0.1)}>
        +0.1°
      </button>
    </span>
  );
}

/** A page in the list of pages, small, as it will be: turned, straightened and cut to its frame. */
function Thumb({ page }: { page: Page }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const { thumb, quarter, rect, fine } = page;
  useEffect(() => {
    const c = cv.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const src = turned(thumb, quarter);
    const cut = cutFrame(src, rect, fine, cutSize(rect, src.width, src.height, 240));
    c.width = cut.width;
    c.height = cut.height;
    g.drawImage(cut, 0, 0);
  }, [thumb, quarter, rect, fine]);
  return <canvas ref={cv} width={96} height={128} aria-hidden="true" className="block h-20 w-16 rounded-sm bg-white object-contain md:h-28 md:w-24" />;
}

/** What the frame will give, said under the page: its size in pixels, and its shape when it is a preset's. */
function PageSays({ page }: { page: Page }) {
  const [W, H] = turnedSize(page);
  const [w, h] = cutSize(page.rect, W, H, MAX_SIDE);
  const shape = shapeOf(page.rect, W, H);
  return (
    <>
      The page will be {w} × {h} pixels
      {shape === 'a4Portrait' ? ', the shape of an A4 sheet, portrait' : shape === 'a4Landscape' ? ', the shape of an A4 sheet, landscape' : ''}
      {page.fine ? `, straightened by ${degrees(page.fine)}` : ''}.
    </>
  );
}

export interface DocumentAdjusterProps {
  /** The document: a chosen file, or a stored one (its item id, file name and type). Opened once, when this is shown. */
  source: AdjustSource;
  /** The window's title, e.g. "Adjust Birth Certificate · Mona Adel". */
  title: string;
  /** What the button that gives the adjusted document says: "Save" (default) or "Use this". */
  saveLabel?: string;
  /** Asked (OK / Cancel) before the adjusted document is given, e.g. before it replaces a stored file. */
  confirmText?: string;
  /**
   * Given the adjusted document when Save is pressed. What goes wrong, as sentences, is shown in the window, which stays
   * open; when nothing does, the window closes (onClose).
   */
  onDone: (adjusted: Adjusted) => Promise<string[] | void | undefined> | string[] | void | undefined;
  /** The window was closed: after onDone, or with Cancel (nothing changed). Put the focus back where it was. */
  onClose: () => void;
}

/** The document adjuster, a modal window: shown as soon as it is added, at the end of the page. See the top of this file. */
export function DocumentAdjuster({ source, title, saveLabel = 'Save', confirmText, onDone, onClose }: DocumentAdjusterProps) {
  const titleId = useId();
  const howId = useId();
  const [pages, setPages] = useState<Page[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentKey, setCurrentKey] = useState(0);
  const [work, setWork] = useState<Work | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [fitting, setFitting] = useState(false);
  const [saving, setSaving] = useState<null | 'making' | 'saving'>(null);
  const [errors, setErrors] = useState<string[]>();

  /** The pages as they are now, for work that finishes later (opening a page, fitting the frame). */
  const pagesNow = useRef<Page[]>([]);
  useEffect(() => {
    pagesNow.current = pages;
  }, [pages]);
  /** Which opening of a page is the latest: an earlier one that finishes after it is let go. */
  const openings = useRef(0);

  const name = 'file' in source ? source.file.name : source.fileName;
  const page = pages.find((p) => p.key === currentKey) ?? null;
  const index = page ? pages.indexOf(page) : -1;
  const shown = page && work && work.key === page.key && work.quarter === page.quarter ? work.canvas : null;
  const kept = pages.filter((p) => !p.removed);
  const busy = saving !== null;

  /** Opens a page at its full size, to frame it. */
  const openWork = useCallback(async (p: Page) => {
    const run = ++openings.current;
    try {
      let canvas = await openPage(p.source, p.quarter);
      if (run !== openings.current) return;
      // turned meanwhile: turned the same way here
      const now = pagesNow.current.find((x) => x.key === p.key);
      let quarter = p.quarter;
      if (now && now.quarter !== quarter) {
        canvas = turnCanvas(canvas, (now.quarter - quarter + 360) % 360);
        quarter = now.quarter;
      }
      setWork({ key: p.key, quarter, canvas });
    } catch {
      if (run === openings.current) setSaid({ text: 'This page could not be opened in this browser.', tone: 'warn' });
    }
  }, []);

  // the document's pages, once, when the window opens
  useEffect(() => {
    let live = true;
    pagesOf(source).then(
      (got) => {
        if (!live) return;
        if (!Array.isArray(got)) {
          setLoadErrors(got.errors);
          return;
        }
        setPages(got);
        setCurrentKey(got[0].key);
        setLoaded(true);
        void openWork(got[0]);
      },
      () => {
        if (live) setLoadErrors([UNOPENED]);
      },
    );
    return () => {
      live = false;
    };
  }, [source, openWork]);

  const dialogEl = useRef<HTMLDialogElement | null>(null);
  const attach = useCallback((dialog: HTMLDialogElement | null) => {
    dialogEl.current = dialog;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /** Closes the window: its close event calls onClose, once the rest of the page can take the focus again. */
  function finish() {
    const dialog = dialogEl.current;
    if (dialog?.open) dialog.close();
    else onClose();
  }

  /** Changes the page on screen; anything said about it before no longer holds. */
  function update(key: number, change: (p: Page) => Partial<Page>, says: Said | null = null) {
    setPages((ps) => ps.map((p) => (p.key === key ? { ...p, ...change(p) } : p)));
    setSaid(says);
  }

  function select(key: number) {
    if (key === currentKey) return;
    setCurrentKey(key);
    setSaid(null);
    const p = pages.find((x) => x.key === key);
    // back to the page already open: an opening of another page still on its way is let go
    if (work?.key === key) openings.current++;
    else if (p) void openWork(p);
  }

  function rotate() {
    if (!page || busy) return;
    const key = page.key;
    update(key, (p) => ({ quarter: (p.quarter + 90) % 360, rect: turnRect(p.rect) }));
    setWork((w) => (w && w.key === key ? { key, quarter: (w.quarter + 90) % 360, canvas: turnCanvas(w.canvas, 90) } : w));
  }

  function reset() {
    if (!page || busy) return;
    const key = page.key;
    update(key, () => ({ quarter: 0, fine: 0, rect: wholeRect() }), { text: `Page ${index + 1} is back as it was given.`, tone: 'ok' });
    setWork((w) => (w && w.key === key && w.quarter ? { key, quarter: 0, canvas: turnCanvas(w.canvas, 360 - w.quarter) } : w));
  }

  function preset(ratio: number | null) {
    if (!page || busy) return;
    const [W, H] = turnedSize(page);
    update(page.key, (p) => ({ rect: ratio === null ? wholeRect() : ratioRect(p.rect, W, H, ratio) }));
  }

  function toggleRemoved(key: number) {
    if (busy) return;
    setPages((ps) => ps.map((p) => (p.key === key ? { ...p, removed: !p.removed } : p)));
    setSaid(null);
  }

  /**
   * "Fit to the page's edges": the paper's own edges are looked for near the frame (lib/page-edges.ts), and the frame
   * is laid on them, with the page straightened on the slider. When no edges show, the frame is left as it was.
   */
  function fitToEdges() {
    const st = page;
    const pic = shown;
    if (!st || !pic || fitting || busy) return;
    setFitting(true);
    // the button says it is looking before the search starts: a fraction of a second, more on a slow phone
    requestAnimationFrame(() =>
      setTimeout(() => {
        let fit: PageFit | null | undefined;
        try {
          fit = fitPage(pixelsOf(pic), { rect: st.rect, fine: st.fine });
        } catch {
          // a browser that gives no canvas to read (fit stays undefined)
        }
        setFitting(false);
        const now = pagesNow.current.find((p) => p.key === st.key);
        if (!now || now.rect !== st.rect || now.fine !== st.fine || now.quarter !== st.quarter) return; // changed meanwhile
        if (fit === undefined) {
          setSaid({ text: 'The page could not be looked at in this browser. Frame it by hand.', tone: 'warn' });
          return;
        }
        if (!fit) {
          setSaid({
            text: "The page's edges couldn't be found near the frame, so it was left as it was. Frame the page more closely and try again.",
            tone: 'warn',
          });
          return;
        }
        const { rect, fine, sides } = fit;
        const by = Math.round((fine - st.fine) * 10) / 10;
        const text =
          (by
            ? `The frame has been fitted to the page's edges and the page straightened by ${degrees(by)}.`
            : "The frame has been fitted to the page's edges; the page was already level.") +
          (sides < 4 ? ' One side showed no edge, so it stays where the frame was.' : '') +
          ` Check it, then press ${saveLabel}.`;
        update(st.key, () => ({ rect, fine }), { text, tone: 'ok', undo: { key: st.key, rect: st.rect, fine: st.fine } });
      }, 0),
    );
  }

  /** Undo the fit: the frame and the slider go back to where they were before "Fit to the page's edges". */
  function undoFit() {
    const before = said?.undo;
    if (!before) return;
    update(before.key, () => ({ rect: before.rect, fine: before.fine }), { text: 'The frame is back where it was.', tone: 'ok' });
  }

  async function save() {
    if (busy || !loaded || !kept.length) return;
    setErrors(undefined);
    setSaving('making');
    let adjusted: Adjusted;
    try {
      adjusted = await makeDocument(
        kept.map((p) => ({
          source: p.source,
          quarter: p.quarter,
          fine: p.fine,
          rect: p.rect,
          work: work && work.key === p.key && work.quarter === p.quarter ? work.canvas : null,
        })),
        name,
        ADJUSTED_MAX_BYTES,
        LIMIT_TEXT,
      );
    } catch (err) {
      setErrors([err instanceof Error && err.message ? err.message : 'The adjusted document could not be made in this browser.']);
      setSaving(null);
      return;
    }
    if (confirmText && !window.confirm(adjusted.note ? `${confirmText}\n\n${adjusted.note}` : confirmText)) {
      setSaving(null);
      return;
    }
    setSaving('saving');
    let failed: string[] | void | undefined;
    try {
      failed = await onDone(adjusted);
    } catch {
      failed = ['The adjusted document could not be saved. Please try again.'];
    }
    if (failed?.length) {
      setErrors(failed);
      setSaving(null);
      return;
    }
    finish();
  }

  function cancel() {
    if (busy) return;
    if (pages.some(changed) && !window.confirm('Discard the changes to this document?')) return;
    finish();
  }

  const summary = !loaded
    ? ''
    : !kept.length
      ? 'Every page is removed: put one back to save.'
      : `${kept.length === pages.length ? '' : `${kept.length} of ${pages.length} pages kept. `}Saved as ${kept.length > 1 ? `one PDF of ${kept.length} pages` : 'a JPG picture'}, ${LIMIT_TEXT} at most.`;

  const textButton = 'inline-flex min-h-9 cursor-pointer items-center text-xs font-semibold hover:underline';

  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      // Esc asks before it throws the changes away
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      onClose={onClose}
      className="m-auto h-[calc(100dvh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-6xl overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col sm:h-[calc(100dvh-4rem)] sm:w-[calc(100vw-4rem)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="min-w-0 self-center font-semibold break-words">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close without saving"
          onClick={cancel}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {pages.length > 1 && (
          <nav aria-label="Pages" className="shrink-0 overflow-auto border-b border-line p-2 md:w-40 md:border-r md:border-b-0 md:p-3">
            <ol className="flex gap-3 md:flex-col">
              {pages.map((p, i) => (
                <li key={p.key} className="grid shrink-0 justify-items-start gap-0.5">
                  <button
                    type="button"
                    aria-pressed={p.key === currentKey}
                    onClick={() => select(p.key)}
                    className={`cursor-pointer rounded-md border-2 p-1 text-left ${p.key === currentKey ? 'border-accent' : 'border-transparent hover:border-line'}`}
                  >
                    <span className={p.removed ? 'block opacity-35' : 'block'}>
                      <Thumb page={p} />
                    </span>
                    <span className="mt-1 block text-xs">
                      Page {i + 1}
                      <span className="sr-only"> of {pages.length}</span>
                      {p.removed && <span className="text-muted"> · removed</span>}
                    </span>
                  </button>
                  <button type="button" onClick={() => toggleRemoved(p.key)} className={`${textButton} ${p.removed ? 'text-accent' : 'text-danger'}`}>
                    {p.removed ? 'Put back' : 'Remove'}
                    <span className="sr-only"> page {i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-auto p-4">
          {loadErrors ? (
            <FormErrors errors={loadErrors} />
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted">
              Opening the document…
            </p>
          ) : (
            page &&
            (page.removed ? (
              <div className="space-y-3">
                <p className="text-sm">Page {index + 1} is removed: it won&apos;t be in the adjusted document.</p>
                <button type="button" onClick={() => toggleRemoved(page.key)} className="btn btn-secondary">
                  Put back page {index + 1}
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={rotate} className="btn btn-secondary">
                    Rotate 90°
                  </button>
                  <span role="group" aria-label="Frame" className="inline-flex flex-wrap gap-2">
                    <button type="button" onClick={() => preset(null)} className="btn btn-secondary">
                      Whole page
                    </button>
                    <button type="button" onClick={() => preset(PRESETS.a4Portrait)} className="btn btn-secondary">
                      A4 portrait
                    </button>
                    <button type="button" onClick={() => preset(PRESETS.a4Landscape)} className="btn btn-secondary">
                      A4 landscape
                    </button>
                  </span>
                  {/* aria-disabled rather than disabled while it looks, so that the button keeps the keyboard's focus */}
                  <button
                    type="button"
                    onClick={fitToEdges}
                    aria-disabled={fitting || !shown}
                    className="btn btn-secondary aria-disabled:cursor-wait aria-disabled:opacity-60"
                  >
                    {fitting ? 'Finding the edges…' : "Fit to the page's edges"}
                  </button>
                  <button type="button" onClick={reset} className="btn btn-secondary">
                    Reset
                  </button>
                </div>
                <StraightenBar fine={page.fine} onFine={(v) => update(page.key, () => ({ fine: straightenOf(v) }))} />
                {/* above the picture, so that it is seen without scrolling */}
                {said &&
                  (said.tone === 'ok' ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p role="status" className="text-sm text-ok">
                        {said.text}
                      </p>
                      {said.undo && (
                        <button type="button" onClick={undoFit} className="btn btn-secondary">
                          Undo the fit
                        </button>
                      )}
                    </div>
                  ) : (
                    <p role="alert" className="text-sm text-warn">
                      {said.text}
                    </p>
                  ))}
                <Cropper
                  key={page.key}
                  work={shown}
                  angle={page.fine}
                  rect={page.rect}
                  onRect={(rect) => update(page.key, () => ({ rect }))}
                  label={`Page ${index + 1} of the document`}
                  frame="Frame of the page"
                  describedBy={howId}
                />
                {!shown && <p className="text-sm text-muted">Opening the page…</p>}
                <p className="text-sm text-muted" aria-live="polite">
                  <PageSays page={page} />
                </p>
                <p id={howId} className="text-xs text-muted">
                  Drag the frame over the document, or drag its handles to resize it: it takes any shape. Straighten the page up to 10 degrees
                  either way, a tenth of a degree at a time. Or frame it roughly and press Fit to the page&apos;s edges: the frame snaps onto the
                  paper&apos;s edges and the page is set level. With the keyboard, the arrow keys move the frame and Shift with the arrow keys
                  resizes it.
                </p>
              </>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-line px-5 py-3">
        <FormErrors errors={errors} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {summary}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={cancel} aria-disabled={busy} className="btn btn-secondary aria-disabled:opacity-60">
              Cancel
            </button>
            {!loadErrors && (
              <button
                type="button"
                onClick={() => void save()}
                aria-disabled={busy || !loaded || !kept.length}
                className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              >
                {saving === 'making' ? 'Making the document…' : saving === 'saving' ? 'Saving…' : saveLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
