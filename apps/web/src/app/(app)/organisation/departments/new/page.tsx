import { Suspense } from 'react';
import { createDepartment } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { DepartmentForm } from '../department-form';

export default function NewDepartmentPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organisation/departments">Departments</BackLink>
      <h2 className="text-lg font-semibold">New department</h2>
      <Suspense fallback={<Loading />}>
        <RequireEditor>
          <DepartmentForm action={createDepartment} />
        </RequireEditor>
      </Suspense>
    </div>
  );
}
