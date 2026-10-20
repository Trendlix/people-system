import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { CorrectionDetail } from './correction';

// An attendance correction (owner, 19 October 2026: "Attendance corrections with approval ("I forgot to check out")"):
// correction.tsx, shared with the phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'Attendance Correction · People System' };

export default function CorrectionPage({ params, searchParams }: PageProps<'/attendance/corrections/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <CorrectionDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
