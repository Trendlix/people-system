import type { Metadata } from 'next';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { todayInCairo } from '../../../../../(app)/employees/ui';
import { handoverStart } from '../../../../../(app)/assets/custody';
import { loadHandoverChoices } from '../../../../../(app)/assets/custody-data';
import { HandoverForm } from '../../../../../(app)/assets/custody/handover-form';
import { assetsCaller, assetsNotLoaded } from '../../../../../(app)/assets/data';
import { PageTitle, PhoneCard, PhoneLoading, Quiet } from '../../../ui';

// A handover on the phone pages (Assets step 3, the brief: "for custodians: hand over and receive back in the phone
// layout, reusing the forms"): the site's form, in the phone layout, ?asset= (an asset's page, a scanned QR label) and
// ?employee= chosen to start with; once saved, the record opens in the phone layout, to attach its signed copy with the
// camera.

export const metadata: Metadata = { title: 'New Handover · Trendlix People' };

async function NewHandover({ searchParams }: { searchParams: PageProps<'/app/assets/custody/new'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.register) {
    return (
      <PhoneCard>
        <Quiet>{can.view ? 'Only an Assets custodian or manager hands assets over.' : "You don't have access to Assets."}</Quiet>
      </PhoneCard>
    );
  }
  const loaded = await loadHandoverChoices();
  if (loaded.kind !== 'ok') {
    return (
      <PhoneCard>
        <Quiet>{assetsNotLoaded(loaded, 'handover form')}</Quiet>
      </PhoneCard>
    );
  }
  const start = handoverStart(params);
  return <HandoverForm choices={loaded.value} startEmployeeId={start.employeeId} startAssetCode={start.assetCode} today={todayInCairo()} surface="app" cancelHref={APP_ASSET_PATHS.list} />;
}

export default function PhoneNewHandoverPage({ searchParams }: PageProps<'/app/assets/custody/new'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="New Handover" back={{ href: APP_ASSET_PATHS.list, label: 'Assets' }}>
        Choose the employee and the assets. The record gets its code when you save it.
      </PageTitle>
      <Suspense fallback={<PhoneLoading rows={4} />}>
        <NewHandover searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
