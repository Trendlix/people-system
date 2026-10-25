'use client';

import { HOURS_CHANGE_LABELS, INTERVIEW_HOURS_LIMITS, WEEKDAY_LABELS, WEEKDAY_ORDER, type HoursChangeKind, type InterviewDefaults, type InterviewHours } from '@trendlix/shared';
import { useState } from 'react';
import { DateInput, TimeInput } from '@/components/date-time-inputs';
import { FormErrors, useFieldIds, useKeptForm } from '@/components/form';
import { Select } from '@/components/select';
import { formatDate, formatDateTime } from '@/lib/format';
import { bufferOptions, noticeOptions, rowsOf, type ChangeRow, type RangeRow } from '@/lib/interview-hours';
import type { FormState } from '@/lib/types';

// The interview hours form (owner, 25 October 2026: "is it better for each interviewer to add his available interviews
// timeslots?"; asked, "Hours + calendar": each interviewer sets weekly interview hours once), on one's own Interview
// Hours page and on HR's Organization → Interview Hours: for each weekday, the ranges they interview in (Cairo time, on
// the quarter hour; add or remove one), the day they count from, the minimum notice and the buffer between interviews
// (the company's, or stricter), and the one-off changes (a day off from interviews, or extra hours on a date). The system
// then takes away their leave, holidays, booked interviews and busy calendar by itself. What was typed stays when a
// save is refused (useKeptForm); the API checks everything again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

type Keyed<T> = T & { key: string };

function Saved({ state, pending }: { state: FormState; pending: boolean }) {
  if (!state.message || state.errors || pending) return null;
  return (
    <p role="status" className="text-sm text-ok">
      {state.message}
    </p>
  );
}

function RemoveButton({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <button type="button" onClick={onClick} className="btn btn-secondary min-h-11 px-3">
      Remove<span className="sr-only"> {what}</span>
    </button>
  );
}

/** One weekly range: the weekday (sent beside it) and its two times. */
function RangeFields({ row, onRemove }: { row: Keyed<RangeRow>; onRemove: () => void }) {
  const fid = useFieldIds();
  const day = WEEKDAY_LABELS[row.day];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="windowDay" value={row.day} />
      <div className="min-w-0 flex-1 sm:max-w-56">
        <label htmlFor={fid('from')} className="label">
          From
        </label>
        <TimeInput id={fid('from')} name="windowFrom" defaultValue={row.from} />
      </div>
      <div className="min-w-0 flex-1 sm:max-w-56">
        <label htmlFor={fid('to')} className="label">
          To
        </label>
        <TimeInput id={fid('to')} name="windowTo" defaultValue={row.to} />
      </div>
      <RemoveButton onClick={onRemove} what={`${day}’s range`} />
    </div>
  );
}

/** One one-off change: its kind (sent beside it), its date, and extra hours' times (sent empty for a day off). */
function ChangeFields({ row, onRemove }: { row: Keyed<ChangeRow>; onRemove: () => void }) {
  const fid = useFieldIds();
  return (
    <div className="space-y-2 rounded-lg border border-line-soft p-3">
      <p className="text-sm font-semibold">{HOURS_CHANGE_LABELS[row.kind]}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="changeKind" value={row.kind} />
        <div className="min-w-0 flex-1 sm:max-w-48">
          <label htmlFor={fid('date')} className="label">
            Date
          </label>
          <DateInput id={fid('date')} name="changeDate" defaultValue={row.date} />
        </div>
        {row.kind === 'extra' ? (
          <>
            <div className="min-w-0 flex-1 sm:max-w-56">
              <label htmlFor={fid('from')} className="label">
                From
              </label>
              <TimeInput id={fid('from')} name="changeFrom" defaultValue={row.from} />
            </div>
            <div className="min-w-0 flex-1 sm:max-w-56">
              <label htmlFor={fid('to')} className="label">
                To
              </label>
              <TimeInput id={fid('to')} name="changeTo" defaultValue={row.to} />
            </div>
          </>
        ) : (
          <>
            <input type="hidden" name="changeFrom" value="" />
            <input type="hidden" name="changeTo" value="" />
          </>
        )}
        <RemoveButton onClick={onRemove} what={HOURS_CHANGE_LABELS[row.kind].toLowerCase()} />
      </div>
    </div>
  );
}

