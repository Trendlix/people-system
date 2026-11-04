import type { Metadata } from 'next';
import { Suspense } from 'react';
import { timesheetHoursText, timesheetWeekText } from '@trendlix/shared';
import { formatDateTime } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { decideTimesheet } from '../actions';
import { loadTimesheet } from '../data';
import { TimesheetDecideForm } from '../decide-form';
import { TIMESHEETS_PATH } from '../timesheets';
import { TimesheetStatusBadge, WeekLines } from '../ui';

// A week of someone's hours (owner, 4 November 2026: "Direct manager, weekly"): whose, which week, where it stands, who
// approves it or decided it and why it was rejected, its lines day by day with the hours, and (for the one it waits for)
// Approve or Reject with why. Its person, the one who approves it, HR and the CEO open it; anyone else: not found.

export const metadata: Metadata = { title: 'Timesheet · People System' };

async function Week({ params }: { params: PageProps<'/timesheets/[id]'>['params'] }) {
  const { id } = await params;
  const loaded = await loadTimesheet(id);
  if (loaded.kind === 'unavailable') return <Empty>This timesheet isn&apos;t there, or isn&apos;t yours to open.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>The timesheet couldn&apos;t load. Please try again in a moment.</Empty>;
  const v = loaded.value;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{v.employee.fullNameEn}</h1>
          <TimesheetStatusBadge status={v.status} />
        </div>
        <p className="text-sm text-muted tabular-nums">
          {shownCode(v.employee.employeeCode) && `${v.employee.employeeCode} · `}
          {timesheetWeekText(v.weekStart)} · {timesheetHoursText(v.totalHours)}
          {v.submittedAt && ` · sent ${formatDateTime(v.submittedAt)}`}
        </p>
        {v.status === 'submitted' && !v.can.decide && <p className="text-sm text-muted">Waiting for {v.approver ? v.approver.fullNameEn : 'HR'} to approve it.</p>}
        {(v.status === 'approved' || v.status === 'rejected') && v.decidedBy && (
          <p className="text-sm text-muted">
            {v.status === 'approved' ? 'Approved' : 'Rejected'} by {v.decidedBy}
            {v.decidedAt && `, ${formatDateTime(v.decidedAt)}`}
          </p>
        )}
        {v.status === 'rejected' && v.rejectReason && (
          <p role="note" className="rounded-lg bg-danger-soft px-4 py-3 text-sm whitespace-pre-line text-danger">
            {v.rejectReason}
          </p>
        )}
      </div>
      {v.can.decide && (
        <section aria-labelledby="timesheet-decide" className="card space-y-3 p-6">
          <h2 id="timesheet-decide" className="text-lg font-semibold">
            Your Decision
          </h2>
          <TimesheetDecideForm action={decideTimesheet.bind(null, v.id ?? id)} name={v.employee.fullNameEn} />
        </section>
      )}
      <WeekLines view={v} />
    </div>
  );
}

export default function TimesheetPage({ params }: PageProps<'/timesheets/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href={TIMESHEETS_PATH}>Timesheets</BackLink>
      <Suspense fallback={<Loading />}>
        <Week params={params} />
      </Suspense>
    </div>
  );
}
