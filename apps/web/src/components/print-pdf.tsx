'use client';

import { useEffect, useRef, useState } from 'react';
import { PRINT_FAILED, printProblem, printWay } from '@/lib/print-pdf';

// The Print button of a filled document (owner's request, 20 October 2026: "add Print Button"), beside its Preview and
// Download PDF: its protected PDF allows printing, so the PDF is loaded from the document's own route (with the session,
// as Preview loads it) into a hidden frame and the browser's print dialog is opened for that frame once it has loaded.
// Where a browser can't print a PDF inside a frame (Safari, iPhone, iPad, Android: lib/print-pdf.ts), the PDF is opened
// in a new tab instead, with a hint where Print is. Nothing is loaded until the button is pressed, and it is loaded
// again at each press: the route reads the document afresh (a draft offer's is filled in anew).

/** `tab`: printed from a tab of its own, `opened` already or (the browser refused the frame) for the user to open. */
type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'tab'; hint: string; opened: boolean } | { kind: 'failed'; message: string };

const HIDDEN: React.CSSProperties = { position: 'absolute', width: 0, height: 0, border: 0, visibility: 'hidden' };

/** How long the PDF has to load into its frame before the page says it couldn't be printed. */
const LOAD_WAIT_MS = 20_000;

/**
 * A button (`children`: what it says) that prints the PDF at `src`, a route of this site serving it inline (e.g. an
 * offer's /offers/<id>/document). `title`: the hidden frame's name, for assistive technology.
 */
export function PrintPdf({ src, title, children, className }: { src: string; title: string; children: React.ReactNode; className?: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  // the PDF's address in this page while its frame is there: kept until the next print, as the print dialog reads it
  const [frame, setFrame] = useState<string | null>(null);
  const printed = useRef(false);
  // each press, so that a wait left from an earlier one says nothing about this one
  const press = useRef(0);

  // the PDF is let go when another is loaded, or the page is left
  useEffect(() => (frame ? () => URL.revokeObjectURL(frame) : undefined), [frame]);

  async function print() {
    const way = printWay({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
    if (way.kind === 'tab') {
      // opened at once, while the press still counts as the user's: a pop-up blocker lets it through
      window.open(src, '_blank', 'noopener');
      setState({ kind: 'tab', hint: way.hint, opened: true });
      return;
    }
    setState({ kind: 'loading' });
    const at = ++press.current;
    try {
      const res = await fetch(src, { cache: 'no-store', credentials: 'same-origin' });
      const problem = await printProblem(res);
      if (problem) {
        setState({ kind: 'failed', message: problem });
        return;
      }
      const blob = await res.blob();
      printed.current = false;
      setFrame(URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })));
      // a frame that never says it has loaded leaves the button usable again
      window.setTimeout(() => {
        if (press.current === at) setState((s) => (s.kind === 'loading' ? { kind: 'failed', message: PRINT_FAILED } : s));
      }, LOAD_WAIT_MS);
    } catch {
      setState({ kind: 'failed', message: PRINT_FAILED });
    }
  }

  function loaded(e: React.SyntheticEvent<HTMLIFrameElement>) {
    if (printed.current) return;
    printed.current = true;
    const win = e.currentTarget.contentWindow;
    try {
      e.currentTarget.focus();
      win?.print();
      setState({ kind: 'idle' });
    } catch {
      // the browser wouldn't print the frame after all: the PDF opened in a tab of its own (by the user: a pop-up opened
      // here, after the press, would be blocked), printed from there
      setState({ kind: 'tab', hint: 'This browser prints it from a tab of its own.', opened: false });
    }
  }

  const loading = state.kind === 'loading';
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button type="button" onClick={print} disabled={loading} aria-busy={loading || undefined} className={className}>
        {loading ? 'Preparing…' : children}
      </button>
      {state.kind === 'tab' && (
        <span role="status" className="max-w-xs text-xs text-muted">
          {state.opened && 'Opened in a new tab. '}
          {state.hint}{' '}
          <a href={src} target="_blank" rel="noopener" className="font-semibold">
            {state.opened ? 'Open it again' : 'Open the PDF'}
          </a>
        </span>
      )}
      {state.kind === 'failed' && (
        <span role="alert" className="max-w-xs text-xs whitespace-pre-line text-danger">
          {state.message}
        </span>
      )}
      {frame && <iframe key={frame} src={frame} title={title} aria-hidden="true" tabIndex={-1} onLoad={loaded} style={HIDDEN} />}
    </span>
  );
}
