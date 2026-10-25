'use client';

import { INTERN_DEFAULT_MONTHS, INTERN_MAX_MONTHS, INTERN_NO_WAGE_TEXT, isTrainingType, PAY_BASES, PAY_BASIS_LABELS, type LawRates } from '@trendlix/shared';
import { AllowanceRows } from '@/components/allowance-rows';
import { valueOf } from '@/components/form';
import { allowanceTerms, type AllowanceRow } from '@/lib/allowances';
import type { AllowanceType, FormState } from '@/lib/types';
import {
  allowanceTotals,
  formatEgp,
  netPerHourText,
  parseAmount,
  plainAmount,
  RATE_BASIS_LABELS,
  ratesYearText,
  SALARY_BASES,
  SALARY_BASIS_LABELS,
  splitSalary,
  workedOutGross,
  workedOutRate,
} from '../employees/[id]/contracts/salary';
import { SalaryBreakdownList } from '../employees/[id]/contracts/salary-breakdown';
import { noProbationHint } from '../employees/[id]/contracts/training';
import { internMonthsOf, type OfferDefaults } from './form-body';
import { estimateText, insuredAllowancesOf, offerBreakdownRows, offerSalary, payBasisFrom, salaryStartFrom, totalPay, type TermsTyped } from './terms';

// The Terms part of the offer form: the pay basis (owner's request, 15 October 2026), a monthly salary typed as the gross
// or as the net wanted, or by the hour (the hourly rate, typed as the gross or as the net per hour agreed, and the hours
// a week, whose monthly estimate is the gross); the working days a week, the basic part, the allowances, and the
// probation and the contract's length. While HR types, the month's breakdown down to the net is shown with the
// allowances in it (terms.ts), with the rates set by law of the join date's year. The form sends the gross worked out (grossSalary), the
// gross rate worked out from a net rate (hourlyRate) and the net worked out (netSalary), as the contract form does.
//
// An intern's offer (owner, 19 October 2026: "interns to be labeled trainees instead of probation") has no probation: 0,
// not editable. It is the unpaid internship ("we are not paying them salary, its just transportation allowance"), the one
// internship since 25 October 2026, monthly with no wage: the gross shows as No wage (unpaid internship) and isn't sent,
// nor a basic part or a net; the allowances are what the intern is paid; and its length is 3 months unless HR chooses
// another, 12 at most.

const optional = <span className="font-normal text-muted">(optional)</span>;
const radio =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

