import type { PayrollRunSummary } from '../../../lib/types';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { addMonths, monthOf } from './list';

// The Payroll Overview's key figures (owner, 17 October 2026: "make the Payroll in the side tab a main title below it -
// Overview - …": the runs as before, with key figures at the top): the run being paid next and where it stands, the last
// paid run's totals, the next payday, and what is unsettled. Plain helpers (no server-only, so they are unit tested).
// Relative imports: the tests run without the "@/" alias.

const pad = (n: number) => String(n).padStart(2, '0');

/** The payday in a month (YYYY-MM): that day, or the month's last when it is shorter. */
function paydayIn(month: string, payday: number): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${pad(Math.min(payday, last))}`;
}

/**
 * The next payday on or after `today` (YYYY-MM-DD, Cairo), and the month whose salaries it pays: the one before it
 * (Payroll Setup's payday is "of the month after the one the salaries are for"). Null without a payday.
 */
export function nextPayday(today: string, payday: number | null | undefined): { date: string; forMonth: string } | null {
  if (!payday || payday < 1 || payday > 31) return null;
  const now = monthOf(today);
  const thisMonth = paydayIn(now, payday);
  const date = thisMonth >= today ? thisMonth : paydayIn(addMonths(now, 1), payday);
  return { date, forMonth: addMonths(date.slice(0, 7), -1) };
}

/** Days from today to a day, to start a sentence: "Today", "Tomorrow", "In 5 days". */
export function daysUntil(today: string, date: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return 'Today';
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}

/**
 * The month whose run is being paid next: the next payday's month of salaries, or without a payday, last month (salaries
 * are paid once the month is over: the owner's March file was made on 6 April).
 */
export function currentRunMonth(today: string, payday: number | null | undefined): string {
  return nextPayday(today, payday)?.forMonth ?? addMonths(monthOf(today), -1);
}

/** The last run marked paid: the newest month among them. */
export function lastPaidRun(runs: readonly PayrollRunSummary[]): PayrollRunSummary | null {
  return runs.filter((r) => r.status === 'paid').sort((a, b) => b.month.localeCompare(a.month))[0] ?? null;
}

/** A paid run's totals as the Overview lists them: the people, the gross (earned and allowances), net, transfer, cost. */
export function paidFigures(run: PayrollRunSummary): { label: string; value: string }[] {
  const t = run.totals;
  return [
    { label: 'Employees', value: String(t.employees) },
    { label: 'Gross', value: formatEgp(Math.round((t.earned + t.allowances) * 100) / 100) },
    { label: 'Net', value: formatEgp(t.net) },
    { label: 'Transfer', value: formatEgp(t.transfer) },
    { label: 'Company cost', value: formatEgp(t.companyCost) },
  ];
}
