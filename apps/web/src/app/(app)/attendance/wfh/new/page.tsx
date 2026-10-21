import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { NewWfh, NewWfhHeading } from './new-wfh';

// A new work from home request (owner, 21 October 2026: "think about how should we handle the working from home in out
// erp"): new-wfh.tsx, shared with the phone pages (/app/requests/new/wfh).

export const metadata: Metadata = { title: 'Work From Home · People System' };

export default function NewWfhPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewWfhHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewWfh />
      </Suspense>
    </div>
  );
}
