import { ASSET_GROUP_LABELS, ASSET_TYPE_LABELS, assetDraftPath } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { titleCase } from '@/lib/format';
import { draftedText, placeText, quantityText } from '../assets';
import { assetsCaller, assetsNotLoaded, loadDrafts } from '../data';
import { DiscardDraftButton, DraftProductImages } from '../drafts-ui';
import { AssetsFrame } from '../frame';
import { Empty, Loading, NoAccess } from '../ui';

// Drafts from Claude (step 2, owner, 21 October 2026: "i might link a claude account for the assets section only to fetch
// data and help in the data entry"; "the connection method"): the assets Claude drafted through the connector, waiting
// for a person. None is an asset yet: none is in any total or list but this one (the spec: "nothing is saved until a
// person presses Save"). For an Assets custodian or manager: Review and confirm opens the Add form filled in from it (the
// photos are added there, as they can't come through Claude), where saving gives its code; Discard sets it aside. The
// maker's product images Claude added (owner, 21 October 2026: "let the mcp connector fetch the product photo and add
// it") show on each, labelled "Product image · from <host>", with Remove.

export const metadata: Metadata = { title: 'Drafts From Claude · People System' };

async function Drafts() {
  const { can } = await assetsCaller();
  if (!can.view) return <NoAccess />;
  if (!can.register) return <Empty>Only an Assets custodian or manager reviews the drafts from Claude.</Empty>;
  const loaded = await loadDrafts();
  if (loaded.kind !== 'ok') return <Empty>{assetsNotLoaded(loaded, 'drafts')}</Empty>;
  const drafts = loaded.value;
  if (!drafts.length) {
    return (
      <Empty>
        No draft is waiting. Ask Claude to draft assets with the Trendlix People connector: <Link href={ASSET_PATHS.connectClaude}>Connect Claude</Link>.
      </Empty>
    );
  }
  return (
    <ul aria-label="Drafts from Claude" className="space-y-3">
      {drafts.map((d) => {
        const f = d.fields;
        const place = placeText({ room: d.room, kit: d.kit });
        return (
          <li key={d.id} className="card space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold">{titleCase(f.name)}</h2>
                <p className="text-sm text-muted">
                  {ASSET_GROUP_LABELS[f.group]} · {ASSET_TYPE_LABELS[f.type] ?? f.type}
                  {[f.brand, f.model].filter(Boolean).length ? ` · ${[f.brand, f.model].filter(Boolean).join(' ')}` : ''}
                  {f.serial ? (
                    <>
                      {' '}
                      · <span className="font-mono">{f.serial}</span>
                    </>
                  ) : null}
                </p>
                {(place || f.group === 'consumable') && (
                  <p className="text-sm">
                    {[place, f.group === 'consumable' ? quantityText(f.quantity, f.unit) : null].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {draftedText(d)}
                  {d.valuesSet ? ' · Values drafted' : ''}
                </p>
              </div>
              <span className="badge bg-accent-soft text-accent">Draft</span>
            </div>
            <DraftProductImages draftId={d.id} images={d.productImages ?? []} />
            <div className="flex flex-wrap items-start gap-3">
              <Link href={assetDraftPath(d.id)} className="btn btn-primary">
                Review and confirm
              </Link>
              <DiscardDraftButton id={d.id} name={f.name} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// All Assets → Drafts from Claude (owner, 24 October 2026: "7 entries, the rest as tabs"): its tab names it, with how
// many wait, under All Assets' heading (frame.tsx)
export default function DraftsPage() {
  return (
    <AssetsFrame tab={ASSET_PATHS.drafts}>
      <div className="max-w-4xl space-y-4">
        <p className="text-muted">
          Assets Claude drafted through the Trendlix People connector. None is in the register yet: review each, add its photos and confirm it, and it gets its
          code; or discard it.
        </p>
        <Suspense fallback={<Loading />}>
          <Drafts />
        </Suspense>
      </div>
    </AssetsFrame>
  );
}
