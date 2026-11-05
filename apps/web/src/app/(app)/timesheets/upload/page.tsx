import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../organization/ui';
import { TIMESHEETS_PATH, uploadsHoursForOthers } from '../timesheets';
import { uploadHoursForOthers } from '../upload-actions';
import { UploadHoursForm } from '../upload-form';
import { UploadSteps } from '../upload-steps';

// Uploading hours for others (owner, 5 November 2026: "how to upload a bulk time log?"; asked, "Our own Excel template",
// "each person and HR", and HR's "Sent to the approver"): HR, the CEO and a Super Admin upload the hours of those
// switched to timesheets (a C-level person's only those who see them, as the API checks), each person's weeks sent to
// whoever approves their timesheet, who approves or rejects them as any week.

export const metadata: Metadata = { title: 'Upload Hours · People System' };

async function Body() {
  const user = await getCurrentUser();
  if (!uploadsHoursForOthers(user)) return <Empty>Only HR, the CEO and a Super Admin upload hours for others.</Empty>;
  return (
    <div className="space-y-6">
      <UploadSteps own={false} />
      <UploadHoursForm action={uploadHoursForOthers} own={false} />
    </div>
  );
}

export default function UploadHoursForOthersPage() {
  return (
    <div className="space-y-4">
      <BackLink href={TIMESHEETS_PATH}>Timesheets</BackLink>
      <div>
        <h1 className="page-title">Upload Hours</h1>
        <p className="mt-1 text-sm text-muted">Upload the hours of those on timesheets from an Excel file; each week goes to whoever approves it.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Body />
      </Suspense>
    </div>
  );
}
