import { CHANGE_REQUEST_STATUS_LABELS, type ChangeRequestStatus } from '@trendlix/shared';
import type { ChangeRequestChange } from '@/lib/types';
import { changeShown } from '../../confirmation';

// Parts of a change request shown both to the employee (their requests) and to HR and Admin (Approvals).

const STATUS_STYLE: Record<ChangeRequestStatus, string> = {
  pending: 'bg-warn-soft text-warn',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
  cancelled: 'bg-line-soft text-muted',
};

/** Waiting for HR, Approved, Rejected or Cancelled. */
export function ChangeRequestStatusBadge({ status }: { status: ChangeRequestStatus }) {
  return <span className={`badge ${STATUS_STYLE[status] ?? 'bg-line-soft text-muted'}`}>{CHANGE_REQUEST_STATUS_LABELS[status] ?? status}</span>;
}

function Value({ text, ar }: { text: string; ar: boolean }) {
  if (!text) return <span className="text-muted">—</span>;
  if (!ar) return <span className="break-words">{text}</span>;
  return (
    <span lang="ar" dir="rtl" className="inline-block">
      {text}
    </span>
  );
}

/** One row per field asked about: its name, what it was (`fromLabel`) and what is asked for (`toLabel`), as the profile shows values. */
export function ChangesTable({ changes, fromLabel, toLabel, caption }: { changes: ChangeRequestChange[]; fromLabel: string; toLabel: string; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">{fromLabel}</th>
            <th scope="col">{toLabel}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => {
            const shown = changeShown(c);
            return (
              <tr key={c.field}>
                <td className="font-medium">{shown.name}</td>
                <td className="tabular-nums">
                  <Value text={shown.from} ar={shown.ar} />
                </td>
                <td className="font-medium tabular-nums">
                  <Value text={shown.to} ar={shown.ar} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
