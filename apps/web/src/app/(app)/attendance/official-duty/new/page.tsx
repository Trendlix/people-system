import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { NewOd, NewOdHeading } from './new-od';

// A new official duty request (owner, 23 October 2026: "Official duty (OD) requests"): new-od.tsx, shared with the
// phone pages (/app/requests/new/od).

export const metadata: Metadata = { title: 'Official Duty · People System' };

export default function NewOdPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewOdHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewOd />
      </Suspense>
    </div>
  );
}
