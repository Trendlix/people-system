'use client';

import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { ContractSettings, FormState, PayrollSettingsView } from '@/lib/types';
import { plainAmount } from '../../employees/[id]/contracts/salary';

// Payroll Setup → Your Rules (HR and Admin; owner's request, 16 October 2026): the rules runs are worked out with,
// after the owner's payroll sheet, and the company defaults that change the sheet, kept with the contract settings: the
// basic share of the gross new contracts start with and the basic wage Form 1 prints. A run keeps the rules it was made
// or last refreshed with; a signed contract keeps its own basic share.

type RuleKey = 'dayDivisor' | 'attendanceGracePercent' | 'kpiGracePercent' | 'overtimeAbovePercent' | 'overtimeRate' | 'noShowDayMultiplier';

const RULE_FIELDS: { key: RuleKey; label: string; hint: string; whole?: boolean }[] = [
  { key: 'dayDivisor', label: 'Days in a month', hint: 'For day rates and part months: someone who joined or left in the month is paid for their days of these.', whole: true },
  { key: 'attendanceGracePercent', label: 'Attendance grace (%)', hint: 'Attendance at or above this counts in full; below it, the fixed part of the gross follows it.' },
  { key: 'kpiGracePercent', label: 'KPI grace (%)', hint: "A KPI average at or above this counts in full; below it, the variable part of the gross follows it. With no KPI given, it isn't cut." },
  { key: 'overtimeAbovePercent', label: 'Overtime above (%)', hint: 'Overtime is paid for attendance above this.' },
  { key: 'overtimeRate', label: 'Overtime rate', hint: 'Overtime is paid at this rate, e.g. 1.5 for time and a half.' },
  { key: 'noShowDayMultiplier', label: 'No-show day costs (days)', hint: "A day absent without notice costs this many days' pay; its hours aren't counted again in attendance." },
];

export function YourRulesForm({
  action,
  rules,
  defaults,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  rules: PayrollSettingsView;
  /** The contract settings; null when they couldn't be read, and a default missing from an API from before it. */
  defaults: ContractSettings | null;
}) {
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();
  const basicShare = defaults?.basicPercentDefault;
  const insuranceBasic = defaults?.insuranceBasicDefault;

  return (
    <form {...form} className="space-y-6">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-4">
        <legend className="font-semibold">Pay Rules</legend>
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
                defaultValue={valueOf(state, f.key, String(rules[f.key]))}
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

      {(basicShare !== undefined || insuranceBasic !== undefined) && (
        <div className="border-t border-line-soft pt-5">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Company Defaults</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              {basicShare !== undefined && (
                <div>
                  <label htmlFor={fid('basicPercentDefault')} className="label">
                    Basic share of the gross for new contracts (%)
                  </label>
                  <input
                    id={fid('basicPercentDefault')}
                    name="basicPercentDefault"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    defaultValue={valueOf(state, 'basicPercentDefault', String(basicShare))}
                    aria-describedby={fid('basicPercentDefault-hint')}
                    className="input tabular-nums"
                  />
                  <p id={fid('basicPercentDefault-hint')} className="hint">
                    The fixed part of the gross a new contract or job offer starts with, which follows attendance; the rest is the variable part,
                    which follows the KPIs. HR can set another on each contract, and a signed contract keeps its own.
                  </p>
                </div>
              )}
              {insuranceBasic !== undefined && (
                <div>
                  <label htmlFor={fid('insuranceBasicDefault')} className="label">
                    Basic wage on social insurance forms (default, EGP)
                  </label>
                  <input
                    id={fid('insuranceBasicDefault')}
                    name="insuranceBasicDefault"
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    defaultValue={valueOf(state, 'insuranceBasicDefault', plainAmount(insuranceBasic))}
                    aria-describedby={fid('insuranceBasicDefault-hint')}
                    className="input tabular-nums"
                  />
                  <p id={fid('insuranceBasicDefault-hint')} className="hint">
                    Printed in Form 1&apos;s <bdi lang="ar">أجر أساسي</bdi> boxes for an employee without a basic wage of their own on the Social
                    Insurance tab. The contract&apos;s basic salary is not changed by it.
                  </p>
                </div>
              )}
            </div>
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton busy={pending}>Save rules</SubmitButton>
        {state.message && !pending && (
          <p role="status" className="text-sm text-ok">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
