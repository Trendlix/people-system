import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CLevelBadge } from '@/components/c-level-badge';
import { cLevelTitle } from '@/lib/confidential';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { inDaysText } from '../dashboard/dashboard';
import { MY_TEAM } from '@/components/nav';
import { Empty, employeeRaiseRequestsHref, Loading, reportStanding, StandingBadge, todayInCairo } from '../employees/ui';
import { calendarDays, calendarPeople, readMonth } from '../leave/calendar';
import { LeaveCalendar } from '../leave/calendar-view';
import { loadHolidaysOf, loadLeaveCalendar, loadWaitingLeave, loadWaitingPermissions } from '../leave/data';
import { leaveCalendarHref, requestsLabel } from '../leave/list';
import { mergeRequests } from '../leave/permissions';
import { WaitingLeaveTable } from '../leave/ui';
import { loadOwnProfile } from '../own-profile';
import { notLoadedText } from '../payroll/load';
import { newRaiseRequestHref, progressText } from '../raise-requests/list';
import { RaiseRequestStatusBadge } from '../raise-requests/ui';
import { loadWaitingClaims } from '../reimbursements/data';
import { claimsLabel } from '../reimbursements/list';
import { WaitingClaimsTable } from '../reimbursements/ui';
import { TEAM_ATTENDANCE_PATH } from '../attendance/attendance';
import { loadTeam } from './data';
import { askedByText, latestRaise, probationOf } from './team';

// My Team (owner's decisions, 17 October 2026): a direct manager's direct reports, in their sidebar, so they reach
// their profiles (the Employees list isn't theirs any more). Each one with their job title and status, the probation
// end while on probation (highlighted when it is soon), and their latest raise request with where it stands (the
// manager is told, not asked, and sees no figure), with Request a raise when the manager may ask for one now: the form
// under Requests → Raise Requests with the report chosen (17 October 2026: "i think raising a request should be moved
// from the Employee tab to the raise requests tab"), else See the requests on their Salary sub-tab. The API decides who
// the manager may see, as everywhere. Reimbursements to Approve (owner, 18 October 2026: "allow the employee to add
// reimbursement request … for specific preset up conditions"): the claims waiting for the manager, the first of the
// three to decide them, each opening its page with the decision form. Leave to Approve (owner, 18 October 2026: "can
// you apply the leaves according to the law?"): the leave requests waiting for the manager, who decides them first, then
// HR; and the team's calendar, a month of who is off (?month=2026-10), with the official holidays. A department's head
// or a team's lead (owner, 19 October 2026: "i want to add department lead person, the person in charge") decides
// first the leave and claims of its people without a direct manager: theirs wait here too, each saying why. A C-level
// report (owner, 19 October 2026: "make C level Employees details not visible to HR") is their card alone: the name
// (opening the card), the job title and where they stand, nothing of their probation or raises. Permission requests
// (owner, 19 October 2026: "4 hours per month with a maximum 2 hours per day", asked "In the system, like leave") wait
// in Leave to Approve with the leave, decided the same way, and show on the team's calendar as hours. Team Attendance
// (owner, 19 October 2026: "the attendance is not active in the side menu"): the team's month of attendance from Zoho
// People's imports, on a page of its own (my-team/attendance).

export const metadata: Metadata = { title: 'My Team · People System' };

const dash = <span className="text-muted">—</span>;

