import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { Department, EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { createDepartment } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { DepartmentForm } from '../department-form';

type Query = Record<string, string | string[] | undefined>;

/** A new department, or a new team in the department given as ?parentId= ("Add team"). */
async function NewDepartment({ searchParams }: { searchParams: Promise<Query> }) {
  // the people its lead is chosen from (owner, 19 October 2026), as the caller may see them; none when they can't be read
  const [departments, people, query] = await Promise.all([apiGet<Department[]>('/departments'), getOrNull<EmployeeSummary[]>('/employees'), searchParams]);
  // Only a department can have teams; anything else starts as a new department.
  const parent = departments.find((d) => d.id === query.parentId && !d.parentId);
  const back = parent ? `/organization/departments/${parent.id}` : '/organization/departments';

  return (
    <>
      <BackLink href={back}>{parent ? parent.nameEn : 'Departments & Job Titles'}</BackLink>
      <h2 className="text-lg font-semibold">{parent ? 'New Team' : 'New Department'}</h2>
      <RequireEditor>
        {/* Keyed: the page is kept between visits, and "Add team" for another department must start the form afresh. */}
        <DepartmentForm
          key={parent?.id ?? ''}
          action={createDepartment}
          departments={departments}
          people={people ?? []}
          defaultParentId={parent?.id}
          cancelHref={back}
        />
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
