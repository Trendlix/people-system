import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { departmentName } from '@/lib/departments';
import type { Department, Grade } from '@/lib/types';
import { createJobTitle } from '../../../../actions';
import { BackLink, Loading, RequireEditor, UUID } from '../../../../ui';
import { JobTitleForm } from '../../../job-title-form';

// A new job title, from "Add job title" on a department's or a team's page: a job title belongs to a department itself
// (e.g. Head of Marketing) or to one of its teams. The one it was opened from comes preselected; the form can choose
// another.

async function NewJobTitle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [departments, grades] = await Promise.all([apiGet<Department[]>('/departments'), apiGet<Grade[]>('/grades')]);
  const place = departments.find((d) => d.id === id);
  if (!place) notFound();
  const back = `/organization/departments/${id}`;

  return (
    <>
      <BackLink href={back}>{departmentName(place)}</BackLink>
      <h2 className="text-lg font-semibold">New Job Title</h2>
      <RequireEditor>
        <JobTitleForm action={createJobTitle} departments={departments} grades={grades} defaultDepartmentId={id} cancelHref={back} />
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
