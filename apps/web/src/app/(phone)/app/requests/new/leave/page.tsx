import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewLeave, NewLeaveHeading } from '../../../../../(app)/leave/new/new-leave';
import { PhoneLoading } from '../../../ui';

// New leave on the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): the site's page
// and form (leave/new/new-leave.tsx), its rules and checks, coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'New Leave · TrendLIX People' };

export default function PhoneNewLeavePage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewLeaveHeading back={appBack('requests')} />
            <PhoneLoading />
          </>
        }
      >
        <NewLeave surface="requests" />
      </Suspense>
    </div>
  );
}
