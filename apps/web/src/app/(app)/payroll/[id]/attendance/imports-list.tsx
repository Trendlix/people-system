import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { AttendanceImportSummary } from '@/lib/attendance-types';
import { attendanceReviewHref } from './attendance';

// A run's attendance imports from Zoho People (owner, 19 October 2026: "Import Zoho now, replace it later"), the latest
// first: when and by whom, how many files and people, whether applied, each opening its review.

export function ImportsList({ runId, imports }: { runId: string; imports: AttendanceImportSummary[] }) {
  if (!imports.length) return null;
  return (
    <ul className="card divide-y divide-line-soft">
      {imports.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <span>
            <span className="font-medium">Read {formatDateTime(i.createdAt)}</span>
            {i.createdBy && <span className="text-muted"> by {i.createdBy}</span>}
            <span className="block text-xs text-muted">
              {i.files} {i.files === 1 ? 'file' : 'files'} · {i.people} {i.people === 1 ? 'person' : 'people'} ·{' '}
              {i.appliedAt ? `applied ${formatDateTime(i.appliedAt)}` : 'not applied yet'}
            </span>
          </span>
          <Link href={attendanceReviewHref(runId, i.id)} className="font-semibold">
            Review<span className="sr-only"> the import read {formatDateTime(i.createdAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
