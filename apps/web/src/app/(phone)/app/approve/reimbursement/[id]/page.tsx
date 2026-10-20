import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClaimDetail } from '../../../../../(app)/reimbursements/[id]/claim-detail';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve from the phone"): a
// reimbursement claim waiting for the caller, with their decision (Approve, or Reject with a comment) and every step:
// the site's page (reimbursements/[id]/claim-detail.tsx), its back link to the phone pages' To Approve, and what is
// done on it coming back here.

export const metadata: Metadata = { title: 'Reimbursement Claim · TrendLIX People' };

export default function PhoneApproveReimbursementPage({ params, searchParams }: PageProps<'/app/approve/reimbursement/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <ClaimDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
