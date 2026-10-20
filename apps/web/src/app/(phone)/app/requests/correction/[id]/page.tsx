import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CorrectionDetail } from '../../../../../(app)/attendance/corrections/[id]/correction';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): their own attendance
// correction, with every step, and Cancel while it may be: the site's page
// (attendance/corrections/[id]/correction.tsx), its back link to the phone pages' My Requests, and what is done on it
// coming back here.

export const metadata: Metadata = { title: 'Attendance Correction · Trendlix People' };

export default function PhoneRequestsCorrectionPage({ params, searchParams }: PageProps<'/app/requests/correction/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <CorrectionDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
