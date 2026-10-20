import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewClaim, NewClaimHeading } from '../../../../../(app)/reimbursements/new/new-claim';
import { PhoneLoading } from '../../../ui';

// A new reimbursement on the phone pages (owner, 20 October 2026: the employee app, "reimbursement with a receipt
// photo"): the site's page and form (reimbursements/new/new-claim.tsx), with Take a photo of the receipt beside the
// file box, coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'New Reimbursement · TrendLIX People' };

export default function PhoneNewReimbursementPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewClaimHeading back={appBack('requests')} />
            <PhoneLoading />
          </>
        }
      >
        <NewClaim surface="requests" />
      </Suspense>
    </div>
  );
}
