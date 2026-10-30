import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { titleCase } from '@/lib/format';
import { BackLink } from '../../../organization/ui';
import { saveAssetValues } from '../../actions';
import { codeFromParam, valuesDefaults } from '../../assets';
import { assetsCaller, assetsNotLoaded, loadAsset } from '../../data';
import { Empty, Loading, NoAccess } from '../../ui';
import { ValuesForm } from '../../values-form';

// An asset's values (owner, 21 October 2026: "CEO and Finance"): for the CEO, Finance and a Super Admin alone, whatever
// their Assets access (they see the register at least as viewers, to fill them). From the asset's page, or from Needs
// Values (?back=needs-values, which it goes back to once saved).

export const metadata: Metadata = { title: 'Asset Values · People System' };

type Props = PageProps<'/assets/[code]/values'>;

async function Values({ params, searchParams }: { params: Props['params']; searchParams: Props['searchParams'] }) {
  const [{ code: raw }, query] = await Promise.all([params, searchParams]);
  const code = codeFromParam(raw);
  if (!code) notFound();
  if (code !== raw) redirect(ASSET_PATHS.values(code));
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  if (!can.values) return <Empty>Only the CEO, Finance and a Super Admin see and set asset values.</Empty>;
  const loaded = await loadAsset(code);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'asset')}</Empty>;
  const asset = loaded.value;
  const back = query.back === 'needs-values' ? 'needs-values' : null;
  return (
    <>
      <BackLink href={back ? ASSET_PATHS.needsValues : ASSET_PATHS.asset(asset.code)}>{back ? 'Needs Values' : asset.code}</BackLink>
      <div>
        <h1 className="page-title">Values of {titleCase(asset.name)}</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="font-mono">{asset.code}</span> · Only the CEO, Finance and a Super Admin see these. The book value is worked out from the purchase
          cost, the purchase date and the useful life.
        </p>
      </div>
      <ValuesForm action={saveAssetValues.bind(null, asset.code, back)} saved={valuesDefaults(asset.values)} cancelHref={back ? ASSET_PATHS.needsValues : ASSET_PATHS.asset(asset.code)} />
    </>
  );
}

export default function AssetValuesPage({ params, searchParams }: Props) {
  return (
    <div className="max-w-3xl space-y-4">
      <Suspense fallback={<Loading />}>
        <Values params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
