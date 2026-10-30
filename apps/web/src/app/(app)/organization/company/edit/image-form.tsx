'use client';

import Image from 'next/image';
import { useActionState } from 'react';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { removeLogo, removeThumbnail, uploadLogo, uploadThumbnail } from '../actions';

const IMAGE_MAX_BYTES = 1024 * 1024;

// The company's two images, uploaded the same way: the logo, a wide wordmark, and the thumbnail beside it, a square brand
// mark (owner's request, 15 October 2026).
const IMAGES = {
  logo: {
    title: 'Logo',
    hint: 'Shown in the sidebar and on the sign-in page. PNG, JPEG or WebP, up to 1 MB.',
    upload: uploadLogo,
    remove: removeLogo,
  },
  thumbnail: {
    title: 'Thumbnail',
    hint: 'A square icon, e.g. your brand mark: shown as the browser tab icon and where there is no room for the full logo. PNG, JPEG or WebP, up to 1 MB.',
    upload: uploadThumbnail,
    remove: removeThumbnail,
  },
} as const;

export type CompanyImage = keyof typeof IMAGES;

/** An image over 1 MB is refused by the browser before anything is sent (the API refuses it too). */
function limitSize(image: CompanyImage) {
  return (e: React.ChangeEvent<HTMLInputElement>) => {
    const tooLarge = [...(e.currentTarget.files ?? [])].some((f) => f.size > IMAGE_MAX_BYTES);
    e.currentTarget.setCustomValidity(tooLarge ? `The ${image} must be 1 MB or smaller.` : '');
  };
}

/**
 * Uploads, replaces or removes the logo or the thumbnail. `canRemove`: Remove, for a Super Admin only (owner's decision,
 * 15 October 2026); replacing it is for every editor.
 */
export function CompanyImageForm({ image, name, src, canRemove }: { image: CompanyImage; name: string; src: string | null; canRemove: boolean }) {
  const { title, hint, upload: uploadImage, remove: removeImage } = IMAGES[image];
  const [upload, uploadAction] = useActionState(uploadImage, {} as FormState);
  const [removal, removeAction, removing] = useActionState(removeImage, {} as FormState);
  const fid = useFieldIds();
  const message = upload.message ?? removal.message;

  return (
    <section className="card p-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{hint} Drag it here, paste it, or choose it.</p>

      <div className="mt-4 flex flex-wrap items-start gap-5">
        <span className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-card">
          {src ? (
            <Image src={src} alt={`${name} ${image}`} fill unoptimized className="object-contain p-2" />
          ) : (
            <span className="text-xs text-muted">No {image}</span>
          )}
        </span>

        <div className="min-w-0 flex-1 basis-56 space-y-3">
          <form action={uploadAction} className="space-y-3">
            <FormErrors errors={upload.errors} />
            <div>
              <label htmlFor={fid(image)} className="label">
                {src ? `Replace ${image}` : `Upload ${image}`}
              </label>
              <FileDrop id={fid(image)} name={image} accept="image/png,image/jpeg,image/webp" required onChange={limitSize(image)} />
            </div>
            <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
          </form>

          {src && canRemove && (
            <form
              action={removeAction}
              onSubmit={(e) => {
                if (!window.confirm(`Remove the company ${image}?`)) e.preventDefault();
              }}
            >
              <FormErrors errors={removal.errors} />
              <button type="submit" disabled={removing} className="btn btn-danger">
                {removing ? 'Removing…' : `Remove ${image}`}
              </button>
            </form>
          )}

          {message && (
            <p role="status" className="text-sm text-ok">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
