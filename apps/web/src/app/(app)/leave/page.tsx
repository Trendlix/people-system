import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { GroupHeading } from '@/components/group-heading';
import { LEAVE_PATH } from '@/components/nav';
import { departmentOptions } from '@/lib/departments';
import { formatDateTime } from '@/lib/format';
import { actionablePeople } from '@/lib/confidential';
import { withCode } from '@/lib/hidden';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import { getCurrentUser } from '@/lib/session';
import type { Department, EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../approvals/data';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { notLoadedText } from '../payroll/load';
import { loadWfhCalendar } from '../attendance/wfh/data';
import { loadOdCalendar } from '../attendance/official-duty/data';
import { calendarDays, calendarPeople, monthRange, readDepartment, readMonth } from './calendar';
import { importsLeave, LEAVE_IMPORT_PATH } from './import/import';
import { LeaveCalendar } from './calendar-view';
import { loadHolidaysOf, loadLeaveCalendar, loadLeaveRequests, loadLeaveTypes, loadPermissions, type Loaded } from './data';
import {
  askerCount,
  canSeeLeaveRequests,
  LEAVE_FILTERS,
  leaveCalendarHref,
  NEW_LEAVE_PATH,
  placeOfEmployee,
  readLeaveFilter,
  readLeaveView,
  RECORD_LEAVE_PATH,
  recordsLeave,
  requestsLabel,
  type LeaveFilter,
  type LeaveView,
} from './list';
import {
  emptyRequestsText,
  isPermission,
  mergeRequests,
  NEW_PERMISSION_PATH,
  RECORD_PERMISSION_PATH,
  recordsPermission,
  requestHref,
  requestListHref,
  type RequestRow,
} from './permissions';
import { hasRequestFilters, kindOfFilters, leaveTypeOf, NO_FILTERS, NO_MATCH_TEXT, readRequestFilters, requestFiltersHref, typeChoices, type RequestFilters } from './request-filters';
import { RequestFiltersForm } from './request-filters-form';
import { LeaveProgress, LeaveStatusBadge, RequestWhen } from './ui';

// Leave Requests, under Requests in the sidebar (owner, 18 October 2026: "if we will work on the attendance and leaves,
// how will we build it?", leaves first; "can you apply the leaves according to the law?"): every employee's leave,
// newest first, filtered by status in the address (so a link keeps it): Waiting for you to start with for HR, who
// decides after the direct manager, and All for the CEO, who views them. Grouped by department, then team, as the other
// lists of people are. Each opens its page, with the documents, the log of every step and, while it waits for the user,
// the decision form. The Calendar shows a month of who is off (?view=calendar&month=2026-10&department=<id>), with the
// official holidays. HR records leave on an employee's behalf with Record leave, approved at once (e.g. sick leave
// reported afterwards); someone with an employee profile asks for their own with New leave. The API checks every request
// again. A C-level person's request (owner, 19 October 2026: "make C level Employees details not visible to HR") isn't
// listed to HR without Super Admin; the CEO decides its HR stage, so it says "With the CEO", is marked C-level for those
// who see it, and has Decide for the CEO when it waits for them (`waitingForYou`). Permission requests (owner, 19 October
// 2026: "this is an option given by us .. 4 hours per month with a maximum 2 hours per day", asked "In the system, like
// leave") are listed with the leave, decided the same way: each permission with its day and hours, opening its own page;
// Record permission for HR beside Record leave, New permission beside New leave; the calendar shows them as hours. An
// Employee and a Type filter beside the status (owner, 26 October 2026: "i need to filter either by employee or typ"; ?employee=
// and ?type=, kept with the status by each link, with Clear filters): the Type holds the leave types and Permission, and
// replaces the kind row (All · Leave · Permissions). Import leaves (owner, 21 October 2026:
// "how to import bulk leaves?") opens Import Leave for HR and the CEO: the template or Zoho People's leave export.

export const metadata: Metadata = { title: 'Leave Requests · People System' };

const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';
const tab = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline';
const SPAN = 6;

type Query = Record<string, string | string[] | undefined>;

const chipLook = (active: boolean) => `${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`;

/**
 * The status chips, each keeping the Employee and the Type chosen, and the Employee and Type filters, which keep the
 * status: the address keeps all three.
 */
function Filters({
  filter,
  filters,
  people,
  types,
}: {
  filter: LeaveFilter;
  filters: RequestFilters;
  people: readonly { id: string; label: string }[] | null;
  types: readonly { value: string; label: string }[];
}) {
  return (
    <div className="space-y-3">
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {LEAVE_FILTERS.map((o) => {
          const active = o.value === filter;
          return (
            <Link key={o.value} href={requestFiltersHref(o.value, filters)} aria-current={active ? 'page' : undefined} className={chipLook(active)}>
              {o.label}
            </Link>
          );
        })}
      </nav>
      <RequestFiltersForm status={filter} employeeId={filters.employeeId} type={filters.type} from={filters.from} to={filters.to} people={people} types={types} filtered={hasRequestFilters(filters)} />
    </div>
  );
}

/** Requests or Calendar, each keeping its own address. */
function Views({ view, month }: { view: LeaveView; month: string }) {
  const views: { key: LeaveView; label: string; href: string }[] = [
    { key: 'list', label: 'Requests', href: LEAVE_PATH },
    { key: 'calendar', label: 'Calendar', href: leaveCalendarHref(month) },
  ];
  return (
    <nav aria-label="Leave" className="flex gap-6 border-b border-line">
      {views.map((v) => (
        <Link
          key={v.key}
          href={v.href}
          aria-current={v.key === view ? 'page' : undefined}
          className={`${tab} ${v.key === view ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

function RequestsTable({ requests }: { requests: RequestRow[] }) {
  const groups = groupByPlace(requests, (r) => placeOfEmployee(r.employee));
  const heading = (rows: RequestRow[]) => ({ count: askerCount(rows), note: requestsLabel(rows.length) });
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Type</th>
            <th scope="col">When</th>
            <th scope="col">Status</th>
            <th scope="col">Where It Stands</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.department ?? ''}>
            {showsDepartment(groups, g) && <GroupHeading level="department" name={g.department} span={SPAN} {...heading(g.teams.flatMap((t) => t.rows))} />}
            {g.teams.map((t) => (
              <Fragment key={t.team ?? ''}>
                {t.team !== null && <GroupHeading level="team" name={t.team} span={SPAN} {...heading(t.rows)} />}
                {t.rows.map((r) => (
                  <tr key={`${isPermission(r) ? 'permission' : 'leave'}:${r.id}`} className={`align-top ${r.status === 'cancelled' ? 'text-muted' : ''}`}>
                    <td className="min-w-44">
                      <span className="font-semibold">{r.employee.fullNameEn}</span>
                      {r.confidential && (
                        <CLevelBadge className="ml-1.5" title={`The CEO decides HR’s stage of a C-level person’s ${isPermission(r) ? 'permission' : 'leave'}.`} />
                      )}
                      <div className="text-xs text-muted">
                        {r.recordedByHr ? 'Recorded by HR' : 'Sent'} {formatDateTime(r.createdAt)}
                      </div>
                    </td>
                    <td className="max-w-64 min-w-40">
                      <Link href={requestHref(r)} className="font-medium">
                        {r.type.nameEn}
                        <span className="sr-only"> for {r.employee.fullNameEn}</span>
                      </Link>
                      {r.reason && <p className="line-clamp-2 text-xs break-words text-muted">{r.reason}</p>}
                    </td>
                    <td className="min-w-44">
                      <RequestWhen request={r} />
                    </td>
                    <td>
                      <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                    </td>
                    <td className="min-w-56 text-sm">
                      <LeaveProgress request={r} />
                    </td>
                    <td className="text-right">
                      <Link href={requestHref(r)} className={r.waitingForYou ? 'btn btn-primary min-h-9 px-3' : 'text-sm font-semibold'}>
                        {r.waitingForYou ? 'Decide' : 'Open'}
                        <span className="sr-only">
                          {' '}
                          the {r.type.nameEn} request by {r.employee.fullNameEn}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        ))}
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(requests.length)}, newest first in each group.</p>
    </div>
  );
}

const NONE: Loaded<never[]> = { kind: 'ok', value: [] };

/**
 * The leave and the permission requests of the status, the employee and the type chosen, read together and merged,
 * newest first. An API from before permission (404) lists the leave alone; a list that couldn't be read is said, the
 * other still shown. The people to choose from are those the user sees (the directory without the C-level cards they can't
 * open), the types the leave types and Permission.
 */
async function RequestsList({ query, user }: { query: Query; user: Awaited<ReturnType<typeof getCurrentUser>> }) {
  const filter = readLeaveFilter(query, user);
  const asked = readRequestFilters(query);
  const [directory, leaveTypes] = await Promise.all([getOrNull<EmployeeSummary[]>('/employees'), loadLeaveTypes()]);
  const people = directory
    ? actionablePeople(directory)
        .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'))
        .map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }))
    : null;
  // a person or a type that isn't among the choices is no filter (a stale or hand-made address)
  const types = typeChoices(leaveTypes.kind === 'ok' ? leaveTypes.value : []);
  const filters: RequestFilters = {
    employeeId: asked.employeeId && (!people || people.some((p) => p.id === asked.employeeId)) ? asked.employeeId : null,
    type: asked.type && (leaveTypes.kind !== 'ok' || types.some((t) => t.value === asked.type)) ? asked.type : null,
    from: asked.from,
    to: asked.to,
  };
  const kind = kindOfFilters(filters);
  const [leave, permissions] = await Promise.all([
    kind === 'permission' ? NONE : loadLeaveRequests(filter, filters.employeeId, leaveTypeOf(filters), filters),
    kind === 'leave' ? NONE : loadPermissions(filter, filters.employeeId, filters),
  ]);
  const rows = mergeRequests(leave.kind === 'ok' ? leave.value : [], permissions.kind === 'ok' ? permissions.value : []);
  // a list not read: said in the list's place when it is the only one asked for, else above the other
  const problems = [
    leave.kind === 'failed' && notLoadedText(leave, 'leave requests'),
    permissions.kind === 'failed' && notLoadedText(permissions, 'permission requests'),
    kind === 'permission' && permissions.kind === 'unavailable' && 'Not available yet: the server does not have permission requests yet.',
  ].filter((p): p is string => typeof p === 'string');
  return (
    <div className="space-y-4">
      <Filters filter={filter} filters={filters} people={people} types={types} />
      {leave.kind === 'unavailable' && kind !== 'permission' ? (
        <Empty>Not available yet: the server does not have leave yet.</Empty>
      ) : leave.kind === 'forbidden' || permissions.kind === 'forbidden' ? (
        <Empty>Only HR and the CEO see everyone&apos;s leave and permission.</Empty>
      ) : (
        <>
          {problems.length > 0 && <Empty>{problems.join(' ')}</Empty>}
          {rows.length === 0 ? (
            problems.length === 0 && (
              <Empty>
                {hasRequestFilters(filters) ? NO_MATCH_TEXT : emptyRequestsText(filter, kind)}{' '}
                {hasRequestFilters(filters) ? (
                  <Link href={requestFiltersHref(filter, NO_FILTERS)}>Clear filters</Link>
                ) : (
                  filter !== 'all' && <Link href={requestListHref('all', kind)}>Show all</Link>
                )}
              </Empty>
            )
          ) : (
            <RequestsTable requests={rows} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * The month's calendar of who is off, for a department or everyone, with the holidays; and the work from home days, a
 * distinct style from leave (owner, 21 October 2026), none from an API from before them; and the official duties in
 * their own colour (owner, 23 October 2026; the spec: "Team calendar shows leave and OD").
 */
async function Calendar({ query, hr }: { query: Query; hr: boolean }) {
  const today = todayInCairo();
  const month = readMonth(query, today);
  const departmentId = readDepartment(query);
  const { from, to } = monthRange(month);
  const [entries, holidays, departments, wfh, od] = await Promise.all([
    loadLeaveCalendar(month, departmentId),
    loadHolidaysOf(Number(month.slice(0, 4))),
    getOrNull<Department[]>('/departments'),
    loadWfhCalendar(from, to, departmentId),
    loadOdCalendar(from, to, departmentId),
  ]);
  if (entries.kind !== 'ok') {
    return <Empty>{entries.kind === 'unavailable' ? 'Not available yet: the server does not have the leave calendar yet.' : notLoadedText(entries, 'calendar')}</Empty>;
  }
  const days = calendarDays(month, holidays.kind === 'ok' ? holidays.value : [], today);
  const people = calendarPeople([...entries.value, ...(wfh.kind === 'ok' ? wfh.value : []), ...(od.kind === 'ok' ? od.value : [])], days);
  return (
    <LeaveCalendar
      month={month}
      days={days}
      people={people}
      hrefFor={(m) => leaveCalendarHref(m, departmentId)}
      departments={departments && departmentOptions(departments)}
      departmentId={departmentId}
      showsWaiting={hr}
      filterAction={LEAVE_PATH}
      hidden={{ view: 'calendar', month }}
    />
  );
}

async function LeaveRequests({ searchParams }: { searchParams: PageProps<'/leave'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!canSeeLeaveRequests(user)) {
    return (
      <Empty>
        Only HR and the CEO see everyone&apos;s leave and permission. Your own is on <Link href="/my-requests">My Requests</Link>; a direct manager,
        team lead or head of department decides the requests waiting for them on <Link href="/my-team">My Team</Link>.
      </Empty>
    );
  }
  const view = readLeaveView(query);
  const month = readMonth(query, todayInCairo());
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Views view={view} month={month} />
        </div>
        <div className="flex flex-wrap gap-2 pb-1">
          {recordsLeave(user) && (
            <Link href={RECORD_LEAVE_PATH} className="btn btn-primary">
              Record leave
            </Link>
          )}
          {recordsPermission(user) && (
            <Link href={RECORD_PERMISSION_PATH} className="btn btn-primary">
              Record permission
            </Link>
          )}
          {/* importing leave in bulk (owner, 21 October 2026: "how to import bulk leaves?"): the template or Zoho's export */}
          {importsLeave(user) && (
            <Link href={LEAVE_IMPORT_PATH} className="btn btn-secondary">
              Import leaves
            </Link>
          )}
          {user.employeeId && (
            <>
              <Link href={NEW_LEAVE_PATH} className="btn btn-secondary">
                New leave
              </Link>
              <Link href={NEW_PERMISSION_PATH} className="btn btn-secondary">
                New permission
              </Link>
            </>
          )}
        </div>
      </div>
      {view === 'calendar' ? <Calendar query={query} hr={recordsLeave(user)} /> : <RequestsList query={query} user={user} />}
    </div>
  );
}

export default function LeaveRequestsPage({ searchParams }: PageProps<'/leave'>) {
  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Leave Requests</h1>
      <p className="mt-1 text-muted">
        Leave as the Labour Law gives it, of the types set up on <Link href="/organization/leave">Organization → Leave</Link>, and permission: a few
        hours away from a working day, within the hours a day and a month set there. The direct manager decides a request first (for someone without
        one, their team lead, else their department&apos;s head), then HR: each approves it or rejects it with a comment, and every step is logged
        on the request; a C-level person&apos;s goes to the CEO instead of HR. HR records leave and permission on an employee&apos;s behalf,
        approved at once. The calendar shows who is off each day of a month, and the hours of permission.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <LeaveRequests searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
