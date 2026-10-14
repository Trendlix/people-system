'use client';

import Image from 'next/image';
import { useActionState } from 'react';
import { FileDrop } from '@/components/file-drop';
import { FormErrors, SubmitButton, useFieldIds } from '@/components/form';
import type { FormState } from '@/lib/types';
import { removeLogo, uploadLogo } from '../actions';

const LOGO_MAX_BYTES = 1024 * 1024;

/** A logo over 1 MB is refused by the browser before anything is sent (the API refuses it too). */
function limitLogoSize(e: React.ChangeEvent<HTMLInputElement>) {
  const tooLarge = [...(e.currentTarget.files ?? [])].some((f) => f.size > LOGO_MAX_BYTES);
  e.currentTarget.setCustomValidity(tooLarge ? 'The logo must be 1 MB or smaller.' : '');
}

export function LogoForm({ name, logoSrc }: { name: string; logoSrc: string | null }) {
  const [upload, uploadAction] = useActionState(uploadLogo, {} as FormState);
  const [removal, removeAction, removing] = useActionState(removeLogo, {} as FormState);
  const fid = useFieldIds();
  const message = upload.message ?? removal.message;

  return (
    <section className="card max-w-2xl p-6">
      <h3 className="font-semibold">Logo</h3>
      <p className="mt-1 text-sm text-muted">Shown in the sidebar and on the sign-in page. PNG, JPEG or WebP, up to 1 MB. A square logo works best. Drag it here, paste it, or choose it.</p>

      <div className="mt-4 flex flex-wrap items-start gap-5">
        <span className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
          {logoSrc ? (
            <Image src={logoSrc} alt={`${name} logo`} fill unoptimized className="object-contain p-2" />
          ) : (
            <span className="text-xs text-muted">No logo</span>
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          <form action={uploadAction} className="space-y-3">
            <FormErrors errors={upload.errors} />
            <div>
              <label htmlFor={fid('logo')} className="label">
                {logoSrc ? 'Replace logo' : 'Upload logo'}
              </label>
              <FileDrop id={fid('logo')} name="logo" accept="image/png,image/jpeg,image/webp" required onChange={limitLogoSize} />
            </div>
            <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
          </form>

          {logoSrc && (
            <form
              action={removeAction}
              onSubmit={(e) => {
                if (!window.confirm('Remove the company logo?')) e.preventDefault();
              }}
            >
              <FormErrors errors={removal.errors} />
              <button type="submit" disabled={removing} className="btn btn-danger">
                {removing ? 'Removing…' : 'Remove logo'}
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
