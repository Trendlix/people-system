import { ASSET_GROUP_LABELS, ASSET_GROUPS, LABEL_SHEET } from '@trendlix/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Select } from '@/components/select';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { formatDate } from '@/lib/format';
import { readLabelQuery } from '../counts';
import { assetsCaller, assetsNotLoaded, listOrEmpty, loadKits, loadRooms } from '../data';
import { loadLabelChoices } from '../step5-data';
import { Empty, Loading, NoAccess, StatusBadge } from '../ui';

// Label sheets (Assets step 5; owner, 22 October 2026: "label sheets"; spec §5: "labels (A4, 3 × 8 labels of 63 × 30 mm:
// QR to https://people.trendlix.com/assets/{code}, the code, the name, the company name; after printing set
// labeled_at)"): the assets whose labels may print, "Not labelled yet" unless asked otherwise, by group, room, kit or a
// search, each ticked (up to 240, ten sheets); the label to start at, for a sheet already partly used; then the sheets
// to check and print, and Mark as labelled once they are stuck on.

export const metadata: Metadata = { title: 'Label Sheets · People System' };

async function Choices({ searchParams }: { searchParams: PageProps<'/assets/labels'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  const query = readLabelQuery(params);
  const [loaded, rooms, kits] = await Promise.all([loadLabelChoices(query), loadRooms(), loadKits()]);
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'labels')}</Empty>;
  const choices = loaded.value;
  return (
    <div className="space-y-6">
      <form action={ASSET_PATHS.labels} className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label htmlFor="labels-show" className="label">
            Show
          </label>
          <Select id="labels-show" name="show" defaultValue={query.unlabelled ? 'unlabelled' : 'all'} className="input">
            <option value="unlabelled">Not labelled yet</option>
            <option value="all">All, labelled or not</option>
          </Select>
        </div>
        <div>
          <label htmlFor="labels-group" className="label">
            Group
          </label>
          <Select id="labels-group" name="group" defaultValue={query.group ?? ''} className="input">
            <option value="">All groups</option>
            {ASSET_GROUPS.map((g) => (
              <option key={g} value={g}>
                {ASSET_GROUP_LABELS[g]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="labels-room" className="label">
            Room
          </label>
          <Select id="labels-room" name="roomId" defaultValue={query.roomId ?? ''} className="input">
            <option value="">All rooms</option>
            {listOrEmpty(rooms).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="labels-kit" className="label">
            Kit
          </label>
          <Select id="labels-kit" name="kitId" defaultValue={query.kitId ?? ''} className="input">
            <option value="">All kits</option>
            {listOrEmpty(kits).map((k) => (
              <option key={k.id} value={k.id}>
                {k.code} · {k.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="labels-q" className="label">
            Search
          </label>
          <input id="labels-q" name="q" type="search" maxLength={100} defaultValue={query.q ?? ''} placeholder="Name, code or serial" className="input" />
        </div>
        <div className="sm:col-span-2 lg:col-span-5">
          <button type="submit" className="btn btn-secondary">
            Show assets
          </button>
        </div>
      </form>

      {choices.length === 0 ? (
        <Empty>{query.unlabelled ? 'Every asset here has its label already.' : 'No asset matches.'}</Empty>
      ) : (
        <form action={`${ASSET_PATHS.labels}/print`} className="space-y-4">
          <p className="text-sm text-muted">
            {choices.length} {choices.length === 1 ? 'asset' : 'assets'}
            {choices.length > LABEL_SHEET.maxLabels ? `: the first ${LABEL_SHEET.maxLabels} are ticked (ten sheets). Print them, then the rest.` : '. Untick those not to print.'}
          </p>
          <ul aria-label="Labels to print" className="card divide-y divide-line-soft">
            {choices.map((c, i) => (
              <li key={c.code}>
                <label htmlFor={`label-${c.code}`} className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-canvas">
                  <input id={`label-${c.code}`} type="checkbox" name="codes" value={c.code} defaultChecked={i < LABEL_SHEET.maxLabels} className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{c.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      <span className="font-mono">{c.code}</span>
                      {c.room ? ` · ${c.room.name}` : ''}
                      {c.kit ? ` · ${c.kit.code}` : ''}
                      {c.labeledAt ? ` · labelled ${formatDate(c.labeledAt.slice(0, 10))}` : ''}
                    </span>
                  </span>
                  <StatusBadge status={c.status} />
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="labels-start" className="label">
                Start at label
              </label>
              <input id="labels-start" name="start" type="number" min={1} max={LABEL_SHEET.perSheet} step={1} defaultValue={1} className="input w-28" />
              <p className="mt-1 text-xs text-muted">1 to 24: on a sheet already partly used, the first label left.</p>
            </div>
            <button type="submit" className="btn btn-primary">
              Preview sheets
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LabelSheetsPage({ searchParams }: PageProps<'/assets/labels'>) {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Label Sheets</h1>
      <p className="mt-1 text-muted">
        A4 sheets of 24 labels ({LABEL_SHEET.columns} × {LABEL_SHEET.rows}, {LABEL_SHEET.labelWidthMm} × {LABEL_SHEET.labelHeightMm} mm). Each label&apos;s QR code opens
        its asset&apos;s page.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Choices searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
