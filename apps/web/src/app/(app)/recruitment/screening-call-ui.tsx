'use client';

import { useActionState, useState } from 'react';
import { SCREENING_CALL_LABELS, SCREENING_CALL_NOTE_MAX, SCREENING_CALL_RESULTS, type ScreeningCallView } from '@trendlix/shared';
import { FormErrors, useFieldIds } from '@/components/form';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import type { screeningCallCard } from './screening-call';

// The applicant page's Screening Call card (owner, 29 October 2026: "HR Screening and scheduling"; asked, "Screening
// call + result"): the call made (Passed or Failed, the comment, who and when) and, for HR (or a Super Admin) at
// Shortlisted, the form to make it, or to change it; why it can't be made yet instead ("Waiting for the hiring manager to
// accept them."). The hiring manager and the interviewers see the result, never HR's comment (the API keeps it from
// them). Only those who passed are interviewed.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;
type Card = NonNullable<ReturnType<typeof screeningCallCard>>;

/** A value kept from what was typed, as text. */
const str = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function Done({ state }: { state: FormState }) {
  if (!state.message || state.errors) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

/** Passed (green) or Failed (amber: HR acts on it). */
export function ScreeningCallBadge({ call }: { call: Pick<ScreeningCallView, 'result'> }) {
  return <span className={`badge ${call.result === 'passed' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>{SCREENING_CALL_LABELS[call.result]}</span>;
}

export function ScreeningCallCard({ card, action }: { card: Card; action: Action }) {
  const { call, form, problem } = card;
  return (
    <section aria-labelledby="applicant-screening-call" className="card space-y-3 p-6">
      <h2 id="applicant-screening-call" className="text-lg font-semibold">
        Screening Call
      </h2>
      {call ? (
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <ScreeningCallBadge call={call} />
            <span className="text-muted">
              {call.by ? `${call.by.name ?? call.by.email}, ` : ''}
              {formatDateTime(call.at)}
            </span>
          </p>
          {call.note && <p className="text-sm whitespace-pre-line">{call.note}</p>}
        </div>
      ) : (
        form && <p className="text-sm text-muted">Call them before the interview: only those who pass the screening call are interviewed.</p>
      )}
      {problem && (
        <p role="note" className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">
          {problem}
        </p>
      )}
      {form && <ScreeningCallForm action={action} call={call} />}
    </section>
  );
}

/** Passed or Failed, a comment, "Save the screening call"; once made, "Change the screening call" opens it again. */
export function ScreeningCallForm({ action, call }: { action: Action; call: ScreeningCallView | null }) {
  const [open, setOpen] = useState(!call);
  // saved: closed again, with what was saved
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await action(prev, fd);
    if (next.message && !next.errors) setOpen(false);
    return next;
  }, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  if (!open) {
    return (
      <div className="space-y-1">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
          Change the screening call
        </button>
        <Done state={state} />
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold">Result</legend>
        <div className="flex flex-wrap gap-4">
          {SCREENING_CALL_RESULTS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input type="radio" name="result" value={r} required defaultChecked={(str(v.result) ?? call?.result) === r} />
              {SCREENING_CALL_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={fid('note')} className="label">
          Comment <span className="font-normal text-muted">(optional, kept from the hiring manager and the interviewers)</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={SCREENING_CALL_NOTE_MAX} defaultValue={str(v.note) ?? call?.note ?? ''} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save the screening call'}
        </button>
        {call && (
          <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
