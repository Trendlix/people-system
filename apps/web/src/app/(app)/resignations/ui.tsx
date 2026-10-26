import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDate, formatDateTime } from '@/lib/format';
import type { ResignationRequestView } from '@/lib/resignation-types';
import { resignationHref, RESIGNATION_STATUS_STYLE } from './resignation';

// Resignation requests in a list (owner, 26 October 2026): HR's and the CEO's under People → Resignations, the employee's own
// on My Requests, a direct manager's on My Team. No hooks.

export function ResignationStatusBadge({ r }: { r: Pick<ResignationRequestView, 'status' | 'statusLabel'> }) {
  return <span className={`badge ${RESIGNATION_STATUS_STYLE[r.status]}`}>{r.statusLabel}</span>;
}

const dash = <span className="text-muted">—</span>;

export function ResignationsTable({ requests, who = false, note }: { requests: readonly ResignationRequestView[]; who?: boolean; note: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {who && <th scope="col">Employee</th>}
            <th scope="col">Sent On</th>
            <th scope="col">Preferred Last Day</th>
            <th scope="col">Last Day By The Rule</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="align-top">
              {who && (
                <td className="min-w-44">
                  <span className="font-semibold">{r.employee.fullNameEn}</span>
                  {r.confidential && <CLevelBadge title="A C-level person: the CEO records it." className="ml-2" />}
                </td>
              )}
              <td className="whitespace-nowrap tabular-nums">{formatDate(r.sentOn)}</td>
              <td className="whitespace-nowrap tabular-nums">{r.preferredLastDay ? formatDate(r.preferredLastDay) : dash}</td>
              <td className="whitespace-nowrap tabular-nums">
                {formatDate(r.ruleLastDay)}
                <div className="text-xs text-muted">{r.notice}</div>
              </td>
              <td>
                <ResignationStatusBadge r={r} />
                {r.status === 'recorded' && r.recorded?.at && <div className="text-xs text-muted">{formatDateTime(r.recorded.at)}</div>}
              </td>
              <td className="text-right">
                <Link href={resignationHref(r.id)} className="font-semibold">
                  Open<span className="sr-only"> the request of {r.employee.fullNameEn}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">{note}</p>
    </div>
  );
}
