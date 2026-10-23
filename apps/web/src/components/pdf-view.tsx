'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfPageSize } from '@trendlix/shared';
import { PdfPages } from '@/app/(app)/organization/templates/[slot]/versions/[versionId]/fields/pdf-pages';

// A PDF drawn in the page, its pages one under the other as wide as the screen (owner, 20 October 2026: the employee
// app, "My attendance and payslips"): a payslip on the phone pages. A phone's web view (the app's) can't show a PDF in a
// frame, so it is drawn with pdf.js, as Place Fields draws a template (pdf-pages.tsx); the file comes from the site's own
// route, with the session. The page sizes are read from the file once it is opened, and the pages fitted to the width.
// The document viewer draws its PDFs with it too on the phone pages and inside the app (the app's Phase 2, 20 October
// 2026), from an address or a file chosen in the page; `bleed`: out to the screen's edges (a page's own PDF, the
// payslip), else within its box (the viewer's window).

/** The space PdfPages leaves around the pages (p-4), on each side. */
const PADDING = 16;

export function PdfView({ src, title, notLoaded, bleed = true }: { src: string | Blob; title: string; notLoaded: string; bleed?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PdfPageSize[]>([]);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const opened = useCallback((sizes: PdfPageSize[]) => setPages(sizes), []);
  const widest = Math.max(1, ...pages.map((p) => p.width));
  const scale = width > PADDING * 2 ? (width - PADDING * 2) / widest : 1;

  return (
    <div ref={box} role="document" aria-label={title} className={`overflow-x-hidden bg-line-soft ${bleed ? '-mx-4' : ''}`}>
      <PdfPages src={src} pages={pages} scale={scale} root={null} onOpened={opened} notLoaded={notLoaded}>
        {() => null}
      </PdfPages>
    </div>
  );
}
