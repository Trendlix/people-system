import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewOd, NewOdHeading } from '../../../../../(app)/attendance/official-duty/new/new-od';
import { PhoneLoading } from '../../../ui';

// Official duty on the phone pages (owner, 23 October 2026: "Official duty (OD) requests"; the brief: "Request official
// duty" in the phone requests too): the site's page and form (attendance/official-duty/new/new-od.tsx), coming back to
// the phone pages once sent.

export const metadata: Metadata = { title: 'Official Duty · Trendlix People' };

export default function PhoneNewOdPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewOdHeading back={appBack('requests')} />
            <PhoneLoading />
          </>
        }
      >
        <NewOd surface="requests" />
      </Suspense>
    </div>
  );
}
