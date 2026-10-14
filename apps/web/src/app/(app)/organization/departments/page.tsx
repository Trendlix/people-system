import Link from 'next/link';
import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import { groupDepartments } from '@/lib/departments';
import { canEditOrganisation, getCurrentUser } from '@/lib/session';
import type { Department, JobTitleSummary } from '@/lib/types';
import { Empty, Loading } from '../ui';
import { JobTitlesTable } from './job-titles-table';

// Owner's words: Department → Team → Job title (e.g. Marketing → Content Team → Senior Content Creator). Each
// department is a card with its own job titles, then its teams with theirs. Every job title belongs to exactly one
// department or team.

type Query = Record<string, string | string[] | undefined>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The English or Arabic name contains the search text (already lower case). */
const nameMatches = (needle: string, ...names: (string | null)[]) => names.some((n) => n?.toLowerCase().includes(needle));

/** "3 job titles · 1 matching" */
const titleCount = (all: number, shown: number) => `${plural(all, 'job title', 'job titles')}${shown < all ? ` · ${shown} matching` : ''}`;

async function DepartmentsList({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, departments, jobTitles, query] = await Promise.all([
    getCurrentUser(),
    apiGet<Department[]>('/departments'),
    apiGet<JobTitleSummary[]>('/job-titles'),
    searchParams,
  ]);
  const canEdit = canEditOrganisation(user);
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';

  // The API sorts job titles by title within each department.
  const titlesOf = new Map<string, JobTitleSummary[]>();
  for (const j of jobTitles) {
    const list = titlesOf.get(j.departmentId);
    if (list) list.push(j);
    else titlesOf.set(j.departmentId, [j]);
  }

  const groups = groupDepartments(departments);
  const teamCount = departments.length - groups.length;

  // A search keeps a department whose name matches with everything in it, and a team whose name matches with all its
  // job titles; otherwise only the job titles that match (and the teams and departments they are in).
  const needle = q.toLowerCase();
  const named = (d: Department) => !needle || nameMatches(needle, d.nameEn, d.nameAr);
  const withTitles = (department: Department, whole: boolean) => {
    const all = titlesOf.get(department.id) ?? [];
    return { department, all, shown: whole ? all : all.filter((j) => nameMatches(needle, j.titleEn, j.titleAr)) };
  };
  const sections = groups.flatMap(({ department, teams }) => {
    const whole = named(department);
    const own = withTitles(department, whole);
    const shownTeams = teams.flatMap((t) => {
      const team = withTitles(t, whole || named(t));
      return whole || named(t) || team.shown.length > 0 ? [team] : [];
    });
    return whole || own.shown.length > 0 || shownTeams.length > 0 ? [{ ...own, teams: shownTeams, teamTotal: teams.length }] : [];
  });

  if (departments.length === 0) {
    return (
      <>
        {canEdit && (
          <div className="mb-4 flex justify-end">
            <Link href="/organization/departments/new" className="btn btn-primary">
              New department
            </Link>
          </div>
        )}
        <Empty>No departments yet.{canEdit && ' Create the first one, then add its teams and job titles.'}</Empty>
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="department-search" className="label">
              Search
            </label>
            <input
              id="department-search"
              name="q"
              type="search"
              maxLength={100}
              defaultValue={q}
              placeholder="Department, team or job title"
              className="input min-w-64"
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
          {q && (
            <Link href="/organization/departments" className="btn btn-secondary">
              Clear
            </Link>
          )}
        </form>
        {canEdit && (
          <Link href="/organization/departments/new" className="btn btn-primary">
            New department
          </Link>
        )}
      </div>

      {sections.length > 0 && (
        <p className="mb-3 text-sm text-muted">
          {q
            ? `${plural(sections.length, 'department', 'departments')} of ${groups.length} match “${q}”`
            : [
                plural(groups.length, 'department', 'departments'),
                teamCount > 0 && plural(teamCount, 'team', 'teams'),
                plural(jobTitles.length, 'job title', 'job titles'),
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      )}

      {sections.length === 0 ? (
        <Empty>
          No department, team or job title matches “{q}”. <Link href="/organization/departments">Show all</Link>
        </Empty>
      ) : (
        <div className="space-y-4">
          {sections.map(({ department: d, all, shown, teams, teamTotal }) => (
            <section key={d.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                <div className="min-w-0">
                  <h3 className="font-semibold">
                    <Link href={`/organization/departments/${d.id}`}>{d.nameEn}</Link>
                  </h3>
                  {d.nameAr && (
                    <p lang="ar" dir="rtl" className="w-fit">
                      {d.nameAr}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted">
                    {titleCount(all.length, shown.length)}
                    {teamTotal > 0 && ` · ${plural(teamTotal, 'team', 'teams')}`}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/organization/departments/${d.id}/job-titles/new`} className="btn btn-secondary">
                      Add job title
                    </Link>
                    <Link href={`/organization/departments/new?parentId=${d.id}`} className="btn btn-secondary">
                      Add team
                    </Link>
                    <Link href={`/organization/departments/${d.id}#edit`} className="btn btn-secondary">
                      Edit department
                    </Link>
                  </div>
                )}
              </div>
              {shown.length > 0 ? (
                <div className="border-t border-line">
                  <JobTitlesTable jobTitles={shown} />
                </div>
              ) : (
                all.length === 0 &&
                teamTotal === 0 && <p className="border-t border-line px-5 py-4 text-sm text-muted">No job titles or teams in this department yet.</p>
              )}

              {teams.length > 0 && (
                <div className="space-y-3 rounded-b-xl border-t border-line bg-canvas p-3 sm:p-4">
                  <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Teams in {d.nameEn}</h4>
                  {teams.map(({ department: t, all: teamAll, shown: teamShown }) => (
                    <section key={t.id} className="rounded-lg border border-line bg-card">
                      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <h5 className="font-semibold">
                            <Link href={`/organization/departments/${t.id}`}>{t.nameEn}</Link>
                          </h5>
                          {t.nameAr && (
                            <p lang="ar" dir="rtl" className="w-fit">
                              {t.nameAr}
                            </p>
                          )}
                          <p className="mt-1 text-sm text-muted">{titleCount(teamAll.length, teamShown.length)}</p>
                        </div>
                        {canEdit && (
                          <Link href={`/organization/departments/${t.id}/job-titles/new`} className="btn btn-secondary">
                            Add job title<span className="sr-only"> to {t.nameEn}</span>
                          </Link>
                        )}
                      </div>
                      {teamShown.length > 0 ? (
                        <div className="border-t border-line">
                          <JobTitlesTable jobTitles={teamShown} />
                        </div>
                      ) : (
                        teamAll.length === 0 && <p className="border-t border-line px-4 py-3 text-sm text-muted">No job titles in this team yet.</p>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export default function DepartmentsPage({ searchParams }: PageProps<'/organization/departments'>) {
  return (
    <Suspense fallback={<Loading />}>
      <DepartmentsList searchParams={searchParams} />
    </Suspense>
  );
}
