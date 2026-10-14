'use client';

import { useEffect, useId, useRef, type PointerEvent } from 'react';
import { CARD_MM, CARD_RATIO, CUT_MM, dragRect, FINE_MAX, frameCard, frameSays, HANDLES, keyRect, type Grip, type Rect } from './card';
import { cutSize } from './image';

// Ported from Prime ERP (Trendlix), production/web/src/scan/crop.tsx at commit 1368621. Changes: plain English words
// instead of its translations, this app's buttons, the rotation goes to 10° either way, and the line under the picture
// gives the size of the cut with its margin.

// Cropping by hand: a picture with a frame dragged over it. Used where a side of an ID scan is framed by hand
// ("Adjust by hand" in id-scan.tsx). The arithmetic of the frame is in card.ts.

interface Drag {
  mode: Grip;
  px: number;
  py: number;
  bw: number;
  bh: number;
  r: Rect;
}

// where each handle sits on the frame
const HANDLE: Record<Exclude<Grip, 'move'>, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  se: 'left-full top-full cursor-nwse-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
};

/**
 * The picture `work`, shown turned by `angle` degrees about its middle, with the frame `rect` over it. The frame follows
 * the pointer and the keyboard: arrow keys move it, with Shift they resize it. `label`: what the picture is; `frame`: what
 * the frame is; `describedBy`: the words on how to use it; `tall`: room for a whole page. Until there is a picture, the
 * frame is not shown.
 */
export function Cropper({
  work,
  angle,
  rect,
  onRect,
  label,
  frame,
  describedBy,
  tall,
}: {
  work: HTMLCanvasElement | null;
  angle: number;
  rect: Rect;
  onRect: (r: Rect) => void;
  label: string;
  frame: string;
  describedBy?: string;
  tall?: boolean;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    // the picture under the frame, rotated by hand as far as the slider says
    const c = cv.current;
    const g = c && work ? c.getContext('2d') : null;
    if (!c || !work || !g) return;
    const k = Math.min(1, 1400 / Math.max(work.width, work.height));
    c.width = Math.max(1, Math.round(work.width * k));
    c.height = Math.max(1, Math.round(work.height * k));
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.translate(c.width / 2, c.height / 2);
    g.rotate((angle * Math.PI) / 180);
    g.drawImage(work, -c.width / 2, -c.height / 2, c.width, c.height);
  }, [work, angle]);

  function down(e: PointerEvent<HTMLDivElement>) {
    if (!work || !wrap.current) return;
    e.preventDefault();
    const b = wrap.current.getBoundingClientRect();
    drag.current = { mode: ((e.target as HTMLElement).dataset.h as Grip) || 'move', px: e.clientX, py: e.clientY, bw: b.width, bh: b.height, r: { ...rect } };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone
    }
    e.currentTarget.focus({ preventScroll: true });
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d) onRect(dragRect(d.r, d.mode, (e.clientX - d.px) / d.bw, (e.clientY - d.py) / d.bh));
  }
  const end = () => {
    drag.current = null;
  };

  return (
    <div className="text-center">
      <div ref={wrap} className="relative inline-block max-w-full touch-none overflow-hidden rounded-md bg-black leading-[0] select-none">
        <canvas
          ref={cv}
          width={600}
          height={380}
          role="img"
          aria-label={label}
          className={`block h-auto w-auto max-w-full ${tall ? 'max-h-[62vh]' : 'max-h-[56vh]'}`}
        />
        <div
          tabIndex={0}
          role="group"
          aria-label={frame}
          aria-describedby={describedBy}
          hidden={!work}
          data-crop-box=""
          className="absolute box-border cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,.58)] focus-visible:outline-2 focus-visible:outline-offset-[-5px] focus-visible:outline-accent"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => {
            const r = work ? keyRect(rect, e.key, e.shiftKey) : null;
            if (r) {
              e.preventDefault();
              onRect(r);
            }
          }}
        >
          {HANDLES.map((h) => (
            <i
              key={h}
              data-h={h}
              aria-hidden="true"
              className={`absolute -m-[9px] size-4 rounded-full border-2 border-accent bg-white after:absolute after:-inset-3 after:content-[''] ${HANDLE[h]}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** "+2.3°", "−0.4°", "0.0°" */
export const degrees = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`;

/** Rotates the card under the frame by hand: at most ten degrees either way, a tenth of a degree at a time. */
export function RotateBar({ fine, onFine }: { fine: number; onFine: (fine: number) => void }) {
  const id = useId();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="inline-flex min-w-0 flex-[1_1_13rem] items-center gap-2 text-sm">
        <span>Rotate the card</span>
        <input
          id={id}
          className="w-[min(14rem,40vw)] accent-accent"
          type="range"
          min={-FINE_MAX}
          max={FINE_MAX}
          step="0.1"
          value={fine}
          aria-valuetext={degrees(fine)}
          onChange={(e) => onFine(+e.target.value)}
        />
      </label>
      <button type="button" className="btn btn-secondary" aria-label="Rotate a tenth of a degree anticlockwise" onClick={() => onFine(fine - 0.1)}>
        −0.1°
      </button>
      <output htmlFor={id} className="min-w-[3.4rem] text-center text-sm tabular-nums">
        {degrees(fine)}
      </output>
      <button type="button" className="btn btn-secondary" aria-label="Rotate a tenth of a degree clockwise" onClick={() => onFine(fine + 0.1)}>
        +0.1°
      </button>
    </span>
  );
}

const MARGIN = `${CUT_MM} mm above and below it and ${(CUT_MM * CARD_RATIO).toFixed(1)} mm at its sides`;

/**
 * What the frame will give, said under the picture: the card brought to the size of an ID card, with the margin the cut
 * keeps around it (never past the picture). W, H: the picture under the frame; `tilt`: how far it is shown turned.
 */
export function FrameSays({ rect, W, H, tilt }: { rect: Rect; W: number; H: number; tilt: number }) {
  const s = frameSays(rect, W, H, true);
  const [w, h] = cutSize(frameCard(rect, W, H, tilt), W, H, [s.w, s.h]);
  return (
    <>
      The cropped picture will be {w} × {h} pixels, fixed to the size of an ID card: {CARD_MM[0]} × {CARD_MM[1]} mm, with a margin of {MARGIN}.
      {s.far
        ? ' The frame is far from the shape of a card: Use this frame fits it to one first.'
        : s.pct
          ? ` The frame is ${s.pct}% ${s.wider ? 'wider' : 'taller'} than a card, so the picture is adjusted to match.`
          : ''}
    </>
  );
}
