import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { END_REASON_LABELS, STANDING_LABELS, STANDINGS, type Standing } from '@trendlix/shared';
import { CLevelBadge } from '@/components/c-level-badge';
import { DepartmentOptions } from '@/components/department-options';
import { GroupHeading } from '@/components/group-heading';
import { Hidden, Shown } from '@/components/hidden';
import { Select } from '@/components/select';
import { apiGet } from '@/lib/api';
import { cLevelTitle } from '@/lib/confidential';
import { withTeams } from '@/lib/departments';
import { formatDate } from '@/lib/format';
import { employmentHidden, filtersByJob } from '@/lib/hidden';
import { placeOrder, showsDepartment } from '@/lib/place-groups';
import { ACCESS_FILTERS, accessBadgeClass, accessLabel, invitableIds, matchesAccess, readAccessFilter, WITHOUT_CONTRACT_LABEL, type AccessFilter } from '@/lib/access';
import { getCurrentUser } from '@/lib/session';
import type { Department, EmployeeSummary, Grade } from '@/lib/types';
import { StaffOnly } from '../staff-only';
import { directorySections, hiddenPlace } from './directory-groups';
import { CARD_FIXES_PATH } from './paperwork';
import { canSeeSalaryRaises, RAISES_PATH } from '../payroll/reports/salary-raises/salary-raises';
import { CONTRACT_TONE_STYLE, directoryContractStatus } from './contract-status';
import { INVITE_FORM_ID, InviteBar } from './invite-bar';
import { Avatar, canAddEmployees, canSeeCardFixes, canSeeEmployeeFiles, Empty, gradeLabel, Loading, seesEveryone, StandingBadge, todayInCairo } from './ui';

// Not an employee's: someone who is only an employee and/or a direct manager is sent to their dashboard, which links
// their own profile, and a manager's My Team their direct reports' (owner's decisions, 17 October 2026).
//
// The directory filters on this server from the one GET /employees call (the API already limits it to the people
// the caller may see), so the counts always match the list. Everyone keeps a profile: someone whose employment ended is
// a former employee, and someone added before being hired is not employed yet (their standing). The team, job title,
// grade and manager are the current employment's, and so are the department and grade filters. A C-level person (owner,
// 19 October 2026: "make C level Employees details not visible to HR") is marked so; for those who see only their card
// (`restricted`), the row has its name, photo, work email, job title, department or team and standing, the contract, the
// grade and the manager a dash, and the name opens the card. The Contract column is where the employee code was (owner,
// 21 October 2026: "instead of the Emp code, add contract status"); the search still finds a code. The Access column
// (owner, 22 October 2026: "any active employee with active contract should have access"), for HR, an Admin and a Super
// Admin: where each one's sign-in stands, with a filter, and Send invitations to those ticked or to everyone not invited.

const UUID = /^[0-9a-f-]{36}$/i;

type Query = Record<string, string | string[] | undefined>;
type Filters = { q: string; departmentId: string; gradeId: string; standing: Standing | ''; access: AccessFilter };

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/**
 * The filters in the address. A developer's never narrow by department or grade (owner, 22 October 2026: "Hide per-person
 * details"): those are hidden from them, so filtering by them would say who is where.
 */
function readFilters(query: Query, byJob = true): Filters {
  const departmentId = byJob ? one(query.departmentId) : '';
  const gradeId = byJob ? one(query.gradeId) : '';
  // ?status= is how the filter was named before standings (Active, Probation, On leave and Notice period kept their names)
  const standing = one(query.standing) || one(query.status);
  return {
    q: one(query.q).trim().slice(0, 100),
    departmentId: UUID.test(departmentId) ? departmentId : '',
    gradeId: UUID.test(gradeId) ? gradeId : '',
    standing: (STANDINGS as readonly string[]).includes(standing) ? (standing as Standing) : '',
    access: readAccessFilter(one(query.access)),
  };
}

