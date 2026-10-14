import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Department, JobTitleSummary } from '@/lib/types';
import { Empty, Loading } from '../ui';

const UUID = /^[0-9a-f-]{36}$/i;

async function JobTitlesList({ searchParams }: { searchParams: Promise<{ departmentId?: string | string[] }> }) {
  const raw = (await searchParams).departmentId;
  const departmentId = typeof raw === 'string' && UUID.test(raw) ? raw : '';
  const [user, departments, jobTitles] = await Promise.all([
    getCurrentUser(),
    apiGet<Department[]>('/departments'),
    apiGet<JobTitleSummary[]>(departmentId ? `/job-titles?departmentId=${departmentId}` : '/job-titles'),
  ]);
  const canEdit = canEditOrganisation(user);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="departmentId" className="label">
              Department
            </label>
            <select id="departmentId" name="departmentId" defaultValue={departmentId} className="input min-w-56">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary">
            Filter
          </button>
        </form>
        {canEdit && departments.length > 0 && (
          <Link
            href={departmentId ? `/organisation/job-titles/new?departmentId=${departmentId}` : '/organisation/job-titles/new'}
            className="btn btn-primary"
          >
            New job title
          </Link>
        )}
      </div>

      {departments.length === 0 ? (
        <Empty>
          Job titles belong to a department.{' '}
          {canEdit && <Link href="/organisation/departments/new">Create a department first.</Link>}
        </Empty>
      ) : jobTitles.length === 0 ? (
        <Empty>No job titles {departmentId ? 'in this department ' : ''}yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Job title</th>
                <th>Arabic title</th>
                <th>Department</th>
                <th>Grade</th>
                <th>JD</th>
                {canEdit && <th><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {jobTitles.map((j) => (
                <tr key={j.id}>
                  <td className="font-medium">{j.titleEn}</td>
                  <td lang="ar" dir="rtl" className="text-right">
                    {j.titleAr ?? <span className="text-muted">—</span>}
                  </td>
                  <td>{j.department.nameEn}</td>
                  <td>{j.grade ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap text-muted">
                    v{j.jdVersion} · {j._count.duties} {j._count.duties === 1 ? 'duty' : 'duties'}
                  </td>
                  {canEdit && (
                    <td className="text-right">
                      <Link href={`/organisation/job-titles/${j.id}`}>Edit</Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function JobTitlesPage({ searchParams }: PageProps<'/organisation/job-titles'>) {
  return (
    <Suspense fallback={<Loading />}>
      <JobTitlesList searchParams={searchParams} />
    </Suspense>
  );
}
