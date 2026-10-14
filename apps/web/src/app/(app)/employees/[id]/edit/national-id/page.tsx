import { Suspense } from 'react';
import { apiGet } from '@/lib/api';
import type { EmployeeIdentity } from '@/lib/types';
import { updateIdentity } from '../../../actions';
import { loadEmployee } from '../../../data';
import { scanIdCard } from '../../../paperwork-actions';
import { EditHeading, Loading, RequireHr } from '../../../ui';
import { NationalIdEditor } from './id-card-scan';

async function EditNationalId({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  // The full values are fetched (and written to the audit log) only for someone who may change them.
  const identity = employee.access.edit ? await apiGet<EmployeeIdentity>(`/employees/${employee.id}/identity`) : null;
  return (
    <>
      <EditHeading profile={employee} title="National ID" />
      <RequireHr profile={employee}>
        {identity && (
          <>
            <p className="text-sm text-muted">Restricted. Opening this page is recorded, because it shows the full numbers.</p>
            <NationalIdEditor
              saveAction={updateIdentity.bind(null, employee.id)}
              scanAction={scanIdCard.bind(null, employee.id)}
              employeeId={employee.id}
              name={employee.fullNameEn}
              identity={identity}
              profile={{
                fullNameAr: employee.fullNameAr,
                addressAr: employee.addressAr,
                city: employee.city,
                governorate: employee.governorate,
                dateOfBirth: employee.dateOfBirth,
                gender: employee.gender,
                maritalStatus: employee.maritalStatus,
                nationality: employee.nationality,
              }}
            />
          </>
        )}
      </RequireHr>
    </>
  );
}

export default function EditNationalIdPage({ params }: PageProps<'/employees/[id]/edit/national-id'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditNationalId params={params} />
      </Suspense>
    </div>
  );
}
