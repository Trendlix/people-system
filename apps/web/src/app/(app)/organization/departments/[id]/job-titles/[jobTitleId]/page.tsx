import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import { departmentName } from '@/lib/departments';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Department, JobTitle } from '@/lib/types';
import { deleteJobTitle, updateJobTitle } from '../../../../actions';
import { BackLink, Loading, UUID } from '../../../../ui';
import { AnchorSection } from '../../../anchor-section';
import { JobTitleForm } from '../../../job-title-form';

const notSet = <span className="text-muted">Not set</span>;

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** The job description as everyone sees it. */
function JobDescription({ jobTitle }: { jobTitle: JobTitle }) {
  return (
    <section className="card max-w-3xl space-y-5 p-6">
      <div>
        <h3 className="font-semibold">Job Description</h3>
        <p className="text-sm text-muted">Version {jobTitle.jdVersion}</p>
      </div>
      <Part title="Purpose of the Role">{jobTitle.jdPurpose ? <p className="whitespace-pre-line">{jobTitle.jdPurpose}</p> : notSet}</Part>
      <Part title="Duties & Responsibilities">
        {jobTitle.duties.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5">
            {jobTitle.duties.map((d) => (
              <li key={d.id}>{d.duty}</li>
            ))}
          </ol>
        ) : (
          notSet
        )}
      </Part>
      <Part title="Requirements">{jobTitle.jdRequirements ? <p className="whitespace-pre-line">{jobTitle.jdRequirements}</p> : notSet}</Part>
    </section>
  );
}

async function JobTitleDetails({ params }: { params: Promise<{ id: string; jobTitleId: string }> }) {
  const { id, jobTitleId } = await params;
  if (!UUID.test(id) || !UUID.test(jobTitleId)) notFound();
  const [user, jobTitle, departments] = await Promise.all([
    getCurrentUser(),
    apiGet<JobTitle>(`/job-titles/${jobTitleId}`),
    apiGet<Department[]>('/departments'),
  ]);
  // Moved to another department or team since the link was made: show it under the one it is in now.
  if (jobTitle.departmentId !== id) redirect(`/organization/departments/${jobTitle.departmentId}/job-titles/${jobTitleId}`);
  const canEdit = canEditOrganisation(user);
  const back = `/organization/departments/${id}`;

  return (
    <>
      <BackLink href={back}>{departmentName(jobTitle.department)}</BackLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{jobTitle.titleEn}</h2>
          {jobTitle.titleAr && (
            <p lang="ar" dir="rtl" className="w-fit">
              {jobTitle.titleAr}
            </p>
          )}
          <p className="mt-1 text-sm text-muted">
            {departmentName(jobTitle.department)}
            {jobTitle.grade && ` · Grade ${jobTitle.grade}`}
          </p>
        </div>
        {canEdit && (
          <a href="#edit" className="btn btn-secondary">
            Edit job title
          </a>
        )}
      </div>

      <JobDescription jobTitle={jobTitle} />

      {canEdit && (
        <>
          <AnchorSection id="edit" className="space-y-2 pt-4">
            <h3 className="font-semibold">Edit Job Title</h3>
            <JobTitleForm action={updateJobTitle.bind(null, jobTitleId)} departments={departments} jobTitle={jobTitle} cancelHref={back} />
          </AnchorSection>
          <section className="max-w-xl space-y-2 pt-4">
            <h3 className="font-semibold">Delete Job Title</h3>
            <DeleteForm
              action={deleteJobTitle.bind(null, jobTitleId, jobTitle.departmentId)}
              confirmText={`Delete the job title "${jobTitle.titleEn}" and its job description? This cannot be undone.`}
              label="Delete job title"
            />
          </section>
        </>
      )}
    </>
  );
}

export default function JobTitlePage({ params }: PageProps<'/organization/departments/[id]/job-titles/[jobTitleId]'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <JobTitleDetails params={params} />
      </Suspense>
    </div>
  );
}
