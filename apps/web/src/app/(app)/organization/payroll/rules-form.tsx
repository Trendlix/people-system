'use client';

import Link from 'next/link';
import { useState } from 'react';
import { INSTALLMENT_LIMIT_MIN, LAW_INSTALLMENT_PERCENT } from '@trendlix/shared';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import type { ContractSettings, FormState, PayrollSettingsView } from '@/lib/types';
import { SETUP_PATHS } from '../setup-pages';
import { plainAmount } from '../../employees/[id]/contracts/salary';

// Payroll Setup → Your Rules (HR and Admin; owner's request, 16 October 2026): the rules runs are worked out with,
// after the owner's payroll sheet, and the company defaults that change the sheet, kept with the contract settings: the
// basic share of the gross new contracts start with and the basic wage Form 1 prints. A run keeps the rules it was made
// or last refreshed with; a signed contract keeps its own basic share. Pay overtime is a switch, off from 16 October
// 2026 (owner: "No overtime for now", as attendance counts at most the shift's hours to work a day): while it is off the
// overtime's percent and rate are greyed and not sent, and the API keeps them for when it is turned on. An API from
// before the switch has none: the overtime fields then show as they did. Salary Reviews (owner's decision, 16 October
// 2026: the Salary Raises report): after how many months without a raise, or since joining, someone is due for a
// salary review; an API from before it has none, and the field isn't shown. Installments (owner, 18 October 2026: "in the
// deductions i might have a loan of a medical subscription or something that needs to be deducted as installments on
// the employee. how will it be managed?"): the most a month's installments of advances and loans may take of the wage,
// the Labour Law's limit (owner, 18 October 2026, after reading the law: "Block above 10%"; Art. 113): 10% at most,
// lower if the company sets it so; a plan or an installment past it is refused, and the run's line warns past it.
// Shown only when the API has it. Office Location (owner, 19 October 2026: "Check-in through the system (phone or web
// with the office location check, or a device) to replace Zoho") and Zoho People's check-in addresses were here until
// 20 October 2026 (owner: "Own page, several locations"): a line points to Check-in Setup in their place.

type RuleKey = 'dayDivisor' | 'attendanceGracePercent' | 'kpiGracePercent' | 'overtimeAbovePercent' | 'overtimeRate' | 'noShowDayMultiplier';

const RULE_FIELDS: { key: RuleKey; label: string; hint: string; whole?: boolean }[] = [
  { key: 'dayDivisor', label: 'Days in a month', hint: 'For day rates and part months: someone who joined or left in the month, or was under contract for part of it, is paid for their days of these.', whole: true },
  { key: 'attendanceGracePercent', label: 'Attendance grace (%)', hint: 'Attendance at or above this counts in full; below it, the fixed part of the gross follows it.' },
  { key: 'kpiGracePercent', label: 'KPI grace (%)', hint: "Last month's final KPI scorecard at or above this counts in full; below it, the variable part of the gross follows its final %. With no final scorecard, it isn't cut." },
  { key: 'noShowDayMultiplier', label: 'No-show day costs (days)', hint: "A day absent without notice costs this many days' pay; its hours aren't counted again in attendance." },
];

type RuleField = { key: RuleKey; label: string; hint: string; whole?: boolean };

const OVERTIME_FIELDS: RuleField[] = [
  { key: 'overtimeAbovePercent', label: 'Overtime above (%)', hint: 'Overtime is paid for attendance above this.' },
  { key: 'overtimeRate', label: 'Overtime rate', hint: 'Overtime is paid at this rate, e.g. 1.5 for time and a half.' },
];

