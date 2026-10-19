import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import type { AttendanceCorrectionView } from '@/lib/correction-types';
import { formatDateTime } from '@/lib/format';
import { LeaveStatusBadge } from '../../leave/ui';
import { correctionDayText, correctionHref, correctionKindName, correctionsLabel, rightTimesText } from './corrections';

// Attendance corrections in a list (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check
// out")"): the employee's own on My Requests, those waiting for a manager on My Team. Each row: the day, what was wrong,
// the right times, where it stands, opening the correction's page (with Decide when it waits for the user). No hooks.

export function CorrectionsTable({ corrections, who = false, note }: { corrections: readonly AttendanceCorrectionView[]; who?: boolean; note: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">Employee</th>}
            <th scope="col">Day</th>
            <th scope="col">What Was Wrong</th>
            <th scope="col">Right Times</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {corrections.map((c) => (
            <tr key={c.id} className="align-top">
              {who && (
                <td className="min-w-40">
                  <span className="font-semibold">{c.employee.fullNameEn}</span>
                  {c.confidential && <CLevelBadge title="A C-level person: the CEO decides HR’s stage." className="ml-2" />}
                </td>
              )}
              <td className="whitespace-nowrap tabular-nums">{correctionDayText(c)}</td>
              <td>{correctionKindName(c.correctionKind)}</td>
              <td className="whitespace-nowrap tabular-nums">{rightTimesText(c)}</td>
              <td>
                <LeaveStatusBadge status={c.status} confidential={c.confidential} />
                <div className="mt-1 text-xs text-muted">{c.recordedByHr ? 'Corrected by HR' : `Sent ${formatDateTime(c.createdAt)}`}</div>
              </td>
              <td className="text-right">
                <Link href={correctionHref(c.id)} className={`btn min-h-9 px-3 no-underline ${c.waitingForYou ? 'btn-primary' : 'btn-secondary'}`}>
                  {c.waitingForYou ? 'Decide' : 'Open'}
                  <span className="sr-only">
                    {' '}
                    the correction of {correctionDayText(c)}
                    {who && ` by ${c.employee.fullNameEn}`}
                  </span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {correctionsLabel(corrections.length)} {note}
      </p>
    </div>
  );
}
