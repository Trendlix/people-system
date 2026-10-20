import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PermissionRequestDetail } from '../../../../../(app)/leave/permissions/[id]/permission-request';
import { PhoneLoading } from '../../../ui';

// On the phone pages (owner, 20 October 2026: the employee app, "managers and team leads approve from the phone"): a
// permission request waiting for the caller, with their decision (Approve, or Reject with a comment) and every step:
// the site's page (leave/permissions/[id]/permission-request.tsx), its back link to the phone pages' To Approve, and
// what is done on it coming back here.

export const metadata: Metadata = { title: 'Permission · TrendLIX People' };

export default function PhoneApprovePermissionPage({ params, searchParams }: PageProps<'/app/approve/permission/[id]'>) {
  return (
    <Suspense fallback={<PhoneLoading />}>
      <PermissionRequestDetail params={params} searchParams={searchParams} surface="approve" />
    </Suspense>
  );
}
