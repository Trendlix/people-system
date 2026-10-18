import { isLeaveDays, leavePayAmount, yearClosingProblems } from '@trendlix/shared';
import type { YearClosingRow } from '../../../../lib/types';
import { monthName } from '../../payroll/list';

// Organization → Leave → Year Closing (owner, 18 October 2026: "make it with decision with the year closing"): for each
// employee, HR decides how many of their unused annual days are carried into the new year and how many are paid. The law
// forbids losing leave (Labour Law 14/2025, Art. 125: "لا يجوز للعامل النزول عن إجازته … ويلتزم صاحب العمل بتسوية رصيد
// الإجازات، أو الأجر المقابل له كل ثلاث سنوات على الأكثر"), so what is carried and what is paid add up to what is unused,
// and the days carried for three years must be paid now (highlighted). The pay is the days × the day rate (the gross ÷
// the payroll's day divisor), added to the January payroll (or the next one open) as Unused leave paid. Pure code,
// tested: the inputs read, each row's problems and amount, the totals, and the form as the API takes it. Relative
// imports: the tests run without the "@/" alias.

type Query = Record<string, string | string[] | undefined>;

/** The years a closing can be for. */
export const CLOSING_YEARS = { from: 2020 } as const;

/**
 * The year the page shows: the address's (?year=2026) when it is one up to this year, else the year just ended from
 * January to March, when its closing is due, and this year from April (to prepare it by its end).
 */
export function closingYear(query: Query, today: string): number {
  const now = Number(today.slice(0, 4));
  const asked = typeof query.year === 'string' && /^\d{4}$/.test(query.year) ? Number(query.year) : NaN;
  if (asked >= CLOSING_YEARS.from && asked <= now) return asked;
  return Number(today.slice(5, 7)) <= 3 ? now - 1 : now;
}

const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');

/** Days as typed in a cell: whole or half (below 0 only for a balance overdrawn, carried as it is); NaN when not; empty is 0. */
export function closingDays(raw: string): number {
  const s = latin(raw).trim().replace(/^[−–]/, '-');
  if (s === '') return 0;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return isLeaveDays(n) ? n : NaN;
}

/** A row as typed: the carry and the pay, as the cells show them. */
export interface TypedSplit {
  carry: string;
  pay: string;
}

/** A row's cells to start with: as the API proposes them (or as decided, once closed). */
export const startingSplit = (row: Pick<YearClosingRow, 'carry' | 'pay'>): TypedSplit => ({ carry: String(row.carry), pay: String(row.pay) });

const tenth = (n: number) => Math.round(n * 10) / 10 + 0;

/**
 * The other cell once one is typed, so the two add up to the unused days: the days paid leave the rest carried, and the
 * days carried leave the rest paid; the other stays as it is while the one typed isn't days within the unused.
 */
export function balanceSplit(row: Pick<YearClosingRow, 'unused'>, typed: TypedSplit, changed: keyof TypedSplit): TypedSplit {
  const value = closingDays(typed[changed]);
  if (Number.isNaN(value) || row.unused < 0 || value > row.unused) return typed;
  const other = String(tenth(row.unused - value));
  return changed === 'pay' ? { ...typed, carry: other } : { ...typed, pay: other };
}

/** A row worked out from its cells: the days, what is wrong (yearClosingProblems), and what the pay comes to. */
export interface RowCheck {
  carry: number;
  pay: number;
  problems: string[];
  amount: number;
}

export function checkRow(row: Pick<YearClosingRow, 'unused' | 'mustSettle' | 'dayRate'>, typed: TypedSplit): RowCheck {
  const carry = closingDays(typed.carry);
  const pay = closingDays(typed.pay);
  const problems = yearClosingProblems(row.unused, carry, pay, row.mustSettle);
  const amount = Number.isNaN(pay) || pay <= 0 ? 0 : leavePayAmount(pay, row.dayRate);
  return { carry, pay, problems, amount };
}

