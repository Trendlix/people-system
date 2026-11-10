import { CARD_MM, CARD_RATIO, cardDims, CUT_MM, type Box, type Pt } from './card';

// After Prime ERP (Trendlix), production/web/src/scan/flatten.ts at commit c6646b8 (10 November 2026; its owner: "if the
// id is captured from mobile camera, can it be adjusted automatically?"). There a card photographed at an angle is found
// and flattened in the browser; here the OCR service finds it and flattens it (services/ocr/app/cards.py, "A card
// photographed at an angle"), and gives its four corners. What is taken here is what the hand framing needs to flatten
// a card from four corners ("Frame by the card's corners" in id-scan.tsx): the perspective transform from four points,
// the shape four corners make, the corners put in the order a card is cut out in, and the points of the cut each taken
// from its place on the picture. Changes: the cut keeps the margin a card framed here keeps (CUT_MM) and is at most
// 1800 points wide, as cutCard cuts (image.ts).
//
// A phone held over a card but not straight above it shows the card as a four-sided shape whose sides are not
// parallel: the side further from the lens is shorter. Each point of the cut is taken from the place on the picture that
// a perspective transform (a homography, worked out here from the four corners) sends it to, between the four points of
// the picture around that place. Nothing here draws: it counts, on plain arrays, so that it is tested without a canvas.
// Nothing is installed for it.

/** A perspective transform as a 3 × 3 matrix, row by row: (x, y) goes to ((m0 x + m1 y + m2) / (m6 x + m7 y + m8), (m3 x + m4 y + m5) / (…)). */
export type Mat = number[];

export const mapPt = (m: Mat, x: number, y: number): Pt => {
  const z = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z];
};

const times = (a: Mat, b: Mat): Mat =>
  [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));

/** The transform that undoes `m`. Null when it has none. */
export function invert(m: Mat): Mat | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det || !Number.isFinite(det)) return null;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}

/**
 * The eight unknowns of a set of linear equations, each row [its eight factors, what it comes to], by elimination with
 * the largest factor first. Null when they have no single answer.
 */
function solve(rows: number[][]): number[] | null {
  const n = rows.length;
  const a = rows.map((r) => r.slice());
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[best][col])) best = r;
    if (Math.abs(a[best][col]) < 1e-12) return null;
    [a[col], a[best]] = [a[best], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const k = a[r][col] / a[col][col];
      if (k) for (let c = col; c <= n; c++) a[r][c] -= k * a[col][c];
    }
  }
  return a.map((r, i) => r[n] / r[i]);
}

/**
 * The perspective transform that takes each of the four points `from` to the point of `to` in the same place: its
 * matrix's eight unknowns from the eight equations the four pairs give, the ninth being 1. The points are first moved
 * about their middle and brought to about one apart, so that the sums are of like sizes. Null when three of them lie on
 * one line.
 */
export function homography(from: Pt[], to: Pt[]): Mat | null {
  const norm = (ps: Pt[]) => {
    const cx = ps.reduce((s, p) => s + p[0], 0) / 4;
    const cy = ps.reduce((s, p) => s + p[1], 0) / 4;
    const d = ps.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / 4;
    const k = Math.SQRT2 / (d || 1);
    return { cx, cy, k, ps: ps.map(([x, y]): Pt => [(x - cx) * k, (y - cy) * k]) };
  };
  const a = norm(from);
  const b = norm(to);
  const lined = (ps: Pt[]) =>
    [0, 1, 2, 3].some((i) => {
      const [p, q, r] = [ps[i], ps[(i + 1) % 4], ps[(i + 2) % 4]];
      return Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) < 1e-9;
    });
  if (lined(a.ps) || lined(b.ps)) return null;
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = a.ps[i];
    const [u, v] = b.ps[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u], [0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  const h = solve(rows);
  if (!h || !h.every(Number.isFinite)) return null;
  const m = times([1 / b.k, 0, b.cx, 0, 1 / b.k, b.cy, 0, 0, 1], times([...h, 1], [a.k, 0, -a.k * a.cx, 0, a.k, -a.k * a.cy, 0, 0, 1]));
  return m[8] ? m.map((v) => v / m[8]) : null;
}