export function OfferTerms({
  state,
  fid,
  defaults,
  employmentType,
  typed,
  basicPercent: basicTyped,
  rows,
  onRows,
  allowanceTypes,
  year,
  rates,
}: {
  state: FormState;
  fid: (name: string) => string;
  defaults: OfferDefaults;
  /** The employment type chosen in the Position part (tracked by the form). */
  employmentType: string;
  /** The salary fields as typed (tracked by the form). */
  typed: TermsTyped;
  /** The basic part as typed, in percent. */
  basicPercent: string;
  rows: AllowanceRow[];
  onRows: (rows: AllowanceRow[]) => void;
  allowanceTypes: AllowanceType[];
  /** The salary's year: the join date's, else this year. */
  year: number;
  /** That year's rates set by law (lawRatesFor on the years kept). */
  rates: LawRates;
}) {
  // an intern's agreement has no probation and pays no wage, monthly (19 October 2026)
  const intern = isTrainingType(employmentType);
  const hourly = !intern && payBasisFrom(typed.payBasis) === 'hourly';
  const start = salaryStartFrom(typed.salaryBasis);
  const rateStart = salaryStartFrom(typed.rateBasis);
  const terms = allowanceTerms(rows, allowanceTypes);
  const salary = offerSalary(typed, rates, terms);
  const calc = salary.kind === 'ok' ? salary.breakdown : null;
  const basicPercent = Number(basicTyped);
  const split = calc && Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100 ? splitSalary(calc.gross, basicPercent) : null;
  // by the hour: the gross rate, typed or worked out from the net rate, and the hours
  const perHour = salary.kind === 'ok' && salary.hourly ? { ...salary.hourly, breakdown: salary.breakdown } : null;

  const allowancesTotal = allowanceTotals(terms).total;

  return (
    <div className="space-y-5">
      {intern ? (
        <div key="noWage" id="field-grossSalary" className="scroll-mt-6 sm:max-w-[calc(50%-0.625rem)]">
          <input type="hidden" name="payBasis" value="monthly" />
          <label htmlFor={fid('grossSalary')} className="label">
            Gross salary
          </label>
          {/* not sent: an intern's gross is 0, kept by the API */}
          <input
            id={fid('grossSalary')}
            value={INTERN_NO_WAGE_TEXT}
            readOnly
            aria-describedby={fid('grossSalary-hint')}
            className="input bg-canvas text-muted"
          />
          <p id={fid('grossSalary-hint')} className="hint">
            An unpaid internship pays no wage. The allowances below, such as transportation, are paid a month.
          </p>
        </div>
      ) : (
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
      )}

      {intern ? null : hourly ? (
        <div key="hourly" className="space-y-5">
          <fieldset aria-describedby={fid('rateBasis-hint')}>
            <legend className="label">Start from</legend>
            <div className="flex flex-wrap gap-2">
              {SALARY_BASES.map((b) => (
                <label key={b} className={radio}>
                  <input type="radio" name="rateBasis" value={b} defaultChecked={rateStart === b} className="size-4 accent-accent" />
                  {RATE_BASIS_LABELS[b]}
                </label>
              ))}
            </div>
            <p id={fid('rateBasis-hint')} className="hint">
              {rateStart === 'net'
                ? 'Type the net per hour agreed, allowances included: the gross rate is worked out, to the piaster.'
                : 'Type the gross per hour: the net is worked out.'}
            </p>
          </fieldset>
          <div className="grid gap-5 sm:grid-cols-2">
            {rateStart === 'net' ? (
              <div key="net" id="field-hourlyRate" className="scroll-mt-6">
                <label htmlFor={fid('netRate')} className="label">
                  Net per hour (EGP)
                </label>
                <input
                  id={fid('netRate')}
                  name="netRate"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  aria-describedby={fid('netRate-hint')}
                  defaultValue={typed.netRate}
                  // only the gross rate worked out from it is saved, so a mistake is caught here rather than as a missing rate
                  ref={(el) => el?.setCustomValidity(salary.kind === 'invalid' && salary.field === 'netRate' ? salary.reason : '')}
                  className="input tabular-nums"
                />
                <p id={fid('netRate-hint')} className="hint">
                  {perHour
                    ? workedOutRate(perHour)
                    : salary.kind === 'invalid' && salary.field === 'netRate'
                      ? salary.reason
                      : 'The net pay agreed for an hour of work, allowances included.'}
                </p>
                {/* what is saved: the gross rate worked out */}
                <input type="hidden" name="hourlyRate" value={perHour ? plainAmount(perHour.rate) : ''} />
              </div>
            ) : (
              <div key="gross" id="field-hourlyRate" className="scroll-mt-6">
                <label htmlFor={fid('hourlyRate')} className="label">
                  Hourly rate (EGP)
                </label>
                <input
                  id={fid('hourlyRate')}
                  name="hourlyRate"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  aria-describedby={fid('hourlyRate-hint')}
                  defaultValue={typed.hourlyRate}
                  aria-invalid={(salary.kind === 'invalid' && salary.field === 'hourlyRate') || undefined}
                  className="input tabular-nums"
                />
                <p id={fid('hourlyRate-hint')} className="hint">
                  The gross pay for an hour of work{perHour ? `: ${netPerHourText(perHour.breakdown.net, perHour.hours)}.` : '.'}
                </p>
              </div>
            )}
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
                {perHour ? estimateText(perHour.rate, perHour.hours, perHour.breakdown.gross) : 'E.g. 20, or 22.5: at most 48, the legal working week.'}
              </p>
            </div>
            {/* what is saved as the gross: the monthly estimate */}
            <input type="hidden" name="grossSalary" value={calc ? plainAmount(calc.gross) : ''} />
          </div>
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
            max={6}
            step={1}
            aria-describedby={fid('daysPerWeek-hint')}
            defaultValue={valueOf(state, 'daysPerWeek', defaults.daysPerWeek === null ? '' : String(defaults.daysPerWeek))}
            className="input tabular-nums"
          />
          <p id={fid('daysPerWeek-hint')} className="hint">
            E.g. 2 or 3 for part-time. Leave empty for the shift&apos;s working days.
          </p>
        </div>
        {!intern && (
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
        )}
      </div>

      <div id="field-allowances" className="scroll-mt-6">
        <AllowanceRows types={allowanceTypes} defaultRows={rows} onChange={onRows} />
      </div>

      {intern ? (
        <p id="field-netSalary" className="scroll-mt-6 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
          {allowancesTotal > 0 ? `No wage: ${formatEgp(allowancesTotal)} a month in allowances.` : 'No wage, and no allowances yet.'}
        </p>
      ) : (
        <div id="field-netSalary" className="scroll-mt-6">
          <p id={fid('breakdown')} className="label">
            Monthly breakdown
          </p>
          {salary.kind === 'ok' ? (
            <SalaryBreakdownList
              rows={offerBreakdownRows(salary.breakdown, rates, { hourly, insuredAllowances: insuredAllowancesOf(terms) })}
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
            Calculated as the Ministry of Finance&apos;s salary tax system does: social insurance on the insured wage, salary tax in its tiers, and the
            Martyrs&apos; Fund. Uses {ratesYearText(year, rates)}, the year of the join date.
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div id="field-probationMonths" className="scroll-mt-6">
          <label htmlFor={fid('probationMonths')} className="label">
            Probation in months
          </label>
          {intern ? (
            // an intern's agreement: none, sent as 0
            <>
              <input id={fid('probationMonths')} value="0" readOnly aria-describedby={fid('probationMonths-hint')} className="input bg-canvas text-muted" />
              <input type="hidden" name="probationMonths" value="0" />
            </>
          ) : (
            <input
              key="probation"
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
          )}
          <p id={fid('probationMonths-hint')} className="hint">
            {intern
              ? noProbationHint()
              : 'At most 3 months, and only once with the company (Labour Law Art. 90): 0 for someone employed here before. 0 for none.'}
          </p>
        </div>
        <div id="field-durationMonths" className="scroll-mt-6">
          <label htmlFor={fid('durationMonths')} className="label">
            {intern ? 'Internship length in months' : 'Contract length in months'}
          </label>
          {/* a new field when the internship is chosen or left: its own months to start with */}
          <input
            key={intern ? 'intern' : 'contract'}
            id={fid('durationMonths')}
            name="durationMonths"
            type="number"
            inputMode="numeric"
            min={1}
            max={intern ? INTERN_MAX_MONTHS : 60}
            step={1}
            aria-describedby={fid('durationMonths-hint')}
            defaultValue={valueOf(state, 'durationMonths', String(intern ? internMonthsOf(defaults) : defaults.durationMonths))}
            className="input tabular-nums"
          />
          <p id={fid('durationMonths-hint')} className="hint">
            {intern
              ? `Short: 1 to ${INTERN_MAX_MONTHS} months, ${INTERN_DEFAULT_MONTHS} unless you choose another. Accepting the offer drafts the internship agreement for this length from the join date.`
              : 'Accepting the offer drafts a fixed-term contract for this length from the join date; on the draft it can be made open-ended or for a specific job instead.'}
          </p>
        </div>
      </div>
    </div>
  );
}
