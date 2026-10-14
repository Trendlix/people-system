import Link from 'next/link';
import type { JobTitleSummary } from '@/lib/types';

/**
 * Job titles from before the rule that they belong to teams only (Department → Team → Job title), still directly in a
 * department. The API refuses to save one there again, so each is moved into a team the next time it is edited.
 */
export function NotInTeam({ jobTitles, canEdit }: { jobTitles: JobTitleSummary[]; canEdit: boolean }) {
  return (
    <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
      <p className="font-semibold">
        Not in a team yet <span className="font-normal">· {jobTitles.length}</span>
      </p>
      {canEdit && <p>Move each into a team: open it and choose a team.</p>}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {jobTitles.map((j) => (
          <li key={j.id}>
            <Link href={`/organization/departments/${j.departmentId}/job-titles/${j.id}${canEdit ? '#edit' : ''}`} className="font-medium text-warn underline">
              {j.titleEn}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
