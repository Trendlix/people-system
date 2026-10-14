import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Department } from '@/lib/types';
import { Empty, Loading } from '../ui';

async function DepartmentsList() {
  const [user, departments] = await Promise.all([getCurrentUser(), apiGet<Department[]>('/departments')]);
  const canEdit = canEditOrganisation(user);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {departments.length} {departments.length === 1 ? 'department' : 'departments'}
        </p>
        {canEdit && (
          <Link href="/organisation/departments/new" className="btn btn-primary">
            New department
          </Link>
        )}
      </div>
      {departments.length === 0 ? (
        <Empty>No departments yet.{canEdit && ' Create the first one to start adding job titles.'}</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Arabic name</th>
                <th>Job titles</th>
                {canEdit && <th><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.nameEn}</td>
                  <td lang="ar" dir="rtl" className="text-right">
                    {d.nameAr ?? <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <Link href={`/organisation/job-titles?departmentId=${d.id}`}>{d._count.jobTitles}</Link>
                  </td>
                  {canEdit && (
                    <td className="text-right">
                      <Link href={`/organisation/departments/${d.id}`}>Edit</Link>
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

export default function DepartmentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DepartmentsList />
    </Suspense>
  );
}
