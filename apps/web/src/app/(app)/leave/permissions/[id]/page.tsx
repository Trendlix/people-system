import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '../../../organization/ui';
import { PermissionRequestDetail } from './permission-request';

// A permission request (owner, 19 October 2026: "In the system, like leave"): permission-request.tsx, shared with the
// phone pages (owner, 20 October 2026: the employee app).

export const metadata: Metadata = { title: 'Permission · People System' };

export default function PermissionRequestPage({ params, searchParams }: PageProps<'/leave/permissions/[id]'>) {
  return (
    <div className="max-w-5xl">
      <Suspense fallback={<Loading />}>
        <PermissionRequestDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
