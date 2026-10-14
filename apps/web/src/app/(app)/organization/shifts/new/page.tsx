import { Suspense } from 'react';
import { createShift } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { ShiftForm } from '../shift-form';

export default function NewShiftPage() {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/shifts">Shifts</BackLink>
      <h2 className="text-lg font-semibold">New Shift</h2>
      <Suspense fallback={<Loading />}>
        <RequireEditor>
          <ShiftForm action={createShift} />
        </RequireEditor>
      </Suspense>
    </div>
  );
}
