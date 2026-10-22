'use client';

import { Select } from '@/components/select';
import { useActionState, useState } from 'react';
import {
  FEEDBACK_CRITERIA,
  FEEDBACK_CRITERION_LABELS,
  FEEDBACK_NOTES_MAX,
  HIRING_SUGGESTION_LABELS,
  HIRING_SUGGESTIONS,
  INTERVIEW_KIND_LABELS,
  INTERVIEW_KINDS,
  INTERVIEW_LENGTHS,
  INTERVIEW_LIMITS,
  RECOMMENDATION_LABELS,
  RECOMMENDATIONS,
  SUGGESTION_NOTE_MAX,
  type FeedbackView,
  type InterviewKind,
  type InterviewView,
} from '@trendlix/shared';
import { DateInput, TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds } from '@/components/form';
import { formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';

// Recruitment's Phase 2 forms (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by email
// through the owner's SMTP settings"): scheduling or moving an interview (the day as DD/MM/YYYY, the time on the
// 12-hour picker in quarter hours, its length, how it is held, where, the interviewers, a note to the candidate), an
// interviewer's scorecard, and the hiring manager's suggestion. The API checks each again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export interface PersonOption {
  id: string;
  label: string;
}

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

/** The day and the time of an interview in Cairo, as the form shows them: "29/10/2026" and "10:30 AM". */
function dayAndTime(startsAt: string | null): { day: string; time: string } {
  if (!startsAt) return { day: '', time: '' };
  const [day, time] = formatDateTime(startsAt).split(', ');
  return { day: day ?? '', time: time ?? '' };
}

/** Scheduling an interview, or moving one (`interview`: its details to start from). */
export function InterviewForm({
  action,
  people,
  defaultInterviewerIds,
  interview,
  submitLabel,
  onCancel,
}: {
  action: Action;
  people: PersonOption[];
  defaultInterviewerIds: string[];
  interview?: InterviewView;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  const start = dayAndTime(interview?.startsAt ?? null);
  const [kind, setKind] = useState<InterviewKind>((str(v.kind) as InterviewKind) || interview?.kind || 'in_person');
  const chosen = new Set(interview ? interview.interviewers.map((i) => i.employeeId) : defaultInterviewerIds);
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('date')} className="label">
            Day
          </label>
          <DateInput id={fid('date')} name="date" defaultValue={str(v.date) ?? start.day} required />
        </div>
        <div>
          <label htmlFor={fid('time')} className="label">
            Time (Cairo)
          </label>
          <TimeInput id={fid('time')} name="time" defaultValue={str(v.time) ?? start.time} required />
        </div>
        <div>
          <label htmlFor={fid('minutes')} className="label">
            Length
          </label>
          <Select id={fid('minutes')} name="minutes" defaultValue={str(v.minutes) ?? String(interview?.minutes ?? 45)} className="input">
            {INTERVIEW_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('kind')} className="label">
            How
          </label>
          <Select id={fid('kind')} name="kind" value={kind} onChange={(e) => setKind(e.target.value as InterviewKind)} className="input">
            {INTERVIEW_KINDS.map((k) => (
              <option key={k} value={k}>
                {INTERVIEW_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('location')} className="label">
            {kind === 'online' ? 'Meeting link' : kind === 'phone' ? 'Phone note' : 'Where'}
            {kind !== 'online' && <span className="font-normal text-muted"> (optional)</span>}
          </label>
          <input
            id={fid('location')}
            name="location"
            defaultValue={str(v.location) ?? interview?.location ?? ''}
            maxLength={INTERVIEW_LIMITS.location}
            placeholder={kind === 'online' ? 'https://meet.google.com/…' : kind === 'phone' ? 'We call them on their mobile unless you say otherwise' : 'The office’s address unless you give another'}
            className="input"
          />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Interviewers</legend>
        <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line-soft p-2 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="interviewerIds" value={p.id} defaultChecked={chosen.has(p.id)} />
              {p.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Each gets a notification, and the calendar invitation at their work email.</p>
      </fieldset>
      <div>
        <label htmlFor={fid('note')} className="label">
          Note to the candidate <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={INTERVIEW_LIMITS.note} defaultValue={str(v.note) ?? interview?.note ?? ''} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
        )}
        <Done state={state} />
      </div>
    </form>
  );
}

/** "Schedule an interview", opening the form. */
export function ScheduleInterview({ action, people, defaultInterviewerIds }: { action: Action; people: PersonOption[]; defaultInterviewerIds: string[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        Schedule an interview
      </button>
    );
  }
  return <InterviewForm action={action} people={people} defaultInterviewerIds={defaultInterviewerIds} submitLabel="Schedule and invite" onCancel={() => setOpen(false)} />;
}

/** "Move", opening the form with the interview's details. */
export function MoveInterview({ action, people, interview }: { action: Action; people: PersonOption[]; interview: InterviewView }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
        Move
      </button>
    );
  }
  return <InterviewForm action={action} people={people} defaultInterviewerIds={[]} interview={interview} submitLabel="Move and tell them" onCancel={() => setOpen(false)} />;
}

/** An interviewer's scorecard: each criterion from 1 to 5, the recommendation, notes; their own to change afterwards. */
export function FeedbackForm({ action, mine }: { action: Action; mine: FeedbackView | null }) {
  const [open, setOpen] = useState(!mine);
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  if (!open) {
    return (
      <div className="space-y-1">
        <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
          Change my scorecard
        </button>
        <Done state={state} />
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      {FEEDBACK_CRITERIA.map((c) => (
        <fieldset key={c} className="space-y-1">
          <legend className="text-sm font-semibold">{FEEDBACK_CRITERION_LABELS[c]}</legend>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex items-center gap-1 text-sm">
                <input type="radio" name={`rating_${c}`} value={n} required defaultChecked={(str(v[`rating_${c}`]) ?? String(mine?.ratings[c] ?? '')) === String(n)} />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('recommendation')} className="label">
            Recommendation
          </label>
          <Select id={fid('recommendation')} name="recommendation" required defaultValue={str(v.recommendation) ?? mine?.recommendation ?? ''} className="input">
            <option value="" disabled>
              Choose…
            </option>
            {RECOMMENDATIONS.map((r) => (
              <option key={r} value={r}>
                {RECOMMENDATION_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <label htmlFor={fid('notes')} className="label">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('notes')} name="notes" rows={3} maxLength={FEEDBACK_NOTES_MAX} defaultValue={str(v.notes) ?? mine?.notes ?? ''} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : mine ? 'Save my scorecard' : 'Give my scorecard'}
        </button>
        {mine && (
          <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
            Cancel
          </button>
        )}
        <Done state={state} />
      </div>
    </form>
  );
}

/** The hiring manager's suggestion to HR: the next step or a rejection, with a note. */
export function SuggestForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  return (
    <form action={formAction} className="space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">Your suggestion</legend>
        {HIRING_SUGGESTIONS.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm">
            <input type="radio" name="suggestion" value={s} required />
            {HIRING_SUGGESTION_LABELS[s]}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor={fid('note')} className="label">
          Why <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={SUGGESTION_NOTE_MAX} className="input" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn btn-secondary">
          {pending ? 'Sending…' : 'Send to HR'}
        </button>
        <Done state={state} />
      </div>
    </form>
  );
}
