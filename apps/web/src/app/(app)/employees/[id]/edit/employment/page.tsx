import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { deleteEmployee, updateEmployment } from '../../../actions';
import { loadEmployee, loadPickers } from '../../../data';
import { EditHeading, Loading, RequireHr } from '../../../ui';
import { EmploymentForm } from './employment-form';

async function EditEmployment({ params }: { params: Promise<{ id: string }> }) {
  const employee = await loadEmployee(params);
  const pickers = employee.access.edit ? await loadPickers(employee.id) : null;
  return (
    <>
      <EditHeading profile={employee} title="Employment" />
      <RequireHr profile={employee}>
        {pickers && (
          <div className="space-y-8">
            <EmploymentForm action={updateEmployment.bind(null, employee.id)} employee={employee} pickers={pickers} />
            <section className="max-w-xl space-y-2">
              <h2 className="font-semibold">Delete employee</h2>
              <p className="text-sm text-muted">
                Only for records added by mistake. When someone leaves, change their status to Resigned or Terminated instead, so their history is
                kept.
              </p>
              <DeleteForm
                action={deleteEmployee.bind(null, employee.id)}
                confirmText={`Delete ${employee.fullNameEn} (${employee.employeeCode}) and all of their details? This cannot be undone.`}
                label="Delete employee"
              />
            </section>
          </div>
        )}
      </RequireHr>
    </>
  );
}

export default function EditEmploymentPage({ params }: PageProps<'/employees/[id]/edit/employment'>) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Loading />}>
        <EditEmployment params={params} />
      </Suspense>
    </div>
  );
}
