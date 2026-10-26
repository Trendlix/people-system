import type { Metadata } from 'next';
import { Suspense } from 'react';
import { recordsOdFor } from '@trendlix/shared';
import { actionablePeople } from '@/lib/confidential';
import { withCode } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { LeaveEmployeePicker } from '../../../leave/record/employee-picker';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { readEmployee } from '../../../raise-requests/list';
import { recordOd } from '../actions';
import { OD_PATH, RECORD_OD_PATH, recordsOd } from '../od';
import { RecordOdForm } from '../od-forms';

// Record Official Duty, under Attendance → Official Duty (owner, 26 October 2026, asked "how to apply or import official
// duty": "HR records it"), modelled on Record a WFH Day: HR, and the CEO for a C-level person. First who it is for, among
// everyone employed now the user may record for (?employee=<id>), then the days (from–to), a full day or part of one,
// where and why; as the days are chosen, what refuses them (a rest day or holiday on its own, leave, a work from home
// day, another official duty or a compensatory day off on them, hours outside the shift, a month whose payroll is with
// the CEO, approved or paid) and what they would be recorded past (more than 3 days after the first day), asked to
// confirm. It is recorded approved at once and logged as recorded by HR, the employee told, its warnings kept with it and
// in the audit log. A C-level person HR sees only the card of isn't offered: the API refuses theirs to HR.

export const metadata: Metadata = { title: 'Record Official Duty · People System' };

function Heading() {
  return (
    <div className="space-y-2">
      <BackLink href={OD_PATH}>Official Duty</BackLink>
      <h1 className="text-2xl font-semibold">Record Official Duty</h1>
      <p className="text-muted">
        Official duty an employee is on or was on, recorded by HR: approved at once and logged as recorded by HR, with your reason, and the employee is
        told. More than 3 days after its first day it is recorded with a warning, kept with it. On its days they check in from where they are, and the
        days count as attended for its hours.
      </p>
    </div>
  );
}

async function Record({ searchParams }: { searchParams: PageProps<'/attendance/official-duty/record'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!recordsOd(user)) return <Empty>Only HR records official duty for someone, and the CEO a C-level person&apos;s.</Empty>;
  const people = await getOrNull<EmployeeSummary[]>('/employees');
  if (!people) return <Empty>The employees couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  const employed = actionablePeople(people)
    .filter((p) => p.employment && p.id !== user.employeeId && recordsOdFor(user, p.confidential === true))
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'));
  if (!employed.length) return <Empty>There is nobody you record official duty for: the CEO records a C-level person&apos;s, HR everyone else&apos;s.</Empty>;
  const options = employed.map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }));
  const asked = readEmployee(query);
  const chosen = asked ? (employed.find((p) => p.id === asked) ?? null) : null;
  return (
    <>
      <LeaveEmployeePicker options={options} chosen={chosen?.id ?? null} action={RECORD_OD_PATH} what="official duty" />
      {chosen && (
        <RecordOdForm
          // a new form for each employee: nothing typed for one stays for the next
          key={chosen.id}
          action={recordOd}
          employee={{ id: chosen.id, name: chosen.fullNameEn }}
          cancelHref={OD_PATH}
        />
      )}
    </>
  );
}

export default function RecordOdPage({ searchParams }: PageProps<'/attendance/official-duty/record'>) {
  return (
    <div className="max-w-3xl space-y-5">
      <Heading />
      <Suspense fallback={<Loading />}>
        <Record searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
