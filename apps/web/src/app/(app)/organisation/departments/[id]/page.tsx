import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import type { Department } from '@/lib/types';
import { deleteDepartment, updateDepartment } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { DepartmentForm } from '../department-form';

async function EditDepartment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const department = await apiGet<Department>(`/departments/${id}`);
  const jobTitles = department._count.jobTitles;

  return (
    <RequireEditor>
      <h2 className="text-lg font-semibold">{department.nameEn}</h2>
      <div className="mt-4 space-y-8">
        <DepartmentForm action={updateDepartment.bind(null, id)} department={department} />
        <section className="max-w-xl space-y-2">
          <h3 className="font-semibold">Delete department</h3>
          {jobTitles > 0 ? (
            <p className="text-sm text-muted">
              This department has {jobTitles} job {jobTitles === 1 ? 'title' : 'titles'}. Move or delete them first.
            </p>
          ) : (
            <DeleteForm
              action={deleteDepartment.bind(null, id)}
              confirmText={`Delete the ${department.nameEn} department? This cannot be undone.`}
              label="Delete department"
            />
          )}
        </section>
      </div>
    </RequireEditor>
  );
}

export default function DepartmentPage({ params }: PageProps<'/organisation/departments/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organisation/departments">Departments</BackLink>
      <Suspense fallback={<Loading />}>
        <EditDepartment params={params} />
      </Suspense>
    </div>
  );
}
