import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { PersonAttendanceView } from '@/lib/attendance-types';
import type { MonthCorrectionsPart } from '@/lib/correction-types';
import { getCurrentUser } from '@/lib/session';
import { askCorrection } from '../../attendance/corrections/actions';
import { CorrectionForm } from '../../attendance/corrections/correction-form';
import { askedDate, correctionMonthOf } from '../../attendance/corrections/month';
import { loadMine } from '../../attendance/data';
import { notLoaded } from '../../attendance/not-loaded';
import { NoProfile } from '../../dashboard/cards';
import { todayInCairo } from '../../employees/ui';
import { BackLink, Empty, Loading } from '../../organization/ui';

// Ask for a correction (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"), from My
// Attendance → the day: the employee's own day (?date=, chosen from the day's row), what is on record for it, what was
// wrong, the right times and why. It goes to their direct manager (without one, their lead), then HR; a C-level
// person's HR stage to the CEO. The API checks the day, the month's payroll and a correction already asked for again.

export const metadata: Metadata = { title: 'Ask for a Correction · People System' };

async function Ask({ searchParams }: { searchParams: PageProps<'/my-attendance/correct'>['searchParams'] }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  if (!user.employeeId) return <NoProfile user={user} />;
  const today = todayInCairo();
  const date = askedDate(query);
  const month = (date ?? today).slice(0, 7);
  const loaded = await loadMine(month);
  if (loaded.kind === 'unavailable') return <NoProfile user={user} />;
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  const view = loaded.value as PersonAttendanceView & MonthCorrectionsPart;
  const data = correctionMonthOf(month, view);
  if (!data) return <Empty>Not available yet: the server does not have attendance corrections yet.</Empty>;
  return (
    <CorrectionForm
      action={askCorrection}
      person={{ employeeId: null, name: view.person.employee.fullNameEn }}
      month={data}
      date={date}
      today={today}
      cancelHref={`/my-attendance?month=${month}`}
      toCeo={view.person.employee.confidential}
    />
  );
}

export default function AskCorrectionPage({ searchParams }: PageProps<'/my-attendance/correct'>) {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <BackLink href="/my-attendance">My Attendance</BackLink>
        <h1 className="text-2xl font-semibold">Ask for a Correction</h1>
        <p className="text-muted">
          A day that isn&apos;t right: you forgot to check in or out, a time is wrong, or you worked remotely or at a client. Your direct manager (or
          lead) decides it, then HR; approved, the day is corrected and keeps what it was.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Ask searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
