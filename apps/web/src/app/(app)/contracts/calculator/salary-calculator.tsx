'use client';

import { useState } from 'react';
import { useFieldIds } from '@/components/form';
import { formatEgp, SALARY_BASES, SALARY_BASIS_LABELS, salaryFor, workedOutGross } from '../../employees/[id]/contracts/salary';
import { calculatorRows, calculatorSearch, type CalculatorInput, type CalculatorRow } from './calculator';

// The Salary Calculator's form and table, worked out in the browser as it is typed (no API). The address keeps the
// input (?gross=… or ?net=…, and the year), so a result can be shared; it is replaced, not added to the history.

const ROW: Record<CalculatorRow['kind'], string> = {
  amount: '',
  deduction: '',
  subtotal: 'font-medium',
  total: 'bg-accent-soft font-semibold',
};

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

export function SalaryCalculator({ initial, years }: { initial: CalculatorInput; years: number[] }) {
  const fid = useFieldIds();
  const [input, setInput] = useState(initial);
  const { basis, amount, year } = input;
  const salary = salaryFor(basis, amount, year);

  function change(next: Partial<CalculatorInput>) {
    const v = { ...input, ...next };
    setInput(v);
    window.history.replaceState(null, '', `${window.location.pathname}${calculatorSearch(v)}`);
  }

  const rows = salary.kind === 'ok' ? calculatorRows(salary.breakdown, year) : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <form className="card space-y-5 p-5" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend className="label">Start from</legend>
          <div className="flex flex-wrap gap-2">
            {SALARY_BASES.map((b) => (
              <label
                key={b}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft"
              >
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
            aria-invalid={salary.kind === 'invalid' || undefined}
            className="input tabular-nums"
          />
          <p id={fid('amount-hint')} className={salary.kind === 'invalid' ? 'mt-1 text-xs text-danger' : 'hint'}>
            {salary.kind === 'invalid'
              ? 'Enter an amount in EGP above 0, e.g. 15,000.'
              : basis === 'net'
                ? 'The net to pay: the gross is worked out, in whole pounds.'
                : 'The net is worked out.'}
          </p>
        </div>

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
      </form>

      <section aria-labelledby={fid('result')} className="card overflow-hidden">
        <h2 id={fid('result')} className="px-4 pt-4 font-semibold">
          Breakdown
        </h2>
        {salary.kind === 'ok' && rows ? (
          <>
            <p className="px-4 pt-1 text-sm text-muted">
              {basis === 'net' ? workedOutGross(salary.typed, salary.breakdown) : `Net ${formatEgp(salary.breakdown.net)} for ${formatEgp(salary.breakdown.gross)} gross.`}
            </p>
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
            Enter the {basis === 'net' ? 'net' : 'gross'} salary to see how it breaks down{salary.kind === 'invalid' ? ', as an amount in EGP' : ''}.
          </p>
        )}
      </section>
    </div>
  );
}
