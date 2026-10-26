import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CompensatoryRequestDetail } from '../../../../../(app)/attendance/compensatory/[id]/compensatory-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 26 October 2026: "WFH and compensatory pages in the phone app"): their own compensatory day
// request, with every step, and Cancel while it is being decided: the site's page
// (attendance/compensatory/[id]/compensatory-request.tsx), its back link to the phone pages' My Requests, and what is
// done on it coming back here.

export const metadata: Metadata = { title: 'Compensatory Day · Trendlix People' };

export default function PhoneRequestsCompensatoryPage({ params, searchParams }: PageProps<'/app/requests/compensatory/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <CompensatoryRequestDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
