import { Suspense } from 'react';
import { updatePersonal } from '../../../actions';
import { loadEmployee } from '../../../data';
import { EditHeading, Loading, RequireHr } from '../../../ui';
import { PersonalForm } from './personal-form';

async function EditPersonal({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  return (
    <>
      <EditHeading profile={employee} title="Personal details" />
      <RequireHr profile={employee}>
        <PersonalForm action={updatePersonal.bind(null, employee.id)} employee={employee} />
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
