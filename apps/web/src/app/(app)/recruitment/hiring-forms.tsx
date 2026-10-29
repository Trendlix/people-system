'use client';

import { Select } from '@/components/select';
import { useActionState, useRef, useState, useTransition, type RefObject } from 'react';
import {
  AVAILABILITY_LENGTHS,
  FEEDBACK_CRITERIA,
  FEEDBACK_CRITERION_LABELS,
  FEEDBACK_NOTES_MAX,
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
  type MeetingChoices,
} from '@trendlix/shared';
import { suggestionLabel, type ApplicationStage } from '@trendlix/shared';
import { DateInput, TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds } from '@/components/form';
import { formatDate, formatDateTime } from '@/lib/format';
import type { FormState } from '@/lib/types';
import {
  availabilityQuestion,
  calendarText,
  checkSummary,
  defaultRange,
  findLength,
  lengthText,
  panelOf,
  pickedFields,
  savedWarnings,
  slotCountText,
  slotGroups,
  timeCheckQuestion,
  type SlotItem,
} from './availability';
import { checkTime, findTimes, type CheckResult, type FindResult } from './availability-actions';
import { makesMeeting, meetingOptions, NO_MEETING_CHOICES } from './meetings';

// Recruitment's Phase 2 forms (owner, 22 October 2026: "where will we include the ATS?"; "interview invites go by email
// through the owner's SMTP settings"): scheduling or moving an interview (the day as DD/MM/YYYY, the time on the
// 12-hour picker in quarter hours, its length, how it is held, where, the interviewers, a note to the candidate), an
// interviewer's scorecard, and the hiring manager's suggestion. The API checks each again.
//
// "Find a time" and "Check this time" (owner, 25 October 2026: "is it better for each interviewer to add his available
// interviews timeslots?"; asked, "Hours + calendar" and, for booking, "HR only"): HR sees the times every chosen
// interviewer is free (their interview hours, less their leave, holidays, interviews and busy calendar) and picks one,
// which fills the day, the time and the length; a time typed by hand is checked, and saved all the same with its
// warnings, never refused. The form works as before when neither is used.

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

/**
 * Scheduling an interview, or moving one (`interview`: its details to start from). `meetings`: what the scheduler may
 * create an online one's meeting with (owner, 24 October 2026: "automatically generate meeting links"; "Google Meet,
 * Microsoft Teams, Zoom"), the company's default first, else their own; "Paste a link" always, as before.
 */
