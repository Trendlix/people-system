import { CARD_MM, CARD_RATIO, CUT_MM, jfifDpi, type Box, type Card } from './card';

// Ported from Prime ERP (Trendlix), production/web/src/scan/image.ts at commit 1368621: the canvas helpers the "Adjust by
// hand" frame needs (cardJpeg comes from store.ts there). Finding the card on a picture is left out: here the OCR
// service finds it (POST /id-card/prepare). Changes: cutCard can bring the card to a given size (fixed to the size of an
// ID card), and cutSize says what it will give.

// A card framed by hand is cut out of the page in the browser, on the picture itself, with a margin around it, so that
// the card is never cut inside its own edge.

/** Anything a picture can be drawn from. */
export type Picture = ImageBitmap | HTMLCanvasElement;

export const canvasOf = (w: number, h: number): HTMLCanvasElement => {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return cv;
};

/** The drawing surface of a canvas. A browser that has none left says so. */
export function ctxOf(cv: HTMLCanvasElement, often = false): CanvasRenderingContext2D {
  const ctx = often ? cv.getContext('2d', { willReadFrequently: true }) : cv.getContext('2d');
  if (!ctx) throw new Error('This browser gave no canvas to draw on.');
  return ctx;
}

export const toBlob = (cv: HTMLCanvasElement, type?: string, quality?: number) => new Promise<Blob | null>((res) => cv.toBlob(res, type, quality));

/** Honours the camera's own rotation tag. */
export const loadBitmap = (blob: Blob): Promise<ImageBitmap> =>
  createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob));

/** A file as a canvas of its own size, for work that changes it. */
export async function canvasFrom(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await loadBitmap(blob);
  const cv = canvasOf(bmp.width, bmp.height);
  ctxOf(cv).drawImage(bmp, 0, 0);
  bmp.close?.();
  return cv;
}

/** A picture sent as base64 (the pages and cards of POST /id-card/prepare), as a file. */
export function base64File(data: string, name: string, type = 'image/jpeg'): File {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type });
}

/**
 * What is cut out of a picture for a card: how far the cut reaches on each side of it, from its middle, [left, top,
 * right, bottom] in the picture's points, and `frame`, where the card lies on what is cut. The card with its margin
 * (CUT_MM) and what is to spare, but never past the edge of the picture: where the scan, or the picture, cut off a strip
 * of the card, the edge of the picture is the edge of the cut too. The frame then reaches past the cut on that side.
 * W, H: the picture.
 */
export function cutPlan(card: Card, W: number, H: number): { reach: [number, number, number, number]; frame: Box } {
  const mm = Math.sqrt((card.w * card.h) / (CARD_MM[0] * CARD_MM[1]));
  const sp = card.spare || [0, 0];
  const mx = CUT_MM * CARD_RATIO * mm + sp[0];
  const my = CUT_MM * mm + sp[1];
  const cos = Math.cos(card.angle);
  const sin = Math.sin(card.angle);
  // from the middle of the card along a direction, how far it is to the edge of the picture
  const room = (dx: number, dy: number) =>
    Math.min(
      dx > 1e-9 ? (W - card.cx) / dx : dx < -1e-9 ? -card.cx / dx : Infinity,
      dy > 1e-9 ? (H - card.cy) / dy : dy < -1e-9 ? -card.cy / dy : Infinity,
    );
  const l = Math.min(card.w / 2 + mx, room(-cos, -sin));
  const t = Math.min(card.h / 2 + my, room(sin, -cos));
  const r = Math.min(card.w / 2 + mx, room(cos, sin));
  const b = Math.min(card.h / 2 + my, room(-sin, cos));
  return {
    reach: [l, t, r, b],
    frame: [(l - card.w / 2) / (l + r), (t - card.h / 2) / (t + b), (l + card.w / 2) / (l + r), (t + card.h / 2) / (t + b)],
  };
}

/** A card cut out of a picture, and `frame`: where the card lies on what was cut, as shares of it (see cutPlan). */
export type Cut = HTMLCanvasElement & { frame: Box };

/**
 * The size in pixels of what cutCard gives: the cut of cutPlan, at the picture's own scale or, given `size`, with the
 * card itself brought to that size; at most 1800 pixels wide.
 */
export function cutSize(card: Card, W: number, H: number, size?: [number, number]): [number, number] {
  const [l, t, r, b] = cutPlan(card, W, H).reach;
  const w = (l + r) * (size ? size[0] / card.w : 1);
  const h = (t + b) * (size ? size[1] / card.h : 1);
  const k = Math.min(1, 1800 / w);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/**
 * A card cut out of a picture and set straight, with a margin around it (cutPlan). `size`: the card's own size in the
 * result, in pixels, when it is to be brought to the size of an ID card (cardDims); the margin is scaled with it.
 */
export function cutCard(bmp: Picture, card: Card, size?: [number, number]): Cut {
  const { reach, frame } = cutPlan(card, bmp.width, bmp.height);
  const [l, t, r, b] = reach;
  const [width, height] = cutSize(card, bmp.width, bmp.height, size);
  const cv = canvasOf(width, height);
  const ctx = ctxOf(cv);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(cv.width / (l + r), cv.height / (t + b));
  ctx.translate(l, t);
  ctx.rotate(-card.angle);
  ctx.drawImage(bmp, -card.cx, -card.cy);
  return Object.assign(cv, { frame });
}

/** A picture turned clockwise by a quarter, a half or three quarters. */
export function turnCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const side = deg === 90 || deg === 270;
  const out = canvasOf(side ? src.height : src.width, side ? src.width : src.height);
  const ctx = ctxOf(out);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/** A canvas as a JPEG with its print size: `dpi` dots per inch, written into the JFIF header. */
export async function cardJpeg(cv: HTMLCanvasElement, dpi: number): Promise<Blob | null> {
  const blob = await toBlob(cv, 'image/jpeg', 0.92);
  if (!blob) return null;
  const b = jfifDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([b.buffer as ArrayBuffer], { type: 'image/jpeg' });
}
