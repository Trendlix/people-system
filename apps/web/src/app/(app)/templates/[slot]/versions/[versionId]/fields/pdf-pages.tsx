'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import type { PdfPageSize } from '@trendlix/shared';

// The pages of a PDF template drawn in the browser with pdf.js, one under the other, at the zoom asked for, for Place
// Fields to draw its fields over (`children`: what goes over each page, in its own box of the page's size on screen).
// pdf.js is loaded only on this page, with its worker made by the bundler from pdfjs-dist (a module worker, as
// Turbopack and webpack both build `new Worker(new URL(…, import.meta.url))`). The file comes from the web server's
// own route (the browser never talks to the API). Pages are drawn once they come near the scrolling area's view, at the
// screen's pixel density so the form is sharp, and drawn again a moment after the zoom settles.

type Pdfjs = typeof import('pdfjs-dist');

let pdfjs: Promise<Pdfjs> | null = null;

/** pdf.js, loaded once, with its worker. */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= import('pdfjs-dist')
    .then((lib) => {
      lib.GlobalWorkerOptions.workerPort ??= new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
      return lib;
    })
    .catch((err: unknown) => {
      pdfjs = null; // tried again the next time
      throw err;
    });
  return pdfjs;
}

/** A page's canvas holds at most this many pixels (a long page at 150% on a sharp screen would take more memory). */
const MAX_PIXELS = 16_000_000;

const NOT_LOADED = 'The form could not be loaded. Reload the page to try again.';

type Loaded = { kind: 'loading' } | { kind: 'ok'; doc: PDFDocumentProxy } | { kind: 'failed'; message: string };

/** The web server's route refused the file, with its reason. */
class Refused extends Error {}

/** The reason the web server's route gave (plain text, e.g. a refusal), when it is short enough to show. */
async function reasonOf(res: Response, notLoaded: string): Promise<string> {
  const type = res.headers.get('content-type') ?? '';
  const text = type.startsWith('text/plain') ? (await res.text().catch(() => '')).trim() : '';
  return text && text.length < 300 ? text : notLoaded;
}

/**
 * The PDF at `src`, opened with pdf.js; `onOpened` is told the size of each page, in points, as pdf.js shows it at scale
 * 1. `notLoaded`: what is said when it can't be opened.
 */
function usePdfDocument(src: string, onOpened?: (sizes: PdfPageSize[]) => void, notLoaded = NOT_LOADED): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const opened = useRef(onOpened);
  useEffect(() => {
    opened.current = onOpened;
  });
  useEffect(() => {
    let gone = false;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      const res = await fetch(src, { cache: 'no-store' });
      if (!res.ok) throw new Refused(await reasonOf(res, notLoaded));
      const data = new Uint8Array(await res.arrayBuffer());
      const lib = await loadPdfjs();
      if (gone) return;
      task = lib.getDocument({ data, isEvalSupported: false });
      const doc = await task.promise;
      const sizes: PdfPageSize[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { width, height } = (await doc.getPage(n)).getViewport({ scale: 1 });
        sizes.push({ width, height });
      }
      if (gone) return;
      opened.current?.(sizes);
      setLoaded({ kind: 'ok', doc });
    })().catch((err: unknown) => {
      if (!gone) setLoaded({ kind: 'failed', message: err instanceof Refused ? err.message : notLoaded });
    });
    return () => {
      gone = true;
      void task?.destroy();
    };
  }, [src, notLoaded]);
  return loaded;
}

/** `value`, once it has stayed the same for `ms` (the zoom while Fit width follows a window being resized). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** One page: its canvas, drawn once near the view and again at each settled zoom, and what goes over it. */
function PageView({
  doc,
  number,
  size,
  scale,
  root,
  children,
}: {
  doc: PDFDocumentProxy | null;
  number: number;
  size: PdfPageSize;
  scale: number;
  root: Element | null;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState<'no' | 'yes' | 'failed'>('no');
  const settled = useSettled(scale, 150);

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { root, rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root, near]);

  useEffect(() => {
    if (!doc || !near) return;
    let gone = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(number);
      if (gone) return;
      const base = page.getViewport({ scale: 1 });
      let px = ((size.width * settled) / base.width) * Math.min(window.devicePixelRatio || 1, 3);
      if (base.width * base.height * px * px > MAX_PIXELS) px = Math.sqrt(MAX_PIXELS / (base.width * base.height));
      const viewport = page.getViewport({ scale: px });
      // drawn aside, then copied: the page on screen stays as it was (stretched) until the sharper one is ready
      const aside = document.createElement('canvas');
      aside.width = Math.max(1, Math.floor(viewport.width));
      aside.height = Math.max(1, Math.floor(viewport.height));
      task = page.render({ canvas: aside, viewport });
      await task.promise;
      const shown = canvas.current;
      if (gone || !shown) return;
      shown.width = aside.width;
      shown.height = aside.height;
      shown.getContext('2d')?.drawImage(aside, 0, 0);
      setDrawn('yes');
    })().catch((err: unknown) => {
      if (!gone && !(err instanceof Error && err.name === 'RenderingCancelledException')) setDrawn('failed');
    });
    return () => {
      gone = true;
      task?.cancel();
    };
  }, [doc, near, number, settled, size.width]);

  return (
    <div
      ref={box}
      data-page={number}
      className="relative mx-auto shrink-0 bg-white shadow-[0_1px_3px_rgba(18,22,31,.18)]"
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full" />
      {drawn !== 'yes' && (
        <p className={`absolute inset-x-0 top-6 text-center text-sm ${drawn === 'failed' ? 'text-danger' : 'text-muted'}`}>
          {drawn === 'failed' ? `Page ${number} could not be drawn.` : `Loading page ${number}…`}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The pages of the PDF at `src`, `pages` (in points) at `scale` screen pixels a point, one under the other. `root`: the
 * scrolling area they are in; `onOpened`: the page sizes pdf.js read; `children(n, size)`: what goes over page n.
 * `notLoaded`: what is said when the file can't be opened (another document than a form, e.g. a payslip on the phone
 * pages, owner, 20 October 2026: the employee app).
 */
export function PdfPages({
  src,
  pages,
  scale,
  root,
  onOpened,
  notLoaded,
  children,
}: {
  src: string;
  pages: readonly PdfPageSize[];
  scale: number;
  root: Element | null;
  onOpened?: (sizes: PdfPageSize[]) => void;
  notLoaded?: string;
  children: (page: number, size: PdfPageSize) => React.ReactNode;
}) {
  const loaded = usePdfDocument(src, onOpened, notLoaded);
  return (
    // as wide as the widest page at a zoom past the area's width (so it scrolls sideways), else as wide as the area
    <div className="flex w-max min-w-full flex-col gap-4 p-4">
      {loaded.kind === 'failed' && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          {loaded.message}
        </p>
      )}
      {/* sizes read from the file itself (a payslip on the phone pages): until it is opened, nothing else shows */}
      {loaded.kind === 'loading' && pages.length === 0 && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
      {pages.map((size, i) => (
        <PageView key={i} doc={loaded.kind === 'ok' ? loaded.doc : null} number={i + 1} size={size} scale={scale} root={root}>
          {children(i + 1, size)}
        </PageView>
      ))}
    </div>
  );
}
