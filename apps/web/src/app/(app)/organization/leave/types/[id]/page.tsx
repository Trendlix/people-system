import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import { loadLeaveTypes } from '../../../../leave/data';
import { notLoadedText } from '../../../../payroll/load';
import { BackLink, Empty, Loading, UUID } from '../../../ui';
import { updateLeaveType } from '../../actions';
import { LeaveTypeForm } from '../../leave-type-form';
import { editsLeaveSetup, LEAVE_TYPES_HREF, requestsCountText, typeSource } from '../../setup';

// Changing a leave type, from Organization → Leave → Leave Types (HR; owner, 18 October 2026: "can you apply the leaves
// according to the law?"): its names, days, pay and rules, and turning it off (not offered for new requests) or on. A
// law's type keeps where it comes from; the requests already sent keep their days. Deleting one no request uses is the
// Super Admin's, on the list.

export const metadata: Metadata = { title: 'Leave Type · People System' };

async function EditType({ params }: { params: PageProps<'/organization/leave/types/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!editsLeaveSetup(user)) return <Empty>Only HR changes leave types.</Empty>;
  // the list is short, so the type is looked up in it
  const loaded = await loadLeaveTypes();
  if (loaded.kind !== 'ok') return <Empty>{notLoadedText(loaded, 'leave types')}</Empty>;
  const type = loaded.value.find((t) => t.id === id);
  if (!type) notFound();
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{titleCase(type.nameEn)}</h2>
        {type.active ? <span className="badge bg-ok-soft text-ok">On</span> : <span className="badge bg-line-soft text-muted">Off</span>}
        <span className="text-sm text-muted">
          {typeSource(type)}
          {type.requests !== undefined && ` · ${requestsCountText(type.requests)}`}
        </span>
      </div>
      <LeaveTypeForm action={updateLeaveType.bind(null, id)} type={type} nextOrder={type.sortOrder} cancelHref={LEAVE_TYPES_HREF} />
    </>
  );
}

export default function LeaveTypePage({ params }: PageProps<'/organization/leave/types/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href={LEAVE_TYPES_HREF}>Leave Setup</BackLink>
      <Suspense fallback={<Loading />}>
        <EditType params={params} />
      </Suspense>
    </div>
  );
}
