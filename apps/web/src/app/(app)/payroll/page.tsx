import Link from 'next/link';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { PayrollRunSummary } from '@/lib/types';
import { formatEgp } from '../employees/[id]/contracts/salary';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { createRun } from './actions';
import { loadRuns } from './data';
import { canSeePayroll, hiddenTotalsText, monthName, preparesPayroll, runHref, runMonths, suggestedMonth } from './list';
import { NewRunForm } from './new-run-form';
import { KeyFigures } from './key-figures';
import { PayrollStatusBadge } from './ui';

// Payroll (owner's decisions, 16 October 2026): each month's run, newest first, and for HR a new one. HR prepares a run
// (the month's figures typed until attendance fills them), the CEO approves it, and HR marks it paid once the bank has
// paid it. Salary data: HR, Finance and the CEO see it; the API checks every request again.
// The Overview (owner, 17 October 2026: "make the Payroll in the side tab a main title below it - Overview - Unsettled -
// Additions / Deductions - Reports (Statistics)"): the runs as before, with key figures at the top (overview.tsx) and the
// Payroll pages as tabs. A run's totals leave out the C-level people's lines hidden from the caller (owner, 19 October
// 2026: "make C level Employees details not visible to HR"), and its row says so.

const quiet = 'px-4 py-10 text-center text-sm text-muted';

/** When a run was approved or paid, under its status. */
function when(run: PayrollRunSummary): string | null {
  if (run.paidOn) return `Paid ${formatDate(run.paidOn)}`;
  if (run.approvedAt) return `Approved ${formatDate(run.approvedAt)}`;
  return null;
}

function RunsTable({ runs }: { runs: PayrollRunSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Status</th>
            <th className="text-right">Employees</th>
            <th className="text-right">Net</th>
            <th className="text-right">Transfer</th>
            <th className="text-right">Company Cost</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">
                <Link href={runHref(r.id)} className="font-semibold">
                  {monthName(r.month)}
                </Link>
              </td>
              <td className="whitespace-nowrap">
                <PayrollStatusBadge status={r.status} />
                {when(r) && <div className="mt-0.5 text-xs text-muted">{when(r)}</div>}
              </td>
              <td className="text-right tabular-nums">
                {r.totals.employees}
                {hiddenTotalsText(r.hidden) && <div className="text-xs whitespace-nowrap text-muted">{hiddenTotalsText(r.hidden)}</div>}
              </td>
              <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.totals.net)}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.totals.transfer)}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.totals.companyCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Runs() {
  const user = await getCurrentUser();
  if (!canSeePayroll(user)) return <Empty>Only HR, Finance and the CEO can see payroll.</Empty>;
  const listing = await loadRuns();
  if (listing.kind === 'unavailable') return <Empty>Not available yet: the server does not have payroll yet.</Empty>;

  const today = todayInCairo();
  const months = runMonths(today);
  const taken = listing.kind === 'ok' ? listing.rows.map((r) => r.month) : [];

  return (
    <div className="space-y-8">
      <KeyFigures user={user} runs={listing.kind === 'ok' ? listing.rows : []} today={today} />
      {preparesPayroll(user) && listing.kind === 'ok' && (
        <section id="new-run" className="card space-y-3 p-6">
          <h2 className="font-semibold">New Payroll Run</h2>
          <NewRunForm action={createRun} months={months} taken={taken} suggested={suggestedMonth(months, taken, today)} />
        </section>
      )}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Payroll Runs</h2>
        <div className="card">
          {listing.kind === 'failed' ? (
            <p className={quiet}>
              Couldn&apos;t load the payroll runs. <span className="block pt-1 text-xs">{listing.message}</span>
            </p>
          ) : listing.rows.length === 0 ? (
            <p className={quiet}>No payroll runs yet.{preparesPayroll(user) ? ' Make the first one above.' : ''}</p>
          ) : (
            <RunsTable runs={listing.rows} />
          )}
        </div>
      </section>
    </div>
  );
}

export default function PayrollPage() {
  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold">Payroll Overview</h1>
      <p className="mt-1 text-muted">
        Each month&apos;s pay: HR prepares the run, the CEO approves it, then the bank files are made and HR marks it paid. The rules, rates
        and payday it is worked out with are under <Link href="/organization/payroll">Organization → Payroll Setup</Link>, the holidays under{' '}
        <Link href="/organization/holidays">Organization → Holidays</Link>.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Runs />
        </Suspense>
      </div>
    </div>
  );
}
