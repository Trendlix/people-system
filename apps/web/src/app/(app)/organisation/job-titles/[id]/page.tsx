import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import type { Department, JobTitle } from '@/lib/types';
import { deleteJobTitle, updateJobTitle } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { JobTitleForm } from '../job-title-form';

async function EditJobTitle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [jobTitle, departments] = await Promise.all([apiGet<JobTitle>(`/job-titles/${id}`), apiGet<Department[]>('/departments')]);

  return (
    <RequireEditor>
      <h2 className="text-lg font-semibold">{jobTitle.titleEn}</h2>
      <p className="text-sm text-muted">{jobTitle.department.nameEn}</p>
      <div className="mt-4 space-y-8">
        <JobTitleForm action={updateJobTitle.bind(null, id)} departments={departments} jobTitle={jobTitle} />
        <section className="max-w-xl space-y-2">
          <h3 className="font-semibold">Delete job title</h3>
          <DeleteForm
            action={deleteJobTitle.bind(null, id)}
            confirmText={`Delete the job title "${jobTitle.titleEn}" and its job description? This cannot be undone.`}
            label="Delete job title"
          />
        </section>
      </div>
    </RequireEditor>
  );
}

export default function JobTitlePage({ params }: PageProps<'/organisation/job-titles/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organisation/job-titles">Job titles</BackLink>
      <Suspense fallback={<Loading />}>
        <EditJobTitle params={params} />
      </Suspense>
    </div>
  );
}
