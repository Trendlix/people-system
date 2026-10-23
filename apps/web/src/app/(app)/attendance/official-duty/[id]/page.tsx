import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { OdRequestDetail } from './od-request';

// An official duty request (owner, 23 October 2026: "Manager, then HR"): od-request.tsx, shared with the phone pages
// (/app/requests/od/<id> and /app/approve/od/<id>).

export const metadata: Metadata = { title: 'Official Duty · People System' };

export default function OdRequestPage({ params, searchParams }: PageProps<'/attendance/official-duty/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <OdRequestDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
