import { ASSET_GROUP_LABELS, ASSET_TYPE_LABELS, sessionKindOf } from '@trendlix/shared';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { APP_ASSET_PATHS, ASSET_PATHS } from '@/lib/asset-paths';
import { titleCase } from '@/lib/format';
import { BackLink } from '../../organization/ui';
import { todayInCairo } from '../../employees/ui';
import { AssetDetail } from '../asset-detail';
import { codeFromParam, keptQuery } from '../assets';
import { loadAssetHistory } from '../custody-data';
import { assetsCaller, assetsNotLoaded, loadAsset } from '../data';
import { Empty, Loading, NoAccess, StatusBadge } from '../ui';

// An asset's page on the site (owner, 21 October 2026: "i want to add this module with a special permission to the
// system"), at /assets/[code]: the address inside its QR label (https://people.trendlix.com/assets/{code}). A code in
// lower case is sent to the page of the code as kept. Opened inside the Trendlix People app (its web view says so in its
// user agent, "TrendLIXPeople"), the same page in the phone layout opens instead (/app/assets/[code]); the site doesn't
// otherwise send a phone's browser to the phone pages, and works at a phone's width.

export const metadata: Metadata = { title: 'Asset · People System' };

async function Detail({ params, searchParams }: { params: PageProps<'/assets/[code]'>['params']; searchParams: PageProps<'/assets/[code]'>['searchParams'] }) {
  const [{ code: raw }, query, h] = await Promise.all([params, searchParams, headers()]);
  const code = codeFromParam(raw);
  if (!code) notFound();
  if (sessionKindOf(h.get('user-agent')) === 'app') redirect(`${APP_ASSET_PATHS.asset(code)}${keptQuery(query)}`);
  if (code !== raw) redirect(ASSET_PATHS.asset(code));
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  // its custody history and maintenance log (step 3), beside it
  const [loaded, history] = await Promise.all([loadAsset(code), loadAssetHistory(code)]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'asset')}</Empty>;
  const asset = loaded.value;
  const failed = Number(typeof query.photosFailed === 'string' ? query.photosFailed : 0);
  return (
    <>
      <div className="space-y-1">
        <p className="font-mono text-sm font-semibold text-muted">{asset.code}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{titleCase(asset.name)}</h1>
          <StatusBadge status={asset.status} />
        </div>
        <p className="text-sm text-muted">
          {ASSET_GROUP_LABELS[asset.group]} · {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
          {asset.brand || asset.model ? ` · ${[asset.brand, asset.model].filter(Boolean).join(' ')}` : ''}
        </p>
      </div>
      <AssetDetail
        asset={asset}
        surface="site"
        today={todayInCairo()}
        done={typeof query.done === 'string' ? query.done : null}
        photosFailed={Number.isFinite(failed) ? failed : 0}
        history={history.kind === 'ok' ? history.value : null}
        values={can.values}
      />
    </>
  );
}

export default function AssetPage({ params, searchParams }: PageProps<'/assets/[code]'>) {
  return (
    <div className="max-w-6xl space-y-4">
      <BackLink href={ASSET_PATHS.list}>Assets</BackLink>
      <Suspense fallback={<Loading />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
