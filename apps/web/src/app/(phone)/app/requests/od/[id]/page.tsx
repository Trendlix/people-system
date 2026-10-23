import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OdRequestDetail } from '../../../../../(app)/attendance/official-duty/[id]/od-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 23 October 2026: "Official duty (OD) requests"): their own official duty request, with
// every step, and Cancel while it is being decided: the site's page (attendance/official-duty/[id]/od-request.tsx), its
// back link to the phone pages' My Requests, and what is done on it coming back here.

export const metadata: Metadata = { title: 'Official Duty · Trendlix People' };

export default function PhoneRequestsOdPage({ params, searchParams }: PageProps<'/app/requests/od/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <OdRequestDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
