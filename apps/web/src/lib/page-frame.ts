// The arithmetic of the document adjuster (components/adjust): the frame over a page, of any shape (not an ID card's:
// for that, see employees/scan/card.ts), what it gives, the adjusted file's name, and how a document that is too large
// is brought under the upload limit. Nothing is drawn here: pure, tested in page-frame.test.ts.

/** The frame over a page, as shares of the page shown (between 0 and 1). The same shape as card.ts's Rect. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The whole page: where a frame starts, and the "Whole page" preset. */
export const wholeRect = (): Rect => ({ x: 0, y: 0, w: 1, h: 1 });

/** Whether a frame holds the whole page. */
export const isWhole = (r: Rect) => r.x <= 1e-6 && r.y <= 1e-6 && r.w >= 1 - 1e-6 && r.h >= 1 - 1e-6;

/** The long side of an A4 sheet over its short side: 297 / 210, about 1.414. */
export const A4_RATIO = 297 / 210;

/** The frame presets: width over height, in the page's own points. */
export const PRESETS = {
  a4Portrait: 1 / A4_RATIO,
  a4Landscape: A4_RATIO,
} as const;

/** The frame on the page once the page is turned clockwise by a quarter: the same part of it. */
export function turnRect(r: Rect): Rect {
  return { x: clamp(1 - r.y - r.h, 0, 1), y: r.x, w: r.h, h: r.w };
}

/** The frame on the page once it is turned clockwise by `quarter` degrees (0, 90, 180 or 270). */
export function turnRectBy(r: Rect, quarter: number): Rect {
  let out = r;
  for (let q = ((quarter % 360) + 360) % 360; q > 0; q -= 90) out = turnRect(out);
  return out;
}

/**
 * The frame given the shape `ratio` (width over height, in points of the page W × H): about as large as it was (the
 * same area), about its middle, and on the page, smaller if it must be. Switching between two presets keeps its size.
 */
export function ratioRect(r: Rect, W: number, H: number, ratio: number): Rect {
  const area = r.w * W * (r.h * H);
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const k = Math.min(1, W / w, H / h);
  w *= k;
  h *= k;
  const cx = (r.x + r.w / 2) * W;
  const cy = (r.y + r.h / 2) * H;
  const x = clamp(cx - w / 2, 0, W - w);
  const y = clamp(cy - h / 2, 0, H - h);
  return { x: x / W, y: y / H, w: w / W, h: h / H };
}

/** The preset a frame has the shape of (within 1%), if any. W, H: the page, in points. */
export function shapeOf(r: Rect, W: number, H: number): keyof typeof PRESETS | null {
  const ratio = (r.w * W) / (r.h * H);
  for (const [name, want] of Object.entries(PRESETS) as [keyof typeof PRESETS, number][]) if (Math.abs(ratio / want - 1) <= 0.01) return name;
  return null;
}

/** The longest side of an adjusted page, in pixels: enough for any paper at 300 dpi up to A4, and a photo of more. */
export const MAX_SIDE = 3500;

/**
 * The size in pixels of a page cut out under the frame `r`: the page's own scale (W × H points), never larger, its long
 * side at most `maxSide`; then `factor` of that (below 1 to make the file smaller).
 */
export function cutSize(r: Rect, W: number, H: number, maxSide = MAX_SIDE, factor = 1): [number, number] {
  const w = r.w * W;
  const h = r.h * H;
  const k = Math.min(1, maxSide / Math.max(w, h)) * factor;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** The name of an adjusted file: the original's, without its extension, with "-adjusted.jpg" or "-adjusted.pdf". */
export function adjustedName(name: string, pdf: boolean): string {
  const base = name.replace(/\.[^./\\]{1,8}$/, '').replace(/-adjusted$/i, '').trim() || 'document';
  return `${base}-adjusted.${pdf ? 'pdf' : 'jpg'}`;
}

// ---------- staying under the upload limit ----------

/** The JPEG quality a page is saved at, and the lower ones tried, in turn, when the document is too large. */
export const QUALITIES: readonly number[] = [0.9, 0.8, 0.7, 0.6];
/** The least of its size (as a share of each side) a page is brought down to before giving up. */
export const MIN_FACTOR = 0.3;

/**
 * Encodes page `page` cut out at `factor` of its size (cutSize), once as a JPEG at each of `qualities`, in that order.
 * The page is cut once for all of them.
 */
export type Encode = (page: number, factor: number, qualities: readonly number[]) => Promise<Uint8Array[]>;

/** What fits under the limit: each page's JPEG, and what was lowered to get there. */
export interface Fitted {
  jpegs: Uint8Array[];
  quality: number;
  factor: number;
  /** 'quality': the JPEG quality was lowered; 'resolution': the size of the pages too. */
  lowered: null | 'quality' | 'resolution';
}

/**
 * The pages as JPEGs, together (with `overhead` bytes for what holds them) at most `limit` bytes: at quality 0.9 if they
 * fit; else at a lower quality, step by step (QUALITIES); else at the lowest, with the pages made smaller, step by step,
 * down to MIN_FACTOR of their size. Null when even that is too large.
 */
export async function fitUnder(pages: number, limit: number, overhead: number, encode: Encode): Promise<Fitted | null> {
  const room = limit - overhead;
  const total = (jpegs: Uint8Array[]) => jpegs.reduce((n, j) => n + j.length, 0);
  /** Each page at `factor`, at each quality: by quality, the pages. */
  const all = async (factor: number, qualities: readonly number[]) => {
    const byQuality = qualities.map(() => [] as Uint8Array[]);
    for (let p = 0; p < pages; p++) {
      const got = await encode(p, factor, qualities);
      got.forEach((j, q) => byQuality[q].push(j));
    }
    return byQuality;
  };

  const [first] = await all(1, QUALITIES.slice(0, 1));
  if (total(first) <= room) return { jpegs: first, quality: QUALITIES[0], factor: 1, lowered: null };

  const lower = QUALITIES.slice(1);
  const tries = await all(1, lower);
  for (let q = 0; q < lower.length; q++) if (total(tries[q]) <= room) return { jpegs: tries[q], quality: lower[q], factor: 1, lowered: 'quality' };

  // the lowest quality, and the pages smaller: the size of a JPEG goes about with its number of pixels
  const quality = QUALITIES[QUALITIES.length - 1];
  let size = total(tries[tries.length - 1]);
  let factor = 1;
  for (let round = 0; round < 8 && factor > MIN_FACTOR; round++) {
    factor = Math.max(MIN_FACTOR, Math.min(factor * 0.85, factor * Math.sqrt(room / size) * 0.95));
    const [jpegs] = await all(factor, [quality]);
    size = total(jpegs);
    if (size <= room) return { jpegs, quality, factor, lowered: 'resolution' };
  }
  return null;
}
