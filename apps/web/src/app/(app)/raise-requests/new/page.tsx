import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { NewRaiseRequest, NewRaiseRequestHeading } from './new-raise-request';

// Asking for a raise, under Requests → Raise Requests (owner, 17 October 2026: "i think raising a request should be
// moved from the Employee tab to the raise requests tab"): new-raise-request.tsx, shared with the phone pages (owner, 20
// October 2026: the employee app).

export const metadata: Metadata = { title: 'New Raise Request · People System' };

export default function NewRaiseRequestPage({ searchParams }: PageProps<'/raise-requests/new'>) {
  return (
    <div className="max-w-4xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewRaiseRequestHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewRaiseRequest searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
