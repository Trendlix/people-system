import Link from 'next/link';
import type { JobTitleSummary } from '@/lib/types';
import { gradeRangeLabel } from '../grades/label';

const dash = <span className="text-muted">—</span>;

/** A job title's insurance occupation as written: "212300 · مدير مبيعات", the code first and the name right to left. */
export function OccupationText({ code, name, className }: { code: string; name?: string | null; className?: string }) {
  return (
    <span dir="ltr" className={className}>
      <span className="tabular-nums">{code}</span>
      {name && (
        <>
          {' · '}
          <span lang="ar" dir="rtl">
            {name}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * A team's job titles, with the grades each allows ("G3–G6") and the insurance occupation. Each one links to its page
 * with the job description.
 */
export function JobTitlesTable({ jobTitles }: { jobTitles: JobTitleSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Arabic Title</th>
            <th>Grades</th>
            <th>Insurance Occupation</th>
            <th>JD</th>
          </tr>
        </thead>
        <tbody>
          {jobTitles.map((j) => (
            <tr key={j.id}>
              <td>
                <Link href={`/organization/departments/${j.departmentId}/job-titles/${j.id}`} className="font-medium">
                  {j.titleEn}
                </Link>
              </td>
              <td lang="ar" dir="rtl" className="text-right">
                {j.titleAr ?? dash}
              </td>
              <td className="whitespace-nowrap">{gradeRangeLabel(j) ?? <span className="text-muted">Any grade</span>}</td>
              <td>{j.occupationCode ? <OccupationText code={j.occupationCode} name={j.occupationName} className="whitespace-nowrap" /> : dash}</td>
              <td className="whitespace-nowrap text-muted">
                v{j.jdVersion} · {j._count.duties} {j._count.duties === 1 ? 'duty' : 'duties'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
