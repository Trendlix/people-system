'use client';

import Link from 'next/link';
import { startTransition, useActionState, useState, useSyncExternalStore } from 'react';
import { ATTENDANCE_SOURCE_LABELS, CORRECTION_REASON_MAX, type AttendanceSource, type CorrectableDay } from '@trendlix/shared';
import { DateInput, TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
import { SurfaceField } from '@/components/surface';
import type { MonthCorrectable, MonthCorrection } from '@/lib/correction-types';
import { formatDate, parseDate } from '@/lib/format';
import type { FormState } from '@/lib/types';
import { weekdayOf } from '../../organization/holidays/holidays';
import { CORRECTION_KIND_OPTIONS, correctionFormProblems, correctionReadyText, dayBeforeText, timesNeeded, type TypedCorrection } from './corrections';

// The attendance correction form (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check
// out")"): the employee's own from My Attendance → the day → Ask for a correction, or HR's direct correction from the
// person's month, approved at once. The day (chosen already from the day's row), what is on record for it, what was
// wrong, the right times in 12-hour time (those the kind asks for), and why (required). The shared checks show live,
// Send staying off while any is left; a day of another month than the one read is checked by the API when it is sent.
// A time not yet come is refused live too (owner, 26 October 2026: "yes"), by this device's clock read every few seconds
// (none on the server and while the page loads: the API checks it again by its own).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const optional = <span className="font-normal text-muted">(optional)</span>;

/** The clock, read again every 15 seconds while a form is shown. */
function everyFewSeconds(onTick: () => void) {
  const timer = setInterval(onTick, 15_000);
  return () => clearInterval(timer);
}
/** The time now, to the minute (the times are typed to the minute). */
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
/** On the server and while hydrating: not known. */
const notKnown = () => 0;

/** The month the form knows: its days as shown, its corrections, and whether its days can be corrected. */
export interface CorrectionMonth {
  month: string;
  days: (CorrectableDay & { date: string })[];
  corrections: MonthCorrection[];
  correctable: MonthCorrectable;
}

export function CorrectionForm({
  action,
  person,
  month,
  date,
  today,
  cancelHref,
  toCeo = false,
}: {
  action: Action;
  /** For HR correcting directly: whose day; null for the employee's own. */
  person: { employeeId: string | null; name: string };
  month: CorrectionMonth;
  /** The day chosen already (YYYY-MM-DD), or none. */
  date: string | null;
  today: string;
  cancelHref: string;
  /** The employee is C-level (19 October 2026): after their manager it goes to the CEO, not HR. */
  toCeo?: boolean;
}) {
  const [state, formAction, sending] = useActionState(action, {});
  const fid = useFieldIds();
  const byHr = person.employeeId !== null;
  const [typed, setTyped] = useState<TypedCorrection>(() => ({
    date: valueOf(state, 'date', date ? formatDate(date) : ''),
    kind: valueOf(state, 'kind'),
    checkIn: valueOf(state, 'checkIn'),
    checkOut: valueOf(state, 'checkOut'),
    reason: valueOf(state, 'reason'),
  }));
  const day = parseDate(typed.date) || null;
  const known = !!day && day.startsWith(month.month);
  const onRecord = known ? (month.days.find((d) => d.date === day) ?? null) : null;
  const open = known && month.corrections.some((c) => c.date === day && (c.status === 'with_manager' || c.status === 'with_hr'));
  const now = useSyncExternalStore(everyFewSeconds, minuteNow, notKnown);
  const problems = correctionFormProblems(typed, { today, now: now || null, day: onRecord, known, correctable: known ? month.correctable : null, open, name: byHr ? person.name : null });
  const blocked = problems.length > 0 || sending;
  const needs = timesNeeded(typed.kind, onRecord);

  function set<K extends keyof TypedCorrection>(key: K, value: TypedCorrection[K]) {
    setTyped((t) => ({ ...t, [key]: value }));
  }

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  const label = (need: string, text: string) => (
    <>
      {text} {need === 'optional' && optional}
    </>
  );

  return (
    <form
      onSubmit={send}
      onChange={(e) => {
        // the day and the times typed, for the checks (the fields stay uncontrolled)
        const t = e.target;
        if (t instanceof HTMLInputElement && (t.name === 'date' || t.name === 'checkIn' || t.name === 'checkOut')) set(t.name as 'date' | 'checkIn' | 'checkOut', t.value);
      }}
      aria-label={byHr ? `Correct a day of ${person.name}` : 'Ask for an attendance correction'}
      className="card space-y-5 p-5"
    >
      <FormErrors errors={state.errors} />
      <SurfaceField />
      {person.employeeId && <input type="hidden" name="employeeId" value={person.employeeId} />}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('date')} className="label">
            Day
          </label>
          <DateInput id={fid('date')} name="date" required defaultValue={typed.date} aria-describedby={fid('date-hint')} />
          <p id={fid('date-hint')} className="hint">
            A day gone by, or today, in a month whose payroll isn&apos;t approved yet.
          </p>
        </div>
        <div role="status" aria-live="polite" className="rounded-lg bg-canvas px-4 py-3 text-sm sm:self-start">
          {day && known ? (
            <>
              <p className="text-xs text-muted">
                On record for {weekdayOf(day)} {formatDate(day)}
              </p>
              <p className="mt-0.5 font-semibold tabular-nums">{dayBeforeText(onRecord)}</p>
              {onRecord && <p className="text-xs text-muted">{ATTENDANCE_SOURCE_LABELS[onRecord.source as AttendanceSource] ?? onRecord.source}</p>}
            </>
          ) : (
            <p className="text-muted">{day ? 'The day on record is checked when it is sent.' : 'Choose the day to see what is on record for it.'}</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('kind')} className="label">
            What was wrong
          </label>
          <Select id={fid('kind')} name="kind" required value={typed.kind} onChange={(e) => set('kind', e.target.value)} className="input">
            <option value="">Choose what was wrong</option>
            {CORRECTION_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {needs.checkIn !== 'none' && (
          <div>
            <label htmlFor={fid('checkIn')} className="label">
              {label(needs.checkIn, typed.kind === 'worked_remotely' ? 'Started work at' : 'Came in at')}
            </label>
            <TimeInput id={fid('checkIn')} name="checkIn" defaultValue={typed.checkIn} aria-describedby={fid('times-hint')} />
          </div>
        )}
        <div>
          <label htmlFor={fid('checkOut')} className="label">
            {label(needs.checkOut, 'Left at')}
          </label>
          <TimeInput id={fid('checkOut')} name="checkOut" defaultValue={typed.checkOut} aria-describedby={fid('times-hint')} />
        </div>
        <p id={fid('times-hint')} className="hint -mt-3 sm:col-span-2">
          Times on the day, to the quarter hour, e.g. 9:15 AM and 6:30 PM. A time left empty stays as on record.
        </p>
        <div className="sm:col-span-2">
          <label htmlFor={fid('reason')} className="label">
            Why
          </label>
          <textarea
            id={fid('reason')}
            name="reason"
            rows={3}
            required
            maxLength={CORRECTION_REASON_MAX}
            value={typed.reason}
            onChange={(e) => set('reason', e.target.value)}
            aria-describedby={fid('reason-hint')}
            className="input"
          />
          <p id={fid('reason-hint')} className="hint">
            {byHr ? 'Why HR corrects it, e.g. seen at the office by HR.' : 'E.g. I left for a client meeting and forgot to check out. Your manager and HR read it.'} Up to{' '}
            {CORRECTION_REASON_MAX} characters.
          </p>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {problems.length ? (
          <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
            <p className="font-medium">Before you can {byHr ? 'correct' : 'send'} it:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">{correctionReadyText(typed, byHr, person.name, toCeo)}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={blocked} className="btn btn-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-60">
          {sending ? (byHr ? 'Correcting…' : 'Sending…') : byHr ? 'Correct the day' : 'Send request'}
        </button>
        <Link href={cancelHref} className={`btn btn-secondary min-h-11 ${sending ? 'pointer-events-none opacity-60' : ''}`} aria-disabled={sending || undefined}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
