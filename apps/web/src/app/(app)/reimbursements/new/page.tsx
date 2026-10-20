import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { NewClaim, NewClaimHeading } from './new-claim';

// A new reimbursement claim (owner, 18 October 2026: "allow the employee to add reimbursement request … for specific
// preset up conditions"): new-claim.tsx, shared with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'New Reimbursement · People System' };

export default function NewReimbursementPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewClaimHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewClaim />
      </Suspense>
    </div>
  );
}
