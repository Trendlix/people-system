import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { EmployeeBank } from '@/lib/types';
import { updateBank } from '../../../actions';
import { loadEmployee } from '../../../data';
import { EditHeading, Loading, RequireHr } from '../../../ui';
import { BankForm } from './bank-form';

async function EditBank({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  // The full values are fetched (and written to the audit log) only for someone who may change them.
  const bank = employee.access.edit ? await apiGet<EmployeeBank>(`/employees/${employee.id}/bank`) : null;
  return (
    <>
      <EditHeading profile={employee} title="Bank & Payment" />
      <RequireHr profile={employee}>
        {bank && (
          <>
            <p className="text-sm text-muted">Restricted. Opening this page is recorded, because it shows the full numbers.</p>
            <BankForm action={updateBank.bind(null, employee.id)} employeeId={employee.id} bank={bank} profileName={employee.fullNameEn} />
          </>
        )}
      </RequireHr>
    </>
  );
}

export default function EditBankPage({ params }: PageProps<'/employees/[id]/edit/bank'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditBank params={params} />
      </Suspense>
    </div>
  );
}
