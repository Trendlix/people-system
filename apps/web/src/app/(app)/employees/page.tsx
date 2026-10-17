import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { END_REASON_LABELS, STANDING_LABELS, STANDINGS, type Standing } from '@trendlix/shared';
import { DepartmentOptions } from '@/components/department-options';
import { GroupHeading } from '@/components/group-heading';
import { Select } from '@/components/select';
import { apiGet } from '@/lib/api';
import { withTeams } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { showsDepartment } from '@/lib/place-groups';
import { getCurrentUser } from '@/lib/session';
import type { Department, EmployeeSummary, Grade } from '@/lib/types';
import { StaffOnly } from '../staff-only';
import { directorySections } from './directory-groups';
import { canSeeSalaryRaises, RAISES_PATH } from '../payroll/reports/salary-raises/salary-raises';
import { Avatar, canAddEmployees, Empty, gradeLabel, Loading, seesEveryone, StandingBadge } from './ui';

// Not an employee's: someone who is only an employee and/or a direct manager is sent to their dashboard, which links
// their own profile, and a manager's My Team their direct reports' (owner's decisions, 17 October 2026).
//
// The directory filters on this server from the one GET /employees call (the API already limits it to the people
// the caller may see), so the counts always match the list. Everyone keeps a profile: someone whose employment ended is
// a former employee, and someone added before being hired is not employed yet (their standing). The team, job title,
// grade and manager are the current employment's, and so are the department and grade filters.

const UUID = /^[0-9a-f-]{36}$/i;

type Query = Record<string, string | string[] | undefined>;
type Filters = { q: string; departmentId: string; gradeId: string; standing: Standing | '' };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

function readFilters(query: Query): Filters {
  const departmentId = one(query.departmentId);
  const gradeId = one(query.gradeId);
  // ?status= is how the filter was named before standings (Active, Probation, On leave and Notice period kept their names)
  const standing = one(query.standing) || one(query.status);
  return {
    q: one(query.q).trim().slice(0, 100),
    departmentId: UUID.test(departmentId) ? departmentId : '',
    gradeId: UUID.test(gradeId) ? gradeId : '',
    standing: (STANDINGS as readonly string[]).includes(standing) ? (standing as Standing) : '',
  };
}

/** The directory URL for these filters, leaving out the empty ones. */
function directoryHref(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.departmentId) params.set('departmentId', f.departmentId);
  if (f.gradeId) params.set('gradeId', f.gradeId);
  if (f.standing) params.set('standing', f.standing);
  const qs = params.toString();
  return qs ? `/employees?${qs}` : '/employees';
}

/** Name (English or Arabic), employee code or work email contains the search text. */
function matches(e: EmployeeSummary, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [e.fullNameEn, e.fullNameAr, e.employeeCode, e.workEmail ?? ''].some((v) => v.toLowerCase().includes(needle));
}

const chip = 'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold no-underline';

function StandingChip({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
    >
      {label}
      <span className={`tabular-nums ${active ? 'opacity-75' : 'text-muted'}`}>{count}</span>
    </Link>
  );
}

const dash = <span className="text-muted">—</span>;

/**
 * The team, job title, grade and manager columns: the current employment's. For a former employee, when and why they
 * left, across the four columns.
 */
function Placement({ employee: e }: { employee: EmployeeSummary }) {
  const job = e.employment;
  if (!job && e.lastEnded) {
    return (
      <td colSpan={3} className="text-muted">
        Left <span className="tabular-nums">{formatDate(e.lastEnded.endDate)}</span>
        {e.lastEnded.endReason && ` · ${END_REASON_LABELS[e.lastEnded.endReason]}`}
      </td>
    );
  }
  return (
    <>
      <td>{job?.jobTitle?.titleEn ?? dash}</td>
      <td className="whitespace-nowrap">{job?.grade ? gradeLabel(job.grade) : dash}</td>
      <td>{job?.manager?.fullNameEn ?? dash}</td>
    </>
  );
}

/** Employee, Code, Job Title, Grade, Manager and Standing: what a group's heading spans. */
const COLUMN_COUNT = 6;

