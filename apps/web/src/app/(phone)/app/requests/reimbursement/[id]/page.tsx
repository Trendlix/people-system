import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClaimDetail } from '../../../../../(app)/reimbursements/[id]/claim-detail';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): their own reimbursement
// claim, with every step, and Cancel while it may be: the site's page (reimbursements/[id]/claim-detail.tsx), its back
// link to the phone pages' My Requests, and what is done on it coming back here.

export const metadata: Metadata = { title: 'Reimbursement Claim · TrendLIX People' };

export default function PhoneRequestsReimbursementPage({ params, searchParams }: PageProps<'/app/requests/reimbursement/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <ClaimDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
