'use client';

import { KPI_SETTING_DEFAULTS, KPI_SETTING_LABELS, kpiSettingsProblems, type KpiSettings } from '@trendlix/shared';
import { useState } from 'react';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm } from '@/components/form';
import type { FormState } from '@/lib/types';
import { dayOfMonth } from '../../organization/payroll/settings';
import { SETTING_KEYS, settingsOf, settingValuesOf, type SettingValues } from './templates';

// The KPI settings (owner's brief, 21 October 2026: "Deadlines in a small KPI settings section, defaults: self-rating by
// the 3rd, manager by the 6th, HR by the 8th of the next month"; the sign-off by the 10th): HR's and the Super Admin's.
// What is typed is checked as it is typed, as the API checks it (kpiSettingsProblems): days 1 to 28, each step after the
// one before; Save waits until they are right.

export function KpiSettingsForm({ action, settings }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; settings: KpiSettings }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const [values, setValues] = useState<SettingValues>(() => settingValuesOf(settings));
  const problems = kpiSettingsProblems(settingsOf(values));

  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {SETTING_KEYS.map((k) => (
          <div key={k}>
            <label htmlFor={fid(k)} className="label">
              {KPI_SETTING_LABELS[k]}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={fid(k)}
                name={k}
                inputMode="numeric"
                autoComplete="off"
                maxLength={2}
                required
                value={values[k]}
                onChange={(e) => {
                  const typed = e.target.value;
                  setValues((v) => ({ ...v, [k]: typed }));
                }}
                aria-describedby={fid(`${k}-hint`)}
                className="input w-20 tabular-nums"
              />
              <span className="text-sm text-muted">of the next month</span>
            </div>
            <p id={fid(`${k}-hint`)} className="hint">
              Default: {dayOfMonth(KPI_SETTING_DEFAULTS[k])}
            </p>
          </div>
        ))}
      </div>
      {problems.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg bg-warn-soft py-3 pr-4 pl-8 text-sm text-warn">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending} disabled={problems.length > 0}>
          Save
        </SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
