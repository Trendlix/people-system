import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { Department } from '@/lib/types';
import { createJobTitle } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { JobTitleForm } from '../job-title-form';

async function NewJobTitle({ searchParams }: { searchParams: Promise<{ departmentId?: string | string[] }> }) {
  const [departments, query] = await Promise.all([apiGet<Department[]>('/departments'), searchParams]);
  const preset = typeof query.departmentId === 'string' ? query.departmentId : undefined;
  return (
    <RequireEditor>
      <JobTitleForm action={createJobTitle} departments={departments} defaultDepartmentId={preset} />
    </RequireEditor>
  );
}

export default function NewJobTitlePage({ searchParams }: PageProps<'/organisation/job-titles/new'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organisation/job-titles">Job titles</BackLink>
      <h2 className="text-lg font-semibold">New job title</h2>
      <Suspense fallback={<Loading />}>
        <NewJobTitle searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
