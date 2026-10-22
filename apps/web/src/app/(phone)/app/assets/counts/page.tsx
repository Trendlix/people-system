import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { APP_ASSET_PATHS } from '@/lib/asset-paths';
import { formatDate } from '@/lib/format';
import { countedText, countFiguresText, scopeKindText } from '../../../../(app)/assets/counts';
import { assetsCaller, assetsNotLoaded, listOrEmpty, loadKits, loadRooms } from '../../../../(app)/assets/data';
import { loadCounts } from '../../../../(app)/assets/step5-data';
import { PageTitle, PhoneCard, PhoneLoading, Quiet } from '../../ui';

// Counts on the phone (Assets step 5; owner, 22 October 2026: "stock counts"; the brief: "a count flow that scans QR
// codes with the camera"): what is due by group, a room or a kit to count, and the last counts made; a count is ticked
// by scanning its labels with the camera (where the phone's browser can read QR codes), by typing or by tapping.

export const metadata: Metadata = { title: 'Counts · Trendlix People' };

const startClass = 'btn btn-secondary min-h-12 w-full justify-between';

async function Counts() {
  const { can } = await assetsCaller();
  if (!can.view) {
    return (
      <PhoneCard>
        <Quiet>You don&apos;t have access to Assets. An Admin gives it on the Users page.</Quiet>
      </PhoneCard>
    );
  }
  const [loaded, rooms, kits] = await Promise.all([loadCounts(1), loadRooms(), loadKits()]);
  if (loaded.kind !== 'ok') {
    return (
      <PhoneCard>
        <Quiet>{assetsNotLoaded(loaded, 'counts')}</Quiet>
      </PhoneCard>
    );
  }
  const { schedule, history } = loaded.value;
  return (
    <div className="space-y-4">
      <PhoneCard title="By Group">
        <ul className="space-y-2">
          {schedule.map((s) => (
            <li key={s.group}>
              {can.register && s.assets > 0 ? (
                <Link href={APP_ASSET_PATHS.countNew({ kind: 'group', group: s.group })} className={startClass}>
                  <span>{s.label}</span>
                  <span className={`text-xs ${s.overdue || s.neverCounted ? 'font-semibold text-warn' : 'text-muted'}`}>
                    {s.neverCounted ? 'Due now' : s.overdue ? `Overdue since ${formatDate(s.dueOn)}` : `Next ${formatDate(s.dueOn)}`}
                  </span>
                </Link>
              ) : (
                <p className="flex min-h-12 items-center justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="text-xs text-muted">{s.assets === 0 ? 'No assets' : s.neverCounted ? 'Due now' : `Next ${formatDate(s.dueOn)}`}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      </PhoneCard>
      {can.register && (
        <>
          <PhoneCard title="A Room">
            {listOrEmpty(rooms).filter((r) => !r.archived).length === 0 ? (
              <Quiet>No rooms yet.</Quiet>
            ) : (
              <ul className="space-y-2">
                {listOrEmpty(rooms)
                  .filter((r) => !r.archived)
                  .map((r) => (
                    <li key={r.id}>
                      <Link href={APP_ASSET_PATHS.countNew({ kind: 'room', roomId: r.id })} className={startClass}>
                        <span>{r.name}</span>
                        <span className="text-xs text-muted">{r.assets}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </PhoneCard>
          <PhoneCard title="A Kit">
            {listOrEmpty(kits).length === 0 ? (
              <Quiet>No kits yet.</Quiet>
            ) : (
              <ul className="space-y-2">
                {listOrEmpty(kits).map((k) => (
                  <li key={k.id}>
                    <Link href={APP_ASSET_PATHS.countNew({ kind: 'kit', kitId: k.id })} className={startClass}>
                      <span>
                        {k.code} · {k.name}
                      </span>
                      <span className="text-xs text-muted">{k.assets}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PhoneCard>
        </>
      )}
      <PhoneCard title="Last Counts" flush>
        {history.length === 0 ? (
          <div className="px-4 pb-4">
            <Quiet>No count yet.</Quiet>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {history.slice(0, 10).map((c) => (
              <li key={c.id}>
                <Link href={APP_ASSET_PATHS.count(c.id)} className="block min-h-14 px-4 py-3 text-ink no-underline active:bg-canvas">
                  <span className="block font-medium">
                    {scopeKindText(c.scope.kind)}: {c.scope.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {countedText(c)} · {countFiguresText(c)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PhoneCard>
    </div>
  );
}

export default function PhoneCountsPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="Counts" back={{ href: APP_ASSET_PATHS.list, label: 'Assets' }}>
        Tick what is there by scanning its label, typing its code or tapping it.
      </PageTitle>
      <Suspense fallback={<PhoneLoading />}>
        <Counts />
      </Suspense>
    </div>
  );
}
