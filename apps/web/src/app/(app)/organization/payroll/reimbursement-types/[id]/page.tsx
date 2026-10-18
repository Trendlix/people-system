import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { titleCase } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';
import type { ReimbursementTypeView } from '@/lib/types';
import { notLoadedText, loadJson } from '../../../../payroll/load';
import { BackLink, Empty, Loading, UUID } from '../../../ui';
import { updateReimbursementType } from '../../reimbursement-types-actions';
import { ReimbursementTypeForm } from '../../reimbursement-type-form';
import { claimsCountText, editsReimbursementTypes, REIMBURSEMENT_TYPES_HREF } from '../../reimbursement-types';
import { whoChoices } from '../form-data';

// Changing a reimbursement type, from Payroll Setup → Reimbursement Types (HR; owner, 18 October 2026: "in the setup i
// need to enter for it a cap"): its names, caps and conditions, who may claim it, and turning it off (not offered for new
// claims) or on. The claims already sent keep the conditions they were sent under. Deleting one no claim uses is the
// Super Admin's, on the section.

export const metadata: Metadata = { title: 'Reimbursement Type · People System' };

async function EditType({ params }: { params: PageProps<'/organization/payroll/reimbursement-types/[id]'>['params'] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!editsReimbursementTypes(user)) return <Empty>Only HR changes reimbursement types.</Empty>;
  // the API has no single-type read: the list is short, so it is looked up in that
  const [loaded, choices] = await Promise.all([loadJson<ReimbursementTypeView[]>('/reimbursement-types'), whoChoices()]);
  if (loaded.kind !== 'ok') return <Empty>{notLoadedText(loaded, 'reimbursement types')}</Empty>;
  const type = loaded.value.find((t) => t.id === id);
  if (!type) notFound();
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{titleCase(type.nameEn)}</h2>
        {type.active ? <span className="badge bg-ok-soft text-ok">On</span> : <span className="badge bg-line-soft text-muted">Off</span>}
        <span className="text-sm text-muted">{claimsCountText(type.claims)}</span>
      </div>
      <ReimbursementTypeForm
        action={updateReimbursementType.bind(null, id)}
        type={type}
        departments={choices.departments}
        grades={choices.grades}
        cancelHref={REIMBURSEMENT_TYPES_HREF}
      />
    </>
  );
}

export default function ReimbursementTypePage({ params }: PageProps<'/organization/payroll/reimbursement-types/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href={REIMBURSEMENT_TYPES_HREF}>Payroll Setup</BackLink>
      <Suspense fallback={<Loading />}>
        <EditType params={params} />
      </Suspense>
    </div>
  );
}