/** The directory URL for these filters, leaving out the empty ones. */
function directoryHref(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.departmentId) params.set('departmentId', f.departmentId);
  if (f.gradeId) params.set('gradeId', f.gradeId);
  if (f.standing) params.set('standing', f.standing);
  if (f.access) params.set('access', f.access);
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
 * left, across the four columns. A C-level person's card has no grade nor manager (left out by the API): a dash.
 */
function Placement({ employee: e }: { employee: EmployeeSummary }) {
  const job = e.employment;
  if (!job && e.lastEnded) {
    return (
      <td colSpan={3} className="text-muted">
        Left {e.lastEnded.endDate && <span className="tabular-nums">{formatDate(e.lastEnded.endDate)}</span>}
        {e.lastEnded.endReason && ` · ${END_REASON_LABELS[e.lastEnded.endReason]}`}
      </td>
    );
  }
  return (
    <>
      <td>{job?.jobTitle ? <Shown text={job.jobTitle.titleEn} /> : dash}</td>
      <td className="whitespace-nowrap">{job?.grade ? <Shown text={gradeLabel(job.grade)} /> : dash}</td>
      <td>{job?.manager?.fullNameEn ?? dash}</td>
    </>
  );
}

/**
 * The contract status, in place of the employee code (owner, 21 October 2026: "instead of the Emp code, add contract
 * status"; "State + end date"): "Signed · ends 31/12/2026", "On probation until 15/01/2027", "Draft, not signed" …, in
 * amber within 30 days of an end. A dash on a C-level person's card, which has none of it.
 */
function ContractCell({ employee, today }: { employee: EmployeeSummary; today: string }) {
  // a developer gets no contract dates (22 October 2026: "Hide per-person details")
  if (employmentHidden(employee.employment))
    return (
      <td>
        <Hidden />
      </td>
    );
  const status = directoryContractStatus(employee, today);
  if (!status) return <td>{dash}</td>;
  return <td className={`tabular-nums ${CONTRACT_TONE_STYLE[status.tone]}`}>{status.text}</td>;
}

/** Employee, Contract, Job Title, Grade, Manager and Standing: what a group's heading spans (Access adds one). */
const COLUMN_COUNT = 6;

/** Where their sign-in stands, and a box to tick them for Send invitations when they have an account and no invitation. */
function AccessCell({ employee: e }: { employee: EmployeeSummary }) {
  const a = e.restricted ? null : e.access;
  if (!a) return <td>{dash}</td>;
  return (
    <td className="whitespace-nowrap">
      <span className="inline-flex items-center gap-2">
        {a.state === 'not_invited' && (
          <input type="checkbox" name="employeeIds" value={e.id} form={INVITE_FORM_ID} aria-label={`Invite ${e.fullNameEn}`} className="size-4 accent-accent" />
        )}
        <span className={accessBadgeClass(a.state)}>{accessLabel(a.state)}</span>
      </span>
      {a.withoutContract && <div className="mt-1 text-xs text-warn">{WITHOUT_CONTRACT_LABEL}</div>}
    </td>
  );
}

