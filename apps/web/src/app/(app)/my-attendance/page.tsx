import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import type { MonthCorrectionsPart } from '@/lib/correction-types';
import { formatDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { NoProfile } from '../dashboard/cards';
import { todayInCairo } from '../employees/ui';
import { Empty, Loading } from '../organization/ui';
import { monthName } from '../payroll/list';
import { figureTiles, myAttendanceHref, notImportedYetText, readAttendanceMonth, type PunchRow } from '../attendance/attendance';
import { askCorrectionHref, MY_CORRECTIONS_HREF } from '../attendance/corrections/corrections';
import { DayCorrectionCell } from '../attendance/corrections/day-cell';
import { loadMine } from '../attendance/data';
import { notLoaded } from '../attendance/not-loaded';
import { DaysTable, FigureTiles, MonthNav } from '../attendance/ui';
import { TodayCheckIn } from './check-in-card';

// My Attendance (owner, 19 October 2026: "the attendance is not active in the side menu"): the employee's own month, in
// their sidebar after My Requests: their figures (days worked, hours counted, absent days, short hours, permission and
// leave) and every day kept, read only, with the month before and after a click away. A C-level person sees their own as
// everyone does. The API answers only with the caller's own. Checking in on the system (owner, 19 October 2026: "Check-in
// through the system (phone or web with the office location check, or a device) to replace Zoho"): Today's Check in /
// Check out at the top, above the month, and the days from their check-ins as well as Zoho People's imports. Attendance
// corrections (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"): each day's
// Ask for a correction (or the correction being decided), a corrected day shown "corrected from …", and every press of
// the day under it.

export const metadata: Metadata = { title: 'My Attendance · People System' };

async function Mine({ searchParams }: { searchParams: PageProps<'/my-attendance'>['searchParams'] }) {
  const user = await getCurrentUser();
  if (!user.employeeId) return <NoProfile user={user} />;
  const month = readAttendanceMonth(await searchParams, todayInCairo());
  const loaded = await loadMine(month);
  if (loaded.kind === 'unavailable') return <NoProfile user={user} />;
  if (loaded.kind !== 'ok') return <Empty>{notLoaded(loaded, 'attendance')}</Empty>;
  const view = loaded.value as typeof loaded.value & MonthCorrectionsPart & { punches?: PunchRow[] };
  const p = view.person;
  const imported = view.sources.map((s) => s.appliedAt ?? s.createdAt).sort().at(-1);
  const today = todayInCairo();
  // attendance corrections (19 October 2026): an API from before them has none of these, and no column shows
  const corrections = view.corrections;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} hrefFor={myAttendanceHref} />
        {corrections && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {view.correctable?.allowed && (
              <Link href={askCorrectionHref(null)} className="btn btn-secondary min-h-11 no-underline">
                Ask for a correction
              </Link>
            )}
            <Link href={MY_CORRECTIONS_HREF} className="text-sm font-semibold">
              My corrections
            </Link>
          </div>
        )}
      </div>
      {corrections && view.correctable && !view.correctable.allowed && view.correctable.reason && (
        <p className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">{view.correctable.reason}</p>
      )}
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
              <DaysTable
                days={p.days}
                name="you"
                punches={view.punches ?? []}
                // working from home (21 October 2026): those days say so
                wfhDays={p.wfhDays ?? []}
                action={
                  corrections
                    ? (d) => <DayCorrectionCell day={d} corrections={corrections} correctable={view.correctable} today={today} href={askCorrectionHref} label="Ask for a correction" />
                    : undefined
                }
              />
            </div>
          </section>
          <p className="text-sm text-muted">
            {imported && `Days from Zoho People imported by HR on ${formatDate(imported)}. `}
            {corrections
              ? 'A day that isn’t right (a check-in or check-out forgotten, a time wrong, work away from the office)? Ask for a correction on its row: your manager, then HR, decide it.'
              : 'Something wrong? Ask HR to check it.'}
          </p>
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
          Your check-ins and check-outs, on the system and from Zoho People&apos;s imports, counted by the company&apos;s rules: the hours within your
          shift, at most its hours a day; a working day without a check-in is an absent day; leave from your approved requests.
        </p>
      </div>
      {/* checking in on the system (19 October 2026): today's, above the month */}
      <Suspense fallback={null}>
        <TodayCheckIn className="max-w-3xl" />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <Mine searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