/** Whether the switch was on in what was typed (after a failed save: the hidden "false", then "true" when checked). */
const typedOn = (typed: string | string[]) => (Array.isArray(typed) ? typed.includes('true') : typed === 'true');

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
  // the switch as typed after a failed save, else as saved; none from an API from before it
  const hasSwitch = rules.payOvertime !== undefined;
  const typedSwitch = state.values?.payOvertime;
  const [paysOvertime, setPaysOvertime] = useState(typedSwitch !== undefined ? typedOn(typedSwitch) : rules.payOvertime !== false);
  const off = hasSwitch && !paysOvertime;
  const reviewMonths = rules.salaryReviewMonths;
  const limitPercent = rules.installmentLimitPercent;

  const numberField = (f: RuleField, disabled = false) => (
    <div key={f.key} className={disabled ? 'opacity-60' : undefined}>
      <label htmlFor={fid(f.key)} className="label">
        {f.label}
      </label>
      <input
        id={fid(f.key)}
        name={f.key}
        required
        disabled={disabled}
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
  );

  return (
    <form {...form} className="space-y-6">
      <FormErrors errors={state.errors} />
      <fieldset className="space-y-4">
        <legend className="font-semibold">Pay Rules</legend>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{RULE_FIELDS.map((f) => numberField(f))}</div>
      </fieldset>

      <div className="border-t border-line-soft pt-5">
        <fieldset className="space-y-4">
          <legend className="font-semibold">Overtime</legend>
          {hasSwitch && (
            <div>
              {/* a hidden "false" so turning it off is sent too */}
              <input type="hidden" name="payOvertime" value="false" />
              <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  role="switch"
                  name="payOvertime"
                  value="true"
                  checked={paysOvertime}
                  onChange={(e) => setPaysOvertime(e.target.checked)}
                  aria-describedby={fid('payOvertime-hint')}
                  className="size-5 accent-accent"
                />
                Pay overtime
              </label>
              <p id={fid('payOvertime-hint')} className="hint">
                Off until attendance and an approval step exist (owner, 16 October 2026). While it is off, no run pays overtime, whatever the
                attendance; the percent and rate below are kept for when it is turned on.
              </p>
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{OVERTIME_FIELDS.map((f) => numberField(f, off))}</div>
        </fieldset>
      </div>

      {reviewMonths !== undefined && (
        <div className="border-t border-line-soft pt-5">
          <fieldset className="space-y-4">
            <legend className="font-semibold">Salary Reviews</legend>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor={fid('salaryReviewMonths')} className="label">
                  Salary review due after (months)
                </label>
                <input
                  id={fid('salaryReviewMonths')}
                  name="salaryReviewMonths"
                  required
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={valueOf(state, 'salaryReviewMonths', String(reviewMonths))}
                  aria-describedby={fid('salaryReviewMonths-hint')}
                  className="input tabular-nums"
                />
                <p id={fid('salaryReviewMonths-hint')} className="hint">
                  The Salary Raises report lists everyone who has had no raise for this many months, or none since joining, as due for a review. 1 to
                  60; 12 is a year.
                </p>
              </div>
            </div>
          </fieldset>
        </div>
      )}

      {limitPercent !== undefined && (
        <div className="border-t border-line-soft pt-5">
          <fieldset className="space-y-4">
            <legend className="font-semibold">The Law&apos;s Limit on Installments</legend>
            <div>
              <label htmlFor={fid('installmentLimitPercent')} className="label">
                A month&apos;s installments may take at most
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={fid('installmentLimitPercent')}
                  name="installmentLimitPercent"
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={valueOf(state, 'installmentLimitPercent', String(limitPercent ?? LAW_INSTALLMENT_PERCENT))}
                  aria-describedby={`${fid('installmentLimitPercent-unit')} ${fid('installmentLimitPercent-hint')}`}
                  className="input w-32 tabular-nums"
                />
                <span id={fid('installmentLimitPercent-unit')} className="text-sm">
                  % of the wage
                </span>
              </div>
              <p id={fid('installmentLimitPercent-hint')} className="hint">
                The Labour Law allows at most {LAW_INSTALLMENT_PERCENT}% of the wage a month to repay an advance or a loan (Law No. 14 of 2025, Art. 113):
                all of the employee&apos;s advance recoveries and loan installments in a month together, against their current contract&apos;s gross.
                Recording a plan, changing or moving an installment, or entering a recovery past it is refused, and the run&apos;s line warns past it.
                {` ${INSTALLMENT_LIMIT_MIN} to ${LAW_INSTALLMENT_PERCENT}`}; lower if the company wants less.
              </p>
            </div>
          </fieldset>
        </div>
      )}

      {/* the check-in places moved to their own page (owner, 20 October 2026: "Own page, several locations") */}
      <div className="border-t border-line-soft pt-5">
        <p className="text-sm">
          Check-in locations and Zoho&apos;s addresses are on <Link href={SETUP_PATHS.checkInSetup}>Check-in Setup</Link>, under Time &amp; Leave.
        </p>
      </div>

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
