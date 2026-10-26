import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CompensatoryRequestDetail } from '../../../../../(app)/attendance/compensatory/[id]/compensatory-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 26 October 2026: "WFH and compensatory pages in the phone app"; "Manager, then HR"): a
// compensatory day request waiting for the caller (its approver in charge, HR, or the CEO for a C-level person's), with
// their decision and every step: the site's page (attendance/compensatory/[id]/compensatory-request.tsx), its back link
// to the phone pages' To Approve, and what is done on it coming back here. The decision is the site's own form: Approve,
// or Reject with a comment; at HR's step, approve as a day off or, rarely, as cash instead ("rarely to be compensated in
// cash"), a day worked with no check-in kept confirmed first, as on the site.

export const metadata: Metadata = { title: 'Compensatory Day · Trendlix People' };

export default function PhoneApproveCompensatoryPage({ params, searchParams }: PageProps<'/app/approve/compensatory/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <CompensatoryRequestDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
