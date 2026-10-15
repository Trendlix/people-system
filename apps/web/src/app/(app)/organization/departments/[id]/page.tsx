import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import { canDelete } from '@/lib/roles';
import { canEditOrganisation, canReorderDepartments, getCurrentUser } from '@/lib/session';
import type { Department, JobTitleSummary } from '@/lib/types';
import { deleteDepartment, reorderDepartments, updateDepartment } from '../../actions';
import { BackLink, Loading, UUID } from '../../ui';
import { AnchorSection } from '../anchor-section';
import { DepartmentForm } from '../department-form';
import { JobTitlesTable } from '../job-titles-table';
import { ReorderList } from '../reorder-list';

// Department → Team → Job title, and a job title may also belong to a department itself (owner's decision, 15 October
// 2026): a department's page lists its own job titles (e.g. Head of Marketing) and its teams; a team's page (a team is
// a department with a parent) lists its job titles, under a breadcrumb back to its department.

type Query = Record<string, string | string[] | undefined>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dash = <span className="text-muted">—</span>;

/**
 * The job titles directly in this department or team (`id`), with Add job title. `intro`: a line under the heading;
 * `empty`: what to say when it has none.
 */
function JobTitles({
  id,
  heading,
  intro,
  empty,
  jobTitles,
  canEdit,
}: {
  id: string;
  heading: string;
  intro?: string;
  empty: string;
  jobTitles: JobTitleSummary[];
  canEdit: boolean;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <h3 className="font-semibold">
            {heading} <span className="font-normal text-muted">· {jobTitles.length}</span>
          </h3>
          {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
        </div>
        {canEdit && (
          <Link href={`/organization/departments/${id}/job-titles/new`} className="btn btn-primary">
            Add job title
          </Link>
        )}
      </div>
      {jobTitles.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-sm text-muted">{empty}</p>
      ) : (
        <div className="border-t border-line">
          <JobTitlesTable jobTitles={jobTitles} />
        </div>
      )}
    </section>
  );
}

/** A department's teams, in their saved order, each with how many job titles it has. `canReorder`: Admin, 2+ teams. */
function Teams({ department, canEdit, canReorder }: { department: Department; canEdit: boolean; canReorder: boolean }) {
  const teams = department.children ?? [];
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <h3 className="font-semibold">
          Teams <span className="font-normal text-muted">· {teams.length}</span>
        </h3>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {canReorder && (
              <Link href={`/organization/departments/${department.id}?reorder=teams`} scroll={false} className="btn btn-secondary">
                Reorder teams
              </Link>
            )}
            <Link href={`/organization/departments/new?parentId=${department.id}`} className="btn btn-primary">
              Add team
            </Link>
          </div>
        )}
      </div>
      {teams.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-sm text-muted">
          No teams in this department yet. A team is a group inside it with job titles of its own, e.g. Content Team in Marketing.
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Arabic Name</th>
                <th>Job Titles</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/organization/departments/${t.id}`} className="font-medium">
                      {t.nameEn}
                    </Link>
                  </td>
                  <td lang="ar" dir="rtl" className="text-right">
                    {t.nameAr ?? dash}
                  </td>
                  <td className="text-muted tabular-nums">{t._count.jobTitles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function DepartmentDetails({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [user, department, jobTitles, departments, query] = await Promise.all([
    getCurrentUser(),
    apiGet<Department>(`/departments/${id}`),
    apiGet<JobTitleSummary[]>(`/job-titles?departmentId=${id}`),
    apiGet<Department[]>('/departments'),
    searchParams,
  ]);
  const canEdit = canEditOrganisation(user);
  const { parent } = department;
  const teams = department.children ?? [];
  // Admins put a department's teams in order (?reorder=teams).
  const canReorder = !parent && canReorderDepartments(user) && teams.length > 1;
  const kind = parent ? 'team' : 'department';
  const Kind = parent ? 'Team' : 'Department'; // in headings
  // Deleting is refused while it still has teams or job titles (and employees, which the API checks).
  const inside = [
    department._count.children > 0 && plural(department._count.children, 'team', 'teams'),
    department._count.jobTitles > 0 && plural(department._count.jobTitles, 'job title', 'job titles'),
  ].filter(Boolean);
  const them = department._count.children + department._count.jobTitles === 1 ? 'it' : 'them';

  return (
    <>
      <div>
        {parent && (
          <nav aria-label="Breadcrumb" className="mb-1 text-sm">
            <ol className="flex flex-wrap items-center gap-x-1.5">
              <li>
                <Link href={`/organization/departments/${parent.id}`}>{parent.nameEn}</Link>
              </li>
              <li className="text-muted">
                <span aria-hidden="true">› </span>
                <span aria-current="page">{department.nameEn}</span>
              </li>
            </ol>
          </nav>
        )}
        <h2 className="text-lg font-semibold">{department.nameEn}</h2>
        {department.nameAr && (
          <p lang="ar" dir="rtl" className="w-fit">
            {department.nameAr}
          </p>
        )}
      </div>

      {parent ? (
        <JobTitles id={id} heading="Job Titles" empty="No job titles in this team yet." jobTitles={jobTitles} canEdit={canEdit} />
      ) : (
        <JobTitles
          id={id}
          heading="Department-Level Job Titles"
          intro={`Job titles of ${department.nameEn} itself rather than of one of its teams, e.g. Head of ${department.nameEn}.`}
          empty={`No job titles of ${department.nameEn} itself yet.`}
          jobTitles={jobTitles}
          canEdit={canEdit}
        />
      )}

      {!parent &&
        (canReorder && query.reorder === 'teams' ? (
          <ReorderList
            title="Reorder Teams"
            hint={`Drag a team by its handle, or use Move up and Move down. The teams in ${department.nameEn} are listed in this order everywhere.`}
            items={teams.map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr }))}
            action={reorderDepartments.bind(null, id)}
            cancelHref={`/organization/departments/${id}`}
          />
        ) : (
          <Teams department={department} canEdit={canEdit} canReorder={canReorder} />
        ))}

      {canEdit && (
        <>
          <AnchorSection id="edit" className="space-y-2 pt-4">
            <h3 className="font-semibold">Edit {Kind}</h3>
            <DepartmentForm action={updateDepartment.bind(null, id)} department={department} departments={departments} />
          </AnchorSection>
          {/* only a Super Admin deletes (owner's decision, 15 October 2026) */}
          {canDelete(user) && (
            <section className="max-w-xl space-y-2 pt-4">
              <h3 className="font-semibold">Delete {Kind}</h3>
              {inside.length > 0 ? (
                <p className="text-sm text-muted">
                  This {kind} has {inside.join(' and ')}. Move or delete {them} first.
                </p>
              ) : (
                <DeleteForm
                  action={deleteDepartment.bind(null, id, department.parentId)}
                  confirmText={
                    parent
                      ? `Delete the ${department.nameEn} team in ${parent.nameEn}? This cannot be undone.`
                      : `Delete the ${department.nameEn} department? This cannot be undone.`
                  }
                  label={`Delete ${kind}`}
                />
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

export default function DepartmentPage({ params, searchParams }: PageProps<'/organization/departments/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/departments">Departments & Job Titles</BackLink>
      <Suspense fallback={<Loading />}>
        <DepartmentDetails params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
