import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDateTime } from '@/lib/format';
import type { CompensatoryRequestView } from '@/lib/compensatory-types';
import { placeOfEmployee } from '../../leave/list';
import { LeaveStatusBadge } from '../../leave/ui';
import { compensatoryAheadMark, compensatoryDaysLine, compensatoryHref, compensatoryLabel, compensatoryOdText, compensatoryOutcomeText, compensatoryProgressText, compensatorySourceText } from './compensatory';
import { joinShown } from '@/lib/hidden';

// Compensatory day requests in a list (owner, 26 October 2026: "my compensatory is a compensation with another day in the
// same month"): the employee's own on My Requests, those waiting for a manager on My Team and for HR on Approvals, and
// everyone's under Attendance → Compensatory Days. Each row: who (when `who`), the day worked and the day off, how it came
// and HR's decision (a day off, or cash instead), where it stands with a status chip, a warning mark for one HR recorded
// past the notice or with no check-in kept, opening its page (Decide when it waits for the user). No hooks. Since 27
// October 2026: part of a day with its hours ("Worked Friday 06/11/2026 (4 hours) · 4 hours off Tuesday 10/11/2026"), and
// the official duty one goes with; since 31 October 2026, one asked ahead for a day worked still to come.

export function CompensatoryTable({ requests, who = false, how = false, note }: { requests: readonly CompensatoryRequestView[]; who?: boolean; how?: boolean; note: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">Employee</th>}
            <th scope="col">Days</th>
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
            const progress = compensatoryProgressText(r);
            const outcome = compensatoryOutcomeText(r.outcome);
            return (
              <tr key={r.id} className="align-top">
                {who && (
                  <td className="min-w-44">
                    <span className="font-semibold">{r.employee.fullNameEn}</span>
                    {r.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage." className="ml-2" />}
                    <div className="text-xs text-muted">{joinShown([r.employee.employeeCode, place])}</div>
                  </td>
                )}
                <td className="min-w-56 tabular-nums">
                  {compensatoryDaysLine(r)}
                  {/* one an official duty carries (27 October 2026), decided with it */}
                  {r.od && <span className="mt-1 block text-xs text-muted">{compensatoryOdText(r.od)}</span>}
                  {compensatoryAheadMark(r) && <span className="mt-1 block text-xs text-accent">{compensatoryAheadMark(r)}</span>}
                </td>
                {how && (
                  <td>
                    {compensatorySourceText(r)}
                    {r.warnings.length > 0 && (
                      <span className="mt-1 block text-xs font-medium text-warn" title={r.warnings.join(' ')}>
                        Recorded with {r.warnings.length === 1 ? 'a warning' : `${r.warnings.length} warnings`}
                      </span>
                    )}
                  </td>
                )}
                <td>
                  <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                  {outcome && r.status === 'approved' && <span className="ml-2 text-xs font-semibold">{outcome}</span>}
                  <div className="mt-1 text-xs text-muted">{r.status === 'approved' || r.status === 'rejected' || r.status === 'cancelled' ? progress.text : `Sent ${formatDateTime(r.createdAt)}`}</div>
                </td>
                <td className="text-right">
                  <Link href={compensatoryHref(r.id)} className={`btn min-h-9 px-3 no-underline ${r.waitingForYou ? 'btn-primary' : 'btn-secondary'}`}>
                    {r.waitingForYou ? 'Decide' : 'Open'}
                    <span className="sr-only">
                      {' '}
                      the compensatory day request for {compensatoryDaysLine(r)}
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
        {compensatoryLabel(requests.length)} {note}
      </p>
    </div>
  );
}