async function Directory({ searchParams }: { searchParams: Promise<Query> }) {
  const [user, departments, grades, everyone, query] = await Promise.all([
    getCurrentUser(),
    apiGet<Department[]>('/departments'),
    apiGet<Grade[]>('/grades'),
    apiGet<EmployeeSummary[]>('/employees'),
    searchParams,
  ]);
  const byJob = filtersByJob(user);
  const f = readFilters(query, byJob);
  const canAdd = canAddEmployees(user);
  // after the data has loaded: it reads the clock
  const today = todayInCairo();

  if (everyone.length === 0) {
    return seesEveryone(user) || canAdd ? (
      <Empty>No employees yet. {canAdd && <Link href="/employees/new">Add the first employee.</Link>}</Empty>
    ) : (
      <Empty>Your account ({user.email}) isn’t linked to an employee profile yet. Ask HR.</Empty>
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
      (!f.gradeId || e.employment?.grade?.id === f.gradeId) &&
      matchesAccess(e.restricted ? null : e.access, f.access),
  );
  const rows = f.standing ? base.filter((e) => e.standing === f.standing) : base;
  // departments and teams in the order set on Organization (owner, 19 October 2026)
  // a developer's in one group: where each works is hidden (22 October 2026)
  const sections = directorySections(rows, placeOrder(departments), byJob ? undefined : hiddenPlace);
  const counts = new Map<Standing, number>();
  for (const e of base) counts.set(e.standing, (counts.get(e.standing) ?? 0) + 1);
  const standings = STANDINGS.filter((s) => counts.has(s) || s === f.standing);
  const filtered = Boolean(f.q || f.departmentId || f.gradeId || f.standing || f.access);
  // the Access column: the API sends it to HR, an Admin and a Super Admin only
  const showAccess = everyone.some((e) => !e.restricted && e.access !== undefined);
  const columns = COLUMN_COUNT + (showAccess ? 1 : 0);

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
        {byJob && (
          <>
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
          </>
        )}
        {showAccess && (
          <div>
            <label htmlFor="employee-access" className="label">
              Access
            </label>
            <Select id="employee-access" name="access" defaultValue={f.access} className="input min-w-44">
              <option value="">Any access</option>
              {ACCESS_FILTERS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
        )}
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
                <th>Contract</th>
                <th>Job Title</th>
                <th>Grade</th>
                <th>Manager</th>
                <th>Standing</th>
                {showAccess && <th>Access</th>}
              </tr>
            </thead>
            {/* Active, then Inactive, each by department, then team (owner's request, 16 October 2026) */}
            {sections.map((section) => (
              <tbody key={section.key}>
                <GroupHeading level="section" name={section.label} count={section.count} span={columns} note={section.note} />
                {section.groups.map((g) => (
                  <Fragment key={g.department ?? ''}>
                    {showsDepartment(section.groups, g) && <GroupHeading level="department" name={g.department} count={g.count} span={columns} />}
                    {g.teams.map((t) => (
                      <Fragment key={t.team ?? ''}>
                        {t.team !== null && <GroupHeading level="team" name={t.team} count={t.rows.length} span={columns} />}
                        {t.rows.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <div className="flex items-center gap-3">
                                <Avatar name={e.fullNameEn} photoId={e.photoId} crop={e.photoCrop} />
                                <div className="min-w-0">
                                  <Link href={`/employees/${e.id}`} className="font-semibold">
                                    {e.fullNameEn}
                                  </Link>
                                  {e.confidential && <CLevelBadge title={cLevelTitle(e.restricted)} className="ml-2" />}
                                  {e.workEmail && <div className="text-xs text-muted">{e.workEmail}</div>}
                                </div>
                              </div>
                            </td>
                            <ContractCell employee={e} today={today} />
                            <Placement employee={e} />
                            <td>
                              <StandingBadge standing={e.standing} />
                            </td>
                            {showAccess && <AccessCell employee={e} />}
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

      {showAccess && <InviteBar notInvited={invitableIds(everyone.map((e) => ({ id: e.id, access: e.restricted ? null : e.access }))).length} />}

      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        Showing {rows.length} of {everyone.length} {everyone.length === 1 ? 'employee' : 'employees'}
      </p>
    </section>
  );
}

/**
 * HR and the CEO search the scanned paperwork; HR, Finance and the CEO see the Salary Raises report, as salaries
 * (owner's decision, 16 October 2026); only HR adds employees. What the card reader learned is seen by HR and Admin:
 * HR opens it from the ID card scan, an Admin who doesn't scan cards from here (owner, 18 October 2026, taking it and
 * Search Documents out of the sidebar as not used every day; Missing Details is under People in the sidebar).
 */
async function HeaderActions() {
  const user = await getCurrentUser();
  return (
    <div className="flex flex-wrap gap-3">
      {canSeeEmployeeFiles(user) && (
        <Link href="/employees/documents" className="btn btn-secondary">
          Search documents
        </Link>
      )}
      {canSeeSalaryRaises(user) && (
        <Link href={RAISES_PATH} className="btn btn-secondary">
          Salary raises
        </Link>
      )}
      {canSeeCardFixes(user) && !canAddEmployees(user) && (
        <Link href={CARD_FIXES_PATH} className="btn btn-secondary">
          Card reading fixes
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
