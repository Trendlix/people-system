import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { GroupHeading } from '@/components/group-heading';
import { LEAVE_PATH } from '@/components/nav';
import { departmentOptions } from '@/lib/departments';
import { formatDateTime } from '@/lib/format';
import { groupByPlace, showsDepartment } from '@/lib/place-groups';
import { getCurrentUser } from '@/lib/session';
import type { Department, LeaveRequestView } from '@/lib/types';
import { getOrNull } from '../approvals/data';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { notLoadedText } from '../payroll/load';
import { calendarDays, calendarPeople, readDepartment, readMonth } from './calendar';
import { LeaveCalendar } from './calendar-view';
import { loadHolidaysOf, loadLeaveCalendar, loadLeaveRequests } from './data';
import {
  askerCount,
  canSeeLeaveRequests,
  daysText,
  emptyLeaveText,
  LEAVE_FILTERS,
  leaveCalendarHref,
  leaveHref,
  leaveListHref,
  NEW_LEAVE_PATH,
  periodText,
  placeOfEmployee,
  readLeaveFilter,
  readLeaveView,
  RECORD_LEAVE_PATH,
  recordsLeave,
  requestsLabel,
  type LeaveFilter,
  type LeaveView,
} from './list';
import { LeaveProgress, LeaveStatusBadge } from './ui';

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
// who see it, and has Decide for the CEO when it waits for them (`waitingForYou`).

export const metadata: Metadata = { title: 'Leave Requests · People System' };

const chip = 'inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold no-underline';
const tab = 'inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-semibold whitespace-nowrap no-underline';
const SPAN = 6;

type Query = Record<string, string | string[] | undefined>;

/** The status filter: one link per status, so the address keeps it. */
function Filters({ filter }: { filter: LeaveFilter }) {
  return (
    <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
      {LEAVE_FILTERS.map((o) => {
        const active = o.value === filter;
        return (
          <Link
            key={o.value}
            href={leaveListHref(o.value)}
            aria-current={active ? 'page' : undefined}
            className={`${chip} ${active ? 'border-ink bg-ink text-white hover:text-white' : 'border-line bg-white text-ink hover:bg-canvas hover:text-ink'}`}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
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

function RequestsTable({ requests }: { requests: LeaveRequestView[] }) {
  const groups = groupByPlace(requests, (r) => placeOfEmployee(r.employee));
  const heading = (rows: LeaveRequestView[]) => ({ count: askerCount(rows), note: requestsLabel(rows.length) });
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
                  <tr key={r.id} className={`align-top ${r.status === 'cancelled' ? 'text-muted' : ''}`}>
                    <td className="min-w-44">
                      <span className="font-semibold">{r.employee.fullNameEn}</span>
                      {r.confidential && <CLevelBadge className="ml-1.5" title="The CEO decides HR’s stage of a C-level person’s leave." />}
                      <div className="text-xs text-muted">
                        {r.recordedByHr ? 'Recorded by HR' : 'Sent'} {formatDateTime(r.createdAt)}
                      </div>
                    </td>
                    <td className="max-w-64 min-w-40">
                      <Link href={leaveHref(r.id)} className="font-medium">
                        {r.type.nameEn}
                        <span className="sr-only"> for {r.employee.fullNameEn}</span>
                      </Link>
                      {r.reason && <p className="line-clamp-2 text-xs break-words text-muted">{r.reason}</p>}
                    </td>
                    <td className="min-w-44">
                      <span className="whitespace-nowrap tabular-nums">{periodText(r)}</span>
                      <span className="block text-xs text-muted tabular-nums">{daysText(r.days)}</span>
                    </td>
                    <td>
                      <LeaveStatusBadge status={r.status} confidential={r.confidential} />
                    </td>
                    <td className="min-w-56 text-sm">
                      <LeaveProgress request={r} />
                    </td>
                    <td className="text-right">
                      <Link href={leaveHref(r.id)} className={r.waitingForYou ? 'btn btn-primary min-h-9 px-3' : 'text-sm font-semibold'}>
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

async function RequestsList({ query, user }: { query: Query; user: Awaited<ReturnType<typeof getCurrentUser>> }) {
  const filter = readLeaveFilter(query, user);
  const listing = await loadLeaveRequests(filter);
  return (
    <div className="space-y-4">
      <Filters filter={filter} />
      {listing.kind === 'unavailable' ? (
        <Empty>Not available yet: the server does not have leave yet.</Empty>
      ) : listing.kind === 'forbidden' ? (
        <Empty>Only HR and the CEO see everyone&apos;s leave.</Empty>
      ) : listing.kind === 'failed' ? (
        <Empty>{notLoadedText(listing, 'leave requests')}</Empty>
      ) : listing.value.length === 0 ? (
        <Empty>
          {emptyLeaveText(filter)} {filter !== 'all' && <Link href={leaveListHref('all')}>Show all</Link>}
        </Empty>
      ) : (
        <RequestsTable requests={listing.value} />
      )}
    </div>
  );
}

/** The month's calendar of who is off, for a department or everyone, with the holidays. */
async function Calendar({ query, hr }: { query: Query; hr: boolean }) {
  const today = todayInCairo();
  const month = readMonth(query, today);
  const departmentId = readDepartment(query);
  const [entries, holidays, departments] = await Promise.all([
    loadLeaveCalendar(month, departmentId),
    loadHolidaysOf(Number(month.slice(0, 4))),
    getOrNull<Department[]>('/departments'),
  ]);
  if (entries.kind !== 'ok') {
    return <Empty>{entries.kind === 'unavailable' ? 'Not available yet: the server does not have the leave calendar yet.' : notLoadedText(entries, 'calendar')}</Empty>;
  }
  const days = calendarDays(month, holidays.kind === 'ok' ? holidays.value : [], today);
  const people = calendarPeople(entries.value, days);
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
        Only HR and the CEO see everyone&apos;s leave. Your own is on <Link href="/my-requests">My Requests</Link>; a direct manager, team lead or
        head of department decides the requests waiting for them on <Link href="/my-team">My Team</Link>.
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
          {user.employeeId && (
            <Link href={NEW_LEAVE_PATH} className="btn btn-secondary">
              New leave
            </Link>
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
        Leave as the Labour Law gives it, of the types set up on <Link href="/organization/leave">Organization → Leave</Link>. The direct manager
        decides a request first (for someone without one, their team lead, else their department&apos;s head), then HR: each approves it or rejects
        it with a comment, and every step is logged on the request; a C-level person&apos;s goes to the CEO instead of HR. HR records leave on
        an employee&apos;s behalf, approved at once. The calendar shows who is off each day of a month.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <LeaveRequests searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
