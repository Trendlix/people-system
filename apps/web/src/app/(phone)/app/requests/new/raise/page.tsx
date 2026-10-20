import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewRaiseRequest, NewRaiseRequestHeading } from '../../../../../(app)/raise-requests/new/new-raise-request';
import { PhoneLoading } from '../../../ui';

// A raise request on the phone pages (owner, 20 October 2026: the employee app, "raise requests"): the site's page and
// form (raise-requests/new/new-raise-request.tsx), for themself or, a manager, for a direct report (?employee=), coming
// back to the phone pages' My Requests once sent.

export const metadata: Metadata = { title: 'New Raise Request · TrendLIX People' };

export default function PhoneNewRaisePage({ searchParams }: PageProps<'/app/requests/new/raise'>) {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewRaiseRequestHeading back={appBack('requests').href} />
            <PhoneLoading />
          </>
        }
      >
        <NewRaiseRequest searchParams={searchParams} surface="requests" />
      </Suspense>
    </div>
  );
}
