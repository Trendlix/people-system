import { Suspense } from 'react';
import { updateEducation } from '../../../actions';
import { loadEmployee } from '../../../data';
import { EditHeading, Loading, profileHref, RequireHr } from '../../../ui';
import { PersonalForm } from '../personal/personal-form';

// The Education tab's fields: university, faculty, degree, major, graduation year, grade, qualification (Arabic).

async function EditEducation({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  const back = profileHref(employee.id, 'education');
  return (
    <>
      <EditHeading profile={employee} title="Education" backHref={back} />
      <RequireHr profile={employee}>
        <PersonalForm action={updateEducation.bind(null, employee.id)} employee={employee} part="education" cancelHref={back} />
      </RequireHr>
    </>
  );
}

export default function EditEducationPage({ params }: PageProps<'/employees/[id]/edit/education'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditEducation params={params} />
      </Suspense>
    </div>
  );
}
