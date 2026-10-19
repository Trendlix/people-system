import type { Metadata } from 'next';
import { Suspense } from 'react';
import { actionablePeople } from '@/lib/confidential';
import { titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile, EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { todayInCairo } from '../../../employees/ui';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { notLoadedText } from '../../../payroll/load';
import { monthName } from '../../../payroll/list';
import { readEmployee } from '../../../raise-requests/list';
import { loadEmployeePermissionMonth } from '../../data';
import { recordPermission } from '../../permission-actions';
import { NewPermissionForm } from '../../permission-forms';
import { noPermissionText, PERMISSION_OFF_TEXT, RECORD_PERMISSION_PATH, recordsPermission, requestListHref } from '../../permissions';
import { LeaveEmployeePicker } from '../../record/employee-picker';
import { MyPermissionTable } from '../../ui';

// Record permission, under Requests → Leave Requests (owner, 19 October 2026: permission "In the system, like leave"; HR
// records it on an employee's behalf as it records leave): HR only. First who it is for, among everyone employed now
// (?employee=<id>), then the permission form as the employee has it, with their month's hours (GET
// /employees/:id/permissions) and their permission of the month below it; it is recorded approved at once and logged as
// recorded by HR, and its hours count as worked on the month's payroll line. The API checks the Leave Setup's hours, the
// day (their shift's rest days, the official holidays, their leave) again. A C-level person HR sees only the card of
// isn't offered (owner, 19 October 2026: "make C level Employees details not visible to HR"): the API refuses theirs to HR.

export const metadata: Metadata = { title: 'Record Permission · People System' };

const BACK = requestListHref(null, 'permission');

function Heading() {
  return (
    <div className="space-y-2">
      <BackLink href={BACK}>Leave Requests</BackLink>
      <h1 className="text-2xl font-semibold">Record Permission</h1>
      <p className="text-muted">
        Permission taken or to be taken by an employee, recorded by HR: approved at once and logged as recorded by HR. Its hours count as worked in the
        month&apos;s payroll, within the hours a month Leave Setup gives.
      </p>
    </div>
  );
}

async function Record({ searchParams }: { searchParams: PageProps<'/leave/permissions/record'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!recordsPermission(user)) return <Empty>Only HR records permission on an employee&apos;s behalf.</Empty>;
  const people = await getOrNull<EmployeeSummary[]>('/employees');
  if (!people) return <Empty>The employees couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  const employed = actionablePeople(people)
    .filter((p) => p.employment)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'))
    .map((p) => ({ id: p.id, label: `${p.fullNameEn} · ${p.employeeCode}` }));
  const asked = readEmployee(query);
  const chosen = asked && employed.some((p) => p.id === asked) ? asked : null;
  const picker = <LeaveEmployeePicker options={employed} chosen={chosen} action={RECORD_PERMISSION_PATH} what="permission" />;
  if (!chosen) return picker;

  const today = todayInCairo();
  const thisMonth = today.slice(0, 7);
  const [profile, month] = await Promise.all([getOrNull<EmployeeProfile>(`/employees/${chosen}`), loadEmployeePermissionMonth(chosen, thisMonth)]);
  // outside the labour law, a freelancer's or an intern's employment has no permission to record, as no leave (19 October 2026)
  const outside = profile?.employment ? noPermissionText(profile.employment.employmentType) : null;
  let form: React.ReactNode;
  if (!profile) form = <Empty>Their profile couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  else if (outside) form = <Empty>{outside}</Empty>;
  else if (month.kind === 'unavailable') form = <Empty>Not available yet: the server does not have permission yet.</Empty>;
  else if (month.kind !== 'ok') form = <Empty>{notLoadedText(month, 'permission hours')}</Empty>;
  else if (!(month.value.hoursPerMonth > 0)) form = <Empty>{PERMISSION_OFF_TEXT} Give hours a month in Organization → Leave.</Empty>;
  else {
    const { requests, ...figures } = month.value;
    form = (
      <>
        <NewPermissionForm
          // a new form for each employee: nothing typed for one stays for the next
          key={chosen}
          action={recordPermission}
          person={{ employeeId: chosen, name: profile.fullNameEn }}
          initial={figures}
          today={today}
          cancelHref={BACK}
        />
        {requests.length > 0 && (
          <section aria-labelledby="their-permission" className="card">
            <h2 id="their-permission" className="px-4 pt-4 font-semibold">
              {titleCase(`${profile.fullNameEn}'s permission in ${monthName(thisMonth)}`)}
            </h2>
            <MyPermissionTable requests={requests} />
          </section>
        )}
      </>
    );
  }
  return (
    <>
      {picker}
      {form}
    </>
  );
}

export default function RecordPermissionPage({ searchParams }: PageProps<'/leave/permissions/record'>) {
  return (
    <div className="max-w-3xl space-y-5">
      <Heading />
      <Suspense fallback={<Loading />}>
        <Record searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
