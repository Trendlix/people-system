'use client';

import { useState } from 'react';
import { grossToNet, PAY_BASES, PAY_BASIS_LABELS } from '@trendlix/shared';
import { AllowanceRows } from '@/components/allowance-rows';
import { useFieldIds } from '@/components/form';
import type { AllowanceType } from '@/lib/types';
import {
  belowAllowancesText,
  formatEgp,
  hourlyFor,
  hourlyLabel,
  MAX_HOURS_PER_WEEK,
  SALARY_BASES,
  SALARY_BASIS_LABELS,
  salaryFor,
  workedOutGross,
  type SalaryResult,
} from '../../employees/[id]/contracts/salary';
import { allowancesEffect, calculatorRows, calculatorSearch, namedAllowances, type CalculatorInput, type CalculatorRow } from './calculator';

// The Salary Calculator's form and table, worked out in the browser as it is typed (no API). The address keeps the
// input (?gross=… or ?net=…, or ?rate=…&hours=… by the hour, the year and the allowances), so a result can be shared;
// it is replaced, not added to the history. As on the contract form, the allowances are of the kinds HR sets in
// Organization → Allowances, on top of the gross, each taxed and insured as its kind says.

const ROW: Record<CalculatorRow['kind'], string> = {
  amount: '',
  deduction: '',
  subtotal: 'font-medium',
  total: 'bg-accent-soft font-semibold',
};

const choice =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

function Rows({ rows }: { rows: CalculatorRow[] }) {
  return rows.map((r) => (
    <tr key={r.label} className={ROW[r.kind]}>
      <td className="align-top">
        {r.label}
        {r.note && <span className="font-normal text-muted"> ({r.note})</span>}
        <span className="mt-0.5 block text-xs font-normal text-muted">{r.how}</span>
      </td>
      <td className="text-right align-top whitespace-nowrap tabular-nums">
        {r.kind === 'deduction' && '− '}
        {formatEgp(r.amount)}
      </td>
    </tr>
  ));
}

