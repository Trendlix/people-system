import type { Metadata } from 'next';
import { Suspense } from 'react';
import { actionablePeople } from '@/lib/confidential';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { LeaveEmployeePicker } from '../../../leave/record/employee-picker';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { readEmployee } from '../../../raise-requests/list';
import { recordWfh } from '../actions';
import { RECORD_WFH_PATH, recordsWfh, WFH_PATH } from '../wfh';
import { RecordWfhForm } from '../wfh-forms';
import { withCode } from '@/lib/hidden';

// Record a WFH day, under Attendance → Work From Home (owner, 21 October 2026: "think about how should we handle the
// working from home in out erp"; HR records a day for someone, past, the same day or over the limit, "with a warning and
// a reason"): HR only. First who it is for, among everyone employed now (?employee=<id>), then the day and the reason;
// as the day is chosen, what refuses it (not a working office day of theirs, a holiday, a day of leave, a day already
// theirs) and what it would be recorded past (no day's notice, the month's days, the days between two), asked to confirm.
// It is recorded approved at once and logged as recorded by HR, its warnings kept with it and in the audit log. A
// C-level person HR sees only the card of isn't offered: the API refuses theirs to HR.

export const metadata: Metadata = { title: 'Record a WFH Day · People System' };

function Heading() {
  return (
    <div className="space-y-2">
      <BackLink href={WFH_PATH}>Work From Home</BackLink>
      <h1 className="text-2xl font-semibold">Record a WFH Day</h1>
      <p className="text-muted">
        A day an employee works or worked from home, recorded by HR: approved at once and logged as recorded by HR, with your reason. Past the day&apos;s
        notice or the limits it is recorded with a warning, kept with it.
      </p>
    </div>
  );
}

async function Record({ searchParams }: { searchParams: PageProps<'/attendance/wfh/record'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!recordsWfh(user)) return <Empty>Only HR records a work from home day for someone.</Empty>;
  const people = await getOrNull<EmployeeSummary[]>('/employees');
  if (!people) return <Empty>The employees couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  const employed = actionablePeople(people)
    .filter((p) => p.employment && p.id !== user.employeeId)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'));
  const options = employed.map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }));
  const asked = readEmployee(query);
  const chosen = asked ? (employed.find((p) => p.id === asked) ?? null) : null;
  return (
    <>
      <LeaveEmployeePicker options={options} chosen={chosen?.id ?? null} action={RECORD_WFH_PATH} what="work from home day" />
      {chosen && (
        <RecordWfhForm
          // a new form for each employee: nothing typed for one stays for the next
          key={chosen.id}
          action={recordWfh}
          employee={{ id: chosen.id, name: chosen.fullNameEn }}
          cancelHref={WFH_PATH}
        />
      )}
    </>
  );
}

export default function RecordWfhPage({ searchParams }: PageProps<'/attendance/wfh/record'>) {
  return (
    <div className="max-w-3xl space-y-5">
      <Heading />
      <Suspense fallback={<Loading />}>
        <Record searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
