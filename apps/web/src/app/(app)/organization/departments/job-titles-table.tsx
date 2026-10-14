import Link from 'next/link';
import type { JobTitleSummary } from '@/lib/types';
import { gradeLabel } from '../grades/label';

const dash = <span className="text-muted">—</span>;

/** A team's job titles. Each one links to its page with the job description. */
export function JobTitlesTable({ jobTitles }: { jobTitles: JobTitleSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Job Title</th>
            <th>Arabic Title</th>
            <th>Grade</th>
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
              <td className="whitespace-nowrap">{j.grade ? gradeLabel(j.grade) : dash}</td>
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
