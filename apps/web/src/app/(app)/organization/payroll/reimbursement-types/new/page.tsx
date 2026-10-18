import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { BackLink, Empty, Loading } from '../../../ui';
import { createReimbursementType } from '../../reimbursement-types-actions';
import { ReimbursementTypeForm } from '../../reimbursement-type-form';
import { editsReimbursementTypes, REIMBURSEMENT_TYPES_HREF } from '../../reimbursement-types';
import { whoChoices } from '../form-data';

// A new reimbursement type, from Payroll Setup → Reimbursement Types (HR; owner, 18 October 2026: "in the setup i need
// to enter for it a cap"): its names, caps and conditions, and who may claim it. Once added, back to the section.

export const metadata: Metadata = { title: 'New Reimbursement Type · People System' };

async function NewType() {
  const user = await getCurrentUser();
  if (!editsReimbursementTypes(user)) return <Empty>Only HR adds reimbursement types.</Empty>;
  const { departments, grades } = await whoChoices();
  return <ReimbursementTypeForm action={createReimbursementType} departments={departments} grades={grades} cancelHref={REIMBURSEMENT_TYPES_HREF} />;
}

export default function NewReimbursementTypePage() {
  return (
    <div className="space-y-4">
      <BackLink href={REIMBURSEMENT_TYPES_HREF}>Payroll Setup</BackLink>
      <h2 className="text-lg font-semibold">New Reimbursement Type</h2>
      <Suspense fallback={<Loading />}>
        <NewType />
      </Suspense>
    </div>
  );
}
