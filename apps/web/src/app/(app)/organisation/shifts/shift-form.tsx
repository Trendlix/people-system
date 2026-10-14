'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, valueOf } from '@/components/form';
import type { FormState, Shift } from '@/lib/types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ShiftForm({ action, shift }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; shift?: Shift }) {
  const [state, formAction] = useActionState(action, {});
  const fid = useFieldIds();
  const typedDays = state.values?.workingDays;
  const days = state.values
    ? new Set((Array.isArray(typedDays) ? typedDays : typedDays ? [typedDays] : []).map(Number))
    : new Set(shift?.workingDays ?? [0, 1, 2, 3, 4]);

  return (
    <form action={formAction} className="card max-w-xl space-y-5 p-6">
      <FormErrors errors={state.errors} />
      <div className="max-w-40">
        <label htmlFor={fid('code')} className="label">
          Shift code
        </label>
        <input id={fid('code')} name="code" required maxLength={10} placeholder="e.g. A" defaultValue={valueOf(state, 'code', shift?.code)} className="input uppercase" />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor={fid('startTime')} className="label">
            Starts
          </label>
          <input id={fid('startTime')} name="startTime" type="time" required defaultValue={valueOf(state, 'startTime', shift?.startTime ?? '09:00')} className="input" />
        </div>
        <div>
          <label htmlFor={fid('endTime')} className="label">
            Ends
          </label>
          <input id={fid('endTime')} name="endTime" type="time" required defaultValue={valueOf(state, 'endTime', shift?.endTime ?? '18:00')} className="input" />
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
            defaultValue={valueOf(state, 'graceMinutes', String(shift?.graceMinutes ?? 15))}
            className="input"
          />
        </div>
      </div>
      <p className="hint -mt-3">Check-in after the start time plus the grace minutes counts as late.</p>
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
        <Link href="/organisation/shifts" className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
