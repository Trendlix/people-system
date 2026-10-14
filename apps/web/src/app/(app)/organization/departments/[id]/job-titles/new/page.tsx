import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { departmentName } from '@/lib/departments';
import type { Department } from '@/lib/types';
import { createJobTitle } from '../../../../actions';
import { BackLink, Loading, RequireEditor, UUID } from '../../../../ui';
import { JobTitleForm } from '../../../job-title-form';

async function NewJobTitle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const departments = await apiGet<Department[]>('/departments');
  const department = departments.find((d) => d.id === id);
  if (!department) notFound();
  const back = `/organization/departments/${id}`;

  return (
    <>
      <BackLink href={back}>{departmentName(department)}</BackLink>
      <h2 className="text-lg font-semibold">New Job Title</h2>
      <RequireEditor>
        <JobTitleForm action={createJobTitle} departments={departments} defaultDepartmentId={id} cancelHref={back} />
      </RequireEditor>
    </>
  );
}

export default function NewJobTitlePage({ params }: PageProps<'/organization/departments/[id]/job-titles/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <NewJobTitle params={params} />
      </Suspense>
    </div>
  );
}
