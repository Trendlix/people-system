import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { LeaveRequestDetail } from './leave-request';

// A leave request (owner, 18 October 2026: "can you apply the leaves according to the law?"): leave-request.tsx, shared
// with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'Leave Request · People System' };

export default function LeaveRequestPage({ params, searchParams }: PageProps<'/leave/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <LeaveRequestDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
