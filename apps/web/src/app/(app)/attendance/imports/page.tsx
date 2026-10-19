import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { formatDateTime } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../../organization/ui';
import { StaffOnly } from '../../staff-only';
import { monthName, runHref } from '../../payroll/list';
import { PayrollStatusBadge } from '../../payroll/ui';
import { attendanceReviewHref } from '../../payroll/[id]/attendance/attendance';
import { canSeeAttendance, dailyHref, importCountsText, importHref, importStateText, importsAttendance, reviewsImports } from '../attendance';
import { loadImportHistory } from '../data';
import { notLoaded } from '../not-loaded';

// Import History (owner's brief, 19 October 2026: the Attendance section's Imports): every import of Zoho People's
// attendance across the payroll runs, the latest first: its month (its days on Daily Attendance) and run (where it
// stands), when it was read and by whom, its files, how many people are matched, to confirm or not found, and whether it
// is applied, by whom and when, or undone; each opening its review on the run (HR and the CEO, who review imports).
// Import opens the Import page (HR). HR, the CEO and Finance; the API checks it again.

export const metadata: Metadata = { title: 'Attendance Imports · People System' };

async function History() {
  const user = await getCurrentUser();
  if (!canSeeAttendance(user)) return <Empty>Only HR, Finance and the CEO see the attendance imports.</Empty>;
  const loaded = await loadImportHistory();
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'imports')}</Empty>;
  const rows = loaded.value;
  const reviews = reviewsImports(user);
  return (
    <div className="space-y-4">
      {importsAttendance(user) && (
        <Link href={importHref()} className="btn btn-primary no-underline">
          Import attendance
        </Link>
      )}
      {rows.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">No attendance has been imported yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Read</th>
                <th scope="col">Files</th>
                <th scope="col">People</th>
                <th scope="col">Applied</th>
                {reviews && (
                  <th scope="col">
                    <span className="sr-only">Review</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap">
                    <Link href={dailyHref(r.month)} className="font-semibold">
                      {monthName(r.month)}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <PayrollStatusBadge status={r.runStatus} />
                      <Link href={runHref(r.runId)}>Payroll</Link>
                    </div>
                  </td>
                  <td className="text-sm whitespace-nowrap">
                    {formatDateTime(r.createdAt)}
                    {r.createdBy && <div className="text-xs text-muted">by {r.createdBy}</div>}
                  </td>
                  <td className="max-w-64 text-sm">
                    {r.files.length <= 3 ? (
                      r.files.map((f) => (
                        <div key={f.name} className="break-all">
                          {f.name} <span className="text-xs text-muted">· {f.rows} rows</span>
                        </div>
                      ))
                    ) : (
                      <>
                        {r.files.length} files
                        <div className="text-xs text-muted">{r.files.reduce((n, f) => n + f.rows, 0)} rows</div>
                      </>
                    )}
                  </td>
                  <td className="text-sm">{importCountsText(r)}</td>
                  <td className={`text-sm ${r.appliedAt ? 'text-ok' : 'text-muted'}`}>{importStateText(r)}</td>
                  {reviews && (
                    <td className="text-right">
                      <Link href={attendanceReviewHref(r.runId, r.id)} className="font-semibold">
                        Review<span className="sr-only"> the {monthName(r.month)} import read {formatDateTime(r.createdAt)}</span>
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-3 text-sm text-muted">
            {rows.length} {rows.length === 1 ? 'import' : 'imports'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function AttendanceImportsPage() {
  return (
    <StaffOnly>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Import History</h1>
          <p className="mt-1 max-w-3xl text-muted">
            Every import of Zoho People&apos;s attendance, on each month&apos;s payroll, the latest first: who read it and when, its people, and whether it
            was applied to the payroll&apos;s figures.
          </p>
        </div>
        <Suspense fallback={<Loading />}>
          <History />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
