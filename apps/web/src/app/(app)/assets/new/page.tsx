import { isAssetGroup } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../organization/ui';
import { todayInCairo } from '../../employees/ui';
import { AssetForm } from '../asset-form';
import { valuesDefaults } from '../assets';
import { assetsCaller, listOrEmpty, loadKits, loadRooms } from '../data';
import { Empty, Loading, NoAccess } from '../ui';

// Add asset (owner, 21 October 2026: "i want to add this module with a special permission to the system"): for an
// Assets custodian or manager; the form follows the group (?group= chooses it to start with, production kit
// otherwise), with the values for the CEO, Finance and a Super Admin, and "Take photo" and "Choose photos". The code is
// given when it is saved. "Fill from photos" and "Scan label" come with step 2, once the Assets AI is set up.

export const metadata: Metadata = { title: 'Add Asset · People System' };

async function NewAsset({ searchParams }: { searchParams: PageProps<'/assets/new'>['searchParams'] }) {
  const [{ access, can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  if (!can.register) return <Empty>Only an Assets custodian or manager registers assets.</Empty>;
  const [rooms, kits] = await Promise.all([loadRooms(), loadKits()]);
  const group = typeof params.group === 'string' && isAssetGroup(params.group) ? params.group : 'kit';
  return (
    <AssetForm
      mode="add"
      defaults={{ group }}
      values={can.values ? valuesDefaults(null) : null}
      rooms={listOrEmpty(rooms)}
      kits={listOrEmpty(kits)}
      today={todayInCairo()}
      ai={access.ai}
      surface="site"
      cancelHref={ASSET_PATHS.list}
    />
  );
}

export default function NewAssetPage({ searchParams }: PageProps<'/assets/new'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <BackLink href={ASSET_PATHS.list}>Assets</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Add Asset</h1>
        <p className="mt-1 text-muted">Its group decides its code, its fields and how it is kept. The code is given when you save it, and never changes.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <NewAsset searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
