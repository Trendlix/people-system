import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { PersonAttendanceView } from '@/lib/attendance-types';
import type { MonthCorrectionsPart } from '@/lib/correction-types';
import { getCurrentUser } from '@/lib/session';
import { recordCorrection } from '../../corrections/actions';
import { CorrectionForm } from '../../corrections/correction-form';
import { correctsDays } from '../../corrections/corrections';
import { askedDate, correctionMonthOf } from '../../corrections/month';
import { loadPerson } from '../../data';
import { notLoaded } from '../../not-loaded';
import { todayInCairo } from '../../../employees/ui';
import { BackLink, Empty, Loading, UUID } from '../../../organization/ui';
import { StaffOnly } from '../../../staff-only';
import { joinShown } from '@/lib/hidden';

// HR corrects a day directly (owner's brief, 19 October 2026: "HR may also correct a day directly (with a reason,
// audited)"), from the person's month → the day: what is on record, what was wrong, the right times and why; approved at
// once, the day corrected keeping what it was, the month's draft payroll line refilled. Never HR's own day (someone else
// in HR corrects it), and a C-level person's only HR with Super Admin (the API's rules).

export const metadata: Metadata = { title: 'Correct a Day · People System' };

async function Correct({ params, searchParams }: { params: PageProps<'/attendance/[employeeId]/correct'>['params']; searchParams: PageProps<'/attendance/[employeeId]/correct'>['searchParams'] }) {
  const [{ employeeId }, query, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  if (!UUID.test(employeeId)) notFound();
  if (!correctsDays(user)) return <Empty>Only HR corrects a day directly. An employee asks for a correction from My Attendance.</Empty>;
  const today = todayInCairo();
  const date = askedDate(query);
  const month = (date ?? today).slice(0, 7);
  const loaded = await loadPerson(employeeId, month);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  const view = loaded.value as PersonAttendanceView & MonthCorrectionsPart;
  if (view.self) return <Empty>Someone else in HR corrects your own day, or ask for a correction from My Attendance.</Empty>;
  const data = correctionMonthOf(month, view);
  if (!data) return <Empty>Not available yet: the server does not have attendance corrections yet.</Empty>;
  const name = view.person.employee.fullNameEn;
  return (
    <div className="space-y-4">
      <p className="text-muted">
        {joinShown([name, view.person.employee.employeeCode, view.person.employee.department])}
      </p>
      <CorrectionForm action={recordCorrection} person={{ employeeId, name }} month={data} date={date} today={today} cancelHref={`/attendance/${employeeId}?month=${month}`} />
    </div>
  );
}

export default function CorrectDayPage({ params, searchParams }: PageProps<'/attendance/[employeeId]/correct'>) {
  return (
    <StaffOnly>
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <BackLink href="/attendance">Daily Attendance</BackLink>
          <h1 className="text-2xl font-semibold">Correct a Day</h1>
          <p className="text-muted">HR&apos;s correction, approved at once and in the audit log: the day keeps what it was, shown as corrected from it.</p>
        </div>
        <Suspense fallback={<Loading />}>
          <Correct params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </StaffOnly>
  );
}
