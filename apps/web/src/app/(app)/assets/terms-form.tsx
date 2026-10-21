'use client';

import { CUSTODY_TERMS_MAX, CUSTODY_TERMS_REVIEW_NOTE, CUSTODY_TEXT_LIMITS } from '@trendlix/shared';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// The terms the custody forms print (Assets step 3, the brief: "Put the terms in Assets → Settings as editable text,
// managers only, and the snapshot on each record"): one term a line, for an Assets manager; "Use the standard wording"
// prints the spec's again. Beside them the owner's note, never printed on the form: "Have a labour lawyer review this
// wording before use". The records already made keep the terms they were printed with. The API checks it again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function TermsForm({ action, standardAction, terms, standard }: { action: Action; standardAction: Action; terms: string[]; standard: boolean }) {
  const [state, formAction] = useActionState(action, {});
  const [reset, resetAction] = useActionState(standardAction, {});
  const fid = useFieldIds();
  const said = state.message ?? reset.message;
  return (
    <div className="space-y-3">
      <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
        {CUSTODY_TERMS_REVIEW_NOTE}
      </p>
      <form action={formAction} className="space-y-3">
        <FormErrors errors={state.errors ?? reset.errors} />
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
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Save terms</SubmitButton>
          {!standard && (
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
