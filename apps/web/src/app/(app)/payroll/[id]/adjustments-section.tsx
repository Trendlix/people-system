import Link from 'next/link';
import type { PayrollRunView } from '@/lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { adjustmentsHref, runAdjustments } from '../adjustments/adjustments';
import { monthName } from '../list';
import { withCodeInBrackets } from '@/lib/hidden';

// The run's additions and deductions (owner, 17 October 2026: Additions / Deductions, one-off amounts per employee and
// month, added to that month's run): what its lines take, with a link to the month's list, and the month's pending ones
// for people not on the run, as no line takes them (put the person on the run, or move them to a later month).

export function RunAdjustments({ run, today }: { run: PayrollRunView; today: string }) {
  const sums = runAdjustments(run.lines);
  const missing = run.adjustmentsNotOnRun ?? [];
  const href = adjustmentsHref(run.month, today);
  return (
    <section aria-labelledby="run-adjustments" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="run-adjustments" className="text-lg font-semibold">
          Additions and Deductions
        </h2>
        <Link href={href} className="text-sm">
          {monthName(run.month)} additions and deductions
        </Link>
      </div>
      <p className="text-sm text-muted">
        {sums.count === 0
          ? 'None on this run.'
          : `${sums.count} on ${sums.lines} ${sums.lines === 1 ? 'line' : 'lines'}: ${formatEgp(sums.taxed)} taxed additions in the pay earned, ${formatEgp(sums.untaxed)} untaxed added after tax, ${formatEgp(sums.deductions)} deducted after tax.`}
        {run.status === 'draft' && ' A change to one of them is on its line at once.'}
      </p>
      {missing.length > 0 && (
        <div role="status" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-semibold">Not on this run, so not paid with it</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((m) => (
              <li key={m.employeeId}>
                {withCodeInBrackets(m.name, m.employeeCode)}: {m.count} {m.count === 1 ? 'addition or deduction' : 'additions or deductions'}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            {run.status === 'draft' ? 'Refresh the run once each is on a signed contract, or ' : ''}
            <Link href={href}>move them to a later month</Link>.
          </p>
        </div>
      )}
    </section>
  );
}
