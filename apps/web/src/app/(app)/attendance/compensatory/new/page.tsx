import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { NewCompensatory, NewCompensatoryHeading } from './new-compensatory';

// A new compensatory day request (owner, 26 October 2026: "my compensatory is a compensation with another day in the same
// month"): new-compensatory.tsx.

export const metadata: Metadata = { title: 'Compensatory Day · People System' };

export default function NewCompensatoryPage() {
  return (
    <div className="max-w-3xl space-y-5">
      <Suspense
        fallback={
          <>
            <NewCompensatoryHeading back={null} />
            <Loading />
          </>
        }
      >
        <NewCompensatory />
      </Suspense>
    </div>
  );
}