/** The table's totals: the days unused, carried and paid, what the pay comes to, and how many rows have a problem. */
export function closingTotals(rows: readonly Pick<YearClosingRow, 'unused'>[], checks: readonly RowCheck[]): { unused: number; carry: number; pay: number; amount: number; problems: number } {
  const sum = (f: (i: number) => number) => tenth(rows.reduce((n, _, i) => n + (Number.isNaN(f(i)) ? 0 : f(i)), 0));
  return {
    unused: sum((i) => rows[i].unused),
    carry: sum((i) => checks[i].carry),
    pay: sum((i) => checks[i].pay),
    amount: Math.round(checks.reduce((n, c) => n + c.amount, 0) * 100) / 100 + 0,
    problems: checks.filter((c) => c.problems.length).length,
  };
}

/** What the cells start with for "Pay all": every unused day paid. */
export const payAll = (row: Pick<YearClosingRow, 'unused'>): TypedSplit =>
  row.unused < 0 ? { carry: String(row.unused), pay: '0' } : { carry: '0', pay: String(row.unused) };

/** What the cells start with for "Carry all but what must be paid": the days carried for three years paid, the rest carried. */
export function carryRest(row: Pick<YearClosingRow, 'unused' | 'mustSettle'>): TypedSplit {
  if (row.unused < 0) return { carry: String(row.unused), pay: '0' };
  const pay = Math.min(Math.max(0, row.mustSettle), row.unused);
  return { carry: String(tenth(row.unused - pay)), pay: String(pay) };
}

/** The cells' names in the form: "carry.<employeeId>", "pay.<employeeId>". */
export const cellName = (field: keyof TypedSplit, employeeId: string) => `${field}.${employeeId}`;

/** What POST /leave/year-closing/:year takes. */
export interface ClosingBody {
  rows: { employeeId: string; carry: number; pay: number }[];
}

/**
 * The closing as the API takes it: a row for each employee the form lists (`employeeId`, repeated), with their days
 * carried and paid; or what is wrong (a cell that isn't days). The rules (the two adding up, the days to settle) are
 * checked live on the page and again by the API.
 */
export function closingBody(fd: FormData): { body: ClosingBody | null; errors: string[] } {
  const ids = [...new Set(fd.getAll('employeeId').map(String).filter(Boolean))];
  if (!ids.length) return { body: null, errors: ['There is no one to close the year for.'] };
  const rows: ClosingBody['rows'] = [];
  const errors: string[] = [];
  for (const employeeId of ids) {
    const carry = closingDays(String(fd.get(cellName('carry', employeeId)) ?? ''));
    const pay = closingDays(String(fd.get(cellName('pay', employeeId)) ?? ''));
    if (Number.isNaN(carry) || Number.isNaN(pay)) errors.push('Enter the days carried and paid in whole or half days in every row.');
    rows.push({ employeeId, carry, pay });
  }
  return errors.length ? { body: null, errors: [...new Set(errors)] } : { body: { rows }, errors };
}

/** "Carried since 2024: 3 days · 2025: 5 days", the days carried in by the year they were earned in, oldest first. */
export function carriedText(byYear: Readonly<Record<string, number>>): string | null {
  const parts = Object.keys(byYear)
    .sort()
    .filter((y) => byYear[y] !== 0)
    .map((y) => `${y}: ${byYear[y]}`);
  return parts.length ? parts.join(' · ') : null;
}

/** A closed year's payout of a row, in words: "January 2027 payroll", paid or to be paid, or cancelled; null for none. */
export function payoutText(p: YearClosingRow['payout']): string | null {
  if (!p) return null;
  const month = monthName(p.month);
  if (p.status === 'applied') return `Paid with the ${month} payroll`;
  if (p.status === 'cancelled') return `Cancelled on the ${month} payroll`;
  return `To be paid with the ${month} payroll`;
}

/** What the page says after `?done=`: closed, or opened again. */
export function closingDoneText(query: Query, year: number): string | null {
  const done = typeof query.done === 'string' ? query.done : '';
  if (done === 'closed') return `${year} is closed: the days carried are in ${year + 1}'s balances, and the days paid are added to the payroll as Unused leave paid.`;
  if (done === 'reopened') return `${year} is open again: its carried days and payouts are taken back until it is closed again.`;
  return null;
}
