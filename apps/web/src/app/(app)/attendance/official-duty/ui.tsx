import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDateTime } from '@/lib/format';
import { joinShown } from '@/lib/hidden';
import type { OdRequestView } from '@/lib/od-types';
import { placeOfEmployee } from '../../leave/list';
import { LeaveStatusBadge } from '../../leave/ui';
import { odHref, odLabel, odProgressText, odSourceText, odSpanText, odWhenWords } from './od';

// Official duty requests in a list (owner, 23 October 2026: "Official duty (OD) requests"): the employee's own on My
// Requests, those waiting for a manager on My Team and for HR on Approvals, and everyone's under Attendance → Official
// Duty. Each row: who (when `who`), the days and hours, where (when `where`), a mark for one asked after its first day
// ("Ahead or up to 3 days after": requested after), or for one recorded by HR or imported (26 October 2026) how it came
// with its warnings, where it stands, opening its page (Decide when it waits for the user). The badge a day of official
// duty shows on the attendance pages is attendance/ui.tsx's OdDayBadge. No hooks.

export function OdTable({ requests, who = false, where = false, note }: { requests: readonly OdRequestView[]; who?: boolean; where?: boolean; note: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">Employee</th>}
            <th scope="col">Days</th>
            {where && <th scope="col">Where</th>}
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const place = placeOfEmployee(r.employee);
            const progress = odProgressText(r);
            const when = odWhenWords(r);
            const warned = r.warnings ?? [];
            return (
              <tr key={r.id} className="align-top">
                {who && (
                  <td className="min-w-44">
                    <span className="font-semibold">{r.employee.fullNameEn}</span>
                    {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage." className="ml-2" />}
                    <div className="text-xs text-muted">{joinShown([r.employee.employeeCode, place])}</div>
                  </td>
                )}
                <td className="whitespace-nowrap tabular-nums">
                  {when}
                  <span className="block text-xs text-muted">{odSpanText(r)}</span>
                  {r.recordedByHr || r.imported ? (
                    <span className="mt-1 block text-xs text-muted" title={warned.join(' ') || undefined}>
                      {odSourceText(r)}
                      {warned.length > 0 && <span className="block font-medium text-warn">Recorded with {warned.length === 1 ? 'a warning' : `${warned.length} warnings`}</span>}
                    </span>
                  ) : (
                    r.late && (
                      <span className="mt-1 block text-xs font-medium text-warn" title="Asked after its first day, within the 3 days allowed.">
                        Requested after
                      </span>
                    )
                  )}
                </td>
                {where && <td className="max-w-64 break-words">{r.dutyPlace}</td>}
                <td>
                  <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                  <div className="mt-1 text-xs text-muted">{r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled' ? progress.text : `Sent ${formatDateTime(r.createdAt)}`}</div>
                </td>
                <td className="text-right">
                  <Link href={odHref(r.id)} className={`btn min-h-9 px-3 no-underline ${r.waitingForYou ? 'btn-primary' : 'btn-secondary'}`}>
                    {r.waitingForYou ? 'Decide' : 'Open'}
                    <span className="sr-only">
                      {' '}
                      the official duty request for {when}
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
        {odLabel(requests.length)} {note}
      </p>
    </div>
  );
}
