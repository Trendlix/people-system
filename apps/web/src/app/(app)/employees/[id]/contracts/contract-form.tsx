'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PAY_BASES, PAY_BASIS_LABELS, type PayBasis } from '@trendlix/shared';
import { AllowanceRows } from '@/components/allowance-rows';
import { DateInput } from '@/components/date-time-inputs';
import { FormErrors, SubmitButton, useFieldIds, useKeptForm, valueOf } from '@/components/form';
import { allowanceRows, allowanceTerms, sameAllowances, type AllowanceRow } from '@/lib/allowances';
import { formatDate, parseDate } from '@/lib/format';
import type { AllowanceType, FormState } from '@/lib/types';
import { contractEnd, probationEnd } from './dates';
import {
  basisFrom,
  belowAllowancesText,
  breakdownRows,
  formatAmount,
  formatEgp,
  hourlyPayFor,
  insuredFor,
  MAX_HOURS_PER_WEEK,
  monthlyEstimateText,
  netPerHourText,
  plainAmount,
  RATE_BASIS_LABELS,
  SALARY_BASES,
  SALARY_BASIS_LABELS,
  salaryFor,
  savedNetChange,
  splitSalary,
  switchBasis,
  switchRateBasis,
  workedOutGross,
  workedOutRate,
  type SalaryResult,
} from './salary';
import { SalaryBreakdownList } from './salary-breakdown';

// The form of the New contract, Renew and Edit draft pages. While HR types, it shows when the contract ends, when
// probation ends, the basic and variable parts of the gross, for a full-time contract the insured salary on the social
// insurance copy, and the salary's breakdown down to the net. The API works the dates and parts out again when it saves.
// Every contract runs for a fixed term (owner, 15 October 2026: no open-ended contracts), so only its length is asked.
//
// The salary (owner, 15 October 2026: "add the calculation method to calculate the net and gross salary"): HR starts
// from the gross, and the net is worked out, or from the net wanted, and the gross is worked out in whole pounds, as the
// Ministry of Finance's salary tax system does for the contract's start year. The form sends both as grossSalary and
// netSalary, so the contract's {{net_salary}} is the calculated net; the typed net (wantedNet) and the switch
// (salaryBasis) go along only to be kept if the save is refused.
//
// The owner's requests of the same day: the pay can be a monthly salary or by the hour (part-time, e.g. two or three
// days a week), when the gross is the monthly estimate, rate × hours a week × 52 ÷ 12, which the API works out itself
// (so no grossSalary is sent); the working days a week, for part-time; and allowances a month on top of the gross, of
// the kinds HR sets in Organization → Allowances, which the net, the insured salary and the company cost include.
//
// By the hour, HR can also start from the net rate agreed, e.g. 120 net an hour × 16 hours a week (owner, the same
// day): the gross rate is worked out to the piaster and sent as hourlyRate, with the net worked out; the typed net rate
// (netRate) and the switch (rateBasis) go along only to be kept if the save is refused.

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** What the form starts with: the draft being changed, the version renewed, or the settings and defaults. Dates are YYYY-MM-DD. */
export type ContractDefaults = {
  startDate: string;
  durationMonths: number;
  probationMonths: number;
  payBasis: PayBasis;
  grossSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysPerWeek: number | null;
  basicPercent: number;
  netSalary: number | null;
  allowances: readonly { allowanceTypeId: string; amount: number }[];
  note: string;
};

const amountText = (n: number | null) => (n === null ? '' : String(n));
const optional = <span className="font-normal text-muted">(optional)</span>;
const NET_INVALID = 'Enter the net salary as an amount in EGP, e.g. 13,000.';
const RATE_INVALID = 'Enter the hourly rate as an amount in EGP, e.g. 150.';
const NET_RATE_INVALID = 'Enter the net per hour as an amount in EGP, e.g. 120.';
const HOURS_INVALID = `Enter the hours a week as a number above 0, up to ${MAX_HOURS_PER_WEEK}, e.g. 20 or 22.5.`;
const choice =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

