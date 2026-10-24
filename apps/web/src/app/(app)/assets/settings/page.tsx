import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { formatDateTime } from '@/lib/format';
import { saveAssetSettings } from '../actions';
import { moneyText } from '../assets';
import { restoreStandardTerms, saveCustodyTerms } from '../custody-actions';
import { TermsForm } from '../terms-form';
import { assetsCaller, assetsNotLoaded, loadAssetSettings } from '../data';
import { AssetsFrame } from '../frame';
import { ThresholdForm } from '../place-forms';
import { Empty, Loading, NoAccess } from '../ui';

// The Assets settings (owner, 21 October 2026; spec §5: "Settings: Capitalization threshold, locations (rooms),
// exports"): the capitalization threshold, for an Assets manager and for the CEO, Finance and a Super Admin, who set the
// values it decides on (spec §6.8: "Assets cheaper than the capitalization threshold are Expensed, book value 0"). The
// rooms have a page of their own; the exports come with a later step. Since step 3 (custody, 21 October 2026): the terms
// the custody forms print, an Assets manager's alone (the brief: "editable text, managers only").

export const metadata: Metadata = { title: 'Asset Settings · People System' };

async function Settings() {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  if (!can.settings) return <Empty>Only an Assets manager, the CEO, Finance or a Super Admin changes the asset settings.</Empty>;
  const loaded = await loadAssetSettings();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'settings')}</Empty>;
  const s = loaded.value;
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <ThresholdForm action={saveAssetSettings} saved={String(s.capitalizationThreshold)} />
        <p className="text-sm text-muted">
          Now {moneyText(s.capitalizationThreshold)}.
          {s.updatedAt && ` Changed ${formatDateTime(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy.name ?? s.updatedBy.email}` : ''}.`}
        </p>
      </div>
      {can.manage && s.custodyTerms && (
        <section aria-labelledby="custody-terms" className="card space-y-3 p-5">
          <div>
            <h2 id="custody-terms" className="font-semibold">
              Custody Terms
            </h2>
            <p className="mt-0.5 text-sm text-muted">What the employee agrees to when they sign a custody form. Each record keeps the terms it was printed with.</p>
          </div>
          <TermsForm action={saveCustodyTerms} standardAction={restoreStandardTerms} terms={s.custodyTerms} standard={s.custodyTermsStandard} />
        </section>
      )}
    </div>
  );
}

// Setup → Settings (owner, 24 October 2026: "7 entries, the rest as tabs"; "Keep them inside Assets"): its tab names it,
// under Setup's heading (frame.tsx)
export default function AssetSettingsPage() {
  return (
    <AssetsFrame tab={ASSET_PATHS.settings}>
      <p className="text-muted">
        The capitalization threshold: an asset cheaper than it is Expensed, its book value 0. Every other fixed asset loses its value in a straight
        line over its useful life.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Settings />
        </Suspense>
      </div>
    </AssetsFrame>
  );
}
