import type { Metadata } from 'next';
import { Suspense } from 'react';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { monthName } from '../payroll/list';
import { figureTiles, myAttendanceHref, notImportedYetText, readAttendanceMonth } from '../attendance/attendance';
import { loadMine } from '../attendance/data';
import { notLoaded } from '../attendance/not-loaded';
import { DaysTable, FigureTiles, MonthNav } from '../attendance/ui';

// My Attendance (owner, 19 October 2026: "the attendance is not active in the side menu"): the employee's own month, in
// their sidebar after My Requests: their figures (days worked, hours counted, absent days, short hours, permission and
// leave) and every day kept from Zoho People's imports, read only, with the month before and after a click away. A
// C-level person sees their own as everyone does. The API answers only with the caller's own.

export const metadata: Metadata = { title: 'My Attendance · People System' };

async function Mine({ searchParams }: { searchParams: PageProps<'/my-attendance'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const month = readAttendanceMonth(await searchParams, todayInCairo());
  const loaded = await loadMine(month);
  if (loaded.kind === 'unavailable') return <NoProfile user={user} />;
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  const p = loaded.value.person;
  const imported = loaded.value.sources.map((s) => s.appliedAt ?? s.createdAt).sort().at(-1);
  return (
    <div className="space-y-6">
      <MonthNav month={month} hrefFor={myAttendanceHref} />
      {p.days.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-muted">{notImportedYetText(month)}</div>
      ) : (
        <>
          <FigureTiles label={`Your attendance in ${monthName(month)}`} tiles={figureTiles(p.figures, p)} />
          <section aria-labelledby="my-days-heading" className="space-y-3">
            <h2 id="my-days-heading" className="text-lg font-semibold">
              Your Days
            </h2>
            <div className="card">
              <DaysTable days={p.days} name="you" />
            </div>
          </section>
          {imported && (
            <p className="text-sm text-muted">
              From Zoho People, imported by HR on {formatDate(imported)}. Something wrong? Ask HR to check it.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function MyAttendancePage({ searchParams }: PageProps<'/my-attendance'>) {
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Attendance</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Your check-ins and check-outs as imported from Zoho People, counted by the company&apos;s rules: the hours within your shift, at most its hours a
          day; a working day without a check-in is an absent day; leave from your approved requests.
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Mine searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
