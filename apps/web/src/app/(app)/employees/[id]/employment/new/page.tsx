import Link from 'next/link';
import { Suspense } from 'react';
import { END_REASON_LABELS } from '@trendlix/shared';
import { formatDate } from '@/lib/format';
import { addEmployment } from '../../../employment-actions';
import { loadEmployee, loadPickers } from '../../../data';
import { EditHeading, Empty, Loading, profileHref, RequireHr } from '../../../ui';
import { EmploymentForm } from '../employment-form';

// Hiring someone whose profile exists: their first employment, or a new one after the last ended (a rehire). One
// employment is current at a time, and a new one starts after the last one ended.

async function AddEmployment({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  const back = profileHref(employee.id, 'employment');
  const current = employee.employment;
  const lastEnded = employee.employments.find((e) => e.endDate);
  const pickers = employee.access.edit && !current ? await loadPickers(employee.id) : null;

  return (
    <>
      <EditHeading profile={employee} title={lastEnded ? 'Add a New Employment' : 'Add Employment'} backHref={back} />
      <RequireHr profile={employee}>
        {current ? (
          <Empty>
            {employee.fullNameEn} already has a current employment, since {formatDate(current.joinDate)}. To hire them again, first{' '}
            <Link href={`/employees/${employee.id}/employment/${current.id}/end`}>end that employment</Link>.
          </Empty>
        ) : (
          pickers && (
            <div className="max-w-3xl space-y-4">
              {lastEnded?.endDate && (
                <p className="text-sm text-muted">
                  Rehiring: the last employment ended on {formatDate(lastEnded.endDate)}
                  {lastEnded.endReason && ` (${END_REASON_LABELS[lastEnded.endReason].toLowerCase()})`}. The new one starts after that day; the earlier
                  ones stay in the employment history.
                </p>
              )}
              <EmploymentForm action={addEmployment.bind(null, employee.id)} pickers={pickers} cancelHref={back} submitLabel="Add employment" />
            </div>
          )
        )}
      </RequireHr>
    </>
  );
}

export default function AddEmploymentPage({ params }: PageProps<'/employees/[id]/employment/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <AddEmployment params={params} />
      </Suspense>
    </div>
  );
}
