'use client';

import { ASSET_PHOTOS_MAX, type AssetPhotoRef } from '@trendlix/shared';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { CameraButton } from '@/components/camera-button';
import { DocumentViewer } from '@/components/document-viewer';
import { assetPhotoSrc } from '@/lib/asset-paths';
import { addAssetPhoto, deleteAssetPhoto, makeAssetPhotoFirst, photosSent, replaceAssetPhoto } from './actions';
import { photosLeftText, photosSentText } from './assets';
import { ASSET_PHOTO_ACCEPT, isAssetPhoto, shrinkAssetPhoto } from './photo-files';

// An asset's photos (owner's brief, 21 October 2026: "Take photo" (camera capture on phones), "Choose photos", up to 6
// an asset, the first the one the lists show). On the Add and Edit forms, the photos chosen wait in the page and go once
// the asset is saved (PhotoPicker); on the asset's page, its photos with View, and for a custodian or a manager Add
// photos, Replace and Make main photo, and for a Super Admin Delete (PhotoManager). Each photo is made smaller first and
// sent in a request of its own (photo-files.ts). "Take photo" opens the phone's camera in a phone's browser, the app's
// own camera inside the app (components/camera-button.tsx), a computer's file chooser elsewhere.

/** A photo chosen, with a key of its own and its address in the page for the thumbnail. */
export interface ChosenPhoto {
  key: number;
  file: File;
  url: string;
}

const thumb = 'aspect-square w-full rounded-lg border border-line bg-canvas object-cover';

/** The two ways to add photos, and what was refused. `left`: how many more can be added. */
function AddButtons({ left, disabled, onFiles, cameraLabel = 'Take photo' }: { left: number; disabled: boolean; onFiles: (files: File[]) => void; cameraLabel?: string }) {
  const id = useId();
  const box = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CameraButton onFiles={onFiles} disabled={disabled || left <= 0} label={cameraLabel} />
      <span className="inline-flex">
        <input
          ref={box}
          id={id}
          type="file"
          multiple
          accept={ASSET_PHOTO_ACCEPT}
          disabled={disabled || left <= 0}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            // emptied, so the same photo can be chosen again after it was removed
            e.currentTarget.value = '';
            if (files.length) onFiles(files);
          }}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          aria-disabled={disabled || left <= 0 || undefined}
          className={`btn btn-secondary min-h-12 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${disabled || left <= 0 ? 'pointer-events-none opacity-60' : ''}`}
        >
          Choose photos
        </label>
      </span>
    </div>
  );
}

/** The photos taken: up to `left`, each made smaller; the others said as not added. */
async function prepare(files: File[], left: number): Promise<{ taken: File[]; refused: string[] }> {
  const photos = files.filter(isAssetPhoto);
  const refused = files.filter((f) => !isAssetPhoto(f)).map((f) => `${f.name || 'A file'} is not a photo (JPG, PNG or WebP).`);
  if (photos.length > left) refused.push(`An asset has at most ${ASSET_PHOTOS_MAX} photos: ${photos.length - Math.max(left, 0)} not added.`);
  const taken = await Promise.all(photos.slice(0, Math.max(left, 0)).map(shrinkAssetPhoto));
  return { taken, refused };
}

/**
 * The photos chosen on the Add or Edit form, waiting in the page until the asset is saved: thumbnails with Remove,
 * "Take photo" and "Choose photos". `had`: the asset's photos already (Edit).
 */
