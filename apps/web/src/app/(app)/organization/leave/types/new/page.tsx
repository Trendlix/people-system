import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { loadLeaveTypes } from '../../../../leave/data';
import { BackLink, Empty, Loading } from '../../../ui';
import { createLeaveType } from '../../actions';
import { LeaveTypeForm } from '../../leave-type-form';
import { editsLeaveSetup, LEAVE_TYPES_HREF } from '../../setup';

// A new leave type, from Organization → Leave → Leave Types (HR; owner, 18 October 2026: "can you apply the leaves
// according to the law?"): a kind of leave of the company's own beside the law's, e.g. compassionate leave, with its days,
// pay and rules. Once added, back to the list.

export const metadata: Metadata = { title: 'New Leave Type · People System' };

async function NewType() {
  const user = await getCurrentUser();
  if (!editsLeaveSetup(user)) return <Empty>Only HR adds leave types.</Empty>;
  const types = await loadLeaveTypes();
  const next = types.kind === 'ok' ? Math.max(0, ...types.value.map((t) => t.sortOrder)) + 1 : 10;
  return <LeaveTypeForm action={createLeaveType} nextOrder={next} cancelHref={LEAVE_TYPES_HREF} />;
}

export default function NewLeaveTypePage() {
  return (
    <div className="space-y-4">
      <BackLink href={LEAVE_TYPES_HREF}>Leave Setup</BackLink>
      <h2 className="text-lg font-semibold">New Leave Type</h2>
      <Suspense fallback={<Loading />}>
        <NewType />
      </Suspense>
    </div>
  );
}
