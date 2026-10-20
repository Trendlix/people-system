import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewRaiseRequest, NewRaiseRequestHeading, RaiseRequestsOnly } from '../../../../../(app)/raise-requests/new/new-raise-request';
import { PhoneLoading } from '../../../ui';

// A raise request on the phone pages (owner, 20 October 2026: the employee app, "raise requests"): the site's page and
// form (raise-requests/new/new-raise-request.tsx), for themself or, a manager, for a direct report (?employee=), coming
// back to the phone pages' My Requests once sent. The 404 page for someone who doesn't see raise requests (owner, 20
// October 2026: "raises not to be visible to employee level for now", then "Hide from managers too").

export const metadata: Metadata = { title: 'New Raise Request · Trendlix People' };

export default function PhoneNewRaisePage({ searchParams }: PageProps<'/app/requests/new/raise'>) {
  return (
    <div className="space-y-5">
      <Suspense fallback={<PhoneLoading />}>
        <RaiseRequestsOnly>
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
        </RaiseRequestsOnly>
      </Suspense>
    </div>
  );
}
