import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { CompensatoryRequestDetail } from './compensatory-request';

// A compensatory day request (owner, 26 October 2026: "Manager, then HR"): compensatory-request.tsx.

export const metadata: Metadata = { title: 'Compensatory Days · People System' };

export default function CompensatoryRequestPage({ params, searchParams }: PageProps<'/attendance/compensatory/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <CompensatoryRequestDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
