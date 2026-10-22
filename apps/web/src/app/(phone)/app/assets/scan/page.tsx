import type { Metadata } from 'next';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { assetsCaller } from '../../../../(app)/assets/data';
import { PageTitle, PhoneCard, PhoneLoading, Quiet } from '../../ui';
import { ScanToOpen } from './scan-to-open';

// Scan a label (Assets step 5; owner, 22 October 2026; the brief: "Look up: scanning an asset's label opens its page"),
// for anyone with Assets access.

export const metadata: Metadata = { title: 'Scan a Label · Trendlix People' };

async function Scan() {
  const { can } = await assetsCaller();
  if (!can.view) {
    return (
      <PhoneCard>
        <Quiet>You don&apos;t have access to Assets. An Admin gives it on the Users page.</Quiet>
      </PhoneCard>
    );
  }
  return (
    <PhoneCard>
      <ScanToOpen />
    </PhoneCard>
  );
}

export default function PhoneScanPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="Scan a Label" back={{ href: APP_ASSET_PATHS.list, label: 'Assets' }}>
        Hold the asset&apos;s QR label in front of the camera to open it.
      </PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Scan />
      </Suspense>
    </div>
  );
}
