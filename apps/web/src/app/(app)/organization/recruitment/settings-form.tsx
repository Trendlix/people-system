'use client';

import { useActionState } from 'react';
import { INVITE_LIMITS, REJECTION_LIMITS, SUGGESTION_LIMITS, type RecruitmentSettingsView } from '@trendlix/shared';
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

/**
 * Suggested From Earlier CVs (owner, 24 October 2026: "Suggest; HR adds"): how far back general CVs and earlier
 * applications count, 12 months unless changed.
 */
export function SuggestionSettingsForm({ action, settings }: { action: Action; settings: RecruitmentSettingsView }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <FormErrors errors={state.errors} />
      <div className="max-w-xs">
        <label htmlFor={fid('months')} className="label">
          Months back CVs count
        </label>
        <input
          id={fid('months')}
          name="suggestMonths"
          type="number"
          inputMode="numeric"
          min={SUGGESTION_LIMITS.recencyMonthsMin}
          max={SUGGESTION_LIMITS.recencyMonthsMax}
          step={1}
          required
          defaultValue={str(v.suggestMonths) ?? String(settings.suggestions.recencyMonths)}
          className="input"
        />
        <p className="mt-1 text-xs text-muted">
          From {SUGGESTION_LIMITS.recencyMonthsMin} to {SUGGESTION_LIMITS.recencyMonthsMax} months; the standard is {SUGGESTION_LIMITS.recencyMonths}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
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

/** The invitation to apply's words (24 October 2026: "Yes, HR presses 'Invite to apply'"): left empty, the standard words go. */
export function InviteWordsForm({ action, settings }: { action: Action; settings: RecruitmentSettingsView }) {
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
          name="inviteSubject"
          maxLength={INVITE_LIMITS.subject}
          defaultValue={str(v.inviteSubject) ?? settings.invite.subject ?? ''}
          placeholder={settings.inviteStandard.subject}
          className="input"
        />
      </div>
      <div>
        <label htmlFor={fid('en')} className="label">
          In English
        </label>
        <textarea id={fid('en')} name="inviteEn" rows={9} maxLength={INVITE_LIMITS.text} defaultValue={str(v.inviteEn) ?? settings.invite.en ?? ''} placeholder={settings.inviteStandard.en} className="input" />
      </div>
      <div>
        <label htmlFor={fid('ar')} className="label">
          In Arabic
        </label>
        <textarea id={fid('ar')} name="inviteAr" dir="rtl" rows={9} maxLength={INVITE_LIMITS.text} defaultValue={str(v.inviteAr) ?? settings.invite.ar ?? ''} placeholder={settings.inviteStandard.ar} className="input" />
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
