'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { TimeInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { formatTime } from '@/lib/format';
import { hoursToWorkShown, typedShiftHint, type TypedShift } from '@/lib/shifts';
import type { FormState, Shift } from '@/lib/types';

// A shift: its window (starts, ends), the hours to work a day within it, the grace minutes and the working days. The
// hours to work (owner, 16 October 2026, on the MORNING shift of 9:00 AM to 7:00 PM: "my company shift is to maintain 9
// hours within the shift window, its like flexible shift"): fewer than the window, the shift is flexible, worked anywhere
// within it; empty, the whole window. They are also the most attendance counts a day (owner, 16 October 2026: "maximum
// working hours to be recorded per day is 9 hours between checkin and check out"). The hint under the times follows what
// is typed: when check-in counts as late, or for a flexible shift the latest check-in that leaves its hours. "Count hours
// until" (owner, 20 October 2026: "within the same month with no working hours to be counted after 8 PM even if the
// check out was 11 PM / record the checkout time but count till the checkout window limit"): set, a day's hours count
// until then, past the hours to work, so a long day fills short hours on the month's other days; empty, as before.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FIELDS = ['startTime', 'endTime', 'graceMinutes', 'hoursPerDay', 'countUntil'] as const;

export function ShiftForm({ action, shift }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; shift?: Shift }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  const typedDays = state.values?.workingDays;
  const days = state.values
    ? new Set((Array.isArray(typedDays) ? typedDays : typedDays ? [typedDays] : []).map(Number))
    : new Set(shift?.workingDays ?? [0, 1, 2, 3, 4]);
  const shown: TypedShift = {
    startTime: valueOf(state, 'startTime', formatTime(shift?.startTime ?? '09:00')),
    endTime: valueOf(state, 'endTime', formatTime(shift?.endTime ?? '18:00')),
    graceMinutes: valueOf(state, 'graceMinutes', String(shift?.graceMinutes ?? 15)),
    hoursPerDay: valueOf(state, 'hoursPerDay', hoursToWorkShown(shift?.hoursPerDay)),
    countUntil: valueOf(state, 'countUntil', shift?.countUntil ? formatTime(shift.countUntil) : ''),
  };
  // what is typed now, for the hint; the fields themselves keep their own text
  const [typed, setTyped] = useState<TypedShift>(shown);
  const hint = typedShiftHint(typed);

  function onInput(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    setTyped(Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? '')])) as unknown as TypedShift);
  }

  return (
    <form action={formAction} onInput={onInput} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div className="max-w-40">
        <label htmlFor={fid('code')} className="label">
          Shift code
        </label>
        <input id={fid('code')} name="code" required maxLength={10} placeholder="e.g. A" defaultValue={valueOf(state, 'code', shift?.code)} className="input uppercase" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('startTime')} className="label">
            Starts
          </label>
          <TimeInput id={fid('startTime')} name="startTime" required defaultValue={shown.startTime} aria-describedby={fid('hint')} />
        </div>
        <div>
          <label htmlFor={fid('endTime')} className="label">
            Ends
          </label>
          <TimeInput id={fid('endTime')} name="endTime" required defaultValue={shown.endTime} aria-describedby={fid('hint')} />
        </div>
        <div>
          <label htmlFor={fid('hoursPerDay')} className="label">
            Hours to work a day
          </label>
          <input
            id={fid('hoursPerDay')}
            name="hoursPerDay"
            inputMode="decimal"
            autoComplete="off"
            placeholder="Whole shift"
            maxLength={5}
            defaultValue={shown.hoursPerDay}
            aria-describedby={`${fid('hoursPerDay-hint')} ${fid('hint')}`}
            className="input tabular-nums"
          />
          <p id={fid('hoursPerDay-hint')} className="hint">
            As 9 or 9:00, in half hours. Empty: the whole shift. Fewer: flexible. Also the most hours attendance counts a day.
          </p>
        </div>
        <div>
          <label htmlFor={fid('graceMinutes')} className="label">
            Grace (minutes)
          </label>
          <input
            id={fid('graceMinutes')}
            name="graceMinutes"
            type="number"
            min={0}
            max={120}
            defaultValue={shown.graceMinutes}
            aria-describedby={fid('hint')}
            className="input"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid('countUntil')} className="label">
            Count hours until
          </label>
          <div className="max-w-xs">
            <TimeInput id={fid('countUntil')} name="countUntil" defaultValue={shown.countUntil ?? ''} aria-describedby={`${fid('countUntil-hint')} ${fid('hint')}`} />
          </div>
          <p id={fid('countUntil-hint')} className="hint">
            Optional, at or after the shift ends and before midnight. Set, hours count until this time even past the hours to work, so a long day fills short hours on
            the month&apos;s other days. Empty: they count until the end plus the grace, at most the hours to work.
          </p>
        </div>
      </div>
      <p id={fid('hint')} aria-live="polite" className={`hint -mt-2 ${hint.problem ? 'text-danger' : ''}`}>
        {hint.text}
      </p>
      <fieldset>
        <legend className="label">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day, i) => (
            <label key={day} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
              <input type="checkbox" name="workingDays" value={i} defaultChecked={days.has(i)} className="size-4 accent-accent" />
              {day.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <SubmitButton>{shift ? 'Save changes' : 'Create shift'}</SubmitButton>
        <Link href="/organization/shifts" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
