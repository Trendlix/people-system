'use client';

import { PAY_BASES, PAY_BASIS_LABELS } from '@trendlix/shared';
import { AllowanceRows } from '@/components/allowance-rows';
import { valueOf } from '@/components/form';
import { allowanceTerms, type AllowanceRow } from '@/lib/allowances';
import type { AllowanceType, FormState } from '@/lib/types';
import { formatEgp, parseAmount, plainAmount, SALARY_BASES, SALARY_BASIS_LABELS, splitSalary, workedOutGross } from '../employees/[id]/contracts/salary';
import { SalaryBreakdownList } from '../employees/[id]/contracts/salary-breakdown';
import type { OfferDefaults } from './form-body';
import {
  estimateText,
  insuredAllowancesOf,
  offerBreakdownRows,
  offerSalary,
  parseHours,
  payBasisFrom,
  salaryStartFrom,
  totalPay,
  type TermsTyped,
} from './terms';

// The Terms part of the offer form: the pay basis (owner's request, 15 October 2026), a monthly salary typed as the gross
// or as the net wanted, or by the hour (the hourly rate and the hours a week, whose monthly estimate is the gross); the
// working days a week, the basic part, the allowances, and the probation and the contract's length. While HR types, the
// month's breakdown down to the net is shown with the allowances in it (terms.ts), for the year of the join date. The
// form sends the gross worked out (grossSalary) and the net worked out (netSalary), as the contract form does.

const optional = <span className="font-normal text-muted">(optional)</span>;
const radio =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

