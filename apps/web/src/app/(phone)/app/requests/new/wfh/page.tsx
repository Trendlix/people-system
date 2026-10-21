import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { NewWfh, NewWfhHeading } from '../../../../../(app)/attendance/wfh/new/new-wfh';
import { PhoneLoading } from '../../../ui';

// Work from home on the phone pages (owner, 21 October 2026: "think about how should we handle the working from home in
// out erp"; the brief: a New Request tile "Work from home"): the site's page and form (attendance/wfh/new/new-wfh.tsx),
// coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'Work From Home · Trendlix People' };

export default function PhoneNewWfhPage() {
  return (
    <div className="space-y-5">
      <Suspense
        fallback={
          <>
            <NewWfhHeading back={appBack('requests')} />
            <PhoneLoading />
          </>
        }
      >
        <NewWfh surface="requests" />
      </Suspense>
    </div>
  );
}
