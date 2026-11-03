'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { TimeInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import { Select } from '@/components/select';
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
// until then, past the hours to work, so a long day fills short hours on the month's other days; empty, as before. Days a
// week (owner, 31 October 2026: flexible days): any that many of the working days ticked, for part-timers and interns
// who choose their days; a day then counts as absent only once their week can no longer have them.

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
            aria-describedby={fid('hint')}
            className="input tabular-nums"
          />
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
            <TimeInput id={fid('countUntil')} name="countUntil" defaultValue={shown.countUntil ?? ''} aria-describedby={fid('hint')} />
          </div>
        </div>
      </div>
      <p id={fid('hint')} aria-live="polite" className={`hint -mt-2 ${hint.problem ? 'text-danger' : ''}`}>
        {hint.text}
      </p>
      <fieldset>
        <legend className="label">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day, i) => (
            <label key={day} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft">
              <input type="checkbox" name="workingDays" value={i} defaultChecked={days.has(i)} className="size-4 accent-accent" />
              {day.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="max-w-xs">
        <label htmlFor={fid('daysPerWeek')} className="label">
          Days a week
        </label>
        <Select
          id={fid('daysPerWeek')}
          name="daysPerWeek"
          defaultValue={valueOf(state, 'daysPerWeek', shift?.daysPerWeek ? String(shift.daysPerWeek) : '')}
          className="input"
        >
          <option value="">Every working day</option>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              Any {n} of them
            </option>
          ))}
        </Select>
      </div>
      {/* a freelancer's long day (owner, 3 November 2026: "if more than N Hours Count as Y Hours"), on or off per shift */}
      <fieldset className="space-y-3 rounded-lg border border-line p-4">
        <legend className="label px-1">Freelancers’ long day</legend>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="longDayOn" value="1" defaultChecked={valueOf(state, 'longDayOn', shift?.longDayOn ? '1' : '') === '1'} className="size-4 accent-accent" />
          On for this shift
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={fid('longDayOverHours')} className="label">
              More than (hours)
            </label>
            <input
              id={fid('longDayOverHours')}
              name="longDayOverHours"
              inputMode="decimal"
              autoComplete="off"
              placeholder="10"
              defaultValue={valueOf(state, 'longDayOverHours', hoursToWorkShown(shift?.longDayOverHours))}
              className="input w-28"
            />
          </div>
          <div>
            <label htmlFor={fid('longDayCountsAs')} className="label">
              Count as (hours)
            </label>
            <input
              id={fid('longDayCountsAs')}
              name="longDayCountsAs"
              inputMode="decimal"
              autoComplete="off"
              placeholder="14"
              defaultValue={valueOf(state, 'longDayCountsAs', hoursToWorkShown(shift?.longDayCountsAs))}
              className="input w-28"
            />
          </div>
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
