'use client';

import { useActionState } from 'react';
import { REJECTION_LIMITS, type RecruitmentSettingsView } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';

// The rejection email's words (Phase 2, owner, 22 October 2026; the brief: "a polite standard text that an HR-editable
// Recruitment Settings section can change (English and Arabic)"): left empty, the standard words go.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function RejectionWordsForm({ action, settings }: { action: Action; settings: RecruitmentSettingsView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div>
        <label htmlFor={fid('subject')} className="label">
          Subject
        </label>
        <input
          id={fid('subject')}
          name="rejectionSubject"
          maxLength={REJECTION_LIMITS.subject}
          defaultValue={str(v.rejectionSubject) ?? settings.rejection.subject ?? ''}
          placeholder={settings.standard.subject}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('en')} className="label">
          In English
        </label>
        <textarea id={fid('en')} name="rejectionEn" rows={9} maxLength={REJECTION_LIMITS.text} defaultValue={str(v.rejectionEn) ?? settings.rejection.en ?? ''} placeholder={settings.standard.en} className="input" />
      </div>
      <div>
        <label htmlFor={fid('ar')} className="label">
          In Arabic
        </label>
        <textarea id={fid('ar')} name="rejectionAr" dir="rtl" rows={9} maxLength={REJECTION_LIMITS.text} defaultValue={str(v.rejectionAr) ?? settings.rejection.ar ?? ''} placeholder={settings.standard.ar} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the words'}
        </button>
        {state.message && !state.errors && (
          <span role="status" className="text-sm text-ok">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
