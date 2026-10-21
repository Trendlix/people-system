import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { titleCase } from '@/lib/format';
import { BackLink } from '../../../organization/ui';
import { todayInCairo } from '../../../employees/ui';
import { AssetForm } from '../../asset-form';
import { codeFromParam, editDefaults, valuesDefaults } from '../../assets';
import { assetsCaller, assetsNotLoaded, listOrEmpty, loadAsset, loadKits, loadRooms } from '../../data';
import { Empty, Loading, NoAccess } from '../../ui';

// Edit asset (owner, 21 October 2026: "i want to add this module with a special permission to the system"): for an
// Assets custodian or manager, the same form as Add with what it has now; its code never changes, even when its group
// or type does (what the new group doesn't have is cleared). The status by hand: Available, Under repair or Lost (In
// custody comes with a handover, Disposed with disposal). The values for the CEO, Finance and a Super Admin.

export const metadata: Metadata = { title: 'Edit Asset · People System' };

async function EditAsset({ params }: { params: PageProps<'/assets/[code]/edit'>['params'] }) {
  const { code: raw } = await params;
  const code = codeFromParam(raw);
  if (!code) notFound();
  if (code !== raw) redirect(ASSET_PATHS.edit(code));
  const { access, can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const [loaded, rooms, kits] = await Promise.all([loadAsset(code), loadRooms(), loadKits()]);
  if (loaded.kind === 'unavailable') notFound();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'asset')}</Empty>;
  const asset = loaded.value;
  if (!asset.can.edit) return <Empty>Only an Assets custodian or manager edits assets.</Empty>;
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Edit {titleCase(asset.name)}</h1>
        <p className="mt-1 font-mono text-sm text-muted">{asset.code}</p>
      </div>
      <AssetForm
        mode="edit"
        code={asset.code}
        from={asset.status}
        defaults={editDefaults(asset)}
        values={access.values ? valuesDefaults(asset.values) : null}
        rooms={listOrEmpty(rooms)}
        kits={listOrEmpty(kits)}
        today={todayInCairo()}
        photosHad={asset.photos.length}
        ai={access.ai}
        surface="site"
        cancelHref={ASSET_PATHS.asset(asset.code)}
      />
    </>
  );
}

export default function EditAssetPage({ params }: PageProps<'/assets/[code]/edit'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <Suspense fallback={null}>
        <Back params={params} />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <EditAsset params={params} />
      </Suspense>
    </div>
  );
}

async function Back({ params }: { params: PageProps<'/assets/[code]/edit'>['params'] }) {
  const code = codeFromParam((await params).code);
  return <BackLink href={code ? ASSET_PATHS.asset(code) : ASSET_PATHS.list}>{code ?? 'Assets'}</BackLink>;
}