export function InterviewHoursForm({
  action,
  hours,
  defaults,
  today,
  updatedAt,
  updatedBy,
  submitLabel = 'Save interview hours',
}: {
  action: Action;
  hours: InterviewHours | null;
  defaults: InterviewDefaults;
  /** Today in Cairo (YYYY-MM-DD): where "Counts from" starts for hours set for the first time. */
  today: string;
  updatedAt: string | null;
  updatedBy: { name: string } | null;
  submitLabel?: string;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [ranges, setRanges] = useState<Keyed<RangeRow>[]>(() => rowsOf(hours).ranges.map((r, i) => ({ ...r, key: `saved-${i}` })));
  const [changes, setChanges] = useState<Keyed<ChangeRow>[]>(() => rowsOf(hours).changes.map((c, i) => ({ ...c, key: `saved-${i}` })));
  // each row added gets its own key, so removing one never moves what was typed into another
  const [added, setAdded] = useState(0);
  const addRange = (day: number) => {
    const key = `new-${added}`;
    setAdded(added + 1);
    setRanges((rs) => [...rs, { day, from: '', to: '', key }]);
  };
  const addChange = (kind: HoursChangeKind) => {
    const key = `new-${added}`;
    setAdded(added + 1);
    setChanges((cs) => [...cs, { kind, date: '', from: '', to: '', key }]);
  };
  const L = INTERVIEW_HOURS_LIMITS;

  return (
    <form {...form} noValidate className="space-y-6">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">Weekly Hours</legend>
        <p className="text-sm text-muted">The times you can interview in each week, in Cairo time. Leave a day empty when you don’t interview on it.</p>
        {WEEKDAY_ORDER.map((day) => {
          const rows = ranges.filter((r) => r.day === day);
          return (
            <div key={day} role="group" aria-labelledby={fid(`day-${day}`)} className="space-y-2 border-t border-line-soft pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p id={fid(`day-${day}`)} className="text-sm font-semibold">
                  {WEEKDAY_LABELS[day]}
                </p>
                {rows.length < L.rangesPerDay && (
                  <button type="button" onClick={() => addRange(day)} className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
                    Add a range<span className="sr-only"> on {WEEKDAY_LABELS[day]}</span>
                  </button>
                )}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-muted">No interviews.</p>
              ) : (
                rows.map((r) => <RangeFields key={r.key} row={r} onRemove={() => setRanges((rs) => rs.filter((x) => x.key !== r.key))} />)
              )}
            </div>
          );
        })}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('effectiveFrom')} className="label">
            Counts from
          </label>
          <DateInput id={fid('effectiveFrom')} name="effectiveFrom" defaultValue={formatDate(hours?.effectiveFrom ?? today)} required aria-describedby={fid('effectiveFrom-hint')} />
          <p id={fid('effectiveFrom-hint')} className="hint">
            The weekly hours apply from this day on.
          </p>
        </div>
        <div>
          <label htmlFor={fid('noticeHours')} className="label">
            Minimum notice
          </label>
          <Select id={fid('noticeHours')} name="noticeHours" defaultValue={hours?.noticeHours != null ? String(hours.noticeHours) : ''} aria-describedby={fid('notice-hint')} className="input">
            {noticeOptions(defaults, hours?.noticeHours).map((o) => (
              <option key={o.value || 'company'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p id={fid('notice-hint')} className="hint">
            How far ahead you must be booked. Only longer than the company’s.
          </p>
        </div>
        <div>
          <label htmlFor={fid('bufferMinutes')} className="label">
            Buffer between interviews
          </label>
          <Select id={fid('bufferMinutes')} name="bufferMinutes" defaultValue={hours?.bufferMinutes != null ? String(hours.bufferMinutes) : ''} aria-describedby={fid('buffer-hint')} className="input">
            {bufferOptions(defaults, hours?.bufferMinutes).map((o) => (
              <option key={o.value || 'company'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p id={fid('buffer-hint')} className="hint">
            Kept free before and after each of your interviews.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">One-off Changes</legend>
        <p className="text-sm text-muted">A day off from interviews, or extra hours on a date. Past ones go by themselves.</p>
        {changes.length === 0 && <p className="text-sm text-muted">None.</p>}
        {changes.map((c) => (
          <ChangeFields key={c.key} row={c} onRemove={() => setChanges((cs) => cs.filter((x) => x.key !== c.key))} />
        ))}
        {changes.length < L.changes && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addChange('off')} className="btn btn-secondary">
              Add a day off
            </button>
            <button type="button" onClick={() => addChange('extra')} className="btn btn-secondary">
              Add extra hours
            </button>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : submitLabel}
        </button>
        <Saved state={state} pending={pending} />
      </div>
      {updatedAt && (
        <p className="text-xs text-muted">
          Last saved {formatDateTime(updatedAt)}
          {updatedBy ? ` by ${updatedBy.name}` : ''}.
        </p>
      )}
    </form>
  );
}
