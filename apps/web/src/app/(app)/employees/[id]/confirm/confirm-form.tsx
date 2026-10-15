'use client';

import { PROFILE_DISCLAIMER } from '@trendlix/shared';
import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';

/**
 * The statement the employee accepts, in English and Arabic, its checkbox, and Confirm my details. The version read is
 * sent with it, so the API can refuse when the statement changed meanwhile. `children`: beside the button (Request a change).
 */
export function ConfirmForm({ action, children }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; children?: React.ReactNode }) {
  // Kept form: a refused confirmation leaves the box ticked.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} aria-labelledby={fid('title')} className="card space-y-4 p-6">
      <h2 id={fid('title')} className="font-semibold">
        Your Statement
      </h2>
      <FormErrors errors={state.errors} />
      <div className="space-y-3 rounded-lg border border-line bg-canvas px-4 py-3 text-sm leading-relaxed">
        <p>{PROFILE_DISCLAIMER.en}</p>
        <p lang="ar" dir="rtl">
          {PROFILE_DISCLAIMER.ar}
        </p>
      </div>
      <input type="hidden" name="disclaimerVersion" value={PROFILE_DISCLAIMER.version} />
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="accept" required className="mt-0.5 size-4 shrink-0 accent-accent" />I have read and accept this statement
      </label>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Confirming…' : 'Confirm my details'}
        </button>
        {children}
      </div>
    </form>
  );
}
