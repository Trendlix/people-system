import { ASSET_GROUP_LABELS, ASSET_TYPE_LABELS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { titleCase } from '@/lib/format';
import { todayInCairo } from '../../../../(app)/employees/ui';
import { AssetDetail } from '../../../../(app)/assets/asset-detail';
import { codeFromParam } from '../../../../(app)/assets/assets';
import { assetsCaller, assetsNotLoaded, loadAsset } from '../../../../(app)/assets/data';
import { StatusBadge } from '../../../../(app)/assets/ui';
import { PhoneCard, PhoneLoading, Quiet } from '../../ui';

// An asset in the phone layout (owner's brief, 21 October 2026: "/app/assets/[code] showing the same detail in the phone
// layout, so a QR scanned in the app or the phone's camera opens nicely"): the site's asset page inside the app opens
// here (its web view says so in its user agent). The same photos (Take photo to add one), QR code, fields and values
// (the CEO, Finance and a Super Admin) as the site's; Edit opens the site's form.

export const metadata: Metadata = { title: 'Asset · Trendlix People' };

type Props = PageProps<'/app/assets/[code]'>;

async function Detail({ params, searchParams }: { params: Props['params']; searchParams: Props['searchParams'] }) {
  const [{ code: raw }, query] = await Promise.all([params, searchParams]);
  const code = codeFromParam(raw);
  if (!code) notFound();
  if (code !== raw) redirect(APP_ASSET_PATHS.asset(code));
  const { can } = await assetsCaller();
  if (!can.view) {
    return (
      <PhoneCard>
        <Quiet>You don&apos;t have access to Assets. An Admin gives it on the Users page.</Quiet>
      </PhoneCard>
    );
  }
  const loaded = await loadAsset(code);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') {
    return (
      <PhoneCard>
        <Quiet>{assetsNotLoaded(loaded, 'asset')}</Quiet>
      </PhoneCard>
    );
  }
  const asset = loaded.value;
  const failed = Number(typeof query.photosFailed === 'string' ? query.photosFailed : 0);
  return (
    <>
      <div className="space-y-1">
        <p className="font-mono text-xs font-semibold text-muted">{asset.code}</p>
        <h1 className="text-xl font-semibold">{titleCase(asset.name)}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusBadge status={asset.status} />
          {ASSET_GROUP_LABELS[asset.group]} · {ASSET_TYPE_LABELS[asset.type] ?? asset.type}
        </p>
      </div>
      <AssetDetail asset={asset} surface="app" today={todayInCairo()} done={typeof query.done === 'string' ? query.done : null} photosFailed={Number.isFinite(failed) ? failed : 0} />
    </>
  );
}

export default function PhoneAssetPage({ params, searchParams }: Props) {
  return (
    <div className="space-y-4">
      <Link href={APP_ASSET_PATHS.list} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">
        <span aria-hidden="true">←</span> Assets
      </Link>
      <Suspense fallback={<PhoneLoading rows={4} />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
