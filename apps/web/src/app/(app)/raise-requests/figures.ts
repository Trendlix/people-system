import { grossToNet, lawRatesFor, raisedPay, raiseFigureProblem, raiseFiguresOf, type AllowanceTerms, type LawRates, type RaiseFigure, type RaiseFigureKind } from '@trendlix/shared';
import { figureValue } from './decisions';

// The figures of a raise, shown while it is asked for or decided (owner, 17 October 2026: "while raising a request show
// some figures regarding the raise (Gross and net) but mainly we are working on the gross salary"): the gross now, after
// the raise and the change (the amount and the percent, whichever was typed), first; then the net now and after, an
// approximation from the year's rates set by law, the allowances as they are (counted in the net, unchanged). By the
// hour, the raise is on the rate: the rate now and after, with the monthly estimate. Who sees them is the owner's
// choice: "HR, Finance and the CEO only", then "allow the requestor raiser to see figures too" (the employee for their
// own pay), a manager never ("No, only percent"); the API sends the pay only to them. Pure code, tested; relative
// imports, as vitest doesn't know the @/ paths.

/** A figure before and after the raise, and the change: the amount, and the percent of what it was (null from 0). */
export interface Change {
  from: number;
  to: number;
  amount: number;
  percent: number | null;
}

/** The pay a raise is worked out from: the gross (by the hour, the monthly estimate), the rate and hours, the allowances. */
export interface PayBefore {
  payBasis: string;
  grossSalary: number;
  hourlyRate?: number | null;
  hoursPerWeek?: number | null;
  allowances?: readonly AllowanceTerms[] | null;
}

export interface RaiseFigures {
  /** The monthly gross (by the hour, the monthly estimate): the figure the raise is about. */
  gross: Change;
  /** By the hour: the rate, which the raise is on; null on a monthly salary. */
  hourly: Change | null;
  /** The net, approximately: the gross and the allowances less the employee's insurance, the tax and the Martyrs' Fund. */
  net: Change;
  /** The allowances a month, counted in the net and unchanged by the raise. */
  allowances: number;
  /** The year whose rates set by law the net is worked out with. */
  year: number;
}

const change = (from: number, to: number): Change => ({ from, to, ...raiseFiguresOf(from, to) });

const total = (allowances: readonly AllowanceTerms[]) => allowances.reduce((cents, a) => cents + Math.round(a.amount * 100), 0) / 100;

/**
 * What a raise comes to on the pay before it: the gross raised by the amount or percent (by the hour, the rate, and the
 * monthly estimate from it, for `hoursAfter`, the raise's own hours when they change), and the net before and after
 * with the rates of `year` (the year the raise takes effect in), both with the same rates so the change is the raise's;
 * the allowances as they are (`allowancesAfter` when they change with the raise, e.g. on a raise HR prepared with
 * others). Amounts to the piaster.
 */
export function raiseFigures(
  before: PayBefore,
  figure: RaiseFigure,
  rates: readonly LawRates[],
  year: number,
  options: { allowancesAfter?: readonly AllowanceTerms[] | null; hoursAfter?: number | null } = {},
): RaiseFigures {
  const allowances = before.allowances ?? [];
  const after = options.allowancesAfter ?? allowances;
  const pay = { payBasis: before.payBasis, grossSalary: before.grossSalary, hourlyRate: before.hourlyRate ?? null, hoursPerWeek: before.hoursPerWeek ?? null };
  const raised = raisedPay(pay, figure, options.hoursAfter ?? pay.hoursPerWeek);
  const law = lawRatesFor(year, rates);
  return {
    gross: change(before.grossSalary, raised.grossSalary),
    hourly: raised.hourlyRate !== null && pay.hourlyRate !== null ? change(pay.hourlyRate, raised.hourlyRate) : null,
    net: change(grossToNet(before.grossSalary, law, allowances).net, grossToNet(raised.grossSalary, law, after).net),
    allowances: total(after),
    year,
  };
}

/**
 * The figures for the raise as typed in a form (an amount or a percent, `typed` as the field holds it): null while it
 * isn't a valid raise yet, or without the pay (for those who aren't sent it).
 */
export function typedRaiseFigures(
  before: PayBefore | null | undefined,
  kind: RaiseFigureKind,
  typed: string,
  rates: readonly LawRates[],
  year: number,
  options?: { allowancesAfter?: readonly AllowanceTerms[] | null; hoursAfter?: number | null },
): RaiseFigures | null {
  if (!before || typed.trim() === '') return null;
  const value = figureValue(kind, typed);
  if (raiseFigureProblem({ kind, value })) return null;
  return raiseFigures(before, { kind, value }, rates, year, options);
}

/** The year a raise from that date (YYYY-MM-DD) takes effect in, else today's (YYYY-MM-DD) year. */
export const yearOf = (effective: string | null | undefined, today: string) => Number((effective && /^\d{4}-/.test(effective) ? effective : today).slice(0, 4));

/** A change in words, the sign first: "+EGP 1,500.00 (+15%)"; a change from 0, the amount only. */
export function changeWords(c: Change, money: (n: number) => string): string {
  const sign = c.amount < 0 ? '−' : '+';
  const amount = `${sign}${money(Math.abs(c.amount))}`;
  return c.percent === null ? amount : `${amount} (${sign}${Math.abs(c.percent)}%)`;
}