async function Team() {
  const user = await getCurrentUser();
  const profile = await loadOwnProfile(user);
  if (!profile) return <NoProfile user={user} />;
  const team = await loadTeam(profile);
  const today = todayInCairo();
  if (team.length === 0) return <Empty>No one reports to you at the moment.</Empty>;

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Job Title</th>
            <th scope="col">Status</th>
            <th scope="col">Probation Ends</th>
            <th scope="col">Raise Requests</th>
          </tr>
        </thead>
        <tbody>
          {team.map(({ report: r, profile: theirs, restricted, raises }) => {
            const probation = probationOf(theirs?.employment, today);
            const latest = raises.kind === 'ok' ? latestRaise(raises.value.requests) : null;
            return (
              <tr key={r.id} className="align-top">
                <td>
                  <Link href={`/employees/${r.id}`} className="font-semibold">
                    {r.fullNameEn}
                  </Link>
                  {restricted && <CLevelBadge title={cLevelTitle(true)} className="ml-2" />}
                  <div className="text-xs text-muted tabular-nums">{r.employeeCode}</div>
                </td>
                <td>{r.jobTitle?.titleEn ?? dash}</td>
                <td>
                  {/* Trainee or Intern for a trainee's or an intern's Active (19 October 2026) */}
                  <StandingBadge standing={reportStanding(r)} />
                </td>
                <td className="whitespace-nowrap">
                  {probation ? (
                    <>
                      <span className={`tabular-nums ${probation.soon ? 'font-semibold text-warn' : ''}`}>{formatDate(probation.end)}</span>
                      {probation.soon && <span className="badge ml-1.5 bg-warn-soft text-warn">{inDaysText(probation.days)}</span>}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="min-w-64">
                  {restricted ? (
                    dash
                  ) : raises.kind === 'failed' ? (
                    <span className="text-sm text-muted">Couldn&apos;t load.</span>
                  ) : latest ? (
                    <div className="space-y-1 text-sm">
                      <RaiseRequestStatusBadge status={latest.status} />
                      <p className="text-xs text-muted">
                        Asked by {askedByText(latest, user.email)} on <span className="tabular-nums">{formatDate(latest.createdAt)}</span> ·{' '}
                        {progressText(latest).text}
                      </p>
                    </div>
                  ) : (
                    <span className="text-sm text-muted">None yet</span>
                  )}
                  {raises.kind === 'ok' && (latest || raises.value.canRequest) && (
                    <Link href={raises.value.canRequest ? newRaiseRequestHref(r.id) : employeeRaiseRequestsHref(r.id)} className="mt-1.5 block text-sm font-semibold">
                      {raises.value.canRequest ? 'Request a raise' : 'See the requests'}
                      <span className="sr-only"> for {r.fullNameEn}</span>
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-3 text-sm text-muted">
        {team.length} {team.length === 1 ? 'person reports' : 'people report'} to you
      </p>
    </div>
  );
}

/**
 * The claims waiting for the manager (GET /reimbursements?status=waiting), newest first: who, the type, the date and the
 * amount, each with Decide. Nothing from an API from before them.
 */
async function ToApprove() {
  const claims = await loadWaitingClaims();
  if (claims.kind === 'unavailable' || claims.kind === 'forbidden') return null;
  return (
    <section aria-labelledby="reimbursements-to-approve" className="space-y-3">
      <div>
        <h2 id="reimbursements-to-approve" className="text-lg font-semibold">
          Reimbursements to Approve
        </h2>
        <p className="text-sm text-muted">
          Your direct reports&apos; claims waiting for you, and those of people without a direct manager in a team you lead or a department you head.
          Approve one, approve a lower amount or reject it, with a comment; HR, then Finance, decide it after you.
        </p>
      </div>
      {claims.kind === 'failed' ? (
        <div className="card px-6 py-6 text-sm text-muted">The claims waiting for you couldn&apos;t be loaded. Please try again in a moment.</div>
      ) : claims.value.length === 0 ? (
        <div className="card px-6 py-6 text-sm text-muted">No claims are waiting for you.</div>
      ) : (
        <div className="card">
          <WaitingClaimsTable claims={claims.value} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{claimsLabel(claims.value.length)} waiting for you</p>
        </div>
      )}
    </section>
  );
}

/**
 * The leave and permission requests waiting for the manager (GET /leave/requests and GET /leave/permissions, each
 * ?status=waiting), newest first: who, the type (Permission), when (a permission's day and hours), each with Decide.
 * Nothing from an API from before leave; the leave alone from one before permission.
 */
async function LeaveToApprove() {
  const [leave, permissions] = await Promise.all([loadWaitingLeave(), loadWaitingPermissions()]);
  if (leave.kind === 'unavailable' || leave.kind === 'forbidden') return null;
  const failed = leave.kind === 'failed' || permissions.kind === 'failed';
  const requests = mergeRequests(leave.kind === 'ok' ? leave.value : [], permissions.kind === 'ok' ? permissions.value : []);
  return (
    <section aria-labelledby="leave-to-approve" className="space-y-3">
      <div>
        <h2 id="leave-to-approve" className="text-lg font-semibold">
          Leave to Approve
        </h2>
        <p className="text-sm text-muted">
          Your direct reports&apos; leave and permission requests waiting for you, and those of people without a direct manager in a team you lead
          or a department you head. Approve one, or reject it with a comment; HR decides it after you.
        </p>
      </div>
      {failed && (
        <div className="card px-6 py-6 text-sm text-muted">
          {leave.kind === 'failed' ? 'The leave requests' : 'The permission requests'} waiting for you couldn&apos;t be loaded. Please try again in a
          moment.
        </div>
      )}
      {requests.length === 0 ? (
        !failed && <div className="card px-6 py-6 text-sm text-muted">No leave or permission requests are waiting for you.</div>
      ) : (
        <div className="card">
          <WaitingLeaveTable requests={requests} />
          <p className="border-t border-line px-4 py-3 text-sm text-muted">{requestsLabel(requests.length)} waiting for you</p>
        </div>
      )}
    </section>
  );
}

/** The team's month of who is off (GET /leave/calendar: a manager's own team), with the official holidays. */
async function TeamCalendar({ searchParams }: { searchParams: PageProps<'/my-team'>['searchParams'] }) {
  const query = await searchParams;
  const today = todayInCairo();
  const month = readMonth(query, today);
  const [entries, holidays] = await Promise.all([loadLeaveCalendar(month), loadHolidaysOf(Number(month.slice(0, 4)))]);
  if (entries.kind === 'unavailable' || entries.kind === 'forbidden') return null;
  const days = calendarDays(month, holidays.kind === 'ok' ? holidays.value : [], today);
  return (
    <section id="team-calendar" aria-labelledby="team-calendar-heading" className="scroll-mt-6 space-y-3">
      <div>
        <h2 id="team-calendar-heading" className="text-lg font-semibold">
          Team Calendar
        </h2>
        <p className="text-sm text-muted">
          Who in your team is off each day of the month: approved leave, and the hours of approved permission, with the official holidays.
        </p>
      </div>
      {entries.kind === 'failed' ? (
        <div className="card px-6 py-6 text-sm text-muted">{notLoadedText(entries, 'team calendar')}</div>
      ) : (
        <LeaveCalendar
          month={month}
          days={days}
          people={calendarPeople(entries.value, days)}
          hrefFor={(m) => `${leaveCalendarHref(m, null, MY_TEAM)}#team-calendar`}
          departments={null}
          departmentId={null}
          showsWaiting={false}
          filterAction={MY_TEAM}
          hidden={{ month }}
        />
      )}
    </section>
  );
}

/** The way to the team's attendance (owner, 19 October 2026: "the attendance is not active in the side menu"). */
function TeamAttendance() {
  return (
    <section aria-labelledby="team-attendance-heading" className="space-y-3">
      <div>
        <h2 id="team-attendance-heading" className="text-lg font-semibold">
          Team Attendance
        </h2>
        <p className="text-sm text-muted">
          Your team&apos;s check-ins and check-outs month by month, as imported from Zoho People: the hours counted, absent days, short hours,
          permission and leave, each day of them.
        </p>
      </div>
      <Link href={TEAM_ATTENDANCE_PATH} className="btn btn-secondary no-underline">
        Open Team Attendance
      </Link>
    </section>
  );
}

export default function MyTeamPage({ searchParams }: PageProps<'/my-team'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">My Team</h1>
      <p className="mt-1 text-muted">
        The people who report to you now, their leave and permission requests and reimbursement claims waiting for you, their attendance, and who
        is off this month. Open a profile to see their details and their raise requests.
      </p>
      <div className="mt-6 space-y-8">
        <Suspense fallback={null}>
          <LeaveToApprove />
        </Suspense>
        <Suspense fallback={null}>
          <ToApprove />
        </Suspense>
        <Suspense fallback={<Loading />}>
          <Team />
        </Suspense>
        <TeamAttendance />
        <Suspense fallback={<Loading />}>
          <TeamCalendar searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
