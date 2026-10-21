'use client';

import { ASSET_PRODUCT_IMAGES_MAX, productImageLabel, type AssetDraftImageView } from '@trendlix/shared';
import { useState, useTransition } from 'react';
import { DocumentViewer } from '@/components/document-viewer';
import { draftImageSrc } from '@/lib/asset-paths';
import { discardDraft, removeDraftImage } from './actions';

// Discard on a draft from Claude (step 2, owner, 21 October 2026: "the connection method"), on Drafts from Claude and on
// the Add form filled in from it: asked once more, then set aside (never an asset; the audit log keeps it). And the
// draft's product images (owner, 21 October 2026: "let the mcp connector fetch the product photo and add it / yes build
// it"): the maker's images Claude found, each labelled "Product image · from <host>" with its source page linked, so
// they're never taken for a photo of the item itself; Remove for a custodian or a manager.

export function DiscardDraftButton({ id, name, back = null }: { id: string; name: string; back?: string | null }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function discard() {
    setError(null);
    start(async () => {
      const result = await discardDraft(id, back);
      if (result.errors?.length) setError(result.errors.join(' '));
      else setAsking(false);
    });
  }

  return (
    <div className="space-y-2">
      {asking ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Discard the draft of {name}?</span>
          <button type="button" onClick={discard} disabled={busy} className="btn btn-danger">
            {busy ? 'Discarding…' : 'Discard draft'}
          </button>
          <button type="button" onClick={() => setAsking(false)} disabled={busy} className="btn btn-secondary">
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className="btn btn-secondary">
          Discard
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** One product image: View, its label with the source page linked, its caption, and Remove. */
function DraftImageTile({ draftId, image, index, canRemove }: { draftId: string; image: AssetDraftImageView; index: number; canRemove: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const src = draftImageSrc(draftId, image.id);
  const name = image.caption ?? `Product image ${index + 1}`;

  return (
    <li className="space-y-1">
      <DocumentViewer title={productImageLabel(image.sourceHost)} files={[{ alt: name, src, mimeType: image.mimeType }]} className="block w-full cursor-pointer rounded-lg">
        <span className="sr-only">View {name}</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the website with the caller's session */}
        <img src={src} alt="" loading="lazy" className="aspect-square w-full rounded-lg border border-line bg-white object-contain" />
      </DocumentViewer>
      <p className="text-xs">
        <span className="badge">Product image</span>{' '}
        <span className="text-muted">
          · from{' '}
          <a href={image.sourcePageUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-accent hover:underline">
            {image.sourceHost}
            <span className="sr-only"> (its source page, opens in a new tab)</span>
          </a>
        </span>
      </p>
      {image.caption && <p className="text-xs text-muted">{image.caption}</p>}
      {canRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              const result = await removeDraftImage(draftId, image.id);
              setProblem(result.errors?.length ? result.errors.join(' ') : null);
            })
          }
          className="inline-flex min-h-9 cursor-pointer items-center text-xs font-semibold text-danger hover:underline"
        >
          {busy ? 'Removing…' : 'Remove'}
          <span className="sr-only"> {name}</span>
        </button>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * The product images Claude added to a draft (at most 3), on Drafts from Claude and on the Add form filled in from it:
 * the maker's, showing the model rather than the item, so the person adds a real photo too (it becomes the main one).
 */
export function DraftProductImages({ draftId, images, canRemove = true }: { draftId: string; images: AssetDraftImageView[]; canRemove?: boolean }) {
  if (!images.length) return null;
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">Product Images</h3>
        <p className="text-xs text-muted">
          The maker’s {images.length === 1 ? 'image' : 'images'} Claude found ({images.length} of {ASSET_PRODUCT_IMAGES_MAX}). {images.length === 1 ? 'It shows' : 'They show'} the
          model, not this item: add a real photo of it too, for its condition and serial number. It becomes the main photo.
        </p>
      </div>
      <ul aria-label="Product images" className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {images.map((image, i) => (
          <DraftImageTile key={image.id} draftId={draftId} image={image} index={i} canRemove={canRemove} />
        ))}
      </ul>
    </div>
  );
}
