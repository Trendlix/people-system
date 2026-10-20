import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { ClaimDetail } from './claim-detail';

// A reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific
// preset up conditions"): claim-detail.tsx, shared with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'Reimbursement Claim · People System' };

export default function ReimbursementClaimPage({ params, searchParams }: PageProps<'/reimbursements/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <ClaimDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
