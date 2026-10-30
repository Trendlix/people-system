import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Select } from '@/components/select';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { getCurrentUser } from '@/lib/session';
import { asQuery, groupChips, isFiltered, readAssetQuery, statusChips, type ChipLink } from './assets';
import { bulkCan, bulkRowOf } from './bulk';
import { BulkSelection } from './bulk-ui';
import { assetsCaller, assetsNotLoaded, listOrEmpty, loadAssets, loadKits, loadRooms } from './data';
import { AssetsFrame } from './frame';
import { AssetTable, Empty, Loading, NoAccess, Pages } from './ui';

// The asset register (owner, 21 October 2026: "i want to add this module with a special permission to the system"; the
// spec's Assets list: "Search (name, code, serial, holder); filter chips by group and status; cards with photo, code,
// status, location, kit, serial, holder, market and book value"): for anyone with Assets access, the search and the
// chips by group and status with how many each has, the room and kit, a page of 50 by code; the money only for the CEO,
// Finance and a Super Admin ("CEO and Finance"), whom the API alone answers it to. Disposed assets leave the register
// (spec §2.4: "Excluded from all totals") unless the Disposed chip is chosen. Ticks on each row (owner, 25 October 2026:
// "can i delete multiple assets at one?"; "Never-in-custody only"): Delete selected for a Super Admin, Dispose selected
// for an Assets manager (bulk-ui.tsx), the list read again after each with its filters and page kept.

export const metadata: Metadata = { title: 'All Assets · People System' };

const chip = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap no-underline';
const ACTIVE = 'border-ink bg-ink text-on-accent hover:text-on-accent';
const IDLE = 'border-line bg-card text-ink hover:bg-canvas hover:text-ink';

function Chips({ label, chips }: { label: string; chips: ChipLink[] }) {
  return (
    <nav aria-label={label} className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
      {chips.map((c) => (
        <Link key={c.key} href={c.href} aria-current={c.active ? 'page' : undefined} className={`${chip} ${c.active ? ACTIVE : IDLE}`}>
          {c.label}
          {c.count !== undefined && <span className={`tabular-nums ${c.active ? 'opacity-75' : 'text-muted'}`}>{c.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** What the register says with no rows to show. */
function NoRows({ filtered, registers }: { filtered: boolean; registers: boolean }) {
  return (
    <Empty>
      {filtered
        ? 'No asset matches. Try another search, or clear the filters.'
        : registers
          ? 'No assets yet. Add the first one with Add asset.'
          : 'No assets yet. A custodian or a manager registers them.'}
    </Empty>
  );
}

async function Register({ searchParams }: { searchParams: PageProps<'/assets'>['searchParams'] }) {
  const [{ access, can }, params, user] = await Promise.all([assetsCaller(), searchParams, getCurrentUser()]);
  if (!can.view) return <NoAccess />;
  const query = readAssetQuery(params);
  const [loaded, rooms, kits] = await Promise.all([loadAssets(asQuery(query)), loadRooms(), loadKits()]);
  const deleted = typeof params.deleted === 'string' ? params.deleted : null;
  const counts = loaded.kind === 'ok' ? loaded.value.counts : null;
  const roomList = listOrEmpty(rooms);
  const kitList = listOrEmpty(kits);
  const bulk = bulkCan(user, access);

  return (
    <div className="space-y-4">
      {deleted && (
        <p role="status" className="rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">
          {deleted} was deleted. Its code is never given again.
        </p>
      )}
      <form action={ASSET_PATHS.list} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="asset-search" className="label">
            Search
          </label>
          <input id="asset-search" name="q" type="search" maxLength={100} defaultValue={query.q} placeholder="Name, code, serial or holder" className="input" />
        </div>
        <div className="w-full sm:w-auto">
          <label htmlFor="asset-room" className="label">
            Room
          </label>
          <Select id="asset-room" name="roomId" defaultValue={query.roomId ?? ''} className="input sm:min-w-44">
            <option value="">All rooms</option>
            {roomList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.archived ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-auto">
          <label htmlFor="asset-kit" className="label">
            Kit
          </label>
          <Select id="asset-kit" name="kitId" defaultValue={query.kitId ?? ''} className="input sm:min-w-44">
            <option value="">All kits</option>
            {kitList.map((k) => (
              <option key={k.id} value={k.id}>
                {k.code} · {k.name}
              </option>
            ))}
          </Select>
        </div>
        {query.group && <input type="hidden" name="group" value={query.group} />}
        {query.status && <input type="hidden" name="status" value={query.status} />}
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {isFiltered(query) && (
          <Link href={ASSET_PATHS.list} className="btn btn-secondary">
            Clear
          </Link>
        )}
      </form>

      <div className="space-y-2">
        <Chips label="Groups" chips={groupChips(query, counts)} />
        <Chips label="Statuses" chips={statusChips(query, counts)} />
      </div>

      {loaded.kind !== 'ok' ? (
        <Empty>{assetsNotLoaded(loaded, 'assets')}</Empty>
      ) : bulk.any ? (
        // the ticks are this page's: another page, filter or search starts with none; the page emptied by a delete
        // still shows what was done above its "No asset matches"
        <BulkSelection key={JSON.stringify(query)} rows={loaded.value.items.map(bulkRowOf)} can={bulk}>
          {loaded.value.items.length === 0 ? (
            <NoRows filtered={isFiltered(query)} registers={can.register} />
          ) : (
            <>
              <AssetTable rows={loaded.value.items} values={access.values} href={ASSET_PATHS.asset} select />
              <Pages list={loaded.value} query={query} />
            </>
          )}
        </BulkSelection>
      ) : loaded.value.items.length === 0 ? (
        <NoRows filtered={isFiltered(query)} registers={can.register} />
      ) : (
        <>
          <AssetTable rows={loaded.value.items} values={access.values} href={ASSET_PATHS.asset} />
          <Pages list={loaded.value} query={query} />
        </>
      )}
    </div>
  );
}

// All Assets → All (owner, 24 October 2026: "7 entries, the rest as tabs"): the register, under All Assets' heading
// with Add asset at its top right for a custodian or a manager, and the drafts from Claude waiting counted on their tab
// (frame.tsx), both of which were in the search's row until then
export default function AssetsPage({ searchParams }: PageProps<'/assets'>) {
  return (
    <AssetsFrame tab={ASSET_PATHS.list}>
      <p className="text-muted">
        The studio&apos;s register: everything the company owns, where it is and who holds it. Each asset has a code that never changes, the
        address its QR label opens.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Register searchParams={searchParams} />
        </Suspense>
      </div>
    </AssetsFrame>
  );
}
