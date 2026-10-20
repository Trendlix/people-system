import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PermissionRequestDetail } from '../../../../../(app)/leave/permissions/[id]/permission-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "apply for their requests"): their own permission
// request, with every step, and Cancel while it may be: the site's page
// (leave/permissions/[id]/permission-request.tsx), its back link to the phone pages' My Requests, and what is done on
// it coming back here.

export const metadata: Metadata = { title: 'Permission · Trendlix People' };

export default function PhoneRequestsPermissionPage({ params, searchParams }: PageProps<'/app/requests/permission/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <PermissionRequestDetail params={params} searchParams={searchParams} surface="requests" />
    </Suspense>
  );
}
