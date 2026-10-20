'use client';

import { useId, useRef } from 'react';

// Take a photo, beside a form's file box on the phone pages (/app; owner, 20 October 2026: the employee app,
// "reimbursement with a receipt photo"): a file box of its own that opens the phone's camera straight away
// (capture="environment": the one on the back), the photo going where a chosen file goes (`onFiles`), which checks its
// kind and makes it smaller as for any other. The form's own box stays beside it for the gallery or a PDF. On a computer
// it opens the file chooser. Inside the app, Phase 2 gives it the app's own camera (lib/native.ts, takePhoto).

/** What the camera's box takes: a photo, or a PDF from a phone that offers a scanner there. */
export const CAMERA_ACCEPT = 'image/*,application/pdf';

export function CameraButton({ onFiles, disabled = false, label = 'Take a photo' }: { onFiles: (files: File[]) => void; disabled?: boolean; label?: string }) {
  const id = useId();
  const box = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex">
      <input
        ref={box}
        id={id}
        type="file"
        accept={CAMERA_ACCEPT}
        capture="environment"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          // emptied, so the same photo can be taken again after it was removed
          e.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        aria-disabled={disabled || undefined}
        className={`btn btn-secondary min-h-12 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </svg>
        {label}
      </label>
    </span>
  );
}
