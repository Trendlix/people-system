import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LeaveRequestDetail } from '../../../../../(app)/leave/[id]/leave-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve from the phone"): a
// leave request waiting for the caller, with their decision (Approve, or Reject with a comment) and every step: the
// site's page (leave/[id]/leave-request.tsx), its back link to the phone pages' To Approve, and what is done on it
// coming back here.

export const metadata: Metadata = { title: 'Leave Request · Trendlix People' };

export default function PhoneApproveLeavePage({ params, searchParams }: PageProps<'/app/approve/leave/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <LeaveRequestDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
