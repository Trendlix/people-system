import { ASSET_GROUP_LABELS, ASSET_TYPE_LABELS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { readAssetQuery } from '../assets';
import { assetsCaller, assetsNotLoaded, loadAssets } from '../data';
import { AssetsFrame } from '../frame';
import { AssetThumb, Empty, Loading, NoAccess, Pages, StatusBadge } from '../ui';

// Needs Values (owner's decisions, 21 October 2026: "CEO and Finance"; "Assets without a purchase cost show in a 'Needs
// values' list for them"): for the CEO, Finance and a Super Admin, every asset without a purchase cost that isn't
// disposed of, by code, with the search, each with Set values (its values form, which comes back here once saved).

export const metadata: Metadata = { title: 'Needs Values · People System' };

const listHref = (query: { q?: string | null; page?: number | null }) => {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const qs = params.toString();
  return qs ? `${ASSET_PATHS.needsValues}?${qs}` : ASSET_PATHS.needsValues;
};

async function NeedsValues({ searchParams }: { searchParams: PageProps<'/assets/needs-values'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  if (!can.values) return <Empty>Only the CEO, Finance and a Super Admin see and set asset values.</Empty>;
  const query = { ...readAssetQuery(params), group: null, status: null, roomId: null, kitId: null };
  const loaded = await loadAssets({ q: query.q, page: query.page, needsValues: true });
  const done = typeof params.done === 'string' ? params.done : null;
  return (
    <div className="space-y-4">
      {done && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          Values saved for {done}.
        </p>
      )}
      <form action={ASSET_PATHS.needsValues} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="needs-values-search" className="label">
            Search
          </label>
          <input id="needs-values-search" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder="Name, code, serial or holder" className="input" />
        </div>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {query.q && (
          <Link href={ASSET_PATHS.needsValues} className="btn btn-secondary">
            Clear
          </Link>
        )}
      </form>
      {loaded.kind !== 'ok' ? (
        <Empty>{assetsNotLoaded(loaded, 'assets')}</Empty>
      ) : loaded.value.items.length === 0 ? (
        <Empty>{query.q ? 'No asset without values matches.' : 'Every asset has its purchase cost. Nothing needs values.'}</Empty>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Photo</span>
                  </th>
                  <th scope="col">Asset</th>
                  <th scope="col">Status</th>
                  <th scope="col">Room</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loaded.value.items.map((a) => (
                  <tr key={a.id}>
                    <td className="w-16">
                      <AssetThumb code={a.code} photo={a.photo} />
                    </td>
                    <td className="min-w-56">
                      <Link href={ASSET_PATHS.asset(a.code)} className="font-semibold">
                        {a.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        <span className="font-mono">{a.code}</span> · {ASSET_GROUP_LABELS[a.group]} · {ASSET_TYPE_LABELS[a.type] ?? a.type}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td>{a.room?.name ?? <span className="text-muted">—</span>}</td>
                    <td className="text-right">
                      <Link href={`${ASSET_PATHS.values(a.code)}?back=needs-values`} className="btn btn-primary min-h-9 px-3 whitespace-nowrap">
                        Set values<span className="sr-only"> of {a.code}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pages list={loaded.value} query={query} listHref={listHref} />
        </>
      )}
    </div>
  );
}

// All Assets → Needs values (owner, 24 October 2026: "7 entries, the rest as tabs"): its tab names it, under All
// Assets' heading (frame.tsx)
export default function NeedsValuesPage({ searchParams }: PageProps<'/assets/needs-values'>) {
  return (
    <AssetsFrame tab={ASSET_PATHS.needsValues}>
      <div className="max-w-5xl">
        <p className="text-muted">
          The assets without a purchase cost, for the CEO, Finance and a Super Admin to fill in from the invoice, with the market value. Only you
          see the values.
        </p>
        <div className="mt-6">
          <Suspense fallback={<Loading />}>
            <NeedsValues searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </AssetsFrame>
  );
}
