import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { Department } from '@/lib/types';
import { createDepartment } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { DepartmentForm } from '../department-form';

type Query = Record<string, string | string[] | undefined>;

/** A new department, or a new team in the department given as ?parentId= ("Add team"). */
async function NewDepartment({ searchParams }: { searchParams: Promise<Query> }) {
  const [departments, query] = await Promise.all([apiGet<Department[]>('/departments'), searchParams]);
  // Only a department can have teams; anything else starts as a new department.
  const parent = departments.find((d) => d.id === query.parentId && !d.parentId);
  const back = parent ? `/organization/departments/${parent.id}` : '/organization/departments';

  return (
    <>
      <BackLink href={back}>{parent ? parent.nameEn : 'Departments & Job Titles'}</BackLink>
      <h2 className="text-lg font-semibold">{parent ? 'New Team' : 'New Department'}</h2>
      <RequireEditor>
        {/* Keyed: the page is kept between visits, and "Add team" for another department must start the form afresh. */}
        <DepartmentForm key={parent?.id ?? ''} action={createDepartment} departments={departments} defaultParentId={parent?.id} cancelHref={back} />
      </RequireEditor>
    </>
  );
}

export default function NewDepartmentPage({ searchParams }: PageProps<'/organization/departments/new'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <NewDepartment searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
