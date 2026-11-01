import Link from 'next/link';
import { Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { apiGet } from '@/lib/api';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Grade, JobTitleSummary } from '@/lib/types';
import { Empty, Loading } from '../ui';
import { inGradeRange } from './label';

// The grading system (owner's table: G1 Entry Level … G9 Executive). The rank is the level in the hierarchy; the API
// lists the grades lowest rank first. A job title may limit the grades people with it can have to a range (Account
// Manager: G3 to G6); each employment has the person's own grade. A grade ticked confidential makes those holding it
// C-level (owner, 19 October 2026: "make C level Employees details not visible to HR"): marked so for everyone here; a
// Super Admin ticks it on the grade's form.

const dash = <span className="text-muted">—</span>;

async function GradesList() {
  const [user, grades, jobTitles] = await Promise.all([getCurrentUser(), apiGet<Grade[]>('/grades'), apiGet<JobTitleSummary[]>('/job-titles')]);
  const canEdit = canEditOrganisation(user);
  // The job titles whose range takes each grade; those open to any grade are left out (they would count everywhere).
  const ranged = jobTitles.filter((j) => j.minGrade || j.maxGrade);
  const titlesTaking = (g: Grade) => ranged.filter((j) => inGradeRange(g, j)).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {grades.length} {grades.length === 1 ? 'grade' : 'grades'}
        </p>
        {canEdit && (
          <Link href="/organization/grades/new" className="btn btn-primary">
            New grade
          </Link>
        )}
      </div>
      {grades.length === 0 ? (
        <Empty>No grades yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Level</th>
                <th>Arabic Level</th>
                <th>Example</th>
                <th>
                  Job Titles <span className="sr-only">with this grade in their range</span>
                </th>
                {canEdit && (
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td className="font-medium whitespace-nowrap">
                    {g.code}
                    {g.confidential && <CLevelBadge className="ml-2" />}
                  </td>
                  <td>{g.levelEn}</td>
                  <td lang="ar" dir="rtl" className="text-right">
                    {g.levelAr ?? dash}
                  </td>
                  <td className="text-muted">{g.description ?? dash}</td>
                  <td className="text-muted tabular-nums">{titlesTaking(g)}</td>
                  {canEdit && (
                    <td className="text-right">
                      <Link href={`/organization/grades/${g.id}`}>
                        Edit<span className="sr-only"> {g.code}</span>
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function GradesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <GradesList />
    </Suspense>
  );
}
