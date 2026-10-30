import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MY_TEAM } from '@/components/nav';
import { groupByPlace, placeOrder } from '@/lib/place-groups';
import { loadPlaces } from '@/lib/places';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { monthName } from '../../payroll/list';
import { notImportedYetText, readAttendanceMonth, teamAttendanceHref } from '../../attendance/attendance';
import { loadMonth } from '../../attendance/data';
import { notLoaded } from '../../attendance/not-loaded';
import { PeopleTable } from '../../attendance/people-table';
import { MonthNav } from '../../attendance/ui';

// Team Attendance, from My Team (owner's brief, 19 October 2026: "managers and team leads see their team's attendance
// from My Team"): a month of the team's days kept, from their check-ins on the system (owner, 19 October 2026: "Check-in
// through the system (phone or web with the office location check, or a device) to replace Zoho") and Zoho People's
// imports, one row a person with the month's figures (the flagged check-ins among them), each opening to their days;
// read only. The team is as My Team has it: the direct reports, and for a team's lead or a department's head the people
// without a direct manager whose leave they decide (the API decides who). A C-level report (owner, 19 October 2026:
// "make C level Employees details not visible to HR") is one hidden row.

export const metadata: Metadata = { title: 'Team Attendance · People System' };

async function Team({ searchParams }: { searchParams: PageProps<'/my-team/attendance'>['searchParams'] }) {
  const month = readAttendanceMonth(await searchParams, todayInCairo());
  const [loaded, places] = await Promise.all([loadMonth(month), loadPlaces()]);
  if (loaded.kind === 'forbidden') return <Empty>Team Attendance is for direct managers and leads: no one reports to you at the moment.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'team attendance')}</Empty>;
  const view = loaded.value;
  return (
    <div className="space-y-6">
      <MonthNav month={month} hrefFor={teamAttendanceHref} />
      {view.people.length === 0 && !view.hidden ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{notImportedYetText(month)}</div>
      ) : (
        <PeopleTable groups={groupByPlace(view.people, (p) => p.employee.department, placeOrder(places))} month={month} link="profile" hidden={view.hidden?.label ?? null} />
      )}
      {view.withoutDays.length > 0 && (
        <p className="text-sm text-muted">
          No attendance kept for {monthName(month)}: {view.withoutDays.map((e) => e.fullNameEn).join(', ')}.
        </p>
      )}
    </div>
  );
}

export default function TeamAttendancePage({ searchParams }: PageProps<'/my-team/attendance'>) {
  return (
    <div className="max-w-7xl space-y-6">
      <div className="space-y-2">
        <BackLink href={MY_TEAM}>My Team</BackLink>
        <h1 className="page-title">Team Attendance</h1>
        <p className="max-w-3xl text-muted">
          Your team&apos;s days, from their check-ins on the system and Zoho People&apos;s imports: the hours within each person&apos;s shift, absent
          days, short hours, permission and leave; a check-in outside the work arrangement&apos;s rule is flagged. Open a row for its days.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Team searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
