'use client';

import { CUSTODY_TERMS_MAX, CUSTODY_TERMS_REVIEW_NOTE, CUSTODY_TEXT_LIMITS } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// The terms the custody forms print (Assets step 3, the brief: "Put the terms in Assets → Settings as editable text,
// managers only, and the snapshot on each record"): one term a line, for an Assets manager; "Use the standard wording"
// prints the spec's again. Beside them the owner's note, never printed on the form: "Have a labour lawyer review this
// wording before use". The records already made keep the terms they were printed with. The API checks it again.
// Since 24 October 2026 (owner: the form in "Arabic and English" side by side) the Arabic terms beside the English, one
// a line too: none written, the standard Arabic wording while the English terms are the standard ones, else the forms
// print the English alone (packages/shared custody.ts custodyTermsArOf), as the hint says. "Use the standard wording"
// restores both.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function TermsForm({
  action,
  standardAction,
  terms,
  standard,
  termsAr,
  arStandard,
}: {
  action: Action;
  standardAction: Action;
  terms: string[];
  standard: boolean;
  /** The Arabic terms in force (empty: none, the English printed alone). */
  termsAr: string[];
  /** None written in Arabic. */
  arStandard: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const [reset, resetAction] = useActionState(standardAction, {});
  const fid = useFieldIds();
  const said = state.message ?? reset.message;
  const arNow = !arStandard
    ? 'Your Arabic wording is printed now.'
    : termsAr.length
      ? 'The standard Arabic wording is printed now.'
      : 'Your English terms aren’t the standard wording, so the standard Arabic doesn’t fit them: write them in Arabic here, or the forms print the English terms alone.';
  return (
    <div className="space-y-3">
      <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
        {CUSTODY_TERMS_REVIEW_NOTE}
      </p>
      <form action={formAction} className="space-y-3">
        <FormErrors errors={state.errors ?? reset.errors} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor={fid('terms')} className="label">
              Terms, one a line
            </label>
            <textarea
              // shown afresh once the terms saved change (the standard wording restored)
              key={terms.join('\n')}
              id={fid('terms')}
              name="terms"
              rows={Math.min(12, Math.max(6, terms.length + 1))}
              defaultValue={valueOf(state, 'terms', terms.join('\n'))}
              aria-describedby={fid('terms-hint')}
              className="input"
            />
            <p id={fid('terms-hint')} className="hint">
              Printed in order on each custody form, at most {CUSTODY_TERMS_MAX} terms of {CUSTODY_TEXT_LIMITS.term} characters each.{' '}
              {standard ? 'The standard wording is printed now.' : 'Your wording is printed now.'}
            </p>
          </div>
          <div>
            <label htmlFor={fid('termsAr')} className="label">
              Arabic terms, one a line
            </label>
            <textarea
              key={termsAr.join('\n')}
              id={fid('termsAr')}
              name="termsAr"
              dir="rtl"
              lang="ar"
              rows={Math.min(12, Math.max(6, termsAr.length + 1))}
              defaultValue={valueOf(state, 'termsAr', termsAr.join('\n'))}
              aria-describedby={fid('termsAr-hint')}
              className="input"
            />
            <p id={fid('termsAr-hint')} className={`hint${arStandard && !termsAr.length ? ' text-warn' : ''}`}>
              Printed beside the English terms, in Arabic, same limits. {arNow}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Save terms</SubmitButton>
          {(!standard || !arStandard) && (
            <button type="submit" formAction={resetAction} className="btn btn-secondary">
              Use the standard wording
            </button>
          )}
          {said && (
            <span role="status" className="text-sm text-ok">
              {said}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
