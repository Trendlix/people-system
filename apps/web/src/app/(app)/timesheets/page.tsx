import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { TIMESHEET_FILTERS, timesheetWeekText } from '@trendlix/shared';
import { getCurrentUser } from '@/lib/session';
import { Empty, Loading } from '../organization/ui';
import { loadTimesheets } from './data';
import { readTimesheetsQuery, TIMESHEET_FILTER_LABELS, TIMESHEETS_UPLOAD_PATH, timesheetsHref, uploadsHoursForOthers } from './timesheets';
import { TimesheetTable } from './ui';

// Timesheets (owner, 4 November 2026: "Direct manager, weekly"): the weeks of hours sent, by where they stand (those
// waiting for the user first): the one who approves a person's weeks sees those sent to them, HR and the CEO everyone's
// (a C-level person's only those who see them). Each opens its page, with Decide when it waits for the user. HR, the
// CEO and a Super Admin upload hours from Excel (owner, 5 November 2026: "how to upload a bulk time log?"): Upload hours.

export const metadata: Metadata = { title: 'Timesheets · People System' };

const chip = 'rounded-full border px-3 py-1 text-sm no-underline';
const ACTIVE = 'border-accent bg-accent-soft text-accent';
const IDLE = 'border-line bg-card text-ink';

async function Weeks({ searchParams }: { searchParams: PageProps<'/timesheets'>['searchParams'] }) {
  const q = readTimesheetsQuery(await searchParams);
  const loaded = await loadTimesheets(q);
  return (
    <div className="space-y-4">
      <nav aria-label="Timesheets by status" className="flex flex-wrap gap-2">
        {TIMESHEET_FILTERS.map((s) => (
          <Link key={s} href={timesheetsHref({ ...q, status: s })} className={`${chip} ${q.status === s ? ACTIVE : IDLE}`} aria-current={q.status === s ? 'page' : undefined}>
            {TIMESHEET_FILTER_LABELS[s]}
          </Link>
        ))}
      </nav>
      {q.week && (
        <p className="text-sm">
          The week of {timesheetWeekText(q.week)}. <Link href={timesheetsHref({ status: q.status })}>Every week</Link>
        </p>
      )}
      {loaded.kind === 'unavailable' ? (
        <Empty>Timesheets aren&apos;t available yet.</Empty>
      ) : loaded.kind === 'forbidden' ? (
        <Empty>Only those who approve timesheets, HR and the CEO see them.</Empty>
      ) : loaded.kind !== 'ok' ? (
        <Empty>The timesheets couldn&apos;t load. Please try again in a moment.</Empty>
      ) : loaded.value.length === 0 ? (
        <Empty>{q.status === 'waiting' ? 'No timesheets are waiting for you.' : 'No timesheets here.'}</Empty>
      ) : (
        <TimesheetTable weeks={loaded.value} />
      )}
    </div>
  );
}

/** Upload hours, for HR, the CEO and a Super Admin. */
async function UploadLink() {
  const user = await getCurrentUser();
  if (!uploadsHoursForOthers(user)) return null;
  return (
    <Link href={TIMESHEETS_UPLOAD_PATH} className="btn btn-secondary">
      Upload hours
    </Link>
  );
}

export default function TimesheetsPage({ searchParams }: PageProps<'/timesheets'>) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Timesheets</h1>
        <Suspense fallback={null}>
          <UploadLink />
        </Suspense>
      </div>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Weeks searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
