// Ported from Prime ERP (Trendlix), production/web/src/scan/card.ts at commit 1368621, for the "Adjust by hand" frame of
// the ID scan. Changes: the hand rotation goes to 10° either way (owner's range here; Prime ERP has 5°), the frame starts
// on the card's own box (the cut keeps its own margin, CUT_MM), the photo boxes are left out (not used here), and
// turnCard and frameCard are added for the pages the API sends (POST /id-card/prepare).

// The measures of a card, and the frame a person drags over a picture: the arithmetic only, nothing drawn here.
// An Egyptian national ID is a CR80 card: 85.6 × 53.98 mm. A picture fixed to that size has exactly those proportions,
// and its print size is written into the file, so that it measures as a card whatever its pixel count.

export type Side = 'front' | 'back';
export const SIDES: readonly Side[] = ['front', 'back'];
/** left, top, right, bottom: shares of a picture's width and height, between 0 and 1. */
export type Box = [number, number, number, number];
/** The frame laid over a picture, as shares of it. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * A card on a picture: its middle, its size and the angle of its long side (radians, clockwise as seen on screen), in
 * the picture's own points. `spare`: how much more to keep beyond each side, along its width and along its height, where
 * a strip of it may be and it cannot be told on which side.
 */
export interface Card {
  angle: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  spare?: [number, number];
}

export const CROP_MIN = 0.06;
export const CARD_MM: readonly [number, number] = [85.6, 53.98];
export const CARD_RATIO = CARD_MM[0] / CARD_MM[1];
export const CARD_TOL = 0.15;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** How far a shape is from a card's: above zero when it is wider. */
export const cardOff = (w: number, h: number) => w / h / CARD_RATIO - 1;

/** Pixel size of a card-sized picture holding about as many pixels as w × h: a whole number of dots per inch, so that the print size is exact. */
export function cardDims(w: number, h: number): [number, number, number] {
  const dpi = Math.max(20, Math.min(712, Math.round(Math.sqrt(w * h * CARD_RATIO) / (CARD_MM[0] / 25.4))));
  return [Math.round((dpi * CARD_MM[0]) / 25.4), Math.round((dpi * CARD_MM[1]) / 25.4), dpi];
}

/** Writes the dots per inch into the JFIF header of a JPEG, when it has one. Gives the same bytes back. */
export function jfifDpi(b: Uint8Array, dpi: number): Uint8Array {
  const jfif = b.length > 18 && b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46;
  if (jfif && dpi > 0 && dpi < 65536) {
    b[13] = 1; // the unit: dots per inch
    b[14] = dpi >> 8;
    b[15] = dpi & 255;
    b[16] = dpi >> 8;
    b[17] = dpi & 255;
  }
  return b;
}

// ---------- a card cut out of a picture ----------

/**
 * The margin kept around a card that is cut out of a picture, in millimetres of the card: this much above and below it,
 * and as much more at its sides as keeps the shape of a card (1.9 mm). The card is never cut inside its own edge.
 */
export const CUT_MM = 1.2;
/** Where the card lies on a picture it was cut out of, when nothing of it was missing: inside that margin. */
export const CUT_FRAME: Box = (() => {
  const s = CUT_MM / (CARD_MM[1] + 2 * CUT_MM);
  return [s, s, 1 - s, 1 - s];
})();

// ---------- the frame ----------

/** Where a frame starts: a little inside the picture. */
export const startRect = (): Rect => ({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 });
export const wholeRect = (): Rect => ({ x: 0, y: 0, w: 1, h: 1 });

/** The frame takes the proportions of an ID card, inside the place it has now. W, H: the picture under it, in points. */
export function cardRect(r: Rect, W: number, H: number): Rect {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let w = r.w * W;
  let h = w / CARD_RATIO;
  if (h > r.h * H) {
    h = r.h * H;
    w = h * CARD_RATIO;
  }
  return { x: clamp(cx - w / W / 2, 0, 1 - w / W), y: clamp(cy - h / H / 2, 0, 1 - h / H), w: w / W, h: h / H };
}

/** What the pointer holds: the frame itself ('move'), or one of its eight handles, named by the compass. */
export type Grip = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Exclude<Grip, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The frame after the pointer has moved by dx, dy (shares of the picture) since it took hold of `from`. A handle moves
 * its own edges only, never past the picture or the opposite edge.
 */
