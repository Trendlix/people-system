import { Suspense } from 'react';
import { updatePersonal } from '../../../actions';
import { loadEmailDomain, loadEmployee } from '../../../data';
import { EditHeading, Loading, RequireHr } from '../../../ui';
import { PersonalForm } from './personal-form';

async function EditPersonal({ params }: { params: Promise<{ id: string }> }) {
  const [employee, emailDomain] = await Promise.all([loadEmployee(params), loadEmailDomain()]);
  return (
    <>
      <EditHeading profile={employee} title="Personal Details" />
      <RequireHr profile={employee}>
        <PersonalForm
          action={updatePersonal.bind(null, employee.id)}
          employee={employee}
          part="profile"
          emailDomain={emailDomain}
          cancelHref={`/employees/${employee.id}`}
        />
      </RequireHr>
    </>
  );
}

export default function EditPersonalPage({ params }: PageProps<'/employees/[id]/edit/personal'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditPersonal params={params} />
      </Suspense>
    </div>
  );
}
