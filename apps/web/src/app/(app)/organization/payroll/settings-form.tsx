'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { FormState, PayrollSettingsView } from '@/lib/types';

// The payroll settings (HR and Admin): the rules runs are worked out with, after the owner's payroll sheet, and what
// the bank files need. A run keeps the rules it was made or last refreshed with.

type Field = {
  key: 'dayDivisor' | 'attendanceGracePercent' | 'kpiGracePercent' | 'overtimeAbovePercent' | 'overtimeRate' | 'noShowDayMultiplier';
  label: string;
  hint: string;
  whole?: boolean;
};

const RULE_FIELDS: Field[] = [
  { key: 'dayDivisor', label: 'Days in a month', hint: 'For day rates and part months: someone who joined or left in the month is paid for their days of these.', whole: true },
  { key: 'attendanceGracePercent', label: 'Attendance grace (%)', hint: 'Attendance at or above this counts in full; below it, the fixed part of the gross follows it.' },
  { key: 'kpiGracePercent', label: 'KPI grace (%)', hint: "A KPI average at or above this counts in full; below it, the variable part of the gross follows it. With no KPI given, it isn't cut." },
  { key: 'overtimeAbovePercent', label: 'Overtime above (%)', hint: 'Overtime is paid for attendance above this.' },
  { key: 'overtimeRate', label: 'Overtime rate', hint: 'Overtime is paid at this rate, e.g. 1.5 for time and a half.' },
  { key: 'noShowDayMultiplier', label: 'No-show day costs (days)', hint: "A day absent without notice costs this many days' pay; its hours aren't counted again in attendance." },
];

export function PayrollSettingsForm({ action, settings }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; settings: PayrollSettingsView }) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  return (
    <form {...form} className="space-y-6">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-4">
        <legend className="font-semibold">Rules</legend>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {RULE_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={fid(f.key)} className="label">
                {f.label}
              </label>
              <input
                id={fid(f.key)}
                name={f.key}
                required
                inputMode={f.whole ? 'numeric' : 'decimal'}
                autoComplete="off"
                defaultValue={valueOf(state, f.key, String(settings[f.key]))}
                aria-describedby={fid(`${f.key}-hint`)}
                className="input tabular-nums"
              />
              <p id={fid(`${f.key}-hint`)} className="hint">
                {f.hint}
              </p>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="border-t border-line-soft pt-5">
        <fieldset className="space-y-4">
          <legend className="font-semibold">Bank Files</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor={fid('cibDebitAccount')} className="label">
                CIB account the salaries are paid from
              </label>
              <input
                id={fid('cibDebitAccount')}
                name="cibDebitAccount"
                inputMode="numeric"
                autoComplete="off"
                maxLength={20}
                defaultValue={valueOf(state, 'cibDebitAccount', settings.cibDebitAccount)}
                aria-describedby={fid('cibDebitAccount-hint')}
                className="input tabular-nums"
              />
              <p id={fid('cibDebitAccount-hint')} className="hint">
                The company&apos;s 12-digit CIB account, the debit line at the top of the CIB file.
              </p>
            </div>
            <div>
              <label htmlFor={fid('cibDebitAccountName')} className="label">
                Account name
              </label>
              <input
                id={fid('cibDebitAccountName')}
                name="cibDebitAccountName"
                autoComplete="off"
                maxLength={100}
                defaultValue={valueOf(state, 'cibDebitAccountName', settings.cibDebitAccountName)}
                aria-describedby={fid('cibDebitAccountName-hint')}
                className="input"
              />
              <p id={fid('cibDebitAccountName-hint')} className="hint">
                As CIB has it.
              </p>
            </div>
            <div className="sm:max-w-xs">
              <label htmlFor={fid('achPurpose')} className="label">
                ACH purpose
              </label>
              <input
                id={fid('achPurpose')}
                name="achPurpose"
                required
                autoComplete="off"
                maxLength={20}
                defaultValue={valueOf(state, 'achPurpose', settings.achPurpose)}
                aria-describedby={fid('achPurpose-hint')}
                className="input"
              />
              <p id={fid('achPurpose-hint')} className="hint">
                The transaction purpose on every line of the ACH file, e.g. CASH.
              </p>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>Save</SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
