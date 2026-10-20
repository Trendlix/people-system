import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LeaveRequestDetail } from '../../../../../(app)/leave/[id]/leave-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): their own leave request,
// with every step, and Cancel while it may be: the site's page (leave/[id]/leave-request.tsx), its back link to the
// phone pages' My Requests, and what is done on it coming back here.

export const metadata: Metadata = { title: 'Leave Request · Trendlix People' };

export default function PhoneRequestsLeavePage({ params, searchParams }: PageProps<'/app/requests/leave/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <LeaveRequestDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
