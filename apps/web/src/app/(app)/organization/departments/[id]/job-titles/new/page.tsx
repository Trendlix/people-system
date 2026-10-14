import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { departmentName } from '@/lib/departments';
import type { Department, Grade } from '@/lib/types';
import { createJobTitle } from '../../../../actions';
import { BackLink, Empty, Loading, RequireEditor, UUID } from '../../../../ui';
import { JobTitleForm } from '../../../job-title-form';

// Job titles belong to teams only ("Add job title" is on each team). Opened for a department (an older link), nothing
// is chosen: its teams are in the picker; one with no teams gets a team added first.

async function NewJobTitle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [departments, grades] = await Promise.all([apiGet<Department[]>('/departments'), apiGet<Grade[]>('/grades')]);
  const place = departments.find((d) => d.id === id);
  if (!place) notFound();
  const back = `/organization/departments/${id}`;
  const isTeam = Boolean(place.parentId);
  const hasTeams = departments.some((d) => d.parentId === id);

  return (
    <>
      <BackLink href={back}>{departmentName(place)}</BackLink>
      <h2 className="text-lg font-semibold">New Job Title</h2>
      <RequireEditor>
        {isTeam || hasTeams ? (
          <>
            {!isTeam && <p className="text-sm text-muted">Job titles belong to a team: choose one of the teams of {place.nameEn}.</p>}
            <JobTitleForm action={createJobTitle} departments={departments} grades={grades} defaultTeamId={isTeam ? id : undefined} cancelHref={back} />
          </>
        ) : (
          <Empty>
            Job titles belong to a team, and {place.nameEn} has no teams yet.{' '}
            <Link href={`/organization/departments/new?parentId=${id}`}>Add a team</Link> first, then its job titles.
          </Empty>
        )}
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
