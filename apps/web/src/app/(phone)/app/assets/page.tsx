import { ASSET_STATUS_LABELS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { APP_PATHS } from '@/lib/surface';
import { appListHref, countText, holderText, pagesOf, placeText, readAssetQuery, statusTone } from '../../../(app)/assets/assets';
import { assetsCaller, assetsNotLoaded, loadAssets } from '../../../(app)/assets/data';
import { AssetThumb } from '../../../(app)/assets/ui';
import { PageTitle, PhoneCard, PhoneLoading, Quiet } from '../ui';

// Assets on the phone pages (owner's brief, 21 October 2026: "an 'Assets' entry for people with access: add an asset
// with the camera … and the list. Keep it light"): the search (name, code, serial, holder), the register by code, each
// row opening the asset in the phone layout, and Add asset for a custodian or a manager. The site's Assets pages have
// the chips, the rooms, the kits and the values.

export const metadata: Metadata = { title: 'Assets · Trendlix People' };

async function List({ searchParams }: { searchParams: PageProps<'/app/assets'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) {
    return (
      <PhoneCard>
        <Quiet>You don&apos;t have access to Assets. An Admin gives it on the Users page.</Quiet>
      </PhoneCard>
    );
  }
  const query = { ...readAssetQuery(params), group: null, status: null, roomId: null, kitId: null };
  const loaded = await loadAssets({ q: query.q, page: query.page });
  return (
    <div className="space-y-4">
      <form action={APP_ASSET_PATHS.list} role="search" className="flex gap-2">
        <label htmlFor="app-asset-search" className="sr-only">
          Search assets
        </label>
        <input id="app-asset-search" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder="Name, code, serial or holder" className="input min-h-12 flex-1" />
        <button type="submit" className="btn btn-secondary min-h-12">
          Search
        </button>
      </form>
      {can.register && (
        <Link href={APP_ASSET_PATHS.new} className="btn btn-primary min-h-12 w-full">
          Add asset
        </Link>
      )}
      {loaded.kind !== 'ok' ? (
        <PhoneCard>
          <Quiet>{assetsNotLoaded(loaded, 'assets')}</Quiet>
        </PhoneCard>
      ) : loaded.value.items.length === 0 ? (
        <PhoneCard>
          <Quiet>{query.q ? 'No asset matches.' : 'No assets yet.'}</Quiet>
        </PhoneCard>
      ) : (
        <>
          <PhoneCard flush>
            <ul aria-label="Assets" className="divide-y divide-line-soft">
              {loaded.value.items.map((a) => (
                <li key={a.id}>
                  <Link href={APP_ASSET_PATHS.asset(a.code)} className="flex min-h-16 items-center gap-3 px-4 py-3 text-ink no-underline hover:bg-canvas active:bg-canvas">
                    <AssetThumb code={a.code} photo={a.photo} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{a.name}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        <span className="font-mono">{a.code}</span>
                        {placeText(a) ? ` · ${placeText(a)}` : ''}
                        {a.holder ? ` · ${holderText(a.holder)}` : ''}
                      </span>
                    </span>
                    <span className={`badge shrink-0 ${statusTone(a.status)}`}>{ASSET_STATUS_LABELS[a.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </PhoneCard>
          <PhonePages list={loaded.value} query={query} />
        </>
      )}
    </div>
  );
}

function PhonePages({ list, query }: { list: Parameters<typeof pagesOf>[0] & Parameters<typeof countText>[0]; query: ReturnType<typeof readAssetQuery> }) {
  const pages = pagesOf(list, query, appListHref);
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted tabular-nums">{countText(list)}</span>
      <span className="flex gap-2">
        {pages.previous && (
          <Link href={pages.previous} className="btn btn-secondary">
            Previous
          </Link>
        )}
        {pages.next && (
          <Link href={pages.next} className="btn btn-secondary">
            Next
          </Link>
        )}
      </span>
    </div>
  );
}

export default function PhoneAssetsPage({ searchParams }: PageProps<'/app/assets'>) {
  return (
    <div className="space-y-4">
      <PageTitle title="Assets" back={{ href: APP_PATHS.home, label: 'Home' }}>
        The studio&apos;s register. Scan an asset&apos;s QR label with the phone&apos;s camera to open it.
      </PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
