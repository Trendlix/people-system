'use client';

import { useId, useState, useTransition } from 'react';
import { CameraButton } from '@/components/camera-button';
import { attachSignedCopy, signedCopiesSent } from '../custody-actions';
import { shrinkAssetPhoto } from '../photo-files';

// Attaching a custody record's signed copy (Assets step 3; the spec's paper signing: "photograph/scan the signed page
// and attach it"): Take a photo (the phone's camera in its browser, the app's own camera inside the app:
// components/camera-button.tsx) or Choose a file (a photo or a PDF, e.g. a scan). Photos are made smaller first, as an
// asset's are (photo-files.ts); a PDF goes as it is. Each file in a request of its own (uploads pass through the website,
// which takes at most 4.5 MB a request). The API checks each file's kind and size again.

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const fits = (f: File) => /^image\/(jpeg|png|webp)$/.test(f.type) || f.type === 'application/pdf';

export function SignedCopyAttach({ code }: { code: string }) {
  const id = useId();
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  function send(files: File[]) {
    start(async () => {
      const refused = files.filter((f) => !fits(f)).map((f) => `${f.name || 'A file'} is not a photo (JPG, PNG or WebP) or a PDF.`);
      const errors: string[] = [...refused];
      let sent = 0;
      for (const f of files.filter(fits)) {
        const file = f.type === 'application/pdf' ? f : await shrinkAssetPhoto(f);
        const fd = new FormData();
        fd.append('file', file, file.name || 'signed-form.jpg');
        const r = await attachSignedCopy(code, fd);
        if (r.error) errors.push(r.error);
        else sent++;
      }
      if (sent) await signedCopiesSent();
      const done = sent ? `${sent === 1 ? 'The signed copy was' : `${sent} files were`} attached.` : '';
      setSaid({ text: [done, ...new Set(errors)].filter(Boolean).join(' ') || 'Nothing was attached.', ok: errors.length === 0 && sent > 0 });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CameraButton onFiles={send} disabled={pending} label="Take a photo" />
        <span className="inline-flex">
          <input
            id={id}
            type="file"
            multiple
            accept={ACCEPT}
            disabled={pending}
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = '';
              if (files.length) send(files);
            }}
            className="peer sr-only"
          />
          <label
            htmlFor={id}
            aria-disabled={pending || undefined}
            className={`btn btn-secondary min-h-12 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${pending ? 'pointer-events-none opacity-60' : ''}`}
          >
            Choose a file
          </label>
        </span>
      </div>
      <p className="hint">{pending ? 'Attaching…' : 'A photo of the signed page, or a PDF scan of it. At most 10 MB each.'}</p>
      {said && (
        <p role="status" className={`text-sm ${said.ok ? 'text-ok' : 'text-danger'}`}>
          {said.text}
        </p>
      )}
    </div>
  );
}