export function dragRect(from: Rect, m: Grip, dx: number, dy: number): Rect {
  let { x, y, w, h } = from;
  let x2 = x + w;
  let y2 = y + h;
  if (m === 'move') {
    x = clamp(x + dx, 0, 1 - w);
    y = clamp(y + dy, 0, 1 - h);
  } else {
    if (m.includes('w')) x = clamp(x + dx, 0, x2 - CROP_MIN);
    if (m.includes('e')) x2 = clamp(x2 + dx, x + CROP_MIN, 1);
    if (m.includes('n')) y = clamp(y + dy, 0, y2 - CROP_MIN);
    if (m.includes('s')) y2 = clamp(y2 + dy, y + CROP_MIN, 1);
    w = x2 - x;
    h = y2 - y;
  }
  return { x, y, w, h };
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Arrow keys move the frame; with Shift they resize it. Null for any other key. */
export function keyRect(r: Rect, key: string, shift: boolean): Rect | null {
  const d = ARROWS[key];
  const s = 0.01;
  if (!d) return null;
  return shift
    ? { x: r.x, y: r.y, w: clamp(r.w + d[0] * s, CROP_MIN, 1 - r.x), h: clamp(r.h + d[1] * s, CROP_MIN, 1 - r.y) }
    : { x: clamp(r.x + d[0] * s, 0, 1 - r.w), y: clamp(r.y + d[1] * s, 0, 1 - r.h), w: r.w, h: r.h };
}

/**
 * Where a card that was found lies once the page is turned so that the card is level: the turn in degrees, and the
 * frame on the card's own box (no air: the cut keeps its margin, CUT_MM). W, H: the page, in points.
 */
export function foundRect(found: Card, W: number, H: number): { base: number; rect: Rect } {
  const t = -found.angle;
  const dx = found.cx - W / 2;
  const dy = found.cy - H / 2;
  const x = W / 2 + dx * Math.cos(t) - dy * Math.sin(t);
  const y = H / 2 + dx * Math.sin(t) + dy * Math.cos(t);
  const w = Math.min(W, found.w);
  const h = Math.min(H, found.h);
  return {
    base: (t * 180) / Math.PI,
    rect: { x: clamp((x - w / 2) / W, 0, 1 - w / W), y: clamp((y - h / 2) / H, 0, 1 - h / H), w: w / W, h: h / H },
  };
}

/** The furthest a card is rotated by hand, either way, in degrees (owner's range). */
export const FINE_MAX = 10;
/** A rotation by hand: at most ten degrees either way, a tenth of a degree at a time. */
export const fineOf = (v: unknown) => clamp(Math.round((+(v as number) || 0) * 10) / 10, -FINE_MAX, FINE_MAX);

/** What the frame will give, for the line under the picture: the size in points, and how far the frame is from a card's shape. */
export function frameSays(r: Rect, W: number, H: number, fix: boolean): { w: number; h: number; off: number; far: boolean; pct: number; wider: boolean } {
  const w = Math.round(r.w * W);
  const h = Math.round(r.h * H);
  const off = cardOff(w, h);
  const dims = fix ? cardDims(w, h) : [w, h];
  return {
    w: dims[0],
    h: dims[1],
    off,
    far: Math.abs(off) > CARD_TOL,
    pct: Math.abs(off) > 0.005 ? Math.max(1, Math.round(Math.abs(off) * 100)) : 0,
    wider: off > 0,
  };
}

// ---------- the pages of POST /id-card/prepare (added here) ----------

/** An angle in radians, brought between −π and π. */
const turnOf = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * A card found on a page, on the same page turned clockwise by a quarter, a half or three quarters (as turnCanvas turns
 * it). W, H: the page before the turn.
 */
export function turnCard(c: Card, W: number, H: number, deg: number): Card {
  const side = deg === 90 || deg === 270;
  const t = (deg * Math.PI) / 180;
  const dx = c.cx - W / 2;
  const dy = c.cy - H / 2;
  return {
    ...c,
    cx: (side ? H : W) / 2 + dx * Math.cos(t) - dy * Math.sin(t),
    cy: (side ? W : H) / 2 + dx * Math.sin(t) + dy * Math.cos(t),
    angle: turnOf(c.angle + t),
  };
}

/** The quarter turn (0, 90, 180 or 270, clockwise) that leaves a card at `angle` (radians) leaning by 45° or less. */
export function quarterFor(angle: number): number {
  const q = -Math.round((angle * 180) / Math.PI / 90) * 90;
  return ((q % 360) + 360) % 360;
}

/**
 * The card a frame stands for on the page under it. The Cropper shows the page turned by `tilt` degrees about its
 * middle, with the frame level over it: the card is the frame turned back by as much, in the page's own points.
 */
export function frameCard(r: Rect, W: number, H: number, tilt: number): Card {
  const t = (-tilt * Math.PI) / 180;
  const dx = (r.x + r.w / 2) * W - W / 2;
  const dy = (r.y + r.h / 2) * H - H / 2;
  return { cx: W / 2 + dx * Math.cos(t) - dy * Math.sin(t), cy: H / 2 + dx * Math.sin(t) + dy * Math.cos(t), w: r.w * W, h: r.h * H, angle: t };
}
