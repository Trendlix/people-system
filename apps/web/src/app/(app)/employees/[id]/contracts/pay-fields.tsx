'use client';

import { useState } from 'react';
import { INTERN_NO_WAGE_TEXT, isPerAccount, PAY_BASES, PAY_BASIS_LABELS, type LawRates, type PayBasis, type PayTerms as VersionPay } from '@trendlix/shared';
import { AllowanceRows } from '@/components/allowance-rows';
import { valueOf } from '@/components/form';
import { allowanceRows, allowanceTerms, sameAllowances, type AllowanceRow } from '@/lib/allowances';
import type { AllowanceType, FormState } from '@/lib/types';
import {
  allowanceTotals,
  basisFrom,
  belowAllowancesText,
  breakdownRows,
  formatMoney,
  formatEgp,
  hourlyPayFor,
  insuredFor,
  MAX_HOURS_PER_WEEK,
  monthlyEstimateText,
  netPerHourText,
  parseAmount,
  plainAmount,
  RATE_BASIS_LABELS,
  ratesYearText,
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

// The pay of a contract version, as the contract form (New contract, Renew, Edit draft, hiring in one form) and the raise
// form (owner's decisions, 16 October 2026: a raise during a contract) ask for it: the pay basis, where the salary
// starts from, the gross or the hourly rate and the hours a week, the basic part, the working days, the allowances, and
// the salary's breakdown down to the net, with the hidden fields of what is saved. `usePay` keeps what is typed and
// works the salary out; the form passes its onChange on to `pay.track` and shows <PayFields pay={pay} />.
//
// The salary (owner, 15 October 2026: "add the calculation method to calculate the net and gross salary"): HR starts
// from the gross, and the net is worked out, or from the net wanted, and the gross is worked out in whole pounds, as the
// Ministry of Finance's salary tax system does for the year's rates. The form sends both as grossSalary and netSalary,
// so the contract's {{net_salary}} is the calculated net; the typed net (wantedNet) and the switch (salaryBasis) go
// along only to be kept if the save is refused.
//
// The owner's requests of 15 October 2026: the pay can be a monthly salary or by the hour (part-time, e.g. two or three
// days a week), when the gross is the monthly estimate, rate × hours a week × 52 ÷ 12, which the API works out itself
// (so no grossSalary is sent); the working days a week, for part-time; and allowances a month on top of the gross, of
// the kinds HR sets in Organization → Allowances, which the net, the insured salary and the company cost include.
//
// By the hour, HR can also start from the net rate agreed, e.g. 120 net an hour × 16 hours a week (owner, the same
// day): the gross rate is worked out to the piaster and sent as hourlyRate, with the net worked out; the typed net rate
// (netRate) and the switch (rateBasis) go along only to be kept if the save is refused.
//
// A trainee's contract is the training agreement (owner, 18 October 2026: Internship became Trainee, Labour Law Art.
// 29): its gross is the first training stage's pay, typed in the stages (`fixedGross`), so the gross shows read-only and
// the pay is a monthly salary from it.
//
// An intern's internship agreement pays no wage (owner, 19 October 2026: "in case of trainee, we are not paying them
// salary, its just transportation allowance. can i add the gross with 0?"; the owner chose the unpaid internship, outside
// the labour law): `noWage` shows the gross as No wage (unpaid internship), sent as nothing (the API keeps it at 0), with
// a monthly pay basis, no basic part and no breakdown; the allowances, such as transportation, are what the intern is
// paid.

/** The pay a form starts with: the draft being changed, the version renewed or raised, or the defaults. */
export type PayDefaults = {
  payBasis: PayBasis;
  grossSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  daysPerWeek: number | null;
  basicPercent: number;
  netSalary: number | null;
  allowances: readonly { allowanceTypeId: string; amount: number }[];
};

/** The fields `usePay` keeps track of; the form tracks the others itself. */
const PAY_KEYS = ['payBasis', 'salaryBasis', 'grossSalary', 'wantedNet', 'rateBasis', 'hourlyRate', 'netRate', 'hoursPerWeek', 'basicPercent'] as const;
type PayKey = (typeof PAY_KEYS)[number];
const isPayKey = (name: string): name is PayKey => (PAY_KEYS as readonly string[]).includes(name);

const amountText = (n: number | null) => (n === null ? '' : String(n));
const optional = <span className="font-normal text-muted">(optional)</span>;
const NET_INVALID = 'Enter the net salary as an amount in EGP, e.g. 13,000.';
const RATE_INVALID = 'Enter the hourly rate as an amount in EGP, e.g. 150.';
const NET_RATE_INVALID = 'Enter the net per hour as an amount in EGP, e.g. 120.';
const HOURS_INVALID = `Enter the hours a week as a number above 0, up to ${MAX_HOURS_PER_WEEK}, e.g. 20 or 22.5.`;
export const choice =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm has-checked:border-accent has-checked:bg-accent-soft';

/**
 * What the pay fields hold while HR types (the fields themselves stay uncontrolled), and the salary worked out from it
 * with `rates`, the rates set by law of the year the version starts. A refused save (`state`) leaves it as typed.
 * `fixedGross`: a gross the form sets itself, as typed there (a trainee's, the first training stage's pay: owner, 18
 * October 2026), a monthly salary from the gross while it is given; null or left out, HR types the pay here.
 */
export function usePay(
  state: FormState,
  defaults: PayDefaults,
  allowanceTypes: readonly AllowanceType[],
  rates: LawRates,
  fixedGross: string | null = null,
) {
  const [own, setTyped] = useState<Record<PayKey, string>>(() => ({
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
  // what HR typed is kept underneath a fixed gross, for when it is no longer given (e.g. the employment type changed)
  const typed: Record<PayKey, string> = fixedGross === null ? own : { ...own, payBasis: 'monthly', salaryBasis: 'gross', grossSalary: fixedGross };

  const hourly = typed.payBasis === 'hourly';
  const terms = allowanceTerms(rows, allowanceTypes);
  // by the hour, the gross is the monthly estimate of the gross rate, typed or worked out from the net rate
  const basis = hourly ? 'gross' : basisFrom(typed.salaryBasis);
  const rateBasis = basisFrom(typed.rateBasis);
  const fromNetRate = rateBasis === 'net';
  const pay = hourlyPayFor(rateBasis, fromNetRate ? typed.netRate : typed.hourlyRate, typed.hoursPerWeek, rates, terms, typed.hourlyRate);
  const salary: SalaryResult = !hourly
    ? salaryFor(basis, basis === 'net' ? typed.wantedNet : typed.grossSalary, rates, terms)
    : pay.kind === 'ok'
      ? { kind: 'ok', typed: pay.gross, breakdown: pay.breakdown }
      : pay;
  const calc = salary.kind === 'ok' ? salary.breakdown : null;
  const gross = calc?.gross ?? null;
  const basicPercent = Number(typed.basicPercent);
  const split = gross !== null && Number.isInteger(basicPercent) && basicPercent >= 1 && basicPercent <= 100 ? splitSalary(gross, basicPercent) : null;
  const insured = gross !== null ? insuredFor(gross, rates, terms) : null;
  // only for the same gross and allowances: a change of either changes the net anyway
  const savedNet = sameAllowances(rows, defaults.allowances) ? savedNetChange({ gross: defaults.grossSalary, net: defaults.netSalary }, calc) : null;

  /** A pay field changed: kept (true), or not one of them (false), for the form to track it itself. */
  function track(name: string, value: string): boolean {
    if (!isPayKey(name)) return false;
    if (name === 'salaryBasis') {
      // the other field starts with what this one gives, so the salary stays the same
      setTyped((v) => {
        const s = switchBasis(basisFrom(value), { gross: v.grossSalary, net: v.wantedNet }, rates, terms);
        return { ...v, salaryBasis: value, grossSalary: s.gross, wantedNet: s.net };
      });
    } else if (name === 'rateBasis') {
      // the same by the hour: the other rate starts with what this one gives
      setTyped((v) => {
        const s = switchRateBasis(basisFrom(value), { rate: v.hourlyRate, netRate: v.netRate, hours: v.hoursPerWeek }, rates, terms);
        return { ...v, rateBasis: value, hourlyRate: s.rate, netRate: s.netRate };
      });
    } else {
      setTyped((v) => ({ ...v, [name]: value }));
    }
    return true;
  }

  return { typed, rows, setRows, terms, hourly, basis, rateBasis, fromNetRate, pay, salary, calc, split, insured, savedNet, rates, defaults, track, fixedGross, allowanceTypes };
}

export type Pay = ReturnType<typeof usePay>;

/**
 * The pay as typed, to compare with a version's (raise.ts) and to show what it comes to: null until it is a valid pay
 * (the gross or the rate and hours, and the basic part). Allowance rows not yet valid are left out.
 */
export function typedPayOf(pay: Pay): VersionPay | null {
  const basicPercent = Number(pay.typed.basicPercent);
  if (!pay.calc || !Number.isInteger(basicPercent) || basicPercent < 1 || basicPercent > 100) return null;
  const rate = pay.hourly && pay.pay.kind === 'ok' ? pay.pay : null;
  return {
    payBasis: pay.hourly ? 'hourly' : 'monthly',
    grossSalary: pay.calc.gross,
    hourlyRate: rate?.rate ?? null,
    hoursPerWeek: rate?.hours ?? null,
    basicPercent,
    allowances: pay.rows.flatMap((r) => {
      // one paid per client account (25 October 2026) has no amount: 0, as a version keeps it
      if (r.allowanceTypeId && pay.allowanceTypes.some((t) => t.id === r.allowanceTypeId && isPerAccount(t))) return [{ allowanceTypeId: r.allowanceTypeId, amount: 0 }];
      const amount = parseAmount(r.amount);
      return r.allowanceTypeId && amount !== null && !Number.isNaN(amount) && amount > 0 ? [{ allowanceTypeId: r.allowanceTypeId, amount }] : [];
    }),
  };
}

/**
 * The pay fields, from `usePay`. `fullTime`: a full-time version has a social insurance copy, whose salary is the
 * insured salary. `year` and `yearIs`: the year whose rates set by law are used, and what it is ("the year the contract
 * starts"). `lead`: a question above the pay basis, e.g. whether a renewal's pay changes. `noWage`: an intern's, with no
 * gross, the allowances alone paid.
 */
export function PayFields({
  pay,
  state,
  fid,
  allowanceTypes,
  fullTime,
  year,
  yearIs,
  lead,
  noWage = false,
}: {
  pay: Pay;
  state: FormState;
  fid: (name: string) => string;
  allowanceTypes: readonly AllowanceType[];
  fullTime: boolean;
  year: number;
  yearIs: string;
  lead?: React.ReactNode;
  noWage?: boolean;
}) {
  if (noWage) return <UnpaidFields pay={pay} state={state} fid={fid} allowanceTypes={allowanceTypes} lead={lead} />;
  const { typed, rows, setRows, terms, hourly, basis, rateBasis, fromNetRate, pay: hourlyPay, salary, calc, split, insured, savedNet, rates, defaults, fixedGross } = pay;
  const fixed = fixedGross !== null;
  const insuredText = fullTime && insured ? `Insured salary on the social insurance copy: ${formatMoney(insured.amount)}, ${insured.why}.` : null;
  const what = hourly ? `${fromNetRate ? 'net per hour' : 'hourly rate'} and the hours a week` : `${basis === 'net' ? 'net' : 'gross'} salary`;

  return (
    <div className="space-y-5 border-t border-line pt-6">
      {lead}

      {fixed ? (
        // a gross the form sets (a trainee's first stage): a monthly salary from the gross, nothing to choose
        <>
          <input type="hidden" name="payBasis" value="monthly" />
          <input type="hidden" name="salaryBasis" value="gross" />
        </>
      ) : (
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
      )}

      {fixed ? null : hourly ? (
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
            {basis === 'net' ? 'Type the net wanted, allowances included: the gross is worked out, in whole pounds.' : 'Type the gross: the net is worked out.'}
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
                      hourlyPay.kind === 'invalid' && hourlyPay.field === 'rate'
                        ? NET_RATE_INVALID
                        : hourlyPay.kind === 'belowAllowances'
                          ? belowAllowancesText(hourlyPay.net, true)
                          : '',
                    )
                  }
                  className="input tabular-nums"
                />
                <p id={fid('netRate-hint')} className="hint">
                  {hourlyPay.kind === 'ok'
                    ? workedOutRate(hourlyPay)
                    : hourlyPay.kind === 'belowAllowances'
                      ? belowAllowancesText(hourlyPay.net, true)
                      : 'The net pay agreed for an hour of work, allowances included.'}
                </p>
                {/* what is saved: the gross rate worked out */}
                <input type="hidden" name="hourlyRate" value={hourlyPay.kind === 'ok' ? plainAmount(hourlyPay.rate) : ''} />
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
                  ref={(el) => el?.setCustomValidity(hourlyPay.kind === 'invalid' && hourlyPay.field === 'rate' ? RATE_INVALID : '')}
                  className="input tabular-nums"
                />
                <p id={fid('hourlyRate-hint')} className="hint">
                  The gross pay for an hour of work{hourlyPay.kind === 'ok' ? `: ${netPerHourText(hourlyPay.breakdown.net, hourlyPay.hours)}.` : '.'}
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
                ref={(el) => el?.setCustomValidity(hourlyPay.kind === 'invalid' && hourlyPay.field === 'hours' ? HOURS_INVALID : '')}
                className="input tabular-nums"
              />
              <p id={fid('hoursPerWeek-hint')} className="hint">
                {hourlyPay.kind === 'ok'
                  ? `Gross: ${monthlyEstimateText(hourlyPay)}.${insuredText ? ` ${insuredText}` : ''}`
                  : 'The contracted hours each week, e.g. 16 for two 8-hour days.'}
              </p>
            </div>
          </>
        ) : fixed ? (
          <div key="fixedGross">
            <label htmlFor={fid('grossSalary')} className="label">
              Gross salary (EGP)
            </label>
            {/* sent as it shows: the first training stage's pay, typed in the stages above */}
            <input
              id={fid('grossSalary')}
              name="grossSalary"
              value={typed.grossSalary}
              readOnly
              aria-describedby={fid('grossSalary-hint')}
              className="input bg-canvas text-muted tabular-nums"
            />
            <p id={fid('grossSalary-hint')} className="hint">
              The first training stage&apos;s pay, from the stages above; payroll pays each stage&apos;s pay in its months. Without the allowances.
            </p>
          </div>
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
          <SalaryBreakdownList rows={breakdownRows(calc, rates, terms)} labelledBy={fid('breakdown')} />
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
          Calculated as the Ministry of Finance&apos;s salary tax system does: social insurance on the insured wage, salary tax in its tiers, and the
          Martyrs&apos; Fund. Allowances are added to the gross: the taxed ones are taxed with it and the insured ones counted in the insured wage. Assumes
          the full gross, including the variable part, is paid{hourly && ', for the contracted hours every week'}. Uses {ratesYearText(year, rates)}, {yearIs}.
        </p>
      </div>
    </div>
  );
}

/**
 * An intern's pay: no wage, so the gross shows as No wage (unpaid internship) and isn't sent (`unpaid` tells the action
 * so); a monthly basis; the working days; and the allowances, such as transportation, which are what the intern is paid.
 */
function UnpaidFields({
  pay,
  state,
  fid,
  allowanceTypes,
  lead,
}: {
  pay: Pay;
  state: FormState;
  fid: (name: string) => string;
  allowanceTypes: readonly AllowanceType[];
  lead?: React.ReactNode;
}) {
  const { rows, setRows, terms, defaults } = pay;
  const total = allowanceTotals(terms).total;
  return (
    <div className="space-y-5 border-t border-line pt-6">
      {lead}
      <input type="hidden" name="unpaid" value="1" />
      <input type="hidden" name="payBasis" value="monthly" />
      <div className="grid gap-5 sm:grid-cols-2">
        <div key="noWage">
          <label htmlFor={fid('grossSalary')} className="label">
            Gross salary
          </label>
          {/* not sent: an intern's gross is 0, kept by the API */}
          <input id={fid('grossSalary')} value={INTERN_NO_WAGE_TEXT} readOnly aria-describedby={fid('grossSalary-hint')} className="input bg-canvas text-muted" />
          <p id={fid('grossSalary-hint')} className="hint">
            An unpaid internship pays no wage. The allowances below, such as transportation, are paid a month.
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
            E.g. 2 or 3; leave empty for the shift&apos;s week. Which days comes from the shift.
          </p>
        </div>
      </div>

      <AllowanceRows
        types={allowanceTypes}
        defaultRows={rows}
        onChange={setRows}
        hint="A month each, such as the transportation allowance: with no wage, they are what the intern is paid."
      />
      <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
        {total > 0 ? `No wage: ${formatEgp(total)} a month in allowances.` : 'No wage, and no allowances yet.'}
      </p>
    </div>
  );
}
