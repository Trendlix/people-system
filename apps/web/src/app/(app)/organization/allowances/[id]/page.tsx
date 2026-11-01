import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { DeleteForm } from '@/components/form';
import { apiGet } from '@/lib/api';
import { canDelete } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import type { AllowanceType } from '@/lib/types';
import { deleteAllowanceType, setAllowanceTypeActive, updateAllowanceType } from '../../actions';
import { BackLink, Loading, RequireEditor, UUID } from '../../ui';
import { AllowanceActiveForm, AllowanceTypeForm } from '../allowance-form';

async function EditAllowance({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // The API has no single-allowance read: the list is short, so it is looked up in that.
  const [user, allowances] = await Promise.all([getCurrentUser(), apiGet<AllowanceType[]>('/allowance-types')]);
  const allowance = allowances.find((a) => a.id === id);
  if (!allowance) notFound();
  const { nameEn, active, inUse } = allowance;
  return (
    <RequireEditor>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{nameEn}</h2>
        {active ? <span className="badge bg-ok-soft text-ok">Active</span> : <span className="badge bg-line-soft text-muted">Inactive</span>}
      </div>
      <div className="mt-4 space-y-8">
        <AllowanceTypeForm action={updateAllowanceType.bind(null, id)} allowance={allowance} />
        <section className="max-w-xl space-y-2">
          <h3 className="font-semibold">{active ? 'Make Inactive' : 'Make Active'}</h3>
          <AllowanceActiveForm action={setAllowanceTypeActive.bind(null, id, !active)} active={active} />
        </section>
        {/* only a Super Admin deletes (owner's decision, 15 October 2026) */}
        {canDelete(user) && (
          <section className="max-w-xl space-y-2">
            <h3 className="font-semibold">Delete Allowance</h3>
            {inUse ? (
              <p className="text-sm text-muted">It&apos;s on a contract or job offer, so it can&apos;t be deleted.</p>
            ) : (
              <DeleteForm
                action={deleteAllowanceType.bind(null, id)}
                confirmText={`Delete the allowance ${nameEn}?`}
                label="Delete allowance"
              />
            )}
          </section>
        )}
      </div>
    </RequireEditor>
  );
}

export default function AllowancePage({ params }: PageProps<'/organization/allowances/[id]'>) {
  return (
    <div className="space-y-4">
      <BackLink href="/organization/allowances">Allowances</BackLink>
      <Suspense fallback={<Loading />}>
        <EditAllowance params={params} />
      </Suspense>
    </div>
  );
}
