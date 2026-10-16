'use client';

import type { PhotoCrop } from '@trendlix/shared';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { FormErrors } from '@/components/form';
import {
  cropOf,
  keyView,
  maxZoom,
  panView,
  sliderOf,
  viewOf,
  viewStyle,
  wheelZoom,
  ZOOM_STEP,
  zoomLabel,
  zoomOfSlider,
  zoomView,
  type CropView,
  type PhotoSize,
} from '@/lib/photo-crop';
import { Avatar, photoHref } from '../avatar';
import { cropPhoto } from '../photo-crop-actions';

// Cropping the picture beside the name (owner's request, 16 October 2026: "allow me to crop the photo beside the name to
// make the face bigger without affecting the uploaded full photo"): a small round button on the corner of the profile's
// picture, for HR, opens a pop-up window (a native modal <dialog>, like the document viewer's) with the personal photo
// under a square frame masked as the circle. The photo is dragged to move it and zoomed with the slider, the mouse wheel
// or a pinch; the arrow keys move it and + and − zoom. Beside it, the circle as the profile and the list will show it.
// Save keeps the square (lib/photo-crop.ts has the arithmetic); Use the whole photo clears it; Cancel changes nothing.
// The uploaded photo is never changed. Clicking the picture itself still opens the whole photo.

type Said = { tone: 'loading' } | { tone: 'failed' } | { tone: 'shown'; size: PhotoSize };

