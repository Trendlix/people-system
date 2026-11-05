import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { timesheetWeekOf } from '@trendlix/shared';
import { todayInCairo } from '@/lib/date-picker';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { loadMyTimesheet } from '../../timesheets/data';
import { MY_TIMESHEET_PATH } from '../../timesheets/timesheets';
import { uploadMyHours } from '../../timesheets/upload-actions';
import { UploadHoursForm } from '../../timesheets/upload-form';
import { UploadSteps } from '../../timesheets/upload-steps';

// Uploading one's own hours (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel template",
// "each person and HR"): for someone on timesheets, the template, then the file: saved ("Upload and save") or saved and
// sent for approval. Anyone else is told why they don't log hours, as on My Timesheet.

export const metadata: Metadata = { title: 'Upload Hours · People System' };

async function Body() {
  // the page is the caller's, never prerendered: today is read after
  await connection();
  const loaded = await loadMyTimesheet(timesheetWeekOf(todayInCairo()));
  if (loaded.kind === 'unavailable') return <Empty>Timesheets aren&apos;t available yet.</Empty>;
  if (loaded.kind !== 'ok') return <Empty>Your timesheet couldn&apos;t load. Please try again in a moment.</Empty>;
  if (loaded.value.refusal) return <Empty>{loaded.value.refusal}</Empty>;
  return (
    <div className="space-y-6">
      <UploadSteps own />
      <UploadHoursForm action={uploadMyHours} own />
    </div>
  );
}

export default function UploadMyHoursPage() {
  return (
    <div className="space-y-4">
      <BackLink href={MY_TIMESHEET_PATH}>My Timesheet</BackLink>
      <div>
        <h1 className="page-title">Upload Hours</h1>
        <p className="mt-1 text-sm text-muted">Log many days at once from an Excel file, instead of typing them in week by week.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Body />
      </Suspense>
    </div>
  );
}