export function PhotoPicker({ had, photos, onChange, onBusy, disabled }: { had: number; photos: ChosenPhoto[]; onChange: (next: (list: ChosenPhoto[]) => ChosenPhoto[]) => void; onBusy: (busy: boolean) => void; disabled: boolean }) {
  const next = useRef(1);
  const [refused, setRefused] = useState<string[]>([]);
  const left = ASSET_PHOTOS_MAX - had - photos.length;
  const hintId = useId();

  // the thumbnails' addresses in the page are let go when the form goes
  const shown = useRef(photos);
  useEffect(() => {
    shown.current = photos;
  }, [photos]);
  useEffect(() => () => shown.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function add(files: File[]) {
    onBusy(true);
    try {
      const { taken, refused: not } = await prepare(files, left);
      setRefused(not);
      onChange((list) => [...list, ...taken.map((file) => ({ key: next.current++, file, url: URL.createObjectURL(file) }))]);
    } finally {
      onBusy(false);
    }
  }

  return (
    <fieldset aria-describedby={hintId} className="space-y-3">
      <legend className="label">Photos</legend>
      <AddButtons left={left} disabled={disabled} onFiles={(files) => void add(files)} />
      <p id={hintId} className="hint">
        {photosLeftText(had, photos.length, ASSET_PHOTOS_MAX)} Photos are made smaller before they are sent, and go once the asset is saved.
      </p>
      {refused.length > 0 && (
        <p role="status" className="text-xs text-danger">
          {refused.join(' ')}
        </p>
      )}
      {photos.length > 0 && (
        <ul aria-label="Photos to add" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {photos.map((p, i) => (
            <li key={p.key} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a photo in the page, before it is sent */}
              <img src={p.url} alt={`Photo ${had + i + 1} to add`} className={thumb} />
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  onChange((list) => list.filter((x) => x.key !== p.key));
                }}
                className="inline-flex min-h-9 cursor-pointer items-center text-xs font-semibold text-danger hover:underline"
              >
                Remove<span className="sr-only"> photo {had + i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/**
 * Sends the photos one by one once the asset is saved; answers how many went and why the others didn't. `onEach`: after
 * each, with how many are done (for "Sending photo 2 of 3…").
 */
export async function sendPhotos(code: string, photos: readonly ChosenPhoto[], onEach?: (done: number) => void): Promise<{ sent: number; failed: string[] }> {
  let sent = 0;
  const failed: string[] = [];
  for (const [i, p] of photos.entries()) {
    const fd = new FormData();
    fd.append('photos', p.file, p.file.name || 'photo.jpg');
    const result = await addAssetPhoto(code, fd);
    if (result.error) failed.push(result.error);
    else sent++;
    onEach?.(i + 1);
  }
  return { sent, failed };
}

/** One of the asset's photos, with what the caller may do to it. */
function PhotoTile({ code, photo, index, total, canChange, canDelete }: { code: string; photo: AssetPhotoRef; index: number; total: number; canChange: boolean; canDelete: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const replaceId = useId();
  const src = assetPhotoSrc(code, photo.id);
  const name = `Photo ${index + 1}${index === 0 ? ' (main)' : ''}`;

  return (
    <li className="space-y-1">
      <DocumentViewer title={`${code} · ${name}`} files={[{ alt: name, src, mimeType: 'image/jpeg' }]} className="block w-full cursor-pointer rounded-lg">
        <span className="sr-only">View {name.toLowerCase()}</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- served by the website with the caller's session */}
        <img src={src} alt="" loading="lazy" className={thumb} />
      </DocumentViewer>
      {index === 0 && total > 1 && <span className="badge">Main photo</span>}
      {(canChange || canDelete) && (
        <div className="flex flex-wrap gap-x-3 text-xs">
          {canChange && index > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await makeAssetPhotoFirst(code, photo.id);
                  setProblem(r.error ?? null);
                })
              }
              className="inline-flex min-h-9 cursor-pointer items-center font-semibold text-accent hover:underline"
            >
              Make main<span className="sr-only"> {name}</span>
            </button>
          )}
          {canChange && (
            <span className="inline-flex">
              <input
                id={replaceId}
                type="file"
                accept={ASSET_PHOTO_ACCEPT}
                disabled={pending}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (!file) return;
                  start(async () => {
                    if (!isAssetPhoto(file)) {
                      setProblem('Choose a photo (JPG, PNG or WebP).');
                      return;
                    }
                    const fd = new FormData();
                    const smaller = await shrinkAssetPhoto(file);
                    fd.append('photo', smaller, smaller.name || 'photo.jpg');
                    const r = await replaceAssetPhoto(code, photo.id, fd);
                    setProblem(r.error ?? null);
                  });
                }}
                className="peer sr-only"
              />
              <label htmlFor={replaceId} className="inline-flex min-h-9 cursor-pointer items-center font-semibold text-accent hover:underline peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                Replace<span className="sr-only"> {name}</span>
              </label>
            </span>
          )}
          {canDelete && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(`Delete ${name.toLowerCase()} of ${code}? This can't be undone.`)) return;
                start(async () => {
                  const r = await deleteAssetPhoto(code, photo.id);
                  setProblem(r.error ?? null);
                });
              }}
              className="inline-flex min-h-9 cursor-pointer items-center font-semibold text-danger hover:underline"
            >
              Delete<span className="sr-only"> {name}</span>
            </button>
          )}
        </div>
      )}
      {pending && <p className="text-xs text-muted">Saving…</p>}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * The asset's photos on its page: each with View (the document viewer), and, for those who may, Make main, Replace and
 * Delete (a Super Admin); Take photo and Choose photos while it has fewer than 6, sent at once.
 */
export function PhotoManager({ code, photos, canAdd, canDelete }: { code: string; photos: AssetPhotoRef[]; canAdd: boolean; canDelete: boolean }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const left = ASSET_PHOTOS_MAX - photos.length;

  function add(files: File[]) {
    start(async () => {
      setBusy(true);
      try {
        const { taken, refused } = await prepare(files, left);
        const result = await sendPhotos(
          code,
          taken.map((file, i) => ({ key: i, file, url: '' })),
        );
        setSaid([photosSentText(result.sent, result.failed), ...refused].filter(Boolean).join(' ') || null);
        if (result.sent) await photosSent();
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      {photos.length ? (
        <ul aria-label="Photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <PhotoTile key={p.id} code={code} photo={p} index={i} total={photos.length} canChange={canAdd} canDelete={canDelete} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No photos yet.</p>
      )}
      {canAdd && (
        <div className="space-y-1">
          <AddButtons left={left} disabled={busy || pending} onFiles={add} />
          <p className="hint">{busy || pending ? 'Sending the photos…' : photosLeftText(photos.length, 0, ASSET_PHOTOS_MAX)}</p>
        </div>
      )}
      {said && (
        <p role="status" className="text-sm text-muted">
          {said}
        </p>
      )}
    </div>
  );
}
