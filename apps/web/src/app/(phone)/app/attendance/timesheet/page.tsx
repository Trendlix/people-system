import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { timesheetHoursText, timesheetWeekOf, timesheetWeekShift, timesheetWeekText } from '@trendlix/shared';
import { todayInCairo } from '@/lib/date-picker';
import { appTimesheetHref } from '@/lib/surface';
import { loadMyTimesheet } from '../../../../(app)/timesheets/data';
import { TimesheetForm } from '../../../../(app)/timesheets/timesheet-form';
import { weekFrom } from '../../../../(app)/timesheets/timesheets';
import { TimesheetStatusBadge } from '../../../../(app)/timesheets/ui';
import { PhoneWeekLines, WeekStanding } from '../../timesheet-week';
import { PageTitle, PhoneLoading } from '../../ui';

// My Timesheet on the phone pages (owner, 4 November 2026: "Timesheet in app/website"; asked "what is it waiting for?"
// of the phone pages in a browser, the same day): as the site's (app/(app)/my-timesheet), under Attendance. For someone
// HR switched to timesheets: the week (Sunday to Saturday) with the week before and after, where it stands and who
// approves it, why it was rejected, the weeks before still not sent, and the form to log each day's hours against a
// client or a task and send the week (the site's form, laid out for the phone); once sent or approved, its lines as they
// are. Anyone else is told why they don't log hours.

export const metadata: Metadata = { title: 'My Timesheet · Trendlix People' };

const Note = ({ children }: { children: React.ReactNode }) => <div className="card px-4 py-8 text-center text-sm text-muted">{children}</div>;

async function Week({ searchParams }: { searchParams: PageProps<'/app/attendance/timesheet'>['searchParams'] }) {
  // the address read first: the page is the caller's, never prerendered
  const asked = weekFrom((await searchParams).week);
  const today = todayInCairo();
  const thisWeek = timesheetWeekOf(today);
  const loaded = await loadMyTimesheet(asked ?? thisWeek);
  if (loaded.kind === 'unavailable') return <Note>Timesheets aren&apos;t available yet.</Note>;
  if (loaded.kind !== 'ok') return <Note>Your timesheet couldn&apos;t load. Please try again in a moment.</Note>;
  const view = loaded.value;
  if (view.refusal) return <Note>{view.refusal}</Note>;
  const after = timesheetWeekShift(view.weekStart, 1);
  const nav = 'btn btn-secondary min-h-11 flex-1 px-3 no-underline';
  return (
    <div className="space-y-4">
      <nav aria-label="Weeks" className="flex gap-2">
        <Link href={appTimesheetHref(timesheetWeekShift(view.weekStart, -1))} className={nav}>
          ‹ Before
        </Link>
        {view.weekStart !== thisWeek && (
          <Link href={appTimesheetHref(null)} className={nav}>
            This week
          </Link>
        )}
        {after <= thisWeek && (
          <Link href={appTimesheetHref(after)} className={nav}>
            After ›
          </Link>
        )}
      </nav>
      <section aria-label="The week" className="card space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold tabular-nums">{timesheetWeekText(view.weekStart)}</h2>
          <TimesheetStatusBadge status={view.status} />
        </div>
        <p className="text-sm text-muted tabular-nums">{timesheetHoursText(view.totalHours)} logged</p>
        <WeekStanding view={view} />
      </section>
      {view.unsent.length > 0 && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          Not sent yet:{' '}
          {view.unsent.map((w, i) => (
            <span key={w}>
              {i > 0 && ', '}
              <Link href={appTimesheetHref(w)} className="font-semibold text-warn">
                {timesheetWeekText(w)}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
      {view.can.edit ? <TimesheetForm key={`${view.weekStart}-${view.id ?? 'new'}-${view.status ?? ''}`} view={view} today={today} phone /> : <PhoneWeekLines view={view} />}
    </div>
  );
}

export default function PhoneTimesheetPage({ searchParams }: PageProps<'/app/attendance/timesheet'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="My Timesheet">Log each day&apos;s hours against a client or a task, then send the week for approval.</PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Week searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
