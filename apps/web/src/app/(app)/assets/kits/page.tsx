import { ASSET_TEXT_LIMITS } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { createKit, updateKit } from '../actions';
import { assetsCaller, assetsNotLoaded, loadKits } from '../data';
import { NameNotesForm } from '../place-forms';
import { Empty, Loading, NoAccess } from '../ui';

// Kits (spec §2.3: "Kit PK-KIT-{A..Z, AA..}"): production kit assets packed together for shoots, e.g. PK-KIT-A
// Interview kit. Everyone with Assets access sees them, each with how many assets it has (a link to the register of
// that kit); an Assets custodian or manager adds and renames them. A production kit asset is put in one on its Edit
// form. Handing over a whole kit, and kit cards with what is out, come with a later step.

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
                <Link href={ASSET_PATHS.listWith({ kitId: k.id })} className="text-sm font-semibold">
                  {k.assets} {k.assets === 1 ? 'asset' : 'assets'}
                  <span className="sr-only"> in {k.code}</span>
                </Link>
              </div>
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
      <p className="mt-1 text-muted">Production kit assets packed together for shoots. Put an asset in a kit on its Edit form.</p>
      <div className="mt-6">
        <Suspense fallback={<Loading />}>
          <Kits />
        </Suspense>
      </div>
    </div>
  );
}
