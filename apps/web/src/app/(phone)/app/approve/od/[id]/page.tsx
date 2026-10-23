import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OdRequestDetail } from '../../../../../(app)/attendance/official-duty/[id]/od-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 23 October 2026: "Manager, then HR"): an official duty request waiting for the caller,
// with their decision (Approve, or Reject with a comment) and every step: the site's page
// (attendance/official-duty/[id]/od-request.tsx), its back link to the phone pages' To Approve, and what is done on it
// coming back here.

export const metadata: Metadata = { title: 'Official Duty · Trendlix People' };

export default function PhoneApproveOdPage({ params, searchParams }: PageProps<'/app/approve/od/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <OdRequestDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
