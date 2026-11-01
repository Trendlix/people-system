'use client';

import { emailTemplateProblems, fillTemplate, sampleValues, type EmailTemplateText, type EmailTemplateView } from '@trendlix/shared';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { changed, insertField, paragraphsOf, wordsOf } from '@/lib/email-templates';
import { formatDateTime } from '@/lib/format';
import type { TemplateResult } from './actions';

// One email on Organization → Email Templates (1 November 2026): its name, who gets it and when, and whether it goes
// with HR's words or the standard ones; opened, the subject and text with the fields to put in, a live preview with
// sample values, what's wrong before Save, "Send me a test" and "Reset to standard". The API checks everything again.

type Actions = {
  save: (key: string, words: EmailTemplateText) => Promise<TemplateResult>;
  reset: (key: string) => Promise<TemplateResult>;
  test: (key: string, words: EmailTemplateText) => Promise<TemplateResult>;
};

type Busy = 'save' | 'reset' | 'test' | null;

const RESET_CONFIRM = 'Go back to the standard words?';

/** The preview: the subject, then the text as the email shows it, each paragraph in its own direction (Arabic right to left). */
function Preview({ template, words }: { template: EmailTemplateView; words: EmailTemplateText }) {
  const values = sampleValues(template.key);
  const subject = fillTemplate(words.subject, values).replace(/\s+/g, ' ');
  const text = fillTemplate(words.body, values);
  return (
    <div className="rounded-lg border border-line bg-canvas p-4 text-sm">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Preview, with sample values</p>
      <p className="mt-2 font-semibold break-words" dir="auto">
        {subject || <span className="text-muted">No subject</span>}
      </p>
      <div className="mt-3 space-y-3 break-words">
        {paragraphsOf(text).map((lines, i) => (
          <p key={i} dir="auto">
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {l}
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}

export function TemplateCard({ template, edits, testTo, actions }: { template: EmailTemplateView; edits: boolean; testTo: string; actions: Actions }) {
  const [view, setView] = useState(template);
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<EmailTemplateText>(wordsOf(template));
  const [result, setResult] = useState<TemplateResult | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [, startTransition] = useTransition();
  const id = useId();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // the box a field goes into: the one last typed in (the text at first)
  const lastBox = useRef<'subject' | 'body'>('body');

  // the page opened at this email (the Audit Log's "Open email templates" link ends with #its-key)
  useEffect(() => {
    // read once, on the client: the address isn't the server's to see
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.location.hash === `#${template.key}`) setOpen(true);
  }, [template.key]);

  const problems = emailTemplateProblems(view.key, words);
  const dirty = changed(view, words);
  const standardNow = !view.custom;

  function run(kind: Exclude<Busy, null>, call: () => Promise<TemplateResult>) {
    setBusy(kind);
    setResult(null);
    startTransition(async () => {
      const r = await call();
      setBusy(null);
      setResult(r);
      if (r.view) {
        setView(r.view);
        setWords(wordsOf(r.view));
      }
    });
  }

  function addField(field: string) {
    const box = lastBox.current === 'subject' ? subjectRef.current : bodyRef.current;
    const key = lastBox.current;
    const current = words[key];
    const { text, cursor } = insertField(current, field, box?.selectionStart ?? null, box?.selectionEnd ?? null);
    setWords({ ...words, [key]: text });
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(cursor, cursor);
    });
  }

  function cancel() {
    setWords(wordsOf(view));
    setResult(null);
    setOpen(false);
  }

  return (
    <article id={view.key} aria-labelledby={`${id}-title`} className="card scroll-mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id={`${id}-title`} className="font-semibold">
            {view.label}
          </h3>
          <p className="text-sm text-muted">{view.when}</p>
          <p className="text-xs text-muted">
            {standardNow ? (
              <span className="rounded-full bg-line-soft px-2 py-0.5 font-semibold text-ink">Standard words</span>
            ) : (
              <>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">Your words</span>{' '}
                Saved {formatDateTime(view.custom!.updatedAt)}
                {view.custom!.updatedBy ? ` by ${view.custom!.updatedBy.name}` : ''}.
              </>
            )}
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} aria-controls={`${id}-editor`} aria-expanded={false} className="btn btn-secondary min-h-9 px-3">
            {edits ? 'Edit' : 'View'}
          </button>
        )}
      </div>
      {!open && (
        <p className="mt-3 truncate text-sm" dir="auto">
          <span className="text-muted">Subject: </span>
          {wordsOf(view).subject}
        </p>
      )}

      {open && (
        <div id={`${id}-editor`} className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <div>
              <label htmlFor={`${id}-subject`} className="label">
                Subject
              </label>
              <input
                ref={subjectRef}
                id={`${id}-subject`}
                value={words.subject}
                onChange={(e) => setWords({ ...words, subject: e.target.value })}
                onFocus={() => (lastBox.current = 'subject')}
                readOnly={!edits}
                maxLength={200}
                dir="auto"
                className="input"
              />
            </div>
            <div>
              <label htmlFor={`${id}-body`} className="label">
                Text
              </label>
              <textarea
                ref={bodyRef}
                id={`${id}-body`}
                value={words.body}
                onChange={(e) => setWords({ ...words, body: e.target.value })}
                onFocus={() => (lastBox.current = 'body')}
                readOnly={!edits}
                maxLength={10000}
                rows={16}
                dir="auto"
                className="input font-mono text-[13px] leading-relaxed"
              />
            </div>
            {edits && (
              <div>
                <p className="label">Fields</p>
                <ul className="flex flex-wrap gap-2">
                  {view.fields.map((f) => (
                    <li key={f.key}>
                      <button
                        type="button"
                        onClick={() => addField(f.key)}
                        title={`${f.label}. Sample: ${f.sample || '(empty)'}`}
                        className="rounded-full border border-line px-2.5 py-1 font-mono text-xs hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {`{{${f.key}}}`}
                        {view.required.includes(f.key) && <span className="sr-only"> (needed)</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
                  {view.fields.map((f) => (
                    <div key={f.key} className="contents">
                      <dt className="font-mono">{`{{${f.key}}}`}</dt>
                      <dd>
                        {f.label}
                        {view.required.includes(f.key) ? ' · needed' : ''}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <Preview template={view} words={words} />
          </div>

          <div className="space-y-3 lg:col-span-2">
            {edits && problems.length > 0 && (
              <ul role="alert" className="space-y-1 rounded-lg bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {result?.errors && (
              <ul role="alert" className="space-y-1 rounded-lg bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
                {result.errors.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {edits && (
                <>
                  <button
                    type="button"
                    onClick={() => run('save', () => actions.save(view.key, words))}
                    disabled={!!busy || !dirty || problems.length > 0}
                    className="btn btn-primary"
                  >
                    {busy === 'save' ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => run('test', () => actions.test(view.key, words))}
                    disabled={!!busy || problems.length > 0}
                    title={`Sends this email, with the sample values, to ${testTo}`}
                    className="btn btn-secondary"
                  >
                    {busy === 'test' ? 'Sending…' : 'Send me a test'}
                  </button>
                  {!standardNow && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(RESET_CONFIRM)) run('reset', () => actions.reset(view.key));
                      }}
                      disabled={!!busy}
                      className="btn btn-secondary"
                    >
                      {busy === 'reset' ? 'Resetting…' : 'Reset to standard'}
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={cancel} disabled={!!busy} className="btn btn-secondary">
                {edits && dirty ? 'Cancel' : 'Close'}
              </button>
            </div>
            {result?.message && !busy && (
              <p role="status" className="text-sm text-ok">
                {result.message}
              </p>
            )}
            {result?.test && !busy && (
              <p role="status" className={`text-sm ${result.test.ok ? 'text-ok' : 'text-danger'}`}>
                {result.test.message}
              </p>
            )}
            {edits && !standardNow && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">See the standard words</summary>
                <div className="mt-3">
                  <Preview template={view} words={view.start} />
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
