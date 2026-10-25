'use client';

import { STAFFING_MAX_OFF_LIMIT, type StaffingUnitView } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';

// Organization → Leave → Staffing (owner, 25 October 2026: "Warn and need HR"): a team's limit for annual leave (a
// department's without teams), HR's and a Super Admin's to set: at most so many people on annual leave at once, and/or at
// least so many percent at work; both empty, no limit. Saved row by row (PUT /leave/staffing/:departmentId); the API
// checks it again.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function StaffingLimitForm({ action, unit }: { action: Action; unit: Pick<StaffingUnitView, 'nameEn' | 'limit'> }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  return (
    <form {...form} aria-label={`Staffing limit of ${unit.nameEn}`} className="space-y-3">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="text-sm text-ok">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={fid('maxOff')} className="label">
            At most on annual leave at once
          </label>
          <div className="flex items-center gap-2">
            <input
              id={fid('maxOff')}
              name="maxOff"
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              placeholder="None"
              defaultValue={valueOf(state, 'maxOff', unit.limit?.maxOff === null || unit.limit?.maxOff === undefined ? '' : String(unit.limit.maxOff))}
              aria-describedby={fid('hint')}
              className="input w-24 tabular-nums"
            />
            <span className="text-sm text-muted">people</span>
          </div>
        </div>
        <div>
          <label htmlFor={fid('minAtWorkPercent')} className="label">
            At least at work
          </label>
          <div className="flex items-center gap-2">
            <input
              id={fid('minAtWorkPercent')}
              name="minAtWorkPercent"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="None"
              defaultValue={valueOf(state, 'minAtWorkPercent', unit.limit?.minAtWorkPercent === null || unit.limit?.minAtWorkPercent === undefined ? '' : String(unit.limit.minAtWorkPercent))}
              aria-describedby={fid('hint')}
              className="input w-24 tabular-nums"
            />
            <span className="text-sm text-muted">%</span>
          </div>
        </div>
        <SubmitButton busy={pending}>Save limit</SubmitButton>
      </div>
      <p id={fid('hint')} className="hint">
        Either, both or none: a whole number of people from 0 to {STAFFING_MAX_OFF_LIMIT}, a percent from 1 to 100. Empty both to remove the limit.
      </p>
    </form>
  );
}
