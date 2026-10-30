import type { Metadata } from 'next';
import { Suspense } from 'react';
import { actionablePeople } from '@/lib/confidential';
import { withCode } from '@/lib/hidden';
import { getCurrentUser } from '@/lib/session';
import type { EmployeeSummary } from '@/lib/types';
import { getOrNull } from '../../../approvals/data';
import { LeaveEmployeePicker } from '../../../leave/record/employee-picker';
import { BackLink, Empty, Loading } from '../../../organization/ui';
import { readEmployee } from '../../../raise-requests/list';
import { recordCompensatory } from '../actions';
import { COMPENSATORY_PATH, compensatoryRulesOf, RECORD_COMPENSATORY_PATH, recordsCompensatory } from '../compensatory';
import { RecordCompensatoryForm as CompensatoryRecordForm } from '../compensatory-forms';
import { loadCompensatorySettings } from '../data';

// Record a compensatory day, under Attendance → Compensatory Days (owner, 26 October 2026: "my compensatory is a
// compensation with another day in the same month. and rarely to be compensated in cash"): HR only. First who it is for,
// among everyone employed now (?employee=<id>), then the days, a day off or cash instead (the Leave Setup's rate: "if paid
// in cash make it 1.5") and the reason; as the days are chosen, what refuses them and what they would be recorded past (a
// past day off, no check-in kept on the day worked), asked to confirm. It is recorded approved at once and logged as
// recorded by HR. A C-level person HR sees only the card of isn't offered: the API refuses theirs to HR. Part of a day
// worked (owner, 27 October 2026: "Hours off for hours worked"): its hours, earning hours off or their pay in cash by the
// Compensatory Setup's rules, read with the page.

export const metadata: Metadata = { title: 'Record a Compensatory Day · People System' };

function Heading() {
  return (
    <div className="space-y-2">
      <BackLink href={COMPENSATORY_PATH}>Compensatory Days</BackLink>
      <h1 className="page-title">Record a Compensatory Day</h1>
      <p className="text-muted">
        A compensatory day an employee earned, or hours off for part of a day, recorded by HR: approved at once and logged as recorded by HR, with your
        reason. A day off that is past is recorded with a warning; cash instead has no day off.
      </p>
    </div>
  );
}

async function Record({ searchParams }: { searchParams: PageProps<'/attendance/compensatory/record'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!recordsCompensatory(user)) return <Empty>Only HR records a compensatory day for someone.</Empty>;
  const people = await getOrNull<EmployeeSummary[]>('/employees');
  if (!people) return <Empty>The employees couldn&apos;t be loaded. Please try again in a moment.</Empty>;
  const employed = actionablePeople(people)
    .filter((p) => p.employment && p.id !== user.employeeId)
    .sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn, 'en'));
  const options = employed.map((p) => ({ id: p.id, label: withCode(p.fullNameEn, p.employeeCode) }));
  const asked = readEmployee(query);
  const chosen = asked ? (employed.find((p) => p.id === asked) ?? null) : null;
  const settings = chosen ? await loadCompensatorySettings() : null;
  return (
    <>
      <LeaveEmployeePicker options={options} chosen={chosen?.id ?? null} action={RECORD_COMPENSATORY_PATH} what="compensatory day" />
      {chosen && (
        <CompensatoryRecordForm
          // a new form for each employee: nothing typed for one stays for the next
          key={chosen.id}
          action={recordCompensatory}
          employee={{ id: chosen.id, name: chosen.fullNameEn }}
          cancelHref={COMPENSATORY_PATH}
          rules={settings?.kind === 'ok' ? compensatoryRulesOf(settings.value) : undefined}
        />
      )}
    </>
  );
}

export default function RecordCompensatoryPage({ searchParams }: PageProps<'/attendance/compensatory/record'>) {
  return (
    <div className="max-w-3xl space-y-5">
      <Heading />
      <Suspense fallback={<Loading />}>
        <Record searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
