import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CUSTODY_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../../organization/ui';
import { todayInCairo } from '../../../employees/ui';
import { handoverStart } from '../../custody';
import { loadHandoverChoices } from '../../custody-data';
import { assetsCaller, assetsNotLoaded } from '../../data';
import { Empty, Loading, NoAccess } from '../../ui';
import { HandoverForm } from '../handover-form';

// New handover (Assets step 3; the spec's New handover), for an Assets custodian or manager: the form, with ?employee=
// (from a person's holdings) and ?asset= (from an asset's page) chosen to start with.

export const metadata: Metadata = { title: 'New Handover · People System' };

async function NewHandover({ searchParams }: { searchParams: PageProps<'/assets/custody/new'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  if (!can.register) return <Empty>Only an Assets custodian or manager hands assets over.</Empty>;
  const loaded = await loadHandoverChoices();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'handover form')}</Empty>;
  const start = handoverStart(params);
  return <HandoverForm choices={loaded.value} startEmployeeId={start.employeeId} startAssetCode={start.assetCode} startKitId={start.kitId} today={todayInCairo()} surface="site" cancelHref={CUSTODY_PATHS.list} />;
}

export default function NewHandoverPage({ searchParams }: PageProps<'/assets/custody/new'>) {
  return (
    <div className="max-w-4xl space-y-4">
      <BackLink href={CUSTODY_PATHS.list}>Custody</BackLink>
      <div>
        <h1 className="page-title">New Handover</h1>
        <p className="mt-1 text-muted">The record gets its code when you save it. Then print its form, have it signed, and attach the signed copy.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <NewHandover searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
