import Link from 'next/link';
import { Suspense } from 'react';
import { EMPLOYEE_STATUSES, LABELS, type EmployeeStatus } from '@trendlix/shared';
import { DepartmentOptions } from '@/components/department-options';
import { apiGet } from '@/lib/api';
import { departmentName, withTeams } from '@/lib/departments';
import { getCurrentUser } from '@/lib/session';
import type { Department, EmployeeSummary } from '@/lib/types';
import { Avatar, canAddEmployees, canSeeEmployeeFiles, Empty, Loading, seesEveryone, StatusBadge } from './ui';

// The directory filters on this server from the one GET /employees call (the API already limits it to the people
// the caller may see), so the status counts always match the list.

const UUID = /^[0-9a-f-]{36}$/i;

type Query = Record<string, string | string[] | undefined>;
type Filters = { q: string; departmentId: string; status: EmployeeStatus | '' };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

function readFilters(query: Query): Filters {
  const departmentId = one(query.departmentId);
  const status = one(query.status);
  return {
    q: one(query.q).trim().slice(0, 100),
    departmentId: UUID.test(departmentId) ? departmentId : '',
    status: (EMPLOYEE_STATUSES as readonly string[]).includes(status) ? (status as EmployeeStatus) : '',
  };
}

/** The directory URL for these filters, leaving out the empty ones. */
function directoryHref(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.departmentId) params.set('departmentId', f.departmentId);
  if (f.status) params.set('status', f.status);
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

function StatusChip({ href, label, count, active }: { href: string; label: string; count: number; active: boolean }) {
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

async function Directory({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, departments, everyone, query] = await Promise.all([
    getCurrentUser(),
    apiGet<Department[]>('/departments'),
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

  // Counts follow the search and department filters, so each chip shows how many rows it would list. A department
  // also covers the people in its teams.
  const inDepartment = f.departmentId ? withTeams(departments, f.departmentId) : null;
  const base = everyone.filter((e) => matches(e, f.q) && (!inDepartment || (e.department !== null && inDepartment.has(e.department.id))));
  const rows = f.status ? base.filter((e) => e.status === f.status) : base;
  const counts = new Map<EmployeeStatus, number>();
  for (const e of base) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  const statuses = EMPLOYEE_STATUSES.filter((s) => counts.has(s) || s === f.status);
  const filtered = Boolean(f.q || f.departmentId || f.status);

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
          <select id="employee-department" name="departmentId" defaultValue={f.departmentId} className="input min-w-56">
            <option value="">All departments</option>
            <DepartmentOptions departments={departments} />
          </select>
        </div>
        {f.status && <input type="hidden" name="status" value={f.status} />}
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {filtered && (
          <Link href="/employees" className="btn btn-secondary">
            Clear
          </Link>
        )}
      </form>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2 px-4 pb-4">
        <StatusChip href={directoryHref({ ...f, status: '' })} label="All" count={base.length} active={!f.status} />
        {statuses.map((s) => (
          <StatusChip key={s} href={directoryHref({ ...f, status: s })} label={LABELS.status[s]} count={counts.get(s) ?? 0} active={f.status === s} />
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
                <th>Department</th>
                <th>Job Title</th>
                <th>Manager</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={e.fullNameEn} />
                      <div className="min-w-0">
                        <Link href={`/employees/${e.id}`} className="font-semibold">
                          {e.fullNameEn}
                        </Link>
                        {e.workEmail && <div className="text-xs text-muted">{e.workEmail}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-muted tabular-nums">{e.employeeCode}</td>
                  <td>{e.department ? departmentName(e.department) : dash}</td>
                  <td>{e.jobTitle?.titleEn ?? dash}</td>
                  <td>{e.manager?.fullNameEn ?? dash}</td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        Showing {rows.length} of {everyone.length} {everyone.length === 1 ? 'employee' : 'employees'}
      </p>
    </section>
  );
}

/** HR and the CEO search the scanned paperwork; only HR adds employees. */
async function HeaderActions() {
  const user = await getCurrentUser();
  return (
    <div className="flex flex-wrap gap-3">
      {canSeeEmployeeFiles(user) && (
        <Link href="/employees/documents" className="btn btn-secondary">
          Search documents
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
    <>
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
    </>
  );
}