const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** The four sides of a card from its corners (tl, tr, br, bl): top, right, bottom, left. */
export const sidesOf = (q: Pt[]) => ({ top: dist(q[0], q[1]), right: dist(q[1], q[2]), bottom: dist(q[3], q[2]), left: dist(q[0], q[3]) });

/** The four corners turn the same way all round: a shape with no corner pushed in, and no sides that cross. */
export function convex(q: Pt[]): boolean {
  if (q.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const turn = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!(Math.abs(turn) > 1e-9)) return false;
    if (sign && Math.sign(turn) !== sign) return false;
    sign = Math.sign(turn);
  }
  return true;
}

/**
 * Four corners put in the order the card is cut out in: going round clockwise, starting from the one nearest the top
 * left of the picture as it is shown. A card standing on its end is laid on its long side, as Rotate 90° lays it.
 */
export function cornersAsShown(q: Pt[]): Pt[] {
  const cx = q.reduce((a, p) => a + p[0], 0) / 4;
  const cy = q.reduce((a, p) => a + p[1], 0) / 4;
  const round = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let first = 0;
  round.forEach((p, i) => {
    if (p[0] + p[1] < round[first][0] + round[first][1]) first = i;
  });
  const s = sidesOf(round.slice(first).concat(round.slice(0, first)));
  if (s.left + s.right > s.top + s.bottom) first = (first + 3) % 4; // standing on its end: its left side becomes its top
  return round.slice(first).concat(round.slice(0, first));
}

/** The cut of a card framed by its corners, with where the card lies on it, as cutCard cuts a card framed by a frame. */
export interface CornerCut {
  /** The corners, in the picture's points, in the order the card is cut out in (cornersAsShown). */
  q: Pt[];
  ow: number;
  oh: number;
  /** From a point of the cut to the picture. */
  m: Mat;
  /** Where the card lies on the cut, as shares of it. */
  frame: Box;
}

/**
 * The cut of a card framed by its four corners, `quad` as shares of the picture W by H: the card flattened to the size
 * of an ID card (cardDims), as sharp as the nearest of its sides, with the margin cutCard keeps around a card (CUT_MM:
 * 1.2 mm above and below it, 1.9 mm at its sides, taken from the picture beyond the corners), at most 1800 points wide.
 * Null when the corners do not make a card's shape.
 */
export function cornerCut(quad: Pt[], W: number, H: number): CornerCut | null {
  if (quad.length !== 4) return null;
  const q = cornersAsShown(quad.map(([x, y]): Pt => [x * W, y * H]));
  if (!convex(q)) return null;
  const s = sidesOf(q);
  const w = Math.max(s.top, s.bottom, CARD_RATIO * Math.max(s.left, s.right)); // as sharp as its nearest side
  const [cw, ch] = cardDims(w, w / CARD_RATIO);
  const mm = cw / CARD_MM[0];
  const mx = CUT_MM * CARD_RATIO * mm;
  const my = CUT_MM * mm;
  const TW = cw + 2 * mx;
  const TH = ch + 2 * my;
  const k = Math.min(1, 1800 / TW);
  const ow = Math.max(1, Math.round(TW * k));
  const oh = Math.max(1, Math.round(TH * k));
  const kx = ow / TW;
  const ky = oh / TH;
  const [x0, y0, x1, y1] = [mx * kx, my * ky, (mx + cw) * kx, (my + ch) * ky];
  const m = homography([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], q);
  return m && { q, ow, oh, m, frame: [mx / TW, my / TH, (mx + cw) / TW, (my + ch) / TH] };
}

/**
 * The points of a cut `ow` by `oh`, RGBA, each taken from where `m` sends its middle on the picture `px` (sw by sh,
 * RGBA), between the four points around that place. Past the edge of the picture the cut is white, as a card cut out
 * and turned is.
 */
