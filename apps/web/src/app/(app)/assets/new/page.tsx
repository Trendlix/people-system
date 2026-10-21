import { isAssetGroup, type AssetDraftView } from '@trendlix/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ASSET_PATHS } from '@/lib/asset-paths';
import { BackLink } from '../../organization/ui';
import { todayInCairo } from '../../employees/ui';
import { AssetForm } from '../asset-form';
import { draftDefaults, draftedText, valuesDefaults } from '../assets';
import { assetsCaller, assetsNotLoaded, listOrEmpty, loadDraft, loadKits, loadRooms } from '../data';
import { DiscardDraftButton } from '../drafts-ui';
import { Empty, Loading, NoAccess } from '../ui';

// Add asset (owner, 21 October 2026: "i want to add this module with a special permission to the system"): for an
// Assets custodian or manager; the form follows the group (?group= chooses it to start with, production kit
// otherwise), with the values for the CEO, Finance and a Super Admin, and "Take photo" and "Choose photos". The code is
// given when it is saved. Since step 2 (owner, 21 October 2026: "the connection method"), ?draft= fills it in from a
// draft from Claude, the link the connector gives: the person reviews it, adds the photos (they can't come through
// Claude) and confirms it, when it joins the register and its code is given (the spec: "nothing is saved until a person
// presses Save"); or discards it.

export const metadata: Metadata = { title: 'Add Asset · People System' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a draft that can't be confirmed any more says, with where it went. */
function DraftDone({ draft }: { draft: AssetDraftView }) {
  if (draft.status === 'confirmed') {
    return (
      <Empty>
        This draft was already confirmed
        {draft.asset ? (
          <>
            {' '}
            as <Link href={ASSET_PATHS.asset(draft.asset.code)}>{draft.asset.code}</Link>
          </>
        ) : null}
        .
      </Empty>
    );
  }
  return (
    <Empty>
      This draft was discarded. <Link href={ASSET_PATHS.drafts}>Drafts from Claude</Link> lists the ones still waiting.
    </Empty>
  );
}

async function NewAsset({ searchParams }: { searchParams: PageProps<'/assets/new'>['searchParams'] }) {
  const [{ access, can }, params] = await Promise.all([assetsCaller(), searchParams]);
  if (!can.view) return <NoAccess />;
  if (!can.register) return <Empty>Only an Assets custodian or manager registers assets.</Empty>;
  const draftId = typeof params.draft === 'string' && UUID.test(params.draft) ? params.draft : null;
  const [rooms, kits, loadedDraft] = await Promise.all([loadRooms(), loadKits(), draftId ? loadDraft(draftId) : null]);

  if (loadedDraft) {
    if (loadedDraft.kind !== 'ok') {
      return <Empty>{loadedDraft.kind === 'unavailable' ? 'This draft isn’t there any more. Drafts from Claude lists the ones waiting.' : assetsNotLoaded(loadedDraft, 'draft')}</Empty>;
    }
    const draft = loadedDraft.value;
    if (draft.status !== 'open') return <DraftDone draft={draft} />;
    return (
      <div className="space-y-4">
        <section aria-label="Draft from Claude" className="space-y-3 rounded-lg bg-accent-soft p-4">
          <p className="text-sm">
            <span className="font-semibold">{draftedText(draft)}.</span> Review it, add its photos, then press Confirm and add: it joins the register
            and its code is given then. Until then it is in no total or list.
          </p>
          {draft.valuesSet && !can.values && (
            <p className="text-sm text-muted">Values were drafted by someone who sees them: they are kept when you confirm it.</p>
          )}
          <DiscardDraftButton id={draft.id} name={draft.fields.name} back={ASSET_PATHS.drafts} />
        </section>
        <AssetForm
          mode="add"
          defaults={draftDefaults(draft.fields)}
          values={can.values ? valuesDefaults(draft.values ?? null) : null}
          rooms={listOrEmpty(rooms)}
          kits={listOrEmpty(kits)}
          today={todayInCairo()}
          ai={access.ai}
          draftId={draft.id}
          surface="site"
          cancelHref={ASSET_PATHS.drafts}
        />
      </div>
    );
  }

  const group = typeof params.group === 'string' && isAssetGroup(params.group) ? params.group : 'kit';
  return (
    <AssetForm
      mode="add"
      defaults={{ group }}
      values={can.values ? valuesDefaults(null) : null}
      rooms={listOrEmpty(rooms)}
      kits={listOrEmpty(kits)}
      today={todayInCairo()}
      ai={access.ai}
      surface="site"
      cancelHref={ASSET_PATHS.list}
    />
  );
}

export default function NewAssetPage({ searchParams }: PageProps<'/assets/new'>) {
  return (
    <div className="max-w-3xl space-y-4">
      <BackLink href={ASSET_PATHS.list}>Assets</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Add Asset</h1>
        <p className="mt-1 text-muted">Its group decides its code, its fields and how it is kept. The code is given when you save it, and never changes.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <NewAsset searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
