'use client';

import { useId, useRef, useState } from 'react';
import { canTakePhoto, takePhoto } from '@/lib/native';
import { useNativeApp } from '@/lib/use-native';

// Take a photo, beside a form's file box on the phone pages (/app; owner, 20 October 2026: the employee app,
// "reimbursement with a receipt photo"): the photo goes where a chosen file goes (`onFiles`), which checks its kind and
// makes it smaller as for any other. The form's own box stays beside it for the gallery or a PDF. In a phone's browser
// it is a file box of its own that opens the phone's camera straight away (capture="environment": the one on the
// back); on a computer it opens the file chooser. Inside the app (Phase 2, README: "Receipts: the Camera plugin inside
// the app (photo → upload as today), file input outside") it opens the app's own camera (lib/native.ts, takePhoto),
// saying plainly when the camera isn't allowed or the photo couldn't be taken; closing the camera says nothing.

/** What the camera's box takes: a photo, or a PDF from a phone that offers a scanner there. */
export const CAMERA_ACCEPT = 'image/*,application/pdf';

const CAMERA_ICON = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
);

const BUTTON = 'btn btn-secondary min-h-12 cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-accent';

export function CameraButton({ onFiles, disabled = false, label = 'Take a photo' }: { onFiles: (files: File[]) => void; disabled?: boolean; label?: string }) {
  const inApp = useNativeApp();
  if (inApp && canTakePhoto()) return <AppCameraButton onFiles={onFiles} disabled={disabled} label={label} />;
  return <FileCameraButton onFiles={onFiles} disabled={disabled} label={label} />;
}

/** Inside the app: the app's own camera, the photo as a file; what went wrong said under it. */
function AppCameraButton({ onFiles, disabled, label }: { onFiles: (files: File[]) => void; disabled: boolean; label: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();

  async function take() {
    if (busy || disabled) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await takePhoto();
      if (result.kind === 'photo') onFiles([result.file]);
      else if (result.kind === 'failed') setProblem(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void take()}
        disabled={disabled}
        aria-busy={busy || undefined}
        aria-describedby={problem ? problemId : undefined}
        className={`${BUTTON} ${disabled ? 'pointer-events-none opacity-60' : ''} ${busy ? 'cursor-wait opacity-60' : ''}`}
      >
        {CAMERA_ICON}
        {label}
      </button>
      <span id={problemId} role="status" aria-live="polite" className={problem ? 'text-xs text-danger' : 'sr-only'}>
        {problem}
      </span>
    </span>
  );
}

/** In a browser: a file box of its own that opens the phone's camera (a computer's file chooser). */
function FileCameraButton({ onFiles, disabled, label }: { onFiles: (files: File[]) => void; disabled: boolean; label: string }) {
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
      <label htmlFor={id} aria-disabled={disabled || undefined} className={`${BUTTON} ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
        {CAMERA_ICON}
        {label}
      </label>
    </span>
  );
}
