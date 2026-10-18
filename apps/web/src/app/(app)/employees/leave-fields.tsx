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
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

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
            aria-describedby={fid('disability-hint')}
            className="size-4 accent-accent"
          />
          A person with a disability
        </label>
        <p id={fid('disability-hint')} className="hint">
          45 days of annual leave a year (Labour Law Art. 124: <span lang="ar">خمسة وأربعون يوما للأشخاص ذوى الإعاقة والأقزام</span>).
        </p>
      </div>
      <fieldset aria-describedby={fid('prior-hint')}>
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
        <p id={fid('prior-hint')} className="hint">
          As the social insurance print shows it. With the service here, 10 full years give 30 days of annual leave (Art. 124:{' '}
          <span lang="ar">عشر سنوات كاملة لدى صاحب عمل أو أكثر</span>). Empty: none.
        </p>
      </fieldset>
    </fieldset>
  );
}

/** Hazardous work, on the employment form: a checkbox and its marker. */
export function HazardousWorkField({ state, fid, employment }: { state: FormState; fid: (name: string) => string; employment: Employment }) {
  return (
    <div>
      <input type="hidden" name="hazardousWorkSent" value="1" />
      <label className={`${chip} w-fit`}>
        <input
          type="checkbox"
          name="hazardousWork"
          defaultChecked={tickedOf(state, 'hazardousWork', employment.hazardousWork ?? false)}
          aria-describedby={fid('hazardousWork-hint')}
          className="size-4 accent-accent"
        />
        Hazardous, unhealthy or remote work
      </label>
      <p id={fid('hazardousWork-hint')} className="hint">
        7 more days of annual leave a year (Labour Law Art. 124: <span lang="ar">تزاد مدة الإجازة السنوية بمقدار سبعة أيام للعمال الذين يعملون فى الأعمال الخطرة</span>), for the
        work the minister&apos;s decree lists.
      </p>
    </div>
  );
}