export function warp(px: ArrayLike<number>, sw: number, sh: number, m: Mat, ow: number, oh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ow * oh * 4);
  const row = sw * 4;
  for (let y = 0, o = 0; y < oh; y++) {
    let X = m[0] * 0.5 + m[1] * (y + 0.5) + m[2];
    let Y = m[3] * 0.5 + m[4] * (y + 0.5) + m[5];
    let Z = m[6] * 0.5 + m[7] * (y + 0.5) + m[8];
    for (let x = 0; x < ow; x++, o += 4, X += m[0], Y += m[3], Z += m[6]) {
      const fx = X / Z - 0.5;
      const fy = Y / Z - 0.5;
      out[o + 3] = 255;
      if (!(fx >= -0.5 && fy >= -0.5 && fx <= sw - 0.5 && fy <= sh - 0.5)) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        continue;
      }
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const x0 = ix < 0 ? 0 : ix;
      const x1 = ix + 1 >= sw ? sw - 1 : ix + 1;
      const y0 = iy < 0 ? 0 : iy;
      const y1 = iy + 1 >= sh ? sh - 1 : iy + 1;
      const a = y0 * row + x0 * 4;
      const b = y0 * row + x1 * 4;
      const c = y1 * row + x0 * 4;
      const d = y1 * row + x1 * 4;
      const wa = (1 - tx) * (1 - ty);
      const wb = tx * (1 - ty);
      const wc = (1 - tx) * ty;
      const wd = tx * ty;
      out[o] = px[a] * wa + px[b] * wb + px[c] * wc + px[d] * wd;
      out[o + 1] = px[a + 1] * wa + px[b + 1] * wb + px[c + 1] * wc + px[d + 1] * wd;
      out[o + 2] = px[a + 2] * wa + px[b + 2] * wb + px[c + 2] * wc + px[d + 2] * wd;
    }
  }
  return out;
}

/** A picture to take points from: its size, and a part of it (sx, sy, sw, sh) copied smoothly to dw × dh, as RGBA. */
export interface Source {
  W: number;
  H: number;
  copy: (sx: number, sy: number, sw: number, sh: number, dw: number, dh: number) => ArrayLike<number>;
}

/**
 * A cut `ow` by `oh` taken from the picture `src` through `m` (a point of the cut to the picture), as RGBA. Only the
 * part of the picture the cut reaches is read, once, and shrunk smoothly as far as the cut allows without losing any of
 * its sharpness. Null when the transform turns over inside the cut.
 */
export function flatPixels(src: Source, m: Mat, ow: number, oh: number): Uint8ClampedArray | null {
  const ends: Pt[] = [[0, 0], [ow, 0], [ow, oh], [0, oh]];
  if (ends.some(([x, y]) => !(m[6] * x + m[7] * y + m[8] > 1e-9))) return null;
  const on = ends.map(([x, y]) => mapPt(m, x, y));
  const xs = on.map((p) => p[0]);
  const ys = on.map((p) => p[1]);
  const rx0 = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const ry0 = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  const rx1 = Math.min(src.W, Math.ceil(Math.max(...xs)) + 1);
  const ry1 = Math.min(src.H, Math.ceil(Math.max(...ys)) + 1);
  if (rx1 - rx0 < 2 || ry1 - ry0 < 2) return new Uint8ClampedArray(ow * oh * 4).fill(255); // the cut reaches nothing of the picture
  // as many points of the copy to a point of the picture as the cut takes, at most, along any of its four sides
  const k = Math.min(
    1,
    Math.max(...ends.map((p, i) => dist(p, ends[(i + 1) % 4]) / Math.max(1e-9, dist(on[i], on[(i + 1) % 4])))),
  );
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  const cw = Math.max(2, Math.round(rw * k));
  const ch = Math.max(2, Math.round(rh * k));
  const px = src.copy(rx0, ry0, rw, rh, cw, ch);
  return warp(px, cw, ch, times([cw / rw, 0, (-rx0 * cw) / rw, 0, ch / rh, (-ry0 * ch) / rh, 0, 0, 1], m), ow, oh);
}
