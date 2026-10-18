'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState, LeaveSettingsView } from '@/lib/types';
import { lawDefault, SETTING_FIELDS, unitText } from './setup';

// Organization → Leave → Annual Leave (owner, 18 October 2026: "can you apply the leaves according to the law?"): the
// annual leave's days by Labour Law 14/2025 Art. 124, each with the law's words under it and the law's figure when it
// is changed, and how long days carried may stay before they are settled (Art. 125). HR changes them; balances are
// worked out with them from then on.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function LeaveSettingsForm({ action, settings }: { action: Action; settings: LeaveSettingsView }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
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
                  aria-describedby={fid(`${f.key}-hint`)}
                  className="input w-24 text-base font-semibold tabular-nums"
                />
                <span className="text-sm text-muted">{f.unit}</span>
              </div>
              <p id={fid(`${f.key}-hint`)} className="hint">
                <span lang="ar" dir="rtl" className="block">
                  {f.law}
                </span>
                {settings[f.key] !== law && <span className="block">The law: {unitText(law, f.unit)}.</span>}
              </p>
            </div>
          );
        })}
      </div>
      <p className="hint">
        The most of these that applies is earned, month by month, from 1 January: a joiner&apos;s first year pro rata, usable once the months above are
        served. The days for hazardous work are added to it. A change applies to the balances worked out from now on.
      </p>
      <SubmitButton busy={pending}>Save annual leave</SubmitButton>
    </form>
  );
}
