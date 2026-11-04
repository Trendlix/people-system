import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { timesheetHoursText, timesheetWeekOf, timesheetWeekShift, timesheetWeekText } from '@trendlix/shared';
import { todayInCairo } from '@/lib/date-picker';
import { Empty, Loading } from '../organization/ui';
import { loadMyTimesheet } from '../timesheets/data';
import { TimesheetForm } from '../timesheets/timesheet-form';
import { myTimesheetHref, weekFrom } from '../timesheets/timesheets';
import { TimesheetStatusBadge, WeekLines } from '../timesheets/ui';

// My Timesheet (owner, 4 November 2026: "i have a group of employees working on timesheets being paid per hour or
// monthly"; "Timesheet in app/website", "Direct manager, weekly", "Only those HR switches on"): for someone HR switched
// to timesheets, the week (Sunday to Saturday) with the week before and after, where it stands and who approves it, why
// it was rejected, the weeks before still not sent, and the form to log each day's hours against a client or a task
// and send the week; once sent or approved, its lines as they are. Anyone else is told why they don't log hours.

export const metadata: Metadata = { title: 'My Timesheet · People System' };

async function Week({ searchParams }: { searchParams: PageProps<'/my-timesheet'>['searchParams'] }) {
  // the address read first: the page is the caller's, never prerendered
  const asked = weekFrom((await searchParams).week);
  const today = todayInCairo();
  const thisWeek = timesheetWeekOf(today);
  const week = asked ?? thisWeek;
  const loaded = await loadMyTimesheet(week);
  if (loaded.kind === 'unavailable') return <Empty>Timesheets aren&apos;t available yet.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>Your timesheet couldn&apos;t load. Please try again in a moment.</Empty>;
  const view = loaded.value;
  if (view.refusal) return <Empty>{view.refusal}</Empty>;
  const after = timesheetWeekShift(view.weekStart, 1);
  return (
    <div className="space-y-6">
      <nav aria-label="Weeks" className="flex flex-wrap items-center gap-2">
        <Link href={myTimesheetHref(timesheetWeekShift(view.weekStart, -1))} className="btn btn-secondary min-h-9 px-3 no-underline">
          ‹ Week before
        </Link>
        {view.weekStart !== thisWeek && (
          <Link href={myTimesheetHref(null)} className="btn btn-secondary min-h-9 px-3 no-underline">
            This week
          </Link>
        )}
        {after <= thisWeek && (
          <Link href={myTimesheetHref(after)} className="btn btn-secondary min-h-9 px-3 no-underline">
            Week after ›
          </Link>
        )}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tabular-nums">{timesheetWeekText(view.weekStart)}</h2>
        <TimesheetStatusBadge status={view.status} />
        <span className="text-sm text-muted tabular-nums">{timesheetHoursText(view.totalHours)}</span>
      </div>
      {view.status === 'submitted' && <p className="text-sm text-muted">Waiting for {view.approver ? view.approver.fullNameEn : 'HR'} to approve it.</p>}
      {view.status === 'approved' && view.decidedBy && <p className="text-sm text-muted">Approved by {view.decidedBy}.</p>}
      {view.status === 'rejected' && (
        <div role="note" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          <p className="font-semibold">Rejected{view.decidedBy ? ` by ${view.decidedBy}` : ''}: correct it and send it again.</p>
          {view.rejectReason && <p className="whitespace-pre-line">{view.rejectReason}</p>}
        </div>
      )}
      {view.unsent.length > 0 && (
        <p role="note" className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          Not sent yet:{' '}
          {view.unsent.map((w, i) => (
            <span key={w}>
              {i > 0 && ', '}
              <Link href={myTimesheetHref(w)}>{timesheetWeekText(w)}</Link>
            </span>
          ))}
          .
        </p>
      )}
      {view.can.edit ? <TimesheetForm key={`${view.weekStart}-${view.id ?? 'new'}-${view.status ?? ''}`} view={view} today={today} /> : <WeekLines view={view} />}
    </div>
  );
}

export default function MyTimesheetPage({ searchParams }: PageProps<'/my-timesheet'>) {
  return (
    <div>
      <h1 className="page-title">My Timesheet</h1>
      <p className="mt-1 text-sm text-muted">Log each day&apos;s hours against a client or a task, then send the week for approval.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Week searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
