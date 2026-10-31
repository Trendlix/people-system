'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, useFieldIds, valueOf } from '@/components/form';
import type { FormState } from '@/lib/types';
import { PHOTO_ACCEPT, PHOTO_MAX_BYTES, PHOTO_TOO_LARGE } from '../../photo-requests';
import { withSmallerPhotos } from '../../shrink-photo';

/**
 * Choosing a new photo of oneself to send HR (owner, 31 October 2026: "allow them to upload a new photo as a request and
 * approved from the HR"): a JPEG, PNG or WebP image (on a phone, the camera or the photos), shown before it is sent, and
 * a note for HR, optional. Made smaller in the browser first (shrink-photo.ts), as the employee file's photos are.
 */
export function PhotoForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [preview, setPreview] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [busy, setBusy] = useState(false);
  const fid = useFieldIds();

  // the preview's address is let go of when another photo is chosen, or the form goes
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  function chosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    setTooLarge(!!file && file.size > PHOTO_MAX_BYTES);
    setPreview(file && /^image\//.test(file.type) ? URL.createObjectURL(file) : null);
  }

  async function send(fd: FormData) {
    setBusy(true);
    try {
      const ready = await withSmallerPhotos(fd, ['file']);
      startTransition(() => formAction(ready));
    } finally {
      setBusy(false);
    }
  }

  const sending = pending || busy;
  return (
    <form action={send} className="card space-y-4 p-6">
      <div>
        <h2 className="font-semibold">Send a New Photo</h2>
        <p className="mt-1 text-sm text-muted">
          A recent photo with your face clearly visible, on a plain background (JPEG, PNG or WebP). HR checks it first: it becomes your picture
          once HR approves it.
        </p>
      </div>
      <FormErrors errors={tooLarge ? [PHOTO_TOO_LARGE, ...(state.errors ?? [])] : state.errors} />
      <div className="flex flex-wrap items-start gap-5">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- the photo chosen, from this browser: not for the image optimizer
          <img src={preview} alt="The photo you chose" className="size-28 shrink-0 rounded-full border border-line object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor={fid('file')} className="label">
            Photo
          </label>
          <FileDrop id={fid('file')} name="file" accept={PHOTO_ACCEPT} required onChange={chosen} />
        </div>
      </div>
      <div>
        <label htmlFor={fid('note')} className="label">
          Note for HR <span className="font-normal text-muted">· optional</span>
        </label>
        <textarea id={fid('note')} name="note" rows={2} maxLength={1000} defaultValue={valueOf(state, 'note')} className="input" />
      </div>
      <button type="submit" disabled={sending || tooLarge} className="btn btn-primary">
        {sending ? 'Sending…' : 'Send to HR'}
      </button>
    </form>
  );
}
