'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { TEMPLATE_LANGUAGES, type TemplateLanguage } from '@trendlix/shared';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { UploadState } from './actions';
import { BILINGUAL_HINT, DOCX_ACCEPT, fileProblem, LANGUAGE_LABELS } from './wording';

/**
 * Uploading a version of a template's Word file, as a draft (HR and Admin): the file, chosen, dropped or pasted; its
 * language when the slot's isn't fixed; and what changed. The API reads its tags; the page then shows their check, with
 * Publish. The fields keep what was entered when the upload is refused (the file too), and are emptied once it's in.
 */
export function UploadTemplateForm({
  action,
  language,
  hasFile,
}: {
  action: (prev: UploadState, fd: FormData) => Promise<UploadState>;
  /** The slot's language; null: chosen here. */
  language: TemplateLanguage | null;
  /** Whether the slot has a version already (the heading then says a new version). */
  hasFile: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const form = useRef<HTMLFormElement>(null);

  // emptied once a draft is in (each upload's answer is a new object)
  useEffect(() => {
    if (state.draft) form.current?.reset();
  }, [state.draft]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  return (
    <form ref={form} action={formAction} onSubmit={onSubmit} className="space-y-4">
      <div>
        <h2 className="font-semibold">{hasFile ? 'Upload a New Version' : 'Upload the Word File'}</h2>
        <p className="mt-1 text-sm text-muted">
          The .docx file exactly as you use it today, with merge tags like <code className="font-mono text-xs">{'{{full_name_ar}}'}</code> where the data
          goes, up to 4 MB. It is uploaded as a draft: check its tags, then publish it.
        </p>
      </div>
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={fid('file')} className="label">
            Word file
          </label>
          <FileDrop
            id={fid('file')}
            name="file"
            accept={DOCX_ACCEPT}
            required
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.setCustomValidity(file ? fileProblem(file) : '');
            }}
          />
        </div>
        {language === null && (
          <fieldset aria-describedby={fid('language-hint')}>
            <legend className="label">Language of the document</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {TEMPLATE_LANGUAGES.map((l) => (
                <label key={l} className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name="language" value={l} required className="size-4 accent-accent" />
                  {LANGUAGE_LABELS[l]}
                </label>
              ))}
            </div>
            <p id={fid('language-hint')} className="hint">
              {LANGUAGE_LABELS.bilingual}: {BILINGUAL_HINT}
            </p>
          </fieldset>
        )}
        {language === 'bilingual' && <p className="hint sm:col-span-2">{BILINGUAL_HINT}</p>}
        <div className={language === null ? undefined : 'sm:col-span-2'}>
          <label htmlFor={fid('note')} className="label">
            What changed <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea id={fid('note')} name="note" rows={2} maxLength={500} className="input" aria-describedby={fid('note-hint')} />
          <p id={fid('note-hint')} className="hint">
            E.g. &quot;New company address&quot; or &quot;Probation clause updated&quot;. Shown in the list of versions.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pendingText="Uploading…" busy={pending}>
          Upload draft
        </SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
            {state.draft && (
              <>
                {' '}
                <a href={`#draft-${state.draft.id}`} className="font-semibold">
                  Go to the check
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
