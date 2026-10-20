import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appBack } from '@/lib/surface';
import { AskCorrection, AskCorrectionHeading } from '../../../../../(app)/my-attendance/correct/ask-correction';
import { PhoneLoading } from '../../../ui';

// Ask for a correction on the phone pages (owner, 20 October 2026: the employee app, "My attendance … a day → Ask for a
// correction"): the site's page and form (my-attendance/correct/ask-correction.tsx), the day from Attendance (?date=),
// coming back to the phone pages once sent.

export const metadata: Metadata = { title: 'Ask for a Correction · TrendLIX People' };

export default function PhoneAskCorrectionPage({ searchParams }: PageProps<'/app/requests/new/correction'>) {
  return (
    <div className="space-y-5">
      <AskCorrectionHeading back={appBack('requests')} />
      <Suspense fallback={<PhoneLoading />}>
        <AskCorrection searchParams={searchParams} surface="requests" />
      </Suspense>
    </div>
  );
}
