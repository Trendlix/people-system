import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';
import { loadPickers } from '../data';
import { BackLink, canAddEmployees, Empty, Loading } from '../ui';
import { NewEmployeeForm } from './new-employee-form';

async function NewEmployee() {
  const user = await getCurrentUser();
  if (!canAddEmployees(user)) return <Empty>Only HR can add employees.</Empty>;
  return <NewEmployeeForm pickers={await loadPickers()} />;
}

export default function NewEmployeePage() {
  return (
    <div className="space-y-4">
      <BackLink href="/employees">Employees</BackLink>
      <h1 className="text-2xl font-semibold">Add employee</h1>
      <Suspense fallback={<Loading />}>
        <NewEmployee />
      </Suspense>
    </div>
  );
}
