import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { timesheetHoursText, timesheetWeekText } from '@trendlix/shared';
import { formatDateTime } from '@/lib/format';
import { shownCode } from '@/lib/hidden';
import { APP_PATHS } from '@/lib/surface';
import { decideTimesheet } from '../../../../../(app)/timesheets/actions';
import { loadTimesheet } from '../../../../../(app)/timesheets/data';
import { TimesheetDecideForm } from '../../../../../(app)/timesheets/decide-form';
import { TimesheetStatusBadge } from '../../../../../(app)/timesheets/ui';
import { PhoneWeekLines, WeekStanding } from '../../../timesheet-week';
import { PhoneCard, PhoneLoading } from '../../../ui';

// A week of someone's hours on the phone pages (owner, 4 November 2026: "Direct manager, weekly"; the phone pages in a
// browser since the same day): whose, which week, its hours, where it stands, and (for the one it waits for) Approve or
// Reject with why, the site's own form; then its lines day by day. Its person, the one who approves it, HR and the CEO
// open it (as a notification opens it); anyone else: not found.

export const metadata: Metadata = { title: 'Timesheet · Trendlix People' };

const Note = ({ children }: { children: React.ReactNode }) => <div className="card px-4 py-8 text-center text-sm text-muted">{children}</div>;

async function Week({ params }: { params: PageProps<'/app/approve/timesheet/[id]'>['params'] }) {
  const { id } = await params;
  const loaded = await loadTimesheet(id);
  if (loaded.kind === 'unavailable') return <Note>This timesheet isn&apos;t there, or isn&apos;t yours to open.</Note>;
  if (loaded.kind !== 'ok') return <Note>The timesheet couldn&apos;t load. Please try again in a moment.</Note>;
  const v = loaded.value;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{v.employee.fullNameEn}</h1>
          <TimesheetStatusBadge status={v.status} />
        </div>
        <p className="text-sm text-muted tabular-nums">
          {shownCode(v.employee.employeeCode) && `${v.employee.employeeCode} · `}
          {timesheetWeekText(v.weekStart)} · {timesheetHoursText(v.totalHours)}
        </p>
        {v.submittedAt && <p className="text-xs text-muted">Sent {formatDateTime(v.submittedAt)}</p>}
      </div>
      <WeekStanding view={v} />
      {v.can.decide && (
        <PhoneCard title="Your Decision">
          <TimesheetDecideForm action={decideTimesheet.bind(null, v.id ?? id)} name={v.employee.fullNameEn} />
        </PhoneCard>
      )}
      <PhoneWeekLines view={v} />
    </div>
  );
}

export default function PhoneApproveTimesheetPage({ params }: PageProps<'/app/approve/timesheet/[id]'>) {
  return (
    <div className="space-y-2">
      <Link href={APP_PATHS.approve} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
        <span aria-hidden="true">←</span> To Approve
      </Link>
      <Suspense fallback={<PhoneLoading />}>
        <Week params={params} />
      </Suspense>
    </div>
  );
}
