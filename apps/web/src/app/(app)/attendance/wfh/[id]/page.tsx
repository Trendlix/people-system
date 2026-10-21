import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { WfhRequestDetail } from './wfh-request';

// A work from home request (owner, 21 October 2026: "Manager, then HR"): wfh-request.tsx, shared with the phone pages
// (/app/requests/wfh/<id> and /app/approve/wfh/<id>).

export const metadata: Metadata = { title: 'Work From Home · People System' };

export default function WfhRequestPage({ params, searchParams }: PageProps<'/attendance/wfh/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <WfhRequestDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
