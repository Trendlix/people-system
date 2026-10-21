import type { Metadata } from 'next';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { todayInCairo } from '../../../../(app)/employees/ui';
import { AssetForm } from '../../../../(app)/assets/asset-form';
import { valuesDefaults } from '../../../../(app)/assets/assets';
import { assetsCaller, listOrEmpty, loadKits, loadRooms } from '../../../../(app)/assets/data';
import { PageTitle, PhoneCard, PhoneLoading, Quiet } from '../../ui';

// Add asset on the phone pages (owner's brief, 21 October 2026: "add an asset with the camera (lib/native.ts
// takePhoto)"): the site's form, in the phone layout, "Take photo" first (the app's own camera inside the app, the
// phone's camera in its browser); once saved, the asset's page in the phone layout opens.

export const metadata: Metadata = { title: 'Add Asset · Trendlix People' };

async function NewAsset() {
  const { access, can } = await assetsCaller();
  if (!can.register) {
    return (
      <PhoneCard>
        <Quiet>{can.view ? 'Only an Assets custodian or manager registers assets.' : "You don't have access to Assets."}</Quiet>
      </PhoneCard>
    );
  }
  const [rooms, kits] = await Promise.all([loadRooms(), loadKits()]);
  return (
    <AssetForm
      mode="add"
      defaults={{ group: 'kit' }}
      values={can.values ? valuesDefaults(null) : null}
      rooms={listOrEmpty(rooms)}
      kits={listOrEmpty(kits)}
      today={todayInCairo()}
      ai={access.ai}
      surface="app"
      cancelHref={APP_ASSET_PATHS.list}
    />
  );
}

export default function PhoneNewAssetPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="Add Asset" back={{ href: APP_ASSET_PATHS.list, label: 'Assets' }}>
        Take its photos, then fill in what it is. Its code is given when you save it.
      </PageTitle>
      <Suspense fallback={<PhoneLoading rows={4} />}>
        <NewAsset />
      </Suspense>
    </div>
  );
}
