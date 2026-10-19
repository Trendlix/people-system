import type { ChangeRequestStatus } from '@trendlix/shared';
import Link from 'next/link';
import { CLevelBadge } from '@/components/c-level-badge';
import { formatDateTime } from '@/lib/format';
import type { ChangeRequest, ChangeRequestChange } from '@/lib/types';
import { changeStatusLabel } from '../../../requests/details-changes/list';
import { changeShown } from '../../confirmation';
import { profileHref } from '../../tab-list';

// Parts of a change request shown both to the employee (their requests) and to HR and Admin (Approvals, and Details
// Changes under Requests). A C-level person's (owner, 19 October 2026: "make C level Employees details not visible to
// HR"), which the CEO or a Super Admin decides, says "Waiting for the CEO" while it waits, and is marked C-level.

const STATUS_STYLE: Record<ChangeRequestStatus, string> = {
  pending: 'bg-warn-soft text-warn',
  approved: 'bg-ok-soft text-ok',
  rejected: 'bg-danger-soft text-danger',
  cancelled: 'bg-line-soft text-muted',
};

/** Waiting for HR, Approved, Rejected or Cancelled; Waiting for the CEO for a C-level person's (`confidential`). */
export function ChangeRequestStatusBadge({ status, confidential }: { status: ChangeRequestStatus; confidential?: boolean }) {
  return <span className={`badge ${STATUS_STYLE[status] ?? 'bg-line-soft text-muted'}`}>{changeStatusLabel(status, confidential)}</span>;
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

/**
 * A change request as HR and Admin see it (Approvals, Details Changes): whose profile (linked), when and by whom it was
 * asked, its status, the employee's note and the changes asked for (`fromLabel`: what the values were), then
 * `children`: the decision, or the form to make it.
 */
export function ChangeRequestCard({ request: r, fromLabel = 'Current', children }: { request: ChangeRequest; fromLabel?: string; children?: React.ReactNode }) {
  const name = r.employee.fullNameEn;
  return (
    <li className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">
            <Link href={profileHref(r.employee.id)}>{name}</Link>
            <span className="font-normal text-muted"> · {r.employee.employeeCode}</span>
            {r.confidential && <CLevelBadge className="ml-2 align-middle" title="The CEO or a Super Admin decides a C-level person’s change request, not HR." />}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            Asked {formatDateTime(r.requestedAt)}
            {r.requestedBy?.email && <> by {r.requestedBy.email}</>}
          </p>
        </div>
        <ChangeRequestStatusBadge status={r.status} confidential={r.confidential} />
      </div>
      {r.note && (
        <div className="mt-4 text-sm">
          <p className="text-xs text-muted">What should change and why</p>
          <p className="mt-0.5 whitespace-pre-line">{r.note}</p>
        </div>
      )}
      <div className="mt-4">
        <ChangesTable changes={r.changes} fromLabel={fromLabel} toLabel="Requested" caption={`Changes ${name} asked for`} />
      </div>
      {children}
    </li>
  );
}
