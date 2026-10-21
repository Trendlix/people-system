import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDateTime } from '@/lib/format';
import type { WfhRequestView } from '@/lib/wfh-types';
import { placeOfEmployee } from '../../leave/list';
import { LeaveStatusBadge } from '../../leave/ui';
import { wfhDayText, wfhHref, wfhLabel, wfhProgressText, wfhSourceText } from './wfh';

// Work from home requests in a list (owner, 21 October 2026: "think about how should we handle the working from home in
// out erp"): the employee's own on My Requests, those waiting for a manager on My Team and for HR on Approvals, and
// everyone's under Attendance → Work From Home. Each row: who (when `who`), the day, how it came, where it stands, a
// warning mark for a day HR recorded past the notice or the limits, opening its page (Decide when it waits for the
// user). The badge a day worked from home shows on the attendance pages is attendance/ui.tsx's WfhDayBadge. No hooks.

export function WfhTable({ requests, who = false, how = false, note }: { requests: readonly WfhRequestView[]; who?: boolean; how?: boolean; note: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">Employee</th>}
            <th scope="col">Day</th>
            {how && <th scope="col">How</th>}
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const place = placeOfEmployee(r.employee);
            const progress = wfhProgressText(r);
            return (
              <tr key={r.id} className="align-top">
                {who && (
                  <td className="min-w-44">
                    <span className="font-semibold">{r.employee.fullNameEn}</span>
                    {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage." className="ml-2" />}
                    <div className="text-xs text-muted">
                      {r.employee.employeeCode}
                      {place && ` · ${place}`}
                    </div>
                  </td>
                )}
                <td className="whitespace-nowrap tabular-nums">{wfhDayText(r)}</td>
                {how && (
                  <td>
                    {wfhSourceText(r)}
                    {r.warnings.length > 0 && (
                      <span className="mt-1 block text-xs font-medium text-warn" title={r.warnings.join(' ')}>
                        Recorded with {r.warnings.length === 1 ? 'a warning' : `${r.warnings.length} warnings`}
                      </span>
                    )}
                  </td>
                )}
                <td>
                  <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                  <div className="mt-1 text-xs text-muted">{r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled' ? progress.text : `Sent ${formatDateTime(r.createdAt)}`}</div>
                </td>
                <td className="text-right">
                  <Link href={wfhHref(r.id)} className={`btn min-h-9 px-3 no-underline ${r.waitingForYou ? 'btn-primary' : 'btn-secondary'}`}>
                    {r.waitingForYou ? 'Decide' : 'Open'}
                    <span className="sr-only">
                      {' '}
                      the work from home request for {wfhDayText(r)}
                      {who && ` by ${r.employee.fullNameEn}`}
                    </span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {wfhLabel(requests.length)} {note}
      </p>
    </div>
  );
}
