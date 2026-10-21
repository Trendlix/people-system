import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WfhRequestDetail } from '../../../../../(app)/attendance/wfh/[id]/wfh-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 21 October 2026: "think about how should we handle the working from home in out erp"):
// their own work from home request, with every step, and Cancel while it is being decided: the site's page
// (attendance/wfh/[id]/wfh-request.tsx), its back link to the phone pages' My Requests, and what is done on it coming
// back here.

export const metadata: Metadata = { title: 'Work From Home · Trendlix People' };

export default function PhoneRequestsWfhPage({ params, searchParams }: PageProps<'/app/requests/wfh/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <WfhRequestDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
