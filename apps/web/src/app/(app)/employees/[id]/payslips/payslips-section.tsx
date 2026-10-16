import Link from 'next/link';
import { formatDate, titleCase } from '@/lib/format';
import type { EmployeeProfile } from '@/lib/types';
import { runHref } from '../../../payroll/list';
import { payslipHref, payslipRows } from '../../../payroll/payslips';
import { formatEgp } from '../contracts/salary';
import { Loading, ProfileSection } from '../../ui';
import { loadPayslips } from './data';

// The employee's payslips, on the profile's Contracts tab with the rest of what the company issues (owner's decisions,
// 16 October 2026): one per paid payroll run, newest month first, with the month's net. The English one is issued when
// HR marks the run paid; the Arabic one is made on request, the first time it is opened here. Both open as protected
// PDFs in the browser. Someone on hold that month was not paid, so has none. HR, Finance and the CEO only, as the salary
// (Documents, the employee file, is HR's and the CEO's alone, so the payslips are kept here); the API checks this again.

const LINK = 'inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline';

const Title = ({ children }: { children: React.ReactNode }) => (
  <ProfileSection title="Payslips" restricted>
    {children}
  </ProfileSection>
);

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">{children}</p>;
}

export function PayslipsLoading() {
  return (
    <Title>
      <Loading />
    </Title>
  );
}

export async function Payslips({ employee }: { employee: Pick<EmployeeProfile, 'id' | 'fullNameEn'> }) {
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
        <Quiet>The payslips could not be loaded. Please try again in a moment.</Quiet>
      </Title>
    );
  }

  const rows = payslipRows(load.payslips);
  if (rows.length === 0) {
    return (
      <Title>
        <Quiet>No payslips yet. They are issued when a payroll run is marked paid.</Quiet>
      </Title>
    );
  }

  return (
    <Title>
      <ul className="card divide-y divide-line-soft">
        {rows.map((r) => (
          <li key={r.lineId} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
            <div className="min-w-0">
              <h3 className="font-semibold">
                <Link href={runHref(r.runId)} prefetch={false}>
                  {titleCase(r.title)}
                </Link>
              </h3>
              <p className="text-sm">
                Net <span className="font-semibold tabular-nums">{formatEgp(r.net)}</span>
                {r.paidOn && <span className="text-muted"> · paid on {formatDate(r.paidOn)}</span>}
              </p>
            </div>
            {r.onHold ? (
              <span className="text-sm text-muted">On hold: no payslip</span>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                {r.links.map((l) => (
                  // plain links, never prefetched: the web server fetches the PDF from the API with the session, and the
                  // API draws the payslip the first time it is asked for
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
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Payslips are protected PDFs: they open and print, but can&apos;t be edited.</p>
    </Title>
  );
}
