import { ASSET_EXPORT_LABELS, ASSET_EXPORTS, ASSET_GROUP_LABELS, ASSET_GROUPS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { formatDate } from '@/lib/format';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { attentionChips } from '../counts';
import { assetsCaller, assetsNotLoaded } from '../data';
import { loadDashboard } from '../step5-data';
import { Empty, Loading, NoAccess } from '../ui';

// The Assets dashboard (Assets step 5; owner, 22 October 2026: "the Assets dashboard"; the spec's §5 Dashboard: "Market
// value, book value, assets out now; attention chips (overdue returns, lost, low stock, counts due, unsigned handovers,
// under repair, employees in clearance)"), for anyone with Assets access: how many assets, out now, available, under
// repair and lost, by group; the values only for the CEO, Finance and a Super Admin ("CEO and Finance"), whom the API
// alone answers them to; the chips that need attention, each opening its list; and the exports (Excel), their money
// columns only for those who see the values. Disposed assets are out of every figure.

export const metadata: Metadata = { title: 'Assets Dashboard · People System' };

function Figure({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <span className="block text-sm text-muted">{label}</span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums">{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 text-ink no-underline hover:bg-canvas">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

async function Dashboard() {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const loaded = await loadDashboard();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'dashboard')}</Empty>;
  const d = loaded.value;
  const chips = attentionChips(d);
  return (
    <div className="space-y-8">
      <section aria-labelledby="totals" className="space-y-3">
        <h2 id="totals" className="font-semibold">
          Assets Now
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Figure label="Assets" value={d.totals.assets} href={ASSET_PATHS.list} />
          <Figure label="Out now (in custody)" value={d.totals.custody} href={CUSTODY_PATHS.list} />
          <Figure label="Available" value={d.totals.available} href={ASSET_PATHS.listWith({ status: 'available' })} />
          <Figure label="Under repair" value={d.totals.repair} href={ASSET_PATHS.listWith({ status: 'repair' })} />
          <Figure label="Lost" value={d.totals.lost} href={ASSET_PATHS.listWith({ status: 'lost' })} />
        </div>
        {d.values && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="Market value" value={formatEgp(d.values.marketValue)} />
            <Figure label={`Book value on ${formatDate(d.on)}`} value={formatEgp(d.values.bookValue)} />
            <Figure label="Purchase cost" value={formatEgp(d.values.purchaseCost)} />
          </div>
        )}
        {d.values && d.values.withoutCost > 0 && (
          <p className="text-sm text-muted">
            {d.values.withoutCost} {d.values.withoutCost === 1 ? 'asset has' : 'assets have'} no purchase cost yet, so no book value:{' '}
            <Link href={ASSET_PATHS.needsValues}>Needs values</Link>.
          </p>
        )}
      </section>

      <section aria-labelledby="attention" className="space-y-3">
        <h2 id="attention" className="font-semibold">
          Needs Attention
        </h2>
        <ul className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              {c.href ? (
                <Link
                  href={c.href}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-warn/40 bg-warn-soft px-4 text-sm font-semibold text-ink no-underline hover:bg-warn-soft/70"
                >
                  {c.label}
                  <span className="tabular-nums">{c.count}</span>
                </Link>
              ) : (
                <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-white px-4 text-sm text-muted">
                  {c.label}
                  <span className="tabular-nums">0</span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {d.unlabelled > 0 && (
          <p className="text-sm text-muted">
            {d.unlabelled} {d.unlabelled === 1 ? 'asset has' : 'assets have'} no label printed yet: <Link href={ASSET_PATHS.labelsWith({ unlabelled: true })}>Label sheets</Link>.
          </p>
        )}
      </section>

      <section aria-labelledby="by-group" className="space-y-3">
        <h2 id="by-group" className="font-semibold">
          By Group
        </h2>
        <ul className="card divide-y divide-line-soft">
          {ASSET_GROUPS.map((g) => (
            <li key={g}>
              <Link href={ASSET_PATHS.listWith({ group: g })} className="flex min-h-12 items-center justify-between gap-3 px-4 text-ink no-underline hover:bg-canvas">
                <span>{ASSET_GROUP_LABELS[g]}</span>
                <span className="font-semibold tabular-nums">{d.byGroup[g]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="exports" className="space-y-3">
        <div>
          <h2 id="exports" className="font-semibold">
            Exports
          </h2>
          <p className="mt-1 text-sm text-muted">Excel workbooks of the whole module, as it stands now.{can.values ? '' : ' The money columns are only in the CEO’s, Finance’s and a Super Admin’s.'}</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ASSET_EXPORTS.map((k) => (
            <li key={k} className="card flex flex-col gap-2 p-4">
              <span className="font-semibold">{ASSET_EXPORT_LABELS[k].title}</span>
              <span className="text-sm text-muted">{ASSET_EXPORT_LABELS[k].hint}</span>
              {/* a plain link to a file: never prefetched */}
              <a href={ASSET_PATHS.exportFile(k)} className="btn btn-secondary mt-auto self-start" download>
                Download Excel
                <span className="sr-only"> of the {ASSET_EXPORT_LABELS[k].title.toLowerCase()}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function AssetsDashboardPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Assets Dashboard</h1>
      <p className="mt-1 text-muted">What is out, what needs attention, and the exports. Disposed assets are left out.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Dashboard />
        </Suspense>
      </div>
    </div>
  );
}
