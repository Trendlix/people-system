import Link from 'next/link';
import { Suspense } from 'react';
import { LABELS } from '@trendlix/shared';
import { departmentName } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { endEmployment } from '../../../../employment-actions';
import { loadEmployment } from '../../../../data';
import { EditHeading, Empty, gradeLabel, Loading, profileHref, RequireHr } from '../../../../ui';
import { EndEmploymentForm } from '../../employment-form';
import { shownCode } from '@/lib/hidden';

// Recording a past ending: an HR correction tool for an employment that already ended outside People System (e.g.
// before it was used, when entering someone's history). It sets the end directly, without notice, the CEO's approval
// or the deadlines; ending an employment now goes through End employment (../../../ending/new), which the CEO
// approves. The profile stays, and the person is then listed as a former employee with this employment in their
// history. Not while people report to them: the API refuses (409) until they have another manager.

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
      <EditHeading profile={employee} title="Record a Past Ending" backHref={back} />
      <RequireHr profile={employee}>
        {e.endDate ? (
          <Empty>
            This employment already ended on {formatDate(e.endDate)}. <Link href={`/employees/${employee.id}/employment/${e.id}/edit`}>Edit it</Link>
          </Empty>
        ) : (
          <div className="max-w-3xl space-y-4">
            <p className="text-sm">
              <span className="font-semibold">{what}</span> <span className="text-muted">since {formatDate(e.joinDate)}</span>
            </p>
            <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
              For records only: this ends it at once, without the CEO&apos;s approval. To end it now, use{' '}
              <Link href={`/employees/${employee.id}/ending/new`}>End employment</Link>.
            </p>
            {employee.reports.length > 0 && (
              <div role="alert" className="space-y-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
                <p>
                  {employee.reports.length === 1 ? '1 person reports' : `${employee.reports.length} people report`} to {employee.fullNameEn}. Give them another
                  manager before ending this employment:
                </p>
                <ul className="list-disc pl-5">
                  {employee.reports.map((r) => (
                    <li key={r.id}>
                      <Link href={profileHref(r.id, 'employment')}>{r.fullNameEn}</Link>
                      {shownCode(r.employeeCode) && ` (${r.employeeCode})`}
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
