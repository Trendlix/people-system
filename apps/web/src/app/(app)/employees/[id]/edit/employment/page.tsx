import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { loadEmployee } from '../../../data';
import { Loading } from '../../../ui';

// Employment became its own record, with a history (owner's decision, October 2026). Old links to the Employment edit
// page land here and are sent on: to the current employment's Edit page, or to Add employment when there is none.

async function Forward({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactNode> {
  const employee = await loadEmployee(params);
  const current = employee.employment;
  redirect(current ? `/employees/${employee.id}/employment/${current.id}/edit` : `/employees/${employee.id}/employment/new`);
}

export default function OldEmploymentPage({ params }: PageProps<'/employees/[id]/edit/employment'>) {
  return (
    <Suspense fallback={<Loading />}>
      <Forward params={params} />
    </Suspense>
  );
}