export function OfferTerms({
  state,
  fid,
  defaults,
  typed,
  basicPercent: basicTyped,
  rows,
  onRows,
  allowanceTypes,
  year,
}: {
  state: FormState;
  fid: (name: string) => string;
  defaults: OfferDefaults;
  /** The salary fields as typed (tracked by the form). */
  typed: TermsTyped;
  /** The basic part as typed, in percent. */
  basicPercent: string;
  rows: AllowanceRow[];
  onRows: (rows: AllowanceRow[]) => void;
  allowanceTypes: AllowanceType[];
  /** The year whose insurable wage limits apply: the join date's, else this year. */
  year: number;
}) {
  const hourly = payBasisFrom(typed.payBasis) === 'hourly';
  const start = salaryStartFrom(typed.salaryBasis);
  const terms = allowanceTerms(rows, allowanceTypes);
  const salary = offerSalary(typed, year, terms);
  const calc = salary.kind === 'ok' ? salary.breakdown : null;
  const basicPercent = Number(basicTyped);
  const split = calc && Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100 ? splitSalary(calc.gross, basicPercent) : null;
  const rate = parseAmount(typed.hourlyRate);
  const hours = parseHours(typed.hoursPerWeek);

  return (
    <div className="space-y-5">
      <fieldset id="field-payBasis" className="scroll-mt-6" aria-describedby={fid('payBasis-hint')}>
        <legend className="label">Pay basis</legend>
        <div className="flex flex-wrap gap-2">
          {PAY_BASES.map((b) => (
            <label key={b} className={radio}>
              <input type="radio" name="payBasis" value={b} defaultChecked={payBasisFrom(typed.payBasis) === b} className="size-4 accent-accent" />
              {PAY_BASIS_LABELS[b]}
            </label>
          ))}
        </div>
        <p id={fid('payBasis-hint')} className="hint">
          {hourly
            ? 'By the hour, e.g. part-time two or three days a week: the hourly rate × the hours a week × 52 ÷ 12 is the monthly gross.'
            : 'A monthly salary: type the gross, and the net is worked out, or the net wanted, and the gross is worked out.'}
        </p>
      </fieldset>

      {hourly ? (
        <div key="hourly" className="grid gap-5 sm:grid-cols-2">
          <div id="field-hourlyRate" className="scroll-mt-6">
            <label htmlFor={fid('hourlyRate')} className="label">
              Hourly rate (EGP)
            </label>
            <input
              id={fid('hourlyRate')}
              name="hourlyRate"
              inputMode="decimal"
              autoComplete="off"
              required
              defaultValue={typed.hourlyRate}
              aria-invalid={(salary.kind === 'invalid' && salary.field === 'hourlyRate') || undefined}
              className="input tabular-nums"
            />
          </div>
          <div id="field-hoursPerWeek" className="scroll-mt-6">
            <label htmlFor={fid('hoursPerWeek')} className="label">
              Hours a week
            </label>
            <input
              id={fid('hoursPerWeek')}
              name="hoursPerWeek"
              inputMode="decimal"
              autoComplete="off"
              required
              aria-describedby={fid('hoursPerWeek-hint')}
              defaultValue={typed.hoursPerWeek}
              aria-invalid={(salary.kind === 'invalid' && salary.field === 'hoursPerWeek') || undefined}
              className="input tabular-nums"
            />
            <p id={fid('hoursPerWeek-hint')} className="hint">
              {salary.kind === 'ok' && salary.estimate !== null && rate && hours ? estimateText(rate, hours, salary.estimate) : 'E.g. 20, or 22.5: at most 48, the legal working week.'}
            </p>
          </div>
          {/* what is saved as the gross: the monthly estimate */}
          <input type="hidden" name="grossSalary" value={calc ? plainAmount(calc.gross) : ''} />
        </div>
      ) : (
        <div key="monthly" className="space-y-5">
          <fieldset aria-describedby={fid('salaryBasis-hint')}>
            <legend className="label">Start from</legend>
            <div className="flex flex-wrap gap-2">
              {SALARY_BASES.map((b) => (
                <label key={b} className={radio}>
                  <input type="radio" name="salaryBasis" value={b} defaultChecked={start === b} className="size-4 accent-accent" />
                  {SALARY_BASIS_LABELS[b]}
                </label>
              ))}
            </div>
            <p id={fid('salaryBasis-hint')} className="hint">
              {start === 'net'
                ? 'Type the net wanted, allowances included: the gross is worked out, in whole pounds.'
                : 'Type the gross: the net is worked out.'}
            </p>
          </fieldset>
          {start === 'gross' ? (
            <div key="gross" id="field-grossSalary" className="scroll-mt-6 sm:max-w-[calc(50%-0.625rem)]">
              <label htmlFor={fid('grossSalary')} className="label">
                Gross salary (EGP a month)
              </label>
              <input
                id={fid('grossSalary')}
                name="grossSalary"
                inputMode="decimal"
                autoComplete="off"
                required
                defaultValue={typed.grossSalary}
                aria-invalid={salary.kind === 'invalid' || undefined}
                className="input tabular-nums"
              />
            </div>
          ) : (
            <div key="net" id="field-grossSalary" className="scroll-mt-6 sm:max-w-[calc(50%-0.625rem)]">
              <label htmlFor={fid('wantedNet')} className="label">
                Net salary wanted (EGP a month)
              </label>
              <input
                id={fid('wantedNet')}
                name="wantedNet"
                inputMode="decimal"
                autoComplete="off"
                required
                aria-describedby={fid('wantedNet-hint')}
                defaultValue={typed.wantedNet}
                // only the gross worked out from it is saved, so a mistake is caught here rather than as a missing gross
                ref={(el) => el?.setCustomValidity(salary.kind === 'invalid' ? salary.reason : '')}
                className="input tabular-nums"
              />
              <p id={fid('wantedNet-hint')} className="hint">
                {salary.kind === 'ok' ? workedOutGross(parseAmount(typed.wantedNet) ?? 0, salary.breakdown) : 'The monthly net to pay.'}
              </p>
              {/* what is saved: the gross worked out */}
              <input type="hidden" name="grossSalary" value={calc ? plainAmount(calc.gross) : ''} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div id="field-daysPerWeek" className="scroll-mt-6">
          <label htmlFor={fid('daysPerWeek')} className="label">
            Working days a week {optional}
          </label>
          <input
            id={fid('daysPerWeek')}
            name="daysPerWeek"
            type="number"
            inputMode="numeric"
            min={1}
            max={7}
            step={1}
            aria-describedby={fid('daysPerWeek-hint')}
            defaultValue={valueOf(state, 'daysPerWeek', defaults.daysPerWeek === null ? '' : String(defaults.daysPerWeek))}
            className="input tabular-nums"
          />
          <p id={fid('daysPerWeek-hint')} className="hint">
            E.g. 2 or 3 for part-time. Leave empty for the shift&apos;s working days.
          </p>
        </div>
        <div id="field-basicPercent" className="scroll-mt-6">
          <label htmlFor={fid('basicPercent')} className="label">
            Basic part (%)
          </label>
          <input
            id={fid('basicPercent')}
            name="basicPercent"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={1}
            aria-describedby={fid('basicPercent-hint')}
            defaultValue={valueOf(state, 'basicPercent', String(defaults.basicPercent))}
            className="input tabular-nums"
          />
          <p id={fid('basicPercent-hint')} className="hint">
            {split
              ? `Basic ${formatEgp(split.basic)} · variable ${formatEgp(split.variable)}, which follows the monthly performance reports.`
              : 'The rest of the gross is variable, following the monthly performance reports.'}
          </p>
        </div>
      </div>

      <div id="field-allowances" className="scroll-mt-6">
        <AllowanceRows types={allowanceTypes} defaultRows={rows} onChange={onRows} />
      </div>

      <div id="field-netSalary" className="scroll-mt-6">
        <p id={fid('breakdown')} className="label">
          Monthly breakdown
        </p>
        {salary.kind === 'ok' ? (
          <SalaryBreakdownList
            rows={offerBreakdownRows(salary.breakdown, { hourly, insuredAllowances: insuredAllowancesOf(terms) })}
            labelledBy={fid('breakdown')}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">{salary.reason}</p>
        )}
        {calc && calc.allowances > 0 && (
          <p className="hint">Gross salary and allowances: {formatEgp(totalPay(calc.gross, calc.allowances))} a month.</p>
        )}
        {/* what is saved, and goes into the offer as {{net_salary}}: the net worked out */}
        <input type="hidden" name="netSalary" value={calc ? plainAmount(calc.net) : ''} />
        <p className="hint">
          Calculated as the Ministry of Finance&apos;s salary tax system does: social insurance on the insured wage, salary tax in Law 7/2024&apos;s brackets, and
          the Martyrs&apos; Fund. Uses the insurable wage limits for {year}, the year of the join date.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div id="field-probationMonths" className="scroll-mt-6">
          <label htmlFor={fid('probationMonths')} className="label">
            Probation in months
          </label>
          <input
            id={fid('probationMonths')}
            name="probationMonths"
            type="number"
            inputMode="numeric"
            min={0}
            max={3}
            step={1}
            aria-describedby={fid('probationMonths-hint')}
            defaultValue={valueOf(state, 'probationMonths', String(defaults.probationMonths))}
            className="input tabular-nums"
          />
          <p id={fid('probationMonths-hint')} className="hint">
            At most 3 months, and only once with the company (Labour Law Art. 90): 0 for someone employed here before. 0 for none.
          </p>
        </div>
        <div id="field-durationMonths" className="scroll-mt-6">
          <label htmlFor={fid('durationMonths')} className="label">
            Contract length in months
          </label>
          <input
            id={fid('durationMonths')}
            name="durationMonths"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            step={1}
            aria-describedby={fid('durationMonths-hint')}
            defaultValue={valueOf(state, 'durationMonths', String(defaults.durationMonths))}
            className="input tabular-nums"
          />
          <p id={fid('durationMonths-hint')} className="hint">
            Contracts are fixed-term. Accepting the offer drafts a contract for this length from the join date.
          </p>
        </div>
      </div>
    </div>
  );
}
