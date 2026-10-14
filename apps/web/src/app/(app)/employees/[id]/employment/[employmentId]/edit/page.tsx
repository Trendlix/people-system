import Link from 'next/link';
import { Suspense } from 'react';
import { updateEmployment } from '../../../../employment-actions';
import { loadEmployment, loadPickers } from '../../../../data';
import { EditHeading, Loading, periodLabel, profileHref, RequireHr } from '../../../../ui';
import { EmploymentForm } from '../../employment-form';

// Changing an employment: the current one, or an ended one in the history (e.g. a wrong date, including how and when
// it ended). Employments of one person never overlap; the API refuses dates that would.

async function EditEmployment({ params }: { params: Promise<{ id: string; employmentId: string }> }) {
  const { employee, employment } = await loadEmployment(params);
  const pickers = employee.access.edit ? await loadPickers(employee.id) : null;
  const back = profileHref(employee.id, 'employment');
  const ended = Boolean(employment.endDate);

  return (
    <>
      <EditHeading profile={employee} title={ended ? 'Edit Past Employment' : 'Edit Employment'} backHref={back} />
      <RequireHr profile={employee}>
        {pickers && (
          <div className="max-w-3xl space-y-4">
            <p className="text-sm text-muted">
              {periodLabel(employment)}
              {ended ? '. Its status follows why it ended.' : '. '}
              {!ended && (
                <>
                  When they leave, <Link href={`/employees/${employee.id}/employment/${employment.id}/end`}>end the employment</Link> instead of changing it.
                </>
              )}
            </p>
            <EmploymentForm
              action={updateEmployment.bind(null, employee.id, employment.id, ended)}
              pickers={pickers}
              employment={employment}
              cancelHref={back}
              submitLabel="Save changes"
            />
          </div>
        )}
      </RequireHr>
    </>
  );
}

export default function EditEmploymentPage({ params }: PageProps<'/employees/[id]/employment/[employmentId]/edit'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditEmployment params={params} />
      </Suspense>
    </div>
  );
}
