import { ASSET_TYPE_LABELS, type StockLevelView } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_API, ASSET_PATHS } from '@/lib/asset-paths';
import { loadJson } from '../../payroll/load';
import { quantityText } from '../assets';
import { assetsCaller, assetsNotLoaded } from '../data';
import { Empty, Loading, NoAccess } from '../ui';
import { StockActions } from '../upkeep-ui';

// Stock (Assets step 4; the spec's Stock: "Consumables with qty, unit, reorder flag; Use / Restock dialogs; movement
// history"): every consumable with how many are left, flagged Reorder at or under its reorder level (spec §6.7), those to
// reorder first; Use and Restock in place for an Assets custodian or manager (the stock never below 0, each move kept on
// the consumable's page). Everyone with Assets access reads it. ?reorder=1: only those to reorder.

export const metadata: Metadata = { title: 'Stock · People System' };

// the register's chips' look (assets/page.tsx)
const chip = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';

async function Stock({ searchParams }: { searchParams: PageProps<'/assets/stock'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  const reorderOnly = params.reorder === '1';
  const loaded = await loadJson<StockLevelView[]>(ASSET_API.reports.stock(reorderOnly));
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'stock')}</Empty>;
  const rows = [...loaded.value].sort((a, b) => Number(b.reorder) - Number(a.reorder) || a.name.localeCompare(b.name));
  const toReorder = rows.filter((r) => r.reorder).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={ASSET_PATHS.stock} aria-current={!reorderOnly ? 'page' : undefined} className={`${chip} ${!reorderOnly ? ACTIVE : IDLE}`}>
          All
        </Link>
        <Link href={`${ASSET_PATHS.stock}?reorder=1`} aria-current={reorderOnly ? 'page' : undefined} className={`${chip} ${reorderOnly ? ACTIVE : IDLE}`}>
          To reorder{!reorderOnly && toReorder ? ` (${toReorder})` : ''}
        </Link>
        {can.register && (
          <Link href={ASSET_PATHS.new} className="ml-auto text-sm font-semibold">
            Add a consumable
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty>{reorderOnly ? 'Nothing needs reordering.' : 'No consumables yet. Add one from Add Asset, in the Consumables and stock group.'}</Empty>
      ) : (
        <ul aria-label="Consumables" className="space-y-3">
          {rows.map((r) => (
            <li key={r.code} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <Link href={ASSET_PATHS.asset(r.code)} className="font-semibold break-words">
                    {r.name}
                  </Link>
                  <p className="text-xs text-muted">
                    <span className="font-mono">{r.code}</span> · {ASSET_TYPE_LABELS[r.type] ?? r.type}
                    {r.room ? ` · ${r.room.name}` : ''}
                    {r.reorderLevel !== null ? ` · reorder at ${quantityText(r.reorderLevel, r.unit)}` : ''}
                  </p>
                </div>
                <p className="flex items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">{quantityText(r.quantity, r.unit)}</span>
                  {r.reorder && <span className="badge bg-warn-soft text-warn">Reorder</span>}
                </p>
              </div>
              {can.register && <StockActions code={r.code} quantity={r.quantity ?? 0} unit={r.unit} />}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Each use and restock is kept on the consumable&apos;s page, with who made it and the stock after it.</p>
    </div>
  );
}

export default function StockPage({ searchParams }: PageProps<'/assets/stock'>) {
  return (
    <div className="max-w-4xl">
      <h1 className="page-title">Stock</h1>
      <p className="mt-1 text-muted">Consumables by quantity: use them, restock them, and see what needs reordering.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Stock searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
