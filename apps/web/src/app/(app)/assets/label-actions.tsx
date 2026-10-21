'use client';

import { useActionState, useRef, useState } from 'react';
import { FormErrors } from '@/components/form';
import type { FormState } from '@/lib/types';

// The label page's buttons (spec §5: "after printing set labeled_at"): Print label prints the label's own document
// (label.ts) from a frame in the page, so nothing else of the page prints; once it is stuck on, Mark as labelled (a
// custodian's or a manager's) records when. Since step 3 (custody, 21 October 2026) the same button prints the custody
// form and the custody statement (custody-form.ts): PrintDocumentButton, with what it says.

export function PrintLabelButton({ document: html, title }: { document: string; title: string }) {
  return <PrintDocumentButton document={html} title={title} label="Print label" what="label" />;
}

/** Prints a document of its own (`document`: a whole HTML page) from a frame in the page, so nothing else prints. */
export function PrintDocumentButton({ document: html, title, label, what }: { document: string; title: string; label: string; what: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  function print() {
    setProblem(null);
    frame.current?.remove();
    const f = window.document.createElement('iframe');
    f.title = title;
    f.setAttribute('aria-hidden', 'true');
    f.style.position = 'fixed';
    f.style.width = '0';
    f.style.height = '0';
    f.style.border = '0';
    f.style.right = '0';
    f.style.bottom = '0';
    f.onload = () => {
      try {
        f.contentWindow?.focus();
        f.contentWindow?.print();
      } catch {
        setProblem(`The ${what} could not be printed from here. Try another browser, or print this page.`);
      }
    };
    f.srcdoc = html;
    window.document.body.appendChild(f);
    frame.current = f;
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={print} className="btn btn-primary">
        {label}
      </button>
      {problem && (
        <span role="alert" className="text-xs text-danger">
          {problem}
        </span>
      )}
    </span>
  );
}

export function MarkLabelledForm({ action, labelled }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; labelled: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Saving…' : labelled ? 'Mark as labelled again' : 'Mark as labelled'}
        </button>
        {state.message && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
