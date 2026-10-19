import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LEAVE_PATH } from '@/components/nav';
import { actionablePeople } from '@/lib/confidential';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeProfile, EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../approvals/data';
import { noLeaveText } from '../../employees/employment-law';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { notLoadedText } from '../../payroll/load';
import { readEmployee } from '../../raise-requests/list';
import { recordLeave } from '../actions';
import { loadEmployeeLeave, loadHolidaysOf, loadLeaveTypes } from '../data';
import { NewLeaveForm } from '../leave-forms';
import { recordsLeave } from '../list';
import { offeredTypes, personFacts } from '../request';
import { LeaveEmployeePicker } from './employee-picker';

// Record leave, under Requests → Leave Requests (owner, 18 October 2026: HR records leave on an employee's behalf, e.g.
// sick leave reported afterwards): HR only. First who it is for, among everyone employed now (?employee=<id>, also from
// a profile), then the leave form as the employee has it, with their shift, balance and the holidays; it is recorded
// approved at once and logged as recorded by HR, with no notice needed. The API checks the type's rules, the balance and
// an overlap again. A C-level person HR sees only the card of isn't offered (owner, 19 October 2026: "make C level
// Employees details not visible to HR"): the API refuses their leave to HR; the CEO decides theirs.

export const metadata: Metadata = { title: 'Record Leave · People System' };

function Heading() {
  return (
    <div className="space-y-2">
      <BackLink href={LEAVE_PATH}>Leave Requests</BackLink>
      <h1 className="text-2xl font-semibold">Record Leave</h1>
      <p className="text-muted">
        Leave taken or to be taken by an employee, recorded by HR: approved at once, logged as recorded by HR, with no notice needed. It counts in
        their balance and in the month&apos;s payroll.
      </p>
    </div>
  );
}

async function Record({ searchParams }: { searchParams: PageProps<'/leave/record'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!recordsLeave(user)) return <Empty>Only HR records leave on an employee&apos;s behalf.</Empty>;
  const people = await getOrNull<EmployeeSummary[]>('/employees');
  if (!people) return <Empty>The employees couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  const employed = actionablePeople(people)
    .filter((p) => p.employment)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'))
    .map((p) => ({ id: p.id, label: `${p.fullNameEn} · ${p.employeeCode}` }));
  const asked = readEmployee(query);
  const chosen = asked && employed.some((p) => p.id === asked) ? asked : null;
  if (!chosen) return <LeaveEmployeePicker options={employed} chosen={null} />;

  const today = todayInCairo();
  const year = Number(today.slice(0, 4));
  const [profile, types, leave, holidays] = await Promise.all([
    getOrNull<EmployeeProfile>(`/employees/${chosen}`),
    loadLeaveTypes(),
    loadEmployeeLeave(chosen, year),
    loadHolidaysOf(year),
  ]);
  let form: React.ReactNode;
  // outside the labour law, a freelancer's or an intern's employment has no leave to record (18 and 19 October 2026)
  const noLeave = profile?.employment ? noLeaveText(profile.employment.employmentType) : null;
  if (!profile) form = <Empty>Their profile couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  else if (noLeave) form = <Empty>{noLeave}</Empty>;
  else if (types.kind === 'unavailable') form = <Empty>Not available yet: the server does not have leave yet.</Empty>;
  else if (types.kind !== 'ok') form = <Empty>{notLoadedText(types, 'types of leave')}</Empty>;
  else {
    const facts = personFacts(profile);
    const offered = offeredTypes(types.value, facts.gender);
    form = offered.length ? (
      <NewLeaveForm
        // a new form for each employee: nothing typed for one stays for the next
        key={chosen}
        action={recordLeave}
        types={offered}
        today={today}
        person={{ employeeId: chosen, ...facts }}
        initial={{ year, balances: leave.kind === 'ok' ? leave.value : null, holidays: holidays.kind === 'ok' ? holidays.value : [] }}
        cancelHref={LEAVE_PATH}
      />
    ) : (
      <Empty>No type of leave is on. Turn one on in Organization → Leave.</Empty>
    );
  }
  return (
    <>
      <LeaveEmployeePicker options={employed} chosen={chosen} />
      {form}
    </>
  );
}

export default function RecordLeavePage({ searchParams }: PageProps<'/leave/record'>) {
  return (
    <div className="max-w-3xl space-y-5">
      <Heading />
      <Suspense fallback={<Loading />}>
        <Record searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
