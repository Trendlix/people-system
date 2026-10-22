import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Select } from '@/components/select';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { formatDate, formatDateTime } from '@/lib/format';
import { countedText, countFiguresText, scopeKindText } from '../counts';
import { assetsCaller, assetsNotLoaded, listOrEmpty, loadKits, loadRooms } from '../data';
import { loadCounts } from '../step5-data';
import { Empty, Loading, NoAccess } from '../ui';

// Counts (Assets step 5; owner, 22 October 2026: "stock counts"; the spec's §5 Counts: "Schedule per group (last
// counted, next due, status); count by group, room or kit; history with missing items and 'Mark lost'"): each group's
// schedule, every so many days after its last count of the whole group (never counted: due now), with Count now; a room
// or a kit counted too; and the counts made, newest first, each opening its results. Anyone with Assets access reads;
// a custodian or a manager counts (the API checks again).

export const metadata: Metadata = { title: 'Counts · People System' };

function StartForm({ kind, label, options }: { kind: 'room' | 'kit'; label: string; options: { value: string; label: string }[] }) {
  const field = kind === 'room' ? 'roomId' : 'kitId';
  return (
    <form action={`${ASSET_PATHS.counts}/new`} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="kind" value={kind} />
      <div className="min-w-56 flex-1">
        <label htmlFor={`count-${kind}`} className="label">
          {label}
        </label>
        <Select id={`count-${kind}`} name={field} required defaultValue="" className="input">
          <option value="" disabled>
            Choose…
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <button type="submit" className="btn btn-secondary" disabled={!options.length}>
        Start count
      </button>
    </form>
  );
}

async function Counts({ searchParams }: { searchParams: PageProps<'/assets/counts'>['searchParams'] }) {
  const [{ can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : 1) || 1);
  const [loaded, rooms, kits] = await Promise.all([loadCounts(page), loadRooms(), loadKits()]);
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'counts')}</Empty>;
  const { schedule, history, total, pageSize } = loaded.value;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-8">
      <section aria-labelledby="schedule" className="space-y-3">
        <h2 id="schedule" className="font-semibold">
          Schedule
        </h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Group
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Assets
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Every
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Last counted
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Next due
                </th>
                {can.register && (
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    <span className="sr-only">Count</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {schedule.map((s) => (
                <tr key={s.group}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">
                    {s.label}
                  </th>
                  <td className="px-4 py-2.5 tabular-nums">{s.assets}</td>
                  <td className="px-4 py-2.5">{s.everyDays} days</td>
                  <td className="px-4 py-2.5">{s.lastCountedAt ? formatDateTime(s.lastCountedAt) : 'Never counted'}</td>
                  <td className="px-4 py-2.5">
                    {s.assets === 0 ? (
                      <span className="text-muted">No assets</span>
                    ) : (
                      <span className={s.overdue || s.neverCounted ? 'font-semibold text-warn' : ''}>
                        {formatDate(s.dueOn)}
                        {s.overdue ? ' · overdue' : s.neverCounted ? ' · due now' : ''}
                      </span>
                    )}
                  </td>
                  {can.register && (
                    <td className="px-4 py-2.5 text-right">
                      {s.assets > 0 && (
                        <Link href={ASSET_PATHS.countNew({ kind: 'group', group: s.group })} className="font-semibold">
                          Count now<span className="sr-only"> {s.label}</span>
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {can.register && (
        <section aria-labelledby="count-place" className="space-y-3">
          <h2 id="count-place" className="font-semibold">
            Count a Room or a Kit
          </h2>
          <div className="card grid gap-4 p-5 md:grid-cols-2">
            <StartForm kind="room" label="Room" options={listOrEmpty(rooms).filter((r) => !r.archived).map((r) => ({ value: r.id, label: `${r.name} (${r.assets})` }))} />
            <StartForm kind="kit" label="Kit" options={listOrEmpty(kits).map((k) => ({ value: k.id, label: `${k.code} · ${k.name} (${k.assets})` }))} />
          </div>
        </section>
      )}

      <section aria-labelledby="history" className="space-y-3">
        <h2 id="history" className="font-semibold">
          Counts Made
        </h2>
        {history.length === 0 ? (
          <Empty>No count yet.</Empty>
        ) : (
          <ul className="card divide-y divide-line-soft">
            {history.map((c) => (
              <li key={c.id}>
                <Link href={ASSET_PATHS.count(c.id)} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-ink no-underline hover:bg-canvas">
                  <span className="min-w-0">
                    <span className="font-medium">
                      {scopeKindText(c.scope.kind)}: {c.scope.label}
                    </span>
                    <span className="block text-xs text-muted">{countedText(c)}</span>
                  </span>
                  <span className={`text-sm tabular-nums ${c.missing > c.lostMarked ? 'font-semibold text-warn' : 'text-muted'}`}>{countFiguresText(c)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
            {page > 1 && <Link href={ASSET_PATHS.countsPage(page - 1)}>Newer</Link>}
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            {page < pages && <Link href={ASSET_PATHS.countsPage(page + 1)}>Older</Link>}
          </nav>
        )}
      </section>
    </div>
  );
}

export default function CountsPage({ searchParams }: PageProps<'/assets/counts'>) {
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Counts</h1>
      <p className="mt-1 text-muted">
        Tick what is there, by tapping, typing or scanning labels. Whatever isn&apos;t ticked is missing; what is in custody counts as out. Mark a missing asset lost
        from its count once it is looked for.
      </p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Counts searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