async function Directory({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, departments, grades, everyone, query] = await Promise.all([
    getCurrentUser(),
    apiGet<Department[]>('/departments'),
    apiGet<Grade[]>('/grades'),
    apiGet<EmployeeSummary[]>('/employees'),
    searchParams,
  ]);
  const f = readFilters(query);
  const canAdd = canAddEmployees(user);

  if (everyone.length === 0) {
    return seesEveryone(user) || canAdd ? (
      <Empty>No employees yet. {canAdd && <Link href="/employees/new">Add the first employee.</Link>}</Empty>
    ) : (
      <Empty>No employee record uses your sign-in email ({user.email}) as its work email yet. Ask HR to add it to your profile.</Empty>
    );
  }

  // Counts follow the search, department and grade filters, so each chip shows how many rows it would list. A
  // department also covers the people in its teams. The grade is the employee's own, set on their employment. Both are
  // the current employment's: a former employee is in no department now.
  const inDepartment = f.departmentId ? withTeams(departments, f.departmentId) : null;
  const base = everyone.filter(
    (e) =>
      matches(e, f.q) &&
      (!inDepartment || (e.employment?.department != null && inDepartment.has(e.employment.department.id))) &&
      (!f.gradeId || e.employment?.grade?.id === f.gradeId),
  );
  const rows = f.standing ? base.filter((e) => e.standing === f.standing) : base;
  const sections = directorySections(rows);
  const counts = new Map<Standing, number>();
  for (const e of base) counts.set(e.standing, (counts.get(e.standing) ?? 0) + 1);
  const standings = STANDINGS.filter((s) => counts.has(s) || s === f.standing);
  const filtered = Boolean(f.q || f.departmentId || f.gradeId || f.standing);

  return (
    <section className="card">
      <form className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="employee-search" className="label">
            Search
          </label>
          <input
            id="employee-search"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={f.q}
            placeholder="Name, employee code or work email"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="employee-department" className="label">
            Department
          </label>
          <Select id="employee-department" name="departmentId" defaultValue={f.departmentId} className="input min-w-56">
            <option value="">All departments</option>
            <DepartmentOptions departments={departments} />
          </Select>
        </div>
        <div>
          <label htmlFor="employee-grade" className="label">
            Grade
          </label>
          <Select id="employee-grade" name="gradeId" defaultValue={f.gradeId} className="input min-w-44">
            <option value="">All grades</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {gradeLabel(g)}
              </option>
            ))}
          </Select>
        </div>
        {f.standing && <input type="hidden" name="standing" value={f.standing} />}
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {filtered && (
          <Link href="/employees" className="btn btn-secondary">
            Clear
          </Link>
        )}
      </form>

      <nav aria-label="Filter by standing" className="flex flex-wrap gap-2 px-4 pb-4">
        <StandingChip href={directoryHref({ ...f, standing: '' })} label="All" count={base.length} active={!f.standing} />
        {standings.map((s) => (
          <StandingChip
            key={s}
            href={directoryHref({ ...f, standing: s })}
            label={STANDING_LABELS[s]}
            count={counts.get(s) ?? 0}
            active={f.standing === s}
          />
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="border-t border-line px-4 py-10 text-center text-sm text-muted">
          No employees match these filters. <Link href="/employees">Clear filters</Link>
        </p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th>Job Title</th>
                <th>Grade</th>
                <th>Manager</th>
                <th>Standing</th>
              </tr>
            </thead>
            {/* Active, then Inactive, each by department, then team (owner's request, 16 October 2026) */}
            {sections.map((section) => (
              <tbody key={section.key}>
                <GroupHeading level="section" name={section.label} count={section.count} span={COLUMN_COUNT} note={section.note} />
                {section.groups.map((g) => (
                  <Fragment key={g.department ?? ''}>
                    {showsDepartment(section.groups, g) && <GroupHeading level="department" name={g.department} count={g.count} span={COLUMN_COUNT} />}
                    {g.teams.map((t) => (
                      <Fragment key={t.team ?? ''}>
                        {t.team !== null && <GroupHeading level="team" name={t.team} count={t.rows.length} span={COLUMN_COUNT} />}
                        {t.rows.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <div className="flex items-center gap-3">
                                <Avatar name={e.fullNameEn} photoId={e.photoId} crop={e.photoCrop} />
                                <div className="min-w-0">
                                  <Link href={`/employees/${e.id}`} className="font-semibold">
                                    {e.fullNameEn}
                                  </Link>
                                  {e.workEmail && <div className="text-xs text-muted">{e.workEmail}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap text-muted tabular-nums">{e.employeeCode}</td>
                            <Placement employee={e} />
                            <td>
                              <StandingBadge standing={e.standing} />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        Showing {rows.length} of {everyone.length} {everyone.length === 1 ? 'employee' : 'employees'}
      </p>
    </section>
  );
}

/**
 * HR and the CEO search the scanned paperwork and see what the profiles still lack (the Missing Details report); HR,
 * Finance and the CEO see the Salary Raises report, as salaries (owner's decision, 16 October 2026); HR and Admin see
 * what the card reader learned; only HR adds employees.
 */
async function HeaderActions() {
  const user = await getCurrentUser();
  return (
    <div className="flex flex-wrap gap-3">
      {/* Search Documents, Missing Details and Card Reading Fixes are under People in the sidebar (owner, 17 October 2026) */}
      {canSeeSalaryRaises(user) && (
        <Link href={RAISES_PATH} className="btn btn-secondary">
          Salary raises
        </Link>
      )}
      {canAddEmployees(user) && (
        <Link href="/employees/new" className="btn btn-primary">
          Add employee
        </Link>
      )}
    </div>
  );
}

export default function EmployeesPage({ searchParams }: PageProps<'/employees'>) {
  return (
    <StaffOnly>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Employees</h1>
          <p className="mt-1 text-muted">Directory and employee profiles.</p>
        </div>
        <Suspense fallback={null}>
          <HeaderActions />
        </Suspense>
      </div>
      <Suspense fallback={<Loading />}>
        <Directory searchParams={searchParams} />
      </Suspense>
    </StaffOnly>
  );
}
