'use client';

import { useActionState } from 'react';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { MARK_FIELDS } from '../../recruitment/agency';

// Recruitment Settings' Marketing Agencies (owner, 27 October 2026: "i need a flag if the candidate is ex marketing
// agencies or not"; asked, "Name words + your list"): HR (and a Super Admin) add a company as a marketing agency, or as
// not one; saved again, its mark changes. The API keeps it by its name as compared (any case or spacing), audits it, and
// scores again the applications whose CV names it.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function AgencyMarkForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  const notAgency = str(v[MARK_FIELDS.agency]) === 'no';
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors errors={state.errors} />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <label htmlFor={fid('company')} className="label">
            Company
          </label>
          <input
            id={fid('company')}
            name={MARK_FIELDS.company}
            required
            minLength={2}
            maxLength={200}
            autoComplete="off"
            dir="auto"
            defaultValue={str(v[MARK_FIELDS.company]) ?? ''}
            placeholder="e.g. Publicis Egypt"
            className="input"
          />
        </div>
        <fieldset>
          <legend className="label">It is</legend>
          <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name={MARK_FIELDS.agency} value="yes" defaultChecked={!notAgency} className="size-4 accent-accent" />
              A marketing agency
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name={MARK_FIELDS.agency} value="no" defaultChecked={notAgency} className="size-4 accent-accent" />
              Not an agency
            </label>
          </div>
        </fieldset>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {state.message && !state.errors && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
    </form>
  );
}
