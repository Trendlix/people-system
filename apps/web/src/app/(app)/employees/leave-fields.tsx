'use client';

import { valueOf } from '@/components/form';
import type { EmployeeProfile, Employment, FormState } from '@/lib/types';
import { priorServiceFields } from './leave-facts';

// The profile's facts for the annual leave (owner, 18 October 2026: "can you apply the leaves according to the law?";
// Labour Law 14/2025, Art. 124), on the Personal Details page: a disability (45 days) and the service with earlier
// employers, in years and months (towards the 10 full years "لدى صاحب عمل أو أكثر" for 30 days); and on the employment,
// hazardous, unhealthy or remote work (7 days more). HR sets them; each form sends a marker so a checkbox left unticked
// is saved as no.

const chip =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/** After a refused save, ticked if it was sent; otherwise as saved. */
const tickedOf = (state: FormState, key: string, saved: boolean) => (state.values ? key in state.values : saved);

export function LeaveFactsFields({ state, fid, employee }: { state: FormState; fid: (name: string) => string; employee: EmployeeProfile }) {
  const prior = priorServiceFields(employee.priorServiceMonths);
  return (
    <fieldset className="space-y-5">
      <legend className="font-semibold">Annual Leave</legend>
      <input type="hidden" name="leaveFacts" value="1" />
      <div>
        <label className={`${chip} w-fit`}>
          <input
            type="checkbox"
            name="disability"
            defaultChecked={tickedOf(state, 'disability', employee.disability ?? false)}
            className="size-4 accent-accent"
          />
          A person with a disability
        </label>
      </div>
      <fieldset>
        <legend className="label">Service with earlier employers</legend>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={fid('priorServiceYears')}
            name="priorServiceYears"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            aria-label="Years"
            defaultValue={valueOf(state, 'priorServiceYears', prior.years)}
            className="input w-20 tabular-nums"
          />
          <span className="text-sm text-muted">years</span>
          <input
            id={fid('priorServiceExtraMonths')}
            name="priorServiceExtraMonths"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            aria-label="Months"
            defaultValue={valueOf(state, 'priorServiceExtraMonths', prior.months)}
            className="input w-20 tabular-nums"
          />
          <span className="text-sm text-muted">months</span>
        </div>
      </fieldset>
    </fieldset>
  );
}

/** Hazardous work, on the employment form: a checkbox and its marker. */
export function HazardousWorkField({ state, employment }: { state: FormState; employment: Employment }) {
  return (
    <div>
      <input type="hidden" name="hazardousWorkSent" value="1" />
      <label className={`${chip} w-fit`}>
        <input
          type="checkbox"
          name="hazardousWork"
          defaultChecked={tickedOf(state, 'hazardousWork', employment.hazardousWork ?? false)}
          className="size-4 accent-accent"
        />
        Hazardous, unhealthy or remote work
      </label>
    </div>
  );
}
