'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfPageSize } from '@trendlix/shared';
import { PdfPages } from '@/app/(app)/templates/[slot]/versions/[versionId]/fields/pdf-pages';

// A PDF drawn in the page, its pages one under the other as wide as the screen (owner, 20 October 2026: the employee
// app, "My attendance and payslips"): a payslip on the phone pages. A phone's web view (the app's) can't show a PDF in a
// frame, so it is drawn with pdf.js, as Place Fields draws a template (pdf-pages.tsx); the file comes from the site's own
// route, with the session. The page sizes are read from the file once it is opened, and the pages fitted to the width.

/** The space PdfPages leaves around the pages (p-4), on each side. */
const PADDING = 16;

export function PdfView({ src, title, notLoaded }: { src: string; title: string; notLoaded: string }) {
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
    <div ref={box} role="document" aria-label={title} className="-mx-4 overflow-x-hidden bg-line-soft">
      <PdfPages src={src} pages={pages} scale={scale} root={null} onOpened={opened} notLoaded={notLoaded}>
        {() => null}
      </PdfPages>
    </div>
  );
}
