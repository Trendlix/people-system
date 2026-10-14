import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import type { Shift } from '@/lib/types';
import { deleteShift, updateShift } from '../../actions';
import { BackLink, Loading, RequireEditor } from '../../ui';
import { ShiftForm } from '../shift-form';

async function EditShift({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shift = await apiGet<Shift>(`/shifts/${id}`);
  return (
    <RequireEditor>
      <h2 className="text-lg font-semibold">Shift {shift.code}</h2>
      <div className="mt-4 space-y-8">
        <ShiftForm action={updateShift.bind(null, id)} shift={shift} />
        <section className="max-w-xl space-y-2">
          <h3 className="font-semibold">Delete Shift</h3>
          <DeleteForm
            action={deleteShift.bind(null, id)}
            confirmText={`Delete shift ${shift.code}? This cannot be undone.`}
            label="Delete shift"
          />
        </section>
      </div>
    </RequireEditor>
  );
}

export default function ShiftPage({ params }: PageProps<'/organization/shifts/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/shifts">Shifts</BackLink>
      <Suspense fallback={<Loading />}>
        <EditShift params={params} />
      </Suspense>
    </div>
  );
}