/** The pop-up window, only in the page while it is open: shown as a modal as soon as it is added, at the end of the page. */
function CropWindow({ photoId, crop, name, onSaved, onClosed }: { photoId: string; crop: PhotoCrop | null; name: string; onSaved: (message: string) => void; onClosed: () => void }) {
  const titleId = useId();
  const howId = useId();
  const zoomId = useId();
  const [photo, setPhoto] = useState<Said>({ tone: 'loading' });
  const [view, setView] = useState<CropView | null>(null);
  const [saving, setSaving] = useState<null | 'crop' | 'whole'>(null);
  const [errors, setErrors] = useState<string[]>();
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  /** The pointers on the photo now, where each was last: one drags it, two pinch it. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dialogEl = useRef<HTMLDialogElement | null>(null);

  const size = photo.tone === 'shown' ? photo.size : null;
  const busy = saving !== null;

  const attach = useCallback((dialog: HTMLDialogElement | null) => {
    dialogEl.current = dialog;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /** The photo is open: the window starts on the saved crop, else on the whole photo. */
  const opened = useCallback(
    (img: HTMLImageElement) => {
      const shown = shownSize(img);
      if (!shown) return;
      setPhoto((p) => (p.tone === 'shown' ? p : { tone: 'shown', size: shown }));
      setView((v) => v ?? viewOf(crop, shown));
    },
    [crop],
  );
  // a photo the browser already had is open before its load event can be heard
  const photoRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete) opened(img);
    },
    [opened],
  );

  // the mouse wheel zooms about the pointer, and doesn't scroll the window: heard directly, as React hears wheels passively
  useEffect(() => {
    const el = stage.current;
    if (!el || !size) return;
    const wheel = (e: WheelEvent) => {
      const box = frame.current?.getBoundingClientRect();
      if (!box?.width) return;
      e.preventDefault();
      const at = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      setView((v) => v && zoomView(v, wheelZoom(v.zoom, e.deltaY), size, at));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [size]);

  function down(e: PointerEvent<HTMLDivElement>) {
    if (!size || busy) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.focus({ preventScroll: true });
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const all = pointers.current;
    const before = all.get(e.pointerId);
    const box = frame.current?.getBoundingClientRect();
    if (!before || !size || !box?.width) return;
    const now = { x: e.clientX, y: e.clientY };
    all.set(e.pointerId, now);
    if (all.size === 1) {
      // one pointer drags the photo
      setView((v) => v && panView(v, (now.x - before.x) / box.width, (now.y - before.y) / box.height, size));
      return;
    }
    // two fingers pinch it: zoomed as far as they open or close, about the point between them
    const other = [...all.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) return;
    const apart = (a: { x: number; y: number }) => Math.hypot(a.x - other.x, a.y - other.y);
    if (!apart(before)) return;
    const at = { x: ((now.x + other.x) / 2 - box.left) / box.width, y: ((now.y + other.y) / 2 - box.top) / box.height };
    setView((v) => v && zoomView(v, (v.zoom * apart(now)) / apart(before), size, at));
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
  }

  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (!size || !view || busy) return;
    const next = keyView(view, e.key, e.shiftKey, size);
    if (!next) return;
    e.preventDefault();
    setView(next);
  }

  const zoomTo = (zoom: number) => size && setView((v) => v && zoomView(v, zoom, size));

  /** Closes the window: its close event calls onClosed, once the rest of the page can take the focus again. */
  function finish() {
    const dialog = dialogEl.current;
    if (dialog?.open) dialog.close();
    else onClosed();
  }

  async function save(whole: boolean) {
    if (busy || (!whole && (!view || !size))) return;
    setErrors(undefined);
    setSaving(whole ? 'whole' : 'crop');
    let result: Awaited<ReturnType<typeof cropPhoto>>;
    try {
      result = await cropPhoto(photoId, whole || !view || !size ? null : cropOf(view, size), size);
    } catch {
      result = { errors: ['The crop could not be saved. Please try again.'] };
    }
    setSaving(null);
    if (result.errors?.length) {
      setErrors(result.errors);
      return;
    }
    onSaved(result.message ?? 'Saved.');
    finish();
  }

  const shownCrop = view && size ? cropOf(view, size) : crop;
  const most = size ? maxZoom(size) : 1;

  return createPortal(
    <dialog
      ref={attach}
      aria-labelledby={titleId}
      // Esc closes it, as Cancel does, unless it is saving
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClose={onClosed}
      className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-hidden rounded-xl bg-card p-0 text-ink shadow-xl backdrop:bg-black/70 open:flex open:flex-col"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line py-2 pr-2 pl-5">
        <h2 id={titleId} className="min-w-0 self-center font-semibold break-words">
          Crop the Photo · {name}
        </h2>
        <button
          type="button"
          aria-label="Close without saving"
          onClick={() => !busy && finish()}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 overflow-auto p-4 sm:grid-cols-[minmax(0,20rem)_1fr] sm:p-5">
        <div className="mx-auto w-full max-w-80 space-y-3">
          <div
            ref={stage}
            tabIndex={0}
            role="group"
            aria-label={`The personal photo of ${name} under the frame`}
            aria-describedby={howId}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={key}
            className={`relative aspect-square w-full touch-none overflow-hidden rounded-lg bg-black select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${size ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            {/* the square that is saved, a tenth in from each side: the photo around it shows, dimmed, to drag in */}
            <div ref={frame} className="absolute inset-[10%]">
              {/* eslint-disable-next-line @next/next/no-img-element -- a file of the employee file, behind the session: not for the image optimizer */}
              <img
                ref={photoRef}
                src={photoHref(photoId)}
                alt=""
                draggable={false}
                onLoad={(e) => opened(e.currentTarget)}
                onError={() => setPhoto({ tone: 'failed' })}
                className={`pointer-events-none absolute max-w-none ${view && size ? '' : 'invisible'}`}
                style={view && size ? viewStyle(view, size) : undefined}
              />
              {/* the circle beside the name in that square; outside it, the rest of the photo dimmed */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,.58)]" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 border border-dashed border-white/50" />
            </div>
            {photo.tone === 'loading' && <p className="absolute inset-0 m-auto h-fit text-center text-sm text-white">Opening the photo…</p>}
            {photo.tone === 'failed' && (
              <p role="alert" className="absolute inset-0 m-auto h-fit max-w-[80%] text-center text-sm text-white">
                The photo could not be loaded. Close the window and try again.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={!view || !size || view.zoom <= 1}
              onClick={() => view && zoomTo(view.zoom / ZOOM_STEP)}
              className="btn btn-secondary min-h-9 w-9 shrink-0 px-0"
            >
              −
            </button>
            <label htmlFor={zoomId} className="sr-only">
              Zoom
            </label>
            <input
              id={zoomId}
              type="range"
              min={0}
              max={sliderOf(most)}
              step={0.01}
              value={view ? sliderOf(view.zoom) : 0}
              disabled={!view || !size}
              aria-valuetext={view ? zoomLabel(view.zoom) : undefined}
              onChange={(e) => zoomTo(zoomOfSlider(+e.target.value))}
              className="min-w-0 flex-1 accent-accent"
            />
            <button
              type="button"
              aria-label="Zoom in"
              disabled={!view || !size || view.zoom >= most}
              onClick={() => view && zoomTo(view.zoom * ZOOM_STEP)}
              className="btn btn-secondary min-h-9 w-9 shrink-0 px-0"
            >
              +
            </button>
            <output htmlFor={zoomId} className="min-w-10 text-right text-sm tabular-nums">
              {view ? zoomLabel(view.zoom) : ''}
            </output>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">As it will show</p>
            <div className="flex items-end gap-5">
              <figure className="m-0 grid justify-items-center gap-1">
                <Avatar name={name} photoId={photoId} crop={shownCrop} size="lg" />
                <figcaption className="text-xs text-muted">On the profile</figcaption>
              </figure>
              <figure className="m-0 grid justify-items-center gap-1">
                <Avatar name={name} photoId={photoId} crop={shownCrop} />
                <figcaption className="text-xs text-muted">In the list</figcaption>
              </figure>
            </div>
          </div>
          <p id={howId} className="text-sm text-muted">
            Drag the photo to move it, and zoom in with the slider, the mouse wheel or by pinching, until the face fills the circle. With the
            keyboard, the arrow keys move the photo (further with Shift), and + and − zoom in and out.
          </p>
          <p className="text-sm text-muted">Only the picture beside the name changes: the uploaded photo stays as it is.</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-line px-5 py-3">
        <FormErrors errors={errors} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void save(true)}
            aria-disabled={busy}
            className="btn btn-secondary aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {saving === 'whole' ? 'Saving…' : 'Use the whole photo'}
          </button>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => !busy && finish()} aria-disabled={busy} className="btn btn-secondary aria-disabled:opacity-60">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save(false)}
              aria-disabled={busy || !view || !size}
              className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              {saving === 'crop' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * The small round button on the corner of the profile's picture (HR; the API checks this again) that opens the crop
 * window. Shown when the picture is hovered or anything in it has the focus, and always on touch screens. Closing the
 * window puts the focus back on it.
 */
/**
 * The photo's size as the browser shows it: read from how it lays out at its own size, so turned upright by its
 * orientation data whatever the file type. A browser's naturalWidth and naturalHeight can be the file's own, before it
 * is turned (16 October 2026: a crop came out not square), so they are only used when it can't be laid out.
 */
function shownSize(img: HTMLImageElement): PhotoSize | null {
  const probe = img.cloneNode() as HTMLImageElement;
  probe.removeAttribute('class');
  probe.removeAttribute('style');
  probe.removeAttribute('id');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'absolute', top: '0', left: '-100000px', width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', visibility: 'hidden' });
  (img.ownerDocument.body ?? img.parentElement)?.append(probe);
  const laid = { width: probe.offsetWidth, height: probe.offsetHeight };
  probe.remove();
  if (laid.width > 0 && laid.height > 0) return laid;
  return img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null;
}

export function PhotoCropButton({ photoId, crop, name }: { photoId: string; crop: PhotoCrop | null; name: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const opener = useRef<HTMLButtonElement>(null);

  function closed() {
    setOpen(false);
    opener.current?.focus(); // browsers do this too, but not all of them reliably
  }

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        aria-label="Crop the photo beside the name"
        title="Crop the photo beside the name"
        onClick={() => {
          setSaved('');
          setOpen(true);
        }}
        className="absolute -right-1 -bottom-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full border border-line bg-card text-ink opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 after:absolute after:-inset-1.5 after:content-[''] hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M6 2v14a2 2 0 0 0 2 2h14" />
          <path d="M18 22V8a2 2 0 0 0-2-2H2" />
        </svg>
      </button>
      {/* said to screen readers; the picture itself shows the new crop */}
      <span role="status" className="sr-only">
        {saved}
      </span>
      {open && <CropWindow photoId={photoId} crop={crop} name={name} onSaved={setSaved} onClosed={closed} />}
    </>
  );
}