export function InterviewForm({
  action,
  people,
  defaultInterviewerIds,
  interview,
  submitLabel,
  onCancel,
  meetings = NO_MEETING_CHOICES,
}: {
  action: Action;
  people: PersonOption[];
  defaultInterviewerIds: string[];
  interview?: InterviewView;
  submitLabel: string;
  onCancel?: () => void;
  meetings?: MeetingChoices;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fid = useFieldIds();
  const v = state.values ?? {};
  const start = dayAndTime(interview?.startsAt ?? null);
  const [kind, setKind] = useState<InterviewKind>((str(v.kind) as InterviewKind) || interview?.kind || 'in_person');
  const meetingChoice = meetingOptions(meetings, interview);
  const [meeting, setMeeting] = useState<string>(str(v.meeting) ?? meetingChoice.start);
  // the link box: in person, by phone, or online with "Paste a link"
  const pasted = kind !== 'online' || !makesMeeting(meeting);
  const chosen = new Set(interview ? interview.interviewers.map((i) => i.employeeId) : defaultInterviewerIds);
  // a time picked from "Find a time" (25 October 2026): the day, the time and the length it was found for, until the
  // form's next answer (which keeps what was sent); each pick draws the day and length fields again with it
  const form = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<{ date: string; time: string; minutes: string; after: FormState; n: number } | null>(null);
  const shown = picked && picked.after === state ? picked : null;
  const [finding, setFinding] = useState<number | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckResult | null>(null);
  const [checking, startCheck] = useTransition();
  const interviewId = interview?.id ?? null;
  const pick = (fields: { date: string; time: string; minutes: string }, words: string) => {
    setPicked({ ...fields, after: state, n: (picked?.n ?? 0) + 1 });
    setFinding(null);
    setChecked(null);
    setSaid(words);
  };
  const check = () => {
    if (!form.current) return;
    const { input, errors } = timeCheckQuestion(new FormData(form.current), interviewId);
    setSaid(null);
    if (!input) {
      setChecked({ errors });
      return;
    }
    startCheck(async () => setChecked(await checkTime(input)));
  };
  const openFinder = () => {
    if (finding !== null) {
      setFinding(null);
      return;
    }
    setFinding(form.current ? (panelOf(new FormData(form.current)).minutes ?? 45) : 45);
  };
  return (
    <form ref={form} action={formAction} className="space-y-4 rounded-lg border border-line p-4">
      <FormErrors errors={state.errors} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('date')} className="label">
            Day
          </label>
          <DateInput key={`date-${picked?.n ?? 0}`} id={fid('date')} name="date" defaultValue={shown?.date ?? str(v.date) ?? start.day} required />
        </div>
        <div>
          <label htmlFor={fid('time')} className="label">
            Time (Cairo)
          </label>
          <TimeInput id={fid('time')} name="time" defaultValue={shown?.time ?? str(v.time) ?? start.time} required />
        </div>
        <div>
          <label htmlFor={fid('minutes')} className="label">
            Length
          </label>
          <Select key={`minutes-${picked?.n ?? 0}`} id={fid('minutes')} name="minutes" defaultValue={shown?.minutes ?? str(v.minutes) ?? String(interview?.minutes ?? 45)} className="input">
            {INTERVIEW_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={check} disabled={checking} className="btn btn-secondary min-h-9 px-3">
            {checking ? 'Checking…' : 'Check this time'}
          </button>
          <button type="button" onClick={openFinder} aria-expanded={finding !== null} className="btn btn-secondary min-h-9 px-3">
            {finding !== null ? 'Hide free times' : 'Find a time'}
          </button>
          {said && (
            <p role="status" className="text-sm text-ok">
              {said}
            </p>
          )}
        </div>
        <TimeCheckAnswer result={checked} />
        {finding !== null && <FindTime form={form} kind={kind} interviewId={interviewId} startMinutes={finding} onPick={pick} />}
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
        {kind === 'online' && (
          <div>
            <label htmlFor={fid('meeting')} className="label">
              Create the meeting with
            </label>
            <Select id={fid('meeting')} name="meeting" value={meeting} onChange={(e) => setMeeting(e.target.value)} aria-describedby={fid('meeting-hint')} className="input">
              {meetingChoice.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p id={fid('meeting-hint')} className="hint">
              {pasted ? 'Paste the link of a meeting you made yourself.' : 'The link goes into the invitations.'}
            </p>
          </div>
        )}
        {pasted && (
          <div className={kind === 'online' ? '' : 'sm:col-span-2'}>
            <label htmlFor={fid('location')} className="label">
              {kind === 'online' ? 'Meeting link' : kind === 'phone' ? 'Phone note' : 'Where'}
              {kind !== 'online' && <span className="font-normal text-muted"> (optional)</span>}
            </label>
            <input
              id={fid('location')}
              name="location"
              defaultValue={str(v.location) ?? (interview?.meeting ? '' : (interview?.location ?? ''))}
              maxLength={INTERVIEW_LIMITS.location}
              placeholder={kind === 'online' ? 'https://meet.google.com/…' : kind === 'phone' ? 'We call them on their mobile unless you say otherwise' : 'The office’s address unless you give another'}
              className="input"
            />
          </div>
        )}
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
      </div>
      <SavedWithWarnings state={state} />
    </form>
  );
}

/** A save's answer: what was done, then the time's warnings apart (25 October 2026: saved all the same, never refused). */
function SavedWithWarnings({ state }: { state: FormState }) {
  if (!state.message || state.errors) return null;
  const { text, warnings } = savedWarnings(state.message);
  return (
    <div role="status" className="space-y-2 text-sm">
      {text && <p className="text-ok">{text}</p>}
      {warnings.length > 0 && <WarningList title="Saved with these warnings:" warnings={warnings} />}
    </div>
  );
}

function WarningList({ title, warnings }: { title: string; warnings: readonly string[] }) {
  return (
    <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/** "Check this time"'s answer: the warnings for the time typed (never a refusal), or that it suits them all. */
function TimeCheckAnswer({ result }: { result: CheckResult | null }) {
  if (!result) return null;
  if (result.errors) return <FormErrors errors={result.errors} />;
  const { warnings } = result.check;
  return (
    <div role="status">
      {warnings.length ? <WarningList title={checkSummary(warnings)} warnings={warnings} /> : <p className="text-sm text-ok">{checkSummary(warnings)}</p>}
    </div>
  );
}

/**
 * "Find a time" (25 October 2026: "Hours + calendar"; "HR only"): the length (the form's own when it is 30, 45, 60 or 90
 * minutes) and the days (the next 14 unless chosen), for the interviewers ticked and how it is held (from the form);
 * the times all of them are free, grouped by day, each saying who is free and marked where someone is only "maybe".
 * Its fields are the form's too, but only it reads them; Enter in them looks again instead of sending the form.
 */
function FindTime({
  form,
  kind,
  interviewId,
  startMinutes,
  onPick,
}: {
  form: RefObject<HTMLFormElement | null>;
  kind: InterviewKind;
  interviewId: string | null;
  startMinutes: number;
  onPick: (fields: { date: string; time: string; minutes: string }, said: string) => void;
}) {
  const fid = useFieldIds();
  const [range] = useState(() => defaultRange());
  const [minutes, setMinutes] = useState(() => String(findLength(startMinutes)));
  const [result, setResult] = useState<FindResult | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const find = () => {
    if (!form.current) return;
    const { input, errors } = availabilityQuestion(new FormData(form.current), interviewId);
    setProblems(errors);
    if (!input) {
      setResult(null);
      return;
    }
    start(async () => setResult(await findTimes(input)));
  };
  const view = result?.view ?? null;
  const groups = view ? slotGroups(view) : [];
  const calendars = view ? view.people.map((p) => calendarText(p)).filter((t): t is string => !!t) : [];
  const choose = (date: string, heading: string, slot: SlotItem) => onPick(pickedFields(date, { time: slot.hhmm }, view?.minutes ?? Number(minutes)), `Picked ${heading}, ${slot.time}.`);
  return (
    <section
      aria-labelledby={fid('find')}
      className="space-y-3 rounded-lg border border-line-soft bg-canvas p-4"
      onKeyDown={(e) => {
        // the two days' fields only (the length's search box chooses with Enter)
        if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement) || !['findFrom', 'findTo'].includes(e.target.name)) return;
        e.preventDefault();
        find();
      }}
    >
      <div>
        <h3 id={fid('find')} className="font-semibold">
          Find a Time
        </h3>
        <p className="text-xs text-muted">
          The times all the interviewers ticked below are free: their interview hours, less leave, public holidays, their other interviews and a busy calendar
          {kind === 'in_person' ? ', and days they work from home' : ''}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('find-minutes')} className="label">
            Length
          </label>
          <Select id={fid('find-minutes')} name="findMinutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="input">
            {AVAILABILITY_LENGTHS.map((m) => (
              <option key={m} value={m}>
                {lengthText(m)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={fid('find-from')} className="label">
            From
          </label>
          <DateInput id={fid('find-from')} name="findFrom" defaultValue={formatDate(range.from)} />
        </div>
        <div>
          <label htmlFor={fid('find-to')} className="label">
            To
          </label>
          <DateInput id={fid('find-to')} name="findTo" defaultValue={formatDate(range.to)} />
        </div>
      </div>
      <button type="button" onClick={find} disabled={pending} className="btn btn-primary min-h-9 px-3">
        {pending ? 'Looking…' : 'Show free times'}
      </button>
      <FormErrors errors={problems.length ? problems : (result?.errors ?? undefined)} />
      {view && (
        <div className="space-y-3">
          <p role="status" className="text-sm">
            {slotCountText(view)} for {lengthText(view.minutes)}, {formatDate(view.from)} to {formatDate(view.to)}.
            {groups.some((g) => g.slots.some((s) => s.marked)) && <span className="text-muted"> Marked times have someone who is only “maybe”.</span>}
          </p>
          {[...view.notes, ...calendars].length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted">
              {[...new Set([...view.notes, ...calendars])].map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {groups.length === 0 ? (
            <p className="text-sm text-muted">No time suits them all on these days. Try other days or a shorter length, or type a time by hand.</p>
          ) : (
            <div className="max-h-96 space-y-4 overflow-y-auto pe-1">
              {groups.map((g) => (
                <div key={g.date} role="group" aria-labelledby={fid(`day-${g.date}`)}>
                  <h4 id={fid(`day-${g.date}`)} className="text-sm font-semibold">
                    {g.heading}
                    {g.holiday && <span className="font-normal text-muted"> · Public holiday: {g.holiday}</span>}
                  </h4>
                  {g.slots.length ? (
                    <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                      {g.slots.map((slot) => (
                        <li key={slot.start}>
                          <button
                            type="button"
                            onClick={() => choose(g.date, g.heading, slot)}
                            aria-label={`Pick ${g.heading}, ${slot.label}`}
                            className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-start text-sm ${slot.marked ? 'border-warn/40 bg-warn-soft hover:border-warn' : 'border-line bg-card hover:border-accent'}`}
                          >
                            <span className="block font-semibold tabular-nums">{slot.time}</span>
                            <span className={`block text-xs ${slot.marked ? 'text-warn' : 'text-muted'}`}>{slot.who}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">No times: nobody added extra hours on the holiday.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** "Schedule an interview", opening the form. */
export function ScheduleInterview({ action, people, defaultInterviewerIds, meetings }: { action: Action; people: PersonOption[]; defaultInterviewerIds: string[]; meetings?: MeetingChoices }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-primary">
        Schedule an interview
      </button>
    );
  }
  return <InterviewForm action={action} people={people} defaultInterviewerIds={defaultInterviewerIds} submitLabel="Schedule and invite" onCancel={() => setOpen(false)} meetings={meetings} />;
}

/** "Move", opening the form with the interview's details. */
export function MoveInterview({ action, people, interview, meetings }: { action: Action; people: PersonOption[]; interview: InterviewView; meetings?: MeetingChoices }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary">
        Move
      </button>
    );
  }
  return <InterviewForm action={action} people={people} defaultInterviewerIds={[]} interview={interview} submitLabel="Move and tell them" onCancel={() => setOpen(false)} meetings={meetings} />;
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

/**
 * The hiring manager's suggestion to HR: the next step or a rejection, with a note; at Shortlisted, their review: Accept
 * or Reject (owner, 29 October 2026: "Manager view the shortlisted and accept or reject them").
 */
export function SuggestForm({ action, stage }: { action: Action; stage: ApplicationStage }) {
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
            {suggestionLabel(s, stage)}
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
