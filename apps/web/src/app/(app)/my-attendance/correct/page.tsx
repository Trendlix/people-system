import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../organization/ui';
import { AskCorrection, AskCorrectionHeading } from './ask-correction';

// Ask for a correction (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"):
// ask-correction.tsx, shared with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'Ask for a Correction · People System' };

export default function AskCorrectionPage({ searchParams }: PageProps<'/my-attendance/correct'>) {
  return (
    <div className="max-w-3xl space-y-6">
      <AskCorrectionHeading back={{ href: '/my-attendance', label: 'My Attendance' }} />
      <Suspense fallback={<Loading />}>
        <AskCorrection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
