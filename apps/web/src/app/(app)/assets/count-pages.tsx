import { ASSET_COUNT_RESULT_LABELS, type AssetCountResult } from '@trendlix/shared';
import Link from 'next/link';
import { APP_ASSET_PATHS, ASSET_PATHS, type CountScopeQuery } from '@/lib/asset-paths';
import { titleCase } from '@/lib/format';
import { CountSheet, MarkLostButton } from './count-sheet';
import { countedText, countFiguresText, scopeKindText } from './counts';
import { assetsCaller, assetsNotLoaded } from './data';
import { markLostFromCount, saveCount } from './step5-actions';
import { loadCount, loadCountSheet } from './step5-data';
import { Empty, NoAccess } from './ui';

// A count's two pages (Assets step 5; owner, 22 October 2026: "stock counts"), the same on the site and on the phone
// (`phone`: the links go to the phone pages): the sheet of a new count, for a custodian or a manager; and a count's
// results, missing first, with Mark lost on each missing one still available or under repair (spec §6.5: a deliberate
// step), for a custodian or a manager.

const RESULT_TONE: Record<AssetCountResult, string> = { found: 'bg-ok-soft text-ok', missing: 'bg-danger-soft text-danger', out: 'bg-accent-soft text-accent' };

/** A new count's sheet: what the scope has now, to tick. */
export async function NewCount({ scope, phone = false }: { scope: CountScopeQuery | null; phone?: boolean }) {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  if (!can.register) return <Empty>Only an Assets custodian or manager counts. You can read the counts made.</Empty>;
  if (!scope) return <Empty>Choose a group, a room or a kit to count, from Counts.</Empty>;
  const loaded = await loadCountSheet(scope);
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'count’s sheet')}</Empty>;
  const sheet = loaded.value;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">{scopeKindText(sheet.scope.kind)}</p>
        <h1 className={phone ? 'text-xl font-semibold' : 'text-2xl font-semibold'}>Count {titleCase(sheet.scope.label)}</h1>
        <p className="mt-1 text-sm text-muted">
          {sheet.items.length} {sheet.items.length === 1 ? 'asset' : 'assets'} to see. Tick each one that is here: what isn&apos;t ticked is counted missing.
        </p>
      </div>
      {sheet.items.length === 0 ? <Empty>Nothing to count: it has no assets.</Empty> : <CountSheet sheet={sheet} action={saveCount.bind(null, scope, phone)} phone={phone} />}
    </div>
  );
}

/** A count's results, missing first. */
export async function CountResults({ id, phone = false }: { id: string; phone?: boolean }) {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const loaded = await loadCount(id);
  if (loaded.kind !== 'ok') return <Empty>{loaded.kind === 'unavailable' ? 'Count not found.' : assetsNotLoaded(loaded, 'count')}</Empty>;
  const c = loaded.value;
  const assetHref = (code: string) => (phone ? APP_ASSET_PATHS.asset(code) : ASSET_PATHS.asset(code));
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">{scopeKindText(c.scope.kind)}</p>
        <h1 className={phone ? 'text-xl font-semibold' : 'text-2xl font-semibold'}>Count of {titleCase(c.scope.label)}</h1>
        <p className="mt-1 text-sm text-muted">{countedText(c)}</p>
        <p className="mt-1 text-sm font-semibold tabular-nums">{countFiguresText(c)}</p>
        {c.notes && <p className="mt-2 text-sm whitespace-pre-line">{c.notes}</p>}
        {c.foundAgain.length > 0 && (
          <p role="status" className="mt-2 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
            Found again, available now: {c.foundAgain.join(', ')}.
          </p>
        )}
      </div>
      <ul aria-label="Each asset’s result" className={`divide-y divide-line-soft ${phone ? 'rounded-lg border border-line bg-white' : 'card'}`}>
        {c.lines.map((l) => (
          <li key={l.asset.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <Link href={assetHref(l.asset.code)} className="font-medium break-words">
                {l.asset.name}
              </Link>
              <span className="mt-0.5 block text-xs text-muted">
                <span className="font-mono">{l.asset.code}</span>
                {l.asset.room ? ` · ${l.asset.room.name}` : ''}
                {l.lostMarkedAt ? ` · marked lost${l.lostMarkedBy ? ` by ${l.lostMarkedBy.name ?? l.lostMarkedBy.email}` : ''}` : ''}
              </span>
            </span>
            <span className={`badge shrink-0 ${RESULT_TONE[l.result]}`}>{ASSET_COUNT_RESULT_LABELS[l.result]}</span>
            {l.canMarkLost && <MarkLostButton code={l.asset.code} name={l.asset.name} action={markLostFromCount.bind(null, c.id, l.asset.code)} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
