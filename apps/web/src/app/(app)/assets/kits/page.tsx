import { ASSET_TEXT_LIMITS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS, CUSTODY_PATHS } from '@/lib/asset-paths';
import { createKit, updateKit } from '../actions';
import { assetsCaller, assetsNotLoaded, loadKits } from '../data';
import { NameNotesForm } from '../place-forms';
import { Empty, Loading, NoAccess, StatusBadge } from '../ui';
import { kitStatusText, kitStatusTone } from '../upkeep';
import { KitAddForm, KitRemoveButton } from '../upkeep-ui';

// Kits (spec §2.3: "Kit PK-KIT-{A..Z, AA..}"): production kit assets packed together for shoots, e.g. PK-KIT-A
// Interview kit. Everyone with Assets access sees them, each with how many assets it has (a link to the register of
// that kit); an Assets custodian or manager adds and renames them. A production kit asset is put in one on its Edit
// form. Step 4 (spec §5: "Kit cards with items and status (Available / Partly out / Out); new kit from existing kit
// assets; hand over or count a kit"): each kit's card lists its assets with their status and who has them, and how the
// kit stands; a custodian or a manager adds assets by their codes, takes one out, and hands the kit over (New handover
// with its available assets added, the others listed with why).

export const metadata: Metadata = { title: 'Kits · People System' };

async function Kits() {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  const loaded = await loadKits();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'kits')}</Empty>;
  const kits = loaded.value;
  return (
    <div className="space-y-6">
      {can.register && (
        <section aria-labelledby="new-kit" className="space-y-2">
          <h2 id="new-kit" className="font-semibold">
            Add a Kit
          </h2>
          <NameNotesForm
            action={createKit}
            nameLabel="Name"
            nameHint="E.g. Interview kit. Its code is given when it is added: PK-KIT-A, then B …"
            nameMax={ASSET_TEXT_LIMITS.kitName}
            notesMax={ASSET_TEXT_LIMITS.kitNotes}
            submit="Add kit"
          />
        </section>
      )}
      {kits.length === 0 ? (
        <Empty>No kits yet.{can.register ? ' Add the first one above.' : ''}</Empty>
      ) : (
        <ul aria-label="Kits" className="space-y-3">
          {kits.map((k) => (
            <li key={k.id} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-semibold text-muted">{k.code}</p>
                  <h3 className="font-semibold">{k.name}</h3>
                  {k.notes && <p className="text-sm text-muted">{k.notes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {k.status && <span className={`badge ${kitStatusTone(k.status)}`}>{kitStatusText(k.status)}</span>}
                  <Link href={ASSET_PATHS.listWith({ kitId: k.id })} className="text-sm font-semibold">
                    {k.assets} {k.assets === 1 ? 'asset' : 'assets'}
                    <span className="sr-only"> in {k.code}</span>
                  </Link>
                </div>
              </div>
              {k.items && k.items.length > 0 && (
                <ul aria-label={`Assets in ${k.code}`} className="mt-3 divide-y divide-line-soft rounded-lg border border-line">
                  {k.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <Link href={ASSET_PATHS.asset(i.code)} className="font-mono text-sm font-semibold">
                          {i.code}
                        </Link>{' '}
                        <span className="break-words">{i.name}</span>
                        {i.holder && <span className="block text-xs text-muted">With {i.holder}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={i.status} />
                        {can.register && <KitRemoveButton kitId={k.id} assetId={i.id} code={i.code} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {can.register && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {k.status !== 'empty' && k.status !== 'out' && (
                    <Link href={CUSTODY_PATHS.newWith({ kit: k.id })} className="btn btn-secondary">
                      Hand over this kit
                    </Link>
                  )}
                </div>
              )}
              {can.register && (
                <details className="mt-3">
                  <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-accent">Add assets to it</summary>
                  <div className="mt-3">
                    <KitAddForm kitId={k.id} kitCode={k.code} />
                  </div>
                </details>
              )}
              {can.register && (
                <details className="mt-3">
                  <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-semibold text-accent">Rename or add notes</summary>
                  <div className="mt-3">
                    <NameNotesForm
                      action={updateKit.bind(null, k.id)}
                      saved={{ name: k.name, notes: k.notes }}
                      nameLabel="Name"
                      nameMax={ASSET_TEXT_LIMITS.kitName}
                      notesMax={ASSET_TEXT_LIMITS.kitNotes}
                      submit="Save kit"
                      compact
                    />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function KitsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Kits</h1>
      <p className="mt-1 text-muted">Production kit assets packed together for shoots: each kit with its assets and how it stands. Hand a kit over at once; only its available assets go.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Kits />
        </Suspense>
      </div>
    </div>
  );
}
