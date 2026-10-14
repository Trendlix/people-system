import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { JobTitle } from '@/lib/types';
import { Loading, UUID } from '../../ui';

// Job titles moved under their department (/organization/departments/<department>/job-titles/<job title>).
// Old links to a job title land here and are sent on to its new address, which needs its department.
// The old list and "new" pages are redirected in next.config.ts.

async function Forward({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const jobTitle = await apiGet<JobTitle>(`/job-titles/${id}`);
  redirect(`/organization/departments/${jobTitle.departmentId}/job-titles/${id}`);
}

export default function OldJobTitlePage({ params }: PageProps<'/organization/job-titles/[id]'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Forward params={params} />
    </Suspense>
  );
}