export function ContractForm({
  action,
  defaults,
  allowanceTypes,
  renewal,
  probationHint,
  fullTime,
  today,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  defaults: ContractDefaults;
  /** The kinds of allowance (GET /allowance-types), the inactive ones too: those already on the contract stay shown. */
  allowanceTypes: readonly AllowanceType[];
  /** A renewal starts the day after the version before it ends (`startDate`, null when unknown), without probation. */
  renewal: { startDate: string | null; after: string } | null;
  /** Why the probation starts as it does, e.g. someone who already had probation with the company. */
  probationHint?: string;
  /** Full-time contracts have a social insurance copy, whose salary is the insured salary. */
  fullTime: boolean;
  /** YYYY-MM-DD, for the salary's year (its insurable wage limits) while there is no start date. */
  today: string;
  cancelHref: string;
  submitLabel: string;
}) {
  // Kept form: a refused save leaves everything as typed and chosen.
  const { state, pending, form } = useKeptForm(action);
  const fid = useFieldIds();

  // What is typed, for the previews (the fields themselves stay uncontrolled).
  const [typed, setTyped] = useState<Record<string, string>>(() => ({
    startDate: valueOf(state, 'startDate', formatDate(defaults.startDate)),
    durationMonths: valueOf(state, 'durationMonths', String(defaults.durationMonths)),
    probationMonths: valueOf(state, 'probationMonths', String(defaults.probationMonths)),
    payBasis: valueOf(state, 'payBasis', defaults.payBasis),
    salaryBasis: valueOf(state, 'salaryBasis', 'gross'),
    grossSalary: valueOf(state, 'grossSalary', amountText(defaults.grossSalary)),
    wantedNet: valueOf(state, 'wantedNet', ''),
    rateBasis: valueOf(state, 'rateBasis', 'gross'),
    hourlyRate: valueOf(state, 'hourlyRate', amountText(defaults.hourlyRate)),
    netRate: valueOf(state, 'netRate', ''),
    hoursPerWeek: valueOf(state, 'hoursPerWeek', amountText(defaults.hoursPerWeek)),
    basicPercent: valueOf(state, 'basicPercent', String(defaults.basicPercent)),
  }));
  // the allowance rows report their own changes
  const [rows, setRows] = useState<AllowanceRow[]>(() => allowanceRows(state, defaults.allowances));

  const start = renewal ? renewal.startDate : parseDate(typed.startDate) || null;
  const months = Number(typed.durationMonths);
  const end = start && Number.isInteger(months) && months >= 1 ? contractEnd(start, months) : null;
  const probation = renewal ? 0 : Number(typed.probationMonths);
  const probationEnds = start && Number.isInteger(probation) && probation > 0 && probation <= 3 ? probationEnd(start, probation) : null;
  // the salary, with the insurable wage limits of the year the contract starts (this year while there is no start date)
  const year = Number((start ?? today).slice(0, 4));
  const hourly = typed.payBasis === 'hourly';
  const terms = allowanceTerms(rows, allowanceTypes);
  // by the hour, the gross is the monthly estimate of the gross rate, typed or worked out from the net rate
  const basis = hourly ? 'gross' : basisFrom(typed.salaryBasis);
  const rateBasis = basisFrom(typed.rateBasis);
  const fromNetRate = rateBasis === 'net';
  const pay = hourlyPayFor(rateBasis, fromNetRate ? typed.netRate : typed.hourlyRate, typed.hoursPerWeek, year, terms, typed.hourlyRate);
  const salary: SalaryResult = !hourly
    ? salaryFor(basis, basis === 'net' ? typed.wantedNet : typed.grossSalary, year, terms)
    : pay.kind === 'ok'
      ? { kind: 'ok', typed: pay.gross, breakdown: pay.breakdown }
      : pay;
  const calc = salary.kind === 'ok' ? salary.breakdown : null;
  const gross = calc?.gross ?? null;
  const basicPercent = Number(typed.basicPercent);
  const split = gross !== null && Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100 ? splitSalary(gross, basicPercent) : null;
  const insured = gross !== null ? insuredFor(gross, year, terms) : null;
  const insuredText = fullTime && insured ? `Insured salary on the social insurance copy: ${formatAmount(insured.amount)}, ${insured.why}.` : null;
  // only for the same gross and allowances: a change of either changes the net anyway
  const savedNet = sameAllowances(rows, defaults.allowances) ? savedNetChange({ gross: defaults.grossSalary, net: defaults.netSalary }, calc) : null;
  const what = hourly ? `${fromNetRate ? 'net per hour' : 'hourly rate'} and the hours a week` : `${basis === 'net' ? 'net' : 'gross'} salary`;

  function track(e: React.FormEvent<HTMLFormElement>) {
    const t = e.target;
    if (!((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.name)) return;
    const { name, value } = t;
    // the allowance rows report their changes through onChange
    if (name === 'allowanceTypeId' || name === 'allowanceAmount') return;
    if (name === 'salaryBasis') {
      // the other field starts with what this one gives, so the salary stays the same
      setTyped((v) => {
        const s = switchBasis(basisFrom(value), { gross: v.grossSalary, net: v.wantedNet }, year, terms);
        return { ...v, salaryBasis: value, grossSalary: s.gross, wantedNet: s.net };
      });
      return;
    }
    if (name === 'rateBasis') {
      // the same by the hour: the other rate starts with what this one gives
      setTyped((v) => {
        const s = switchRateBasis(basisFrom(value), { rate: v.hourlyRate, netRate: v.netRate, hours: v.hoursPerWeek }, year, terms);
        return { ...v, rateBasis: value, hourlyRate: s.rate, netRate: s.netRate };
      });
      return;
    }
    setTyped((v) => ({ ...v, [name]: value }));
  }

  return (
    <form {...form} onChange={track} className="card max-w-3xl space-y-6 p-6">
      <FormErrors errors={state.errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fid('startDate')} className="label">
            Start date
          </label>
          {renewal ? (
            // not sent: a renewal starts the day after the version before it ends
            <input
              id={fid('startDate')}
              value={renewal.startDate ? formatDate(renewal.startDate) : 'The day after the current version ends'}
              readOnly
              aria-describedby={fid('startDate-hint')}
              className="input bg-canvas text-muted"
            />
          ) : (
            <DateInput
              id={fid('startDate')}
              name="startDate"
              aria-describedby={fid('startDate-hint')}
              defaultValue={valueOf(state, 'startDate', formatDate(defaults.startDate))}
            />
          )}
          <p id={fid('startDate-hint')} className="hint">
            {renewal
              ? `A renewal starts the day after ${renewal.after} ends.`
              : 'The join date, unless the contract starts later. Leave empty for the join date.'}
          </p>
        </div>

        <div>
          <label htmlFor={fid('durationMonths')} className="label">
            Length in months
          </label>
          <input
            id={fid('durationMonths')}
            name="durationMonths"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            step={1}
            required
            aria-describedby={fid('durationMonths-hint')}
            defaultValue={typed.durationMonths}
            className="input tabular-nums"
          />
          <p id={fid('durationMonths-hint')} className="hint">
            {end ? `Ends on ${formatDate(end)}.` : start ? 'Enter the length to see when it ends.' : 'Enter the start date to see when it ends.'} Every
            contract is for a fixed term, renewed in writing before it ends.
          </p>
        </div>

        <div>
          <label htmlFor={fid('probationMonths')} className="label">
            Probation in months
          </label>
          {renewal ? (
            // not sent: no probation on a renewal
            <input id={fid('probationMonths')} value="0" readOnly aria-describedby={fid('probationMonths-hint')} className="input bg-canvas text-muted" />
          ) : (
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
          )}
          <p id={fid('probationMonths-hint')} className="hint">
            {renewal
              ? 'No probation on a renewal: probation comes once with an employer (Labour Law Art. 90).'
              : `${probationHint ?? 'At most 3 months, and only once with the company (Labour Law Art. 90). 0 for none.'}${probationEnds ? ` Probation ends on ${formatDate(probationEnds)}.` : ''}`}
          </p>
        </div>
      </div>

      <div className="space-y-5 border-t border-line pt-6">
        <fieldset aria-describedby={fid('payBasis-hint')}>
          <legend className="label">Pay basis</legend>
          <div className="flex flex-wrap gap-2">
            {PAY_BASES.map((b) => (
              <label key={b} className={choice}>
                <input type="radio" name="payBasis" value={b} defaultChecked={typed.payBasis === b} className="size-4 accent-accent" />
                {PAY_BASIS_LABELS[b]}
              </label>
            ))}
          </div>
          <p id={fid('payBasis-hint')} className="hint">
            {hourly
              ? 'Part-time by the hour, e.g. 2 or 3 days a week: the gross is the monthly estimate, the hourly rate × the hours a week × 52 ÷ 12.'
              : 'A monthly salary, set from the gross or from the net wanted.'}
          </p>
        </fieldset>

        {hourly ? (
          <fieldset key="rateBasis" aria-describedby={fid('rateBasis-hint')}>
            <legend className="label">Start from</legend>
            <div className="flex flex-wrap gap-2">
              {SALARY_BASES.map((b) => (
                <label key={b} className={choice}>
                  <input type="radio" name="rateBasis" value={b} defaultChecked={rateBasis === b} className="size-4 accent-accent" />
                  {RATE_BASIS_LABELS[b]}
                </label>
              ))}
            </div>
            <p id={fid('rateBasis-hint')} className="hint">
              {fromNetRate
                ? 'Type the net per hour agreed, allowances included: the gross rate is worked out, to the piaster.'
                : 'Type the gross per hour: the net is worked out.'}
            </p>
          </fieldset>
        ) : (
          <fieldset key="salaryBasis" aria-describedby={fid('salaryBasis-hint')}>
            <legend className="label">Start from</legend>
            <div className="flex flex-wrap gap-2">
              {SALARY_BASES.map((b) => (
                <label key={b} className={choice}>
                  <input type="radio" name="salaryBasis" value={b} defaultChecked={basis === b} className="size-4 accent-accent" />
                  {SALARY_BASIS_LABELS[b]}
                </label>
              ))}
            </div>
            <p id={fid('salaryBasis-hint')} className="hint">
              {basis === 'net'
                ? 'Type the net wanted, allowances included: the gross is worked out, in whole pounds.'
                : 'Type the gross: the net is worked out.'}
            </p>
          </fieldset>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          {hourly ? (
            <>
              {fromNetRate ? (
                <div key="netRate">
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
                    ref={(el) =>
                      el?.setCustomValidity(
                        pay.kind === 'invalid' && pay.field === 'rate' ? NET_RATE_INVALID : pay.kind === 'belowAllowances' ? belowAllowancesText(pay.net, true) : '',
                      )
                    }
                    className="input tabular-nums"
                  />
                  <p id={fid('netRate-hint')} className="hint">
                    {pay.kind === 'ok'
                      ? workedOutRate(pay)
                      : pay.kind === 'belowAllowances'
                        ? belowAllowancesText(pay.net, true)
                        : 'The net pay agreed for an hour of work, allowances included.'}
                  </p>
                  {/* what is saved: the gross rate worked out */}
                  <input type="hidden" name="hourlyRate" value={pay.kind === 'ok' ? plainAmount(pay.rate) : ''} />
                </div>
              ) : (
                <div key="hourlyRate">
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
                    ref={(el) => el?.setCustomValidity(pay.kind === 'invalid' && pay.field === 'rate' ? RATE_INVALID : '')}
                    className="input tabular-nums"
                  />
                  <p id={fid('hourlyRate-hint')} className="hint">
                    The gross pay for an hour of work{pay.kind === 'ok' ? `: ${netPerHourText(pay.breakdown.net, pay.hours)}.` : '.'}
                  </p>
                </div>
              )}
              <div key="hoursPerWeek">
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
                  ref={(el) => el?.setCustomValidity(pay.kind === 'invalid' && pay.field === 'hours' ? HOURS_INVALID : '')}
                  className="input tabular-nums"
                />
                <p id={fid('hoursPerWeek-hint')} className="hint">
                  {pay.kind === 'ok'
                    ? `Gross: ${monthlyEstimateText(pay)}.${insuredText ? ` ${insuredText}` : ''}`
                    : 'The contracted hours each week, e.g. 16 for two 8-hour days.'}
                </p>
              </div>
            </>
          ) : basis === 'gross' ? (
            <div key="gross">
              <label htmlFor={fid('grossSalary')} className="label">
                Gross salary (EGP)
              </label>
              <input
                id={fid('grossSalary')}
                name="grossSalary"
                inputMode="decimal"
                autoComplete="off"
                required
                aria-describedby={fid('grossSalary-hint')}
                defaultValue={typed.grossSalary}
                className="input tabular-nums"
              />
              <p id={fid('grossSalary-hint')} className="hint">
                {insuredText ??
                  (fullTime
                    ? 'The actual monthly gross, without the allowances. The social insurance copy shows it, with the insured allowances, capped at the maximum insurable wage.'
                    : 'The actual monthly gross, without the allowances.')}
              </p>
            </div>
          ) : (
            <div key="net">
              <label htmlFor={fid('wantedNet')} className="label">
                Net salary wanted (EGP)
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
                ref={(el) =>
                  el?.setCustomValidity(salary.kind === 'invalid' ? NET_INVALID : salary.kind === 'belowAllowances' ? belowAllowancesText(salary.net) : '')
                }
                className="input tabular-nums"
              />
              <p id={fid('wantedNet-hint')} className="hint">
                {salary.kind === 'ok'
                  ? `${workedOutGross(salary.typed, salary.breakdown)}${insuredText ? ` ${insuredText}` : ''}`
                  : salary.kind === 'belowAllowances'
                    ? belowAllowancesText(salary.net)
                    : 'The monthly net to pay, allowances included.'}
              </p>
              {/* what is saved: the gross worked out */}
              <input type="hidden" name="grossSalary" value={calc ? plainAmount(calc.gross) : ''} />
            </div>
          )}
          <div>
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
          <div>
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
              defaultValue={valueOf(state, 'daysPerWeek', amountText(defaults.daysPerWeek))}
              className="input tabular-nums"
            />
            <p id={fid('daysPerWeek-hint')} className="hint">
              E.g. 2 or 3 for part-time; leave empty for the shift&apos;s week. Which days comes from the shift.
            </p>
          </div>
        </div>

        <AllowanceRows
          types={allowanceTypes}
          defaultRows={rows}
          onChange={setRows}
          hint="A month each, paid on top of the gross salary. Each is taxed and insured as its kind is set in Organization → Allowances."
        />

        <div>
          <p id={fid('breakdown')} className="label">
            Monthly breakdown
          </p>
          {calc ? (
            <SalaryBreakdownList rows={breakdownRows(calc, terms)} labelledBy={fid('breakdown')} />
          ) : (
            <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
              {salary.kind === 'belowAllowances'
                ? belowAllowancesText(salary.net, hourly)
                : salary.kind === 'invalid'
                  ? `Enter the ${what} as ${hourly ? 'numbers' : 'an amount in EGP'} to see the breakdown, e.g. ${hourly ? `${fromNetRate ? '120' : '150'} an hour for 20 hours` : '15,000'}.`
                  : `Enter the ${what} to see the breakdown.`}
            </p>
          )}
          {/* what is saved, and goes into the contract as {{net_salary}}: the net worked out */}
          <input type="hidden" name="netSalary" value={calc ? plainAmount(calc.net) : ''} />
          {savedNet && (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              The net saved before, {formatEgp(savedNet.saved)}, isn&apos;t what is calculated now. Saving uses the calculated {formatEgp(savedNet.calculated)}.
            </p>
          )}
          <p className="hint">
            Calculated as the Ministry of Finance&apos;s salary tax system does: social insurance on the insured wage, salary tax in Law 7/2024&apos;s brackets,
            and the Martyrs&apos; Fund. Allowances are added to the gross: the taxed ones are taxed with it and the insured ones counted in the insured wage.
            Assumes the full gross, including the variable part, is paid{hourly && ', for the contracted hours every week'}. Uses the insurable wage limits for{' '}
            {year}, the year the contract starts.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={fid('note')} className="label">
          Note {optional}
        </label>
        <textarea
          id={fid('note')}
          name="note"
          rows={3}
          maxLength={500}
          aria-describedby={fid('note-hint')}
          defaultValue={valueOf(state, 'note', defaults.note)}
          className="input"
        />
        <p id={fid('note-hint')} className="hint">
          E.g. what was agreed beyond the contract. Up to 500 characters.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton busy={pending}>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
