import type { Metadata } from 'next';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { appPayslipHref } from '@/lib/surface';
import { NoProfile } from '../../../(app)/dashboard/cards';
import { formatEgp } from '../../../(app)/employees/[id]/contracts/salary';
import { payslipRows } from '../../../(app)/payroll/payslips';
import { PageTitle, PhoneLoading, RowLink, RowList } from '../ui';
import { loadMyPayslips } from './data';

// Payslips on the phone pages (owner, 20 October 2026: the employee app, "My attendance and payslips"): the employee's
// months paid, newest first (a run's payslips are issued when HR marks it paid: owner's decisions, 16 October 2026),
// each with its net, opening the payslip in the page; a month on hold has none. The API sends only the caller's own.

export const metadata: Metadata = { title: 'Payslips · Trendlix People' };

const quiet = 'card px-4 py-8 text-center text-sm text-muted';

async function Payslips() {
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const loaded = await loadMyPayslips();
  if (loaded.kind === 'unavailable') return <p className={quiet}>Not available yet: the server doesn&apos;t have payslips for you yet. Please try again after its next update.</p>;
  if (loaded.kind === 'forbidden') return <p className={quiet}>Your payslips can&apos;t be opened here. Ask HR for them.</p>;
  if (loaded.kind === 'failed') return <p className={quiet}>Your payslips couldn&apos;t be loaded. {loaded.messages.join(' ')}</p>;
  const rows = payslipRows(loaded.value);
  if (rows.length === 0) return <p className={quiet}>No payslips yet: each month&apos;s is issued once HR marks that payroll paid.</p>;
  return (
    <div className="card">
      <RowList label="Your payslips">
        {rows.map((r) =>
          r.onHold ? (
            <li key={r.lineId} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{r.title}</span>
                <span className="mt-0.5 block text-xs text-muted">On hold this month: not paid, so there is no payslip.</span>
              </span>
            </li>
          ) : (
            <RowLink
              key={r.lineId}
              href={appPayslipHref(r.lineId)}
              title={r.title}
              line={r.paidOn ? <span className="tabular-nums">Paid on {formatDate(r.paidOn)}</span> : 'Paid'}
              aside={
                <span className="block text-sm font-semibold tabular-nums">
                  {formatEgp(r.net)}
                  <span className="block text-[11px] font-normal text-muted">net</span>
                </span>
              }
            />
          ),
        )}
      </RowList>
    </div>
  );
}

export default function PhonePayslipsPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="Payslips">Your payslip for each month paid, newest first. Each is a protected PDF: it opens and prints, but can&apos;t be edited.</PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Payslips />
      </Suspense>
    </div>
  );
}
