import type { Metadata } from 'next';
import { Suspense } from 'react';
import { formatDateTime } from '@/lib/format';
import { saveAssetSettings } from '../actions';
import { moneyText } from '../assets';
import { assetsCaller, assetsNotLoaded, loadAssetSettings } from '../data';
import { ThresholdForm } from '../place-forms';
import { Empty, Loading, NoAccess } from '../ui';

// The Assets settings (owner, 21 October 2026; spec §5: "Settings: Capitalization threshold, locations (rooms),
// exports"): the capitalization threshold, for an Assets manager and for the CEO, Finance and a Super Admin, who set the
// values it decides on (spec §6.8: "Assets cheaper than the capitalization threshold are Expensed, book value 0"). The
// rooms have a page of their own; the exports come with a later step.

export const metadata: Metadata = { title: 'Asset Settings · People System' };

async function Settings() {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  if (!can.settings) return <Empty>Only an Assets manager, the CEO, Finance or a Super Admin changes the asset settings.</Empty>;
  const loaded = await loadAssetSettings();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'settings')}</Empty>;
  const s = loaded.value;
  return (
    <div className="space-y-3">
      <ThresholdForm action={saveAssetSettings} saved={String(s.capitalizationThreshold)} />
      <p className="text-sm text-muted">
        Now {moneyText(s.capitalizationThreshold)}.
        {s.updatedAt && ` Changed ${formatDateTime(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy.name ?? s.updatedBy.email}` : ''}.`}
      </p>
    </div>
  );
}

export default function AssetSettingsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Asset Settings</h1>
      <p className="mt-1 text-muted">
        The capitalization threshold: an asset cheaper than it is Expensed, its book value 0. Every other fixed asset loses its value in a straight
        line over its useful life.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Settings />
        </Suspense>
      </div>
    </div>
  );
}