export function SalaryCalculator({ initial, years, allowanceTypes }: { initial: CalculatorInput; years: number[]; allowanceTypes: readonly AllowanceType[] }) {
  const fid = useFieldIds();
  const [input, setInput] = useState(initial);
  const { pay, basis, amount, rate, hours, year } = input;
  const hourly = pay === 'hourly';
  const allowances = namedAllowances(input.allowances, allowanceTypes);
  const perHour = hourlyFor(rate, hours);
  const salary: SalaryResult = !hourly
    ? salaryFor(basis, amount, year, allowances)
    : perHour.kind === 'ok'
      ? { kind: 'ok', typed: perHour.gross, breakdown: grossToNet(perHour.gross, year, allowances) }
      : perHour;

  function change(next: Partial<CalculatorInput>) {
    const v = { ...input, ...next };
    setInput(v);
    window.history.replaceState(null, '', `${window.location.pathname}${calculatorSearch(v)}`);
  }

  const rows = salary.kind === 'ok' ? calculatorRows(salary.breakdown, year, allowances, perHour.kind === 'ok' && hourly ? perHour : undefined) : null;
  const effect = salary.kind === 'ok' && allowances.length > 0 ? allowancesEffect(salary.breakdown, year) : null;

  let summary = '';
  if (salary.kind === 'ok') {
    const b = salary.breakdown;
    const estimate = hourly && perHour.kind === 'ok' ? `, the monthly estimate of ${hourlyLabel(perHour.rate, perHour.hours)},` : '';
    summary =
      !hourly && basis === 'net'
        ? workedOutGross(salary.typed, b)
        : `Net ${formatEgp(b.net)} for ${formatEgp(b.gross)} gross${estimate}${b.allowances > 0 ? ` and ${formatEgp(b.allowances)} allowances` : ''}.`;
    if (effect !== null) summary += ` The allowances add ${formatEgp(effect)} to the net.`;
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <form className="card space-y-5 p-5" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend className="label">Pay basis</legend>
          <div className="flex flex-wrap gap-2">
            {PAY_BASES.map((p) => (
              <label key={p} className={choice}>
                <input type="radio" name="pay" value={p} checked={pay === p} onChange={() => change({ pay: p })} className="size-4 accent-accent" />
                {PAY_BASIS_LABELS[p]}
              </label>
            ))}
          </div>
        </fieldset>

        {hourly ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <div>
              <label htmlFor={fid('rate')} className="label">
                Hourly rate (EGP)
              </label>
              <input
                id={fid('rate')}
                inputMode="decimal"
                autoComplete="off"
                value={rate}
                onChange={(e) => change({ rate: e.target.value })}
                aria-describedby={fid('rate-hint')}
                aria-invalid={(perHour.kind === 'invalid' && perHour.field === 'rate') || undefined}
                className="input tabular-nums"
              />
              <p id={fid('rate-hint')} className={perHour.kind === 'invalid' && perHour.field === 'rate' ? 'mt-1 text-xs text-danger' : 'hint'}>
                {perHour.kind === 'invalid' && perHour.field === 'rate' ? 'Enter an amount in EGP above 0, e.g. 150.' : 'The gross pay for an hour of work.'}
              </p>
            </div>
            <div>
              <label htmlFor={fid('hours')} className="label">
                Hours a week
              </label>
              <input
                id={fid('hours')}
                inputMode="decimal"
                autoComplete="off"
                value={hours}
                onChange={(e) => change({ hours: e.target.value })}
                aria-describedby={fid('hours-hint')}
                aria-invalid={(perHour.kind === 'invalid' && perHour.field === 'hours') || undefined}
                className="input tabular-nums"
              />
              <p id={fid('hours-hint')} className={perHour.kind === 'invalid' && perHour.field === 'hours' ? 'mt-1 text-xs text-danger' : 'hint'}>
                {perHour.kind === 'invalid' && perHour.field === 'hours'
                  ? `Enter the hours as a number above 0, up to ${MAX_HOURS_PER_WEEK}, e.g. 20 or 22.5.`
                  : 'The gross is the monthly estimate: rate × hours a week × 52 ÷ 12.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <fieldset>
              <legend className="label">Start from</legend>
              <div className="flex flex-wrap gap-2">
                {SALARY_BASES.map((b) => (
                  <label key={b} className={choice}>
                    <input
                      type="radio"
                      name="basis"
                      value={b}
                      checked={basis === b}
                      onChange={() => change({ basis: b })}
                      className="size-4 accent-accent"
                    />
                    {SALARY_BASIS_LABELS[b]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor={fid('amount')} className="label">
                {basis === 'net' ? 'Net salary' : 'Gross salary'} (EGP, monthly)
              </label>
              <input
                id={fid('amount')}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => change({ amount: e.target.value })}
                aria-describedby={fid('amount-hint')}
                aria-invalid={salary.kind === 'invalid' || salary.kind === 'belowAllowances' || undefined}
                className="input tabular-nums"
              />
              <p id={fid('amount-hint')} className={salary.kind === 'invalid' || salary.kind === 'belowAllowances' ? 'mt-1 text-xs text-danger' : 'hint'}>
                {salary.kind === 'invalid'
                  ? 'Enter an amount in EGP above 0, e.g. 15,000.'
                  : salary.kind === 'belowAllowances'
                    ? belowAllowancesText(salary.net)
                    : basis === 'net'
                      ? 'The net to pay, allowances included: the gross is worked out, in whole pounds.'
                      : 'Without the allowances: the net is worked out.'}
              </p>
            </div>
          </>
        )}

        <div>
          <label htmlFor={fid('year')} className="label">
            Year
          </label>
          <select id={fid('year')} value={year} onChange={(e) => change({ year: Number(e.target.value) })} aria-describedby={fid('year-hint')} className="input">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <p id={fid('year-hint')} className="hint">
            The insurable wage limits differ by year.
          </p>
        </div>

        <AllowanceRows
          types={allowanceTypes}
          defaultRows={initial.allowances}
          onChange={(rows) => change({ allowances: rows })}
          hint="A month each, on top of the gross, taxed and insured as each kind is set in Organization → Allowances."
        />
      </form>

      <section aria-labelledby={fid('result')} className="card overflow-hidden">
        <h2 id={fid('result')} className="px-4 pt-4 font-semibold">
          Breakdown
        </h2>
        {salary.kind === 'ok' && rows ? (
          <>
            <p className="px-4 pt-1 text-sm text-muted">{summary}</p>
            <div className="mt-3 overflow-x-auto border-t border-line">
              <table className="table">
                <caption className="sr-only">Salary breakdown in EGP, monthly unless a year is shown</caption>
                <thead>
                  <tr>
                    <th scope="col">Employee</th>
                    <th scope="col" className="text-right">
                      EGP
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <Rows rows={rows.employee} />
                </tbody>
                <tbody>
                  <tr>
                    <th scope="colgroup" colSpan={2}>
                      Company
                    </th>
                  </tr>
                  <Rows rows={rows.company} />
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="px-4 pt-1 pb-6 text-sm text-muted">
            {salary.kind === 'belowAllowances'
              ? belowAllowancesText(salary.net)
              : hourly
                ? `Enter the hourly rate and the hours a week to see how the pay breaks down${salary.kind === 'invalid' ? ', as numbers' : ''}.`
                : `Enter the ${basis === 'net' ? 'net' : 'gross'} salary to see how it breaks down${salary.kind === 'invalid' ? ', as an amount in EGP' : ''}.`}
          </p>
        )}
      </section>
    </div>
  );
}
