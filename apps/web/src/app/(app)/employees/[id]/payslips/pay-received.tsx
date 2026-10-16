import Link from 'next/link';
import { formatDate } from '@/lib/format';
import type { EmployeePayslip, EmployeeProfile } from '@/lib/types';
import { runHref } from '../../../payroll/list';
import { payslipHref, payslipRows, payslipTotals } from '../../../payroll/payslips';
import { formatEgp } from '../contracts/salary';
import { monthsLabel } from '../salary-history/salary-history';
import { Loading, ProfileSection } from '../../ui';
import { loadPayslips } from './data';

// The pay received, on the Employment tab's Salary sub-tab after the Raise Requests: one table of every paid payroll
// month, in every employment, newest first (the Salary History's Pay Received and the Payslips list in one, owner's
// choice, 17 October 2026): the month, linked to its run, the day it was paid, the net and the transfer, the payslips,
// and what was received in all. The English payslip is issued when HR marks the run paid; the Arabic one is made on
// request, the first time it is opened here. Both open as protected PDFs in the browser. Someone on hold that month was
// not paid, so has none. HR, Finance and the CEO only, as the salary; the API checks this again.

const LINK = 'inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline';
const dash = <span className="text-muted">—</span>;

type Employee = Pick<EmployeeProfile, 'id' | 'fullNameEn'>;

const Title = ({ note, children }: { note?: string; children: React.ReactNode }) => (
  <ProfileSection title="Pay Received" note={note} restricted>
    {children}
  </ProfileSection>
);

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{children}</p>;
}

export function PayReceivedLoading() {
  return (
    <Title>
      <Loading />
    </Title>
  );
}

function PayTable({ employee, payslips }: { employee: Employee; payslips: EmployeePayslip[] }) {
  const rows = payslipRows(payslips);
  const totals = payslipTotals(payslips);
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <caption className="sr-only">Pay {employee.fullNameEn} received in each paid payroll month, newest first, with the payslips</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Paid On</th>
            <th scope="col" className="text-right">
              Net
            </th>
            <th scope="col" className="text-right">
              Transfer
            </th>
            <th scope="col">Payslips</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lineId}>
              <th scope="row" className="text-left font-semibold whitespace-nowrap">
                <Link href={runHref(r.runId)} prefetch={false}>
                  {r.title}
                </Link>
              </th>
              <td className="whitespace-nowrap tabular-nums">{r.paidOn ? formatDate(r.paidOn) : dash}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.net)}</td>
              <td className="text-right whitespace-nowrap tabular-nums">{formatEgp(r.transfer)}</td>
              <td>
                {r.onHold ? (
                  <span className="text-sm text-muted">On hold: not paid, no payslip</span>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    {r.links.map((l) => (
                      // plain links, never prefetched: the web server fetches the PDF from the API with the session, and
                      // the API draws the payslip the first time it is asked for
                      <span key={l.language} className="inline-flex items-baseline gap-1.5">
                        <a href={payslipHref(r.lineId, l.language)} target="_blank" rel="noopener" className={LINK}>
                          {l.label}
                          <span className="sr-only">
                            {' '}
                            payslip of {employee.fullNameEn} for {r.title} (PDF), in a new tab
                          </span>
                        </a>
                        {l.note && <span className="text-xs text-muted">{l.note}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="px-4 py-3 text-left font-semibold">
              Received in all
            </th>
            <td className="px-4 py-3 text-muted">{monthsLabel(totals.months)}</td>
            <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(totals.net)}</td>
            <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">{formatEgp(totals.transfer)}</td>
            <td className="px-4 py-3" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export async function PayReceived({ employee }: { employee: Employee }) {
  const load = await loadPayslips(employee.id);
  if (load.kind === 'forbidden') return null; // not the caller's to see
  if (load.kind === 'unavailable') {
    return (
      <Title>
        <Quiet>Not available yet: the server does not have payslips yet.</Quiet>
      </Title>
    );
  }
  if (load.kind === 'failed') {
    return (
      <Title>
        <Quiet>The pay received could not be loaded. Please try again in a moment.</Quiet>
      </Title>
    );
  }
  if (load.payslips.length === 0) {
    return (
      <Title>
        <Quiet>No paid payroll month yet. The payslips are issued when a payroll run is marked paid.</Quiet>
      </Title>
    );
  }

  return (
    <Title note="Each paid payroll month, newest first, with its payslips">
      <PayTable employee={employee} payslips={load.payslips} />
      <p className="text-xs text-muted">Payslips are protected PDFs: they open and print, but can&apos;t be edited.</p>
    </Title>
  );
}
