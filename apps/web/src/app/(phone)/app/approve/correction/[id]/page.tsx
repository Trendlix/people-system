import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CorrectionDetail } from '../../../../../(app)/attendance/corrections/[id]/correction';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve from the phone"): a
// attendance correction waiting for the caller, with their decision (Approve, or Reject with a comment) and every step:
// the site's page (attendance/corrections/[id]/correction.tsx), its back link to the phone pages' To Approve, and what
// is done on it coming back here.

export const metadata: Metadata = { title: 'Attendance Correction · Trendlix People' };

export default function PhoneApproveCorrectionPage({ params, searchParams }: PageProps<'/app/approve/correction/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <CorrectionDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
