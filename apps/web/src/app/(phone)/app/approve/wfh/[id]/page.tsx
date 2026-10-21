import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WfhRequestDetail } from '../../../../../(app)/attendance/wfh/[id]/wfh-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 21 October 2026: "Manager, then HR"): a work from home request waiting for the caller, with
// their decision (Approve, or Reject with a comment) and every step: the site's page (attendance/wfh/[id]/wfh-request.tsx),
// its back link to the phone pages' To Approve, and what is done on it coming back here.

export const metadata: Metadata = { title: 'Work From Home · Trendlix People' };

export default function PhoneApproveWfhPage({ params, searchParams }: PageProps<'/app/approve/wfh/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <WfhRequestDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
