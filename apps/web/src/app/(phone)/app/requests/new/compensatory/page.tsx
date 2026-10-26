import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewCompensatory, NewCompensatoryHeading } from '../../../../../(app)/attendance/compensatory/new/new-compensatory';
import { PhoneLoading } from '../../../ui';

// A compensatory day on the phone pages (owner, 26 October 2026: "WFH and compensatory pages in the phone app"; "my
// compensatory is a compensation with another day in the same month"): the site's page and form
// (attendance/compensatory/new/new-compensatory.tsx): the day worked, the day off in the same month and a reason, the
// shared rules checked live and a day worked with no check-in kept warned of, coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'Compensatory Day · Trendlix People' };

export default function PhoneNewCompensatoryPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewCompensatoryHeading back={appBack('requests')} />
            <PhoneLoading />
          </>
        }
      >
        <NewCompensatory surface="requests" />
      </Suspense>
    </div>
  );
}
