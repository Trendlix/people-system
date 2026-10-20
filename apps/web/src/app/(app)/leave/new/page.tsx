import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { NewLeave, NewLeaveHeading } from './new-leave';

// A new leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"): new-leave.tsx, shared
// with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'New Leave · People System' };

export default function NewLeavePage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewLeaveHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewLeave />
      </Suspense>
    </div>
  );
}
