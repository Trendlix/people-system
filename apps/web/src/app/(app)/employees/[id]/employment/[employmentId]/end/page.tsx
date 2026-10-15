import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS } from '@trendlix/shared';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { endEmployment } from '../../../../employment-actions';
import { loadEmployment } from '../../../../data';
import { EditHeading, Empty, gradeLabel, Loading, profileHref, RequireHr } from '../../../../ui';
import { EndEmploymentForm } from '../../employment-form';

// Ending the current employment: resignation, termination, the end of a contract. The profile stays, and the person is
// then listed as a former employee with this employment in their history. Not while people report to them: the API
// refuses (409) until they have another manager.

async function EndEmployment({ params }: { params: Promise<{ id: string; employmentId: string }> }) {
  const { employee, employment: e } = await loadEmployment(params);
  const back = profileHref(employee.id, 'employment');
  const what = [
    LABELS.employmentType[e.employmentType],
    e.jobTitle?.titleEn,
    e.grade && gradeLabel(e.grade),
    e.department && departmentName(e.department),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <EditHeading profile={employee} title="End Employment" backHref={back} />
      <RequireHr profile={employee}>
        {e.endDate ? (
          <Empty>
            This employment already ended on {formatDate(e.endDate)}. To correct how it ended, <Link href={`/employees/${employee.id}/employment/${e.id}/edit`}>edit it</Link>.
          </Empty>
        ) : (
          <div className="max-w-3xl space-y-4">
            <p className="text-sm">
              <span className="font-semibold">{what}</span> <span className="text-muted">since {formatDate(e.joinDate)}</span>
            </p>
            <p className="text-sm text-muted">
              The profile stays: {employee.fullNameEn} is then listed in the directory as a former employee, and this employment moves to the
              employment history. To hire them again later, add a new employment on the Employment tab.
            </p>
            {employee.reports.length > 0 && (
              <div role="alert" className="space-y-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
                <p>
                  {employee.reports.length === 1 ? '1 person reports' : `${employee.reports.length} people report`} to {employee.fullNameEn}. Choose another
                  manager for {employee.reports.length === 1 ? 'them' : 'each of them'} before ending this employment:
                </p>
                <ul className="list-disc pl-5">
                  {employee.reports.map((r) => (
                    <li key={r.id}>
                      <Link href={profileHref(r.id, 'employment')}>{r.fullNameEn}</Link> ({r.employeeCode})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <EndEmploymentForm action={endEmployment.bind(null, employee.id, e.id)} cancelHref={back} />
          </div>
        )}
      </RequireHr>
    </>
  );
}

export default function EndEmploymentPage({ params }: PageProps<'/employees/[id]/employment/[employmentId]/end'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EndEmployment params={params} />
      </Suspense>
    </div>
  );
}
