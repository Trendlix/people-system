import { Suspense } from 'react';
import { createAllowanceType } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { AllowanceTypeForm } from '../allowance-form';

export default function NewAllowancePage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/allowances">Allowances</BackLink>
      <h2 className="text-lg font-semibold">New Allowance</h2>
      <Suspense fallback={<Loading />}>
        <RequireEditor>
          <AllowanceTypeForm action={createAllowanceType} />
        </RequireEditor>
      </Suspense>
    </div>
  );
}
