'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState, LeaveSettingsView } from '@/lib/types';
import { lawDefault, PERMISSION_FIELDS, SETTING_FIELDS, unitText } from './setup';

// Organization → Leave → Annual Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): the
// annual leave's days by Labour Law 14/2025 Art. 124, each with the law's words under it and the law's figure when it
// is changed, and how long days carried may stay before they are settled (Art. 125). HR changes them; balances are
// worked out with them from then on. Permission (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per
// day", "Yes, in Leave Setup"): its hours a month and most hours a day, in half hours, saved with the rest; new
// permission requests are checked against them, those already sent stay as they were sent. Shown only when the API has
// them (one from before permission sends none).

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function LeaveSettingsForm({ action, settings }: { action: Action; settings: LeaveSettingsView }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  // the permission figures, when the API has them (19 October 2026)
  const permission = typeof settings.permissionHoursPerMonth === 'number';
  return (
    <form {...form} className="space-y-5">
      <FormErrors errors={state.errors} />
      {state.message && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {state.message}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SETTING_FIELDS.map((f) => {
          const saved = String(settings[f.key]);
          const law = lawDefault(f.key);
          return (
            <div key={f.key}>
              <label htmlFor={fid(f.key)} className="label">
                {f.label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={fid(f.key)}
                  name={f.key}
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  defaultValue={valueOf(state, f.key, saved)}
                  aria-describedby={settings[f.key] !== law ? fid(`${f.key}-hint`) : undefined}
                  className="input w-24 text-base font-semibold tabular-nums"
                />
                <span className="text-sm text-muted">{f.unit}</span>
              </div>
              {settings[f.key] !== law && (
                <p id={fid(`${f.key}-hint`)} className="hint">
                  The law: {unitText(law, f.unit)}.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {permission && (
        <fieldset className="space-y-3 border-t border-line-soft pt-5" aria-labelledby={fid('permission-heading')}>
          <h3 id={fid('permission-heading')} className="font-semibold">
            Permission
          </h3>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PERMISSION_FIELDS.map((f) => {
              const saved = settings[f.key] ?? f.defaultHours;
              return (
                <div key={f.key}>
                  <label htmlFor={fid(f.key)} className="label">
                    {f.label}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id={fid(f.key)}
                      name={f.key}
                      type="number"
                      required
                      min={f.min}
                      max={f.max}
                      step={0.5}
                      inputMode="decimal"
                      autoComplete="off"
                      defaultValue={valueOf(state, f.key, String(saved))}
                      className="input w-24 text-base font-semibold tabular-nums"
                    />
                    <span className="text-sm text-muted">hours</span>
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}
      <SubmitButton busy={pending}>{permission ? 'Save leave setup' : 'Save annual leave'}</SubmitButton>
    </form>
  );
}
