import { CARD_RATIO, clamp, FINE_MAX, fineOf, type Rect } from './card';
import { canvasOf, ctxOf } from './image';

// After Prime ERP (Trendlix), production/web/src/scan/edges.ts at commit 1368621 (cardAroundText). There a card is looked
// for outwards from its text, once a scan has been read; here, around the frame a person dragged over the card ("Fit to
// the card's edges" in id-scan.tsx). What comes from there: a card's edge is a straight line that changes the same way all
// along its length, so a strip of the picture summed along it shows the edge, while print and noise cancel out; the strip
// is taken in parts, so that a shadow or an emblem beside a stretch of the edge does not decide; and how far the card still
// leans is read from where its edges lie from one end of their length to the other. The search around a frame is new.

// Fitting the frame to the card under it. The person frames the card roughly; then each side of the frame has the card's
// own edge looked for in a band around it, on the picture turned by the angle tried. The angle at which four edges show
// sharpest in the shape of a card is found roughly first, then exactly from how far those edges still lean. The frame is
// laid on the edges found, in the shape of an ID card, and the angle goes on the slider, in its tenths of a degree. The
// frame is the card's own box, as for a card the OCR service found: the cut keeps its margin around it (CUT_MM).
//
// fitEdges only counts, on an array of points, and is tested on pictures drawn as arrays; pixelsOf takes them off a canvas.

/** The frame's longer side, in points of the picture looked at: a larger picture is shrunk to about this, for speed. */
const LOOK_SIZE = 360;
/** How far either way of each side of the frame the card's edge is looked for, as a share of the frame across that side. */
const BAND = 0.2;
/** How much of each side is looked along, either way of its middle, as a share of its length: clear of the card's rounded
 *  corners, even with the frame a little off. */
const ALONG = 0.35;
/** The parts each band is taken in along its length, and how many of them are left out at either end of how strongly the
 *  edge shows in them: a shadow or a finger over a stretch of the edge, or a photo's edge beside a stretch of it. */
const PARTS = 8;
const TRIM = 2;
/** The angles tried first, either way of the slider's, in degrees, and the step between them. */
const COARSE = 3;
const COARSE_STEP = 0.5;
/** How far four edges may be from the shape of a card and still be taken for one. */
const SHAPE_TOL = 0.04;
/** How clearly the card's own edges must show, at least, against the clearest edges that make a card inside them. */
const OUTER_MIN = 0.15;
/** The least change across an edge, in levels of grey (0 to 255), that counts as one. */
const EDGE_MIN = 4;
/** How far either way of a point the picture is compared, across an edge, in points of the picture looked at. */
const SPAN = 2;

/** A picture as points: RGBA as ImageData gives it, or one grey value a point. */
export interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** A frame as it stands on the hand-framing screen: `rect` over the picture shown turned by base + fine degrees. */
export interface Framing {
  rect: Rect;
  base: number;
  fine: number;
}

/** The frame laid on the card's edges, and the slider that sets the card level. */
export interface Fitted {
  rect: Rect;
  fine: number;
}

type Name = 'L' | 'R' | 'T' | 'B';
const NAMES: readonly Name[] = ['L', 'R', 'T', 'B'];

/** The picture looked at: grey, shrunk by `n` (each point the mean of n × n of the picture's). */
interface Grey {
  g: Float32Array;
  w: number;
  h: number;
  n: number;
}

/**
 * A band around a side of the frame, in the picture's points measured from the frame's middle, along and across the
 * picture as shown: across the side from `a0`, `na` steps of `step` points; along it from `b0`, `nb` steps. `rows`: the
 * side runs across the picture (the top and the bottom). `inward`: which way across is into the frame.
 */
interface Band {
  rows: boolean;
  inward: 1 | -1;
  a0: number;
  na: number;
  b0: number;
  nb: number;
  step: number;
}

/** A band as it shows at one angle: how much lighter the picture gets into the frame, at each step across, in each part (PARTS × na). */
interface Strip {
  band: Band;
  parts: Float32Array;
  ends: number[];
}

/** An edge found across a band: at step `at`, at `pos` in the frame's points, this strong. */
interface Hit {
  at: number;
  pos: number;
  s: number;
}

/**
 * The card's four edges as they show at one angle, in the frame's points; `s`: how clearly; `sign`: 1 when the card is
 * lighter than what is around it, −1 when darker; `by`: the edges that showed, four or three (the shape of a card gives
 * the fourth).
 */
interface Edges {
  L: number;
  R: number;
  T: number;
  B: number;
  s: number;
  sign: 1 | -1;
  by: Partial<Record<Name, Hit>>;
  sides: number;
}

/** What a look found: the clearest edges that make the shape of a card, and the card's own edges, around them (cardEdges). */
interface Found {
  clearest: Edges;
  card: Edges;
}

/** The picture at one position of the slider: its four bands, and what was found on them, if anything. */
interface Look {
  fine: number;
  strips: Record<Name, Strip>;
  found: Found | null;
}

/** The picture in grey, shrunk by n. */
function greyOf(px: Pixels, n: number): Grey {
  const { data, width: W } = px;
  const step = data.length >= W * px.height * 4 ? 4 : 1;
  const w = Math.floor(W / n);
  const h = Math.floor(px.height / n);
  const g = new Float32Array(w * h);
  const k = 1 / (n * n);
  for (let y = 0; y < h * n; y++) {
    const row = Math.floor(y / n) * w;
    for (let x = 0, i = y * W * step; x < w * n; x++, i += step) {
      g[row + Math.floor(x / n)] += (step === 4 ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] : data[i]) * k;
    }
  }
  return { g, w, h, n };
}

/**
 * A band of the picture as shown turned by `turn` (radians), taken about the frame's middle (sx, sy, on the picture
 * itself), summed along each of its parts. Past the edge of the picture, the picture's last points go on: no edge there.
 */
function stripOf(pic: Grey, sx: number, sy: number, turn: number, band: Band): Strip {
  const { g, w, h, n } = pic;
  const { rows, inward, a0, na, b0, nb } = band;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // a point of the frame (p, q) lies on the picture at (sx + p·cos + q·sin, sy − p·sin + q·cos): one step across and one
  // along, in the shrunk picture's points, and where the band starts, the middle of its first point at 0
  const [ax, ay, bx, by] = rows ? [sin, cos, cos, -sin] : [cos, -sin, sin, cos];
  const p0 = rows ? b0 : a0;
  const q0 = rows ? a0 : b0;
  const x0 = (sx + p0 * cos + q0 * sin) / n - 0.5;
  const y0 = (sy - p0 * sin + q0 * cos) / n - 0.5;
  const ends = Array.from({ length: PARTS + 1 }, (_, k) => Math.round((nb * k) / PARTS));
  const sums = new Float64Array(PARTS * na);
  for (let k = 0; k < PARTS; k++) {
    const o = k * na;
    for (let b = ends[k]; b < ends[k + 1]; b++) {
      let x = x0 + b * bx;
      let y = y0 + b * by;
      for (let a = 0; a < na; a++, x += ax, y += ay) {
        let ix = Math.floor(x);
        let iy = Math.floor(y);
        let tx = x - ix;
        let ty = y - iy;
        if (ix < 0) {
          ix = 0;
          tx = 0;
        } else if (ix > w - 2) {
          ix = w - 2;
          tx = 1;
        }
        if (iy < 0) {
          iy = 0;
          ty = 0;
        } else if (iy > h - 2) {
          iy = h - 2;
          ty = 1;
        }
        const i = iy * w + ix;
        const top = g[i] + (g[i + 1] - g[i]) * tx;
        const bottom = g[i + w] + (g[i + w + 1] - g[i + w]) * tx;
        sums[o + a] += top + (bottom - top) * ty;
      }
    }
  }
  // how much lighter it gets into the frame, from two steps before to two steps after (an edge a photo blurs over a few
  // points still shows whole), in each part
  const parts = new Float32Array(PARTS * na);
  for (let k = 0; k < PARTS; k++) {
    const o = k * na;
    const len = Math.max(1, ends[k + 1] - ends[k]);
    for (let a = SPAN; a < na - SPAN; a++) parts[o + a] = (inward * (sums[o + a + SPAN] - sums[o + a - SPAN])) / len;
  }
  return { band, parts, ends };
}

/**
 * How clearly an edge shows at each step across a strip, for a card lighter (`sign` 1) or darker (−1) than what is around
 * it: the mean of its parts, leaving out those where it shows most and least. An edge that runs the whole length shows
 * in every part; the edge of a photo or a line of print beside it, in some only; and at the wrong angle the edge is in a
 * different place in each part.
 */
function scoreOf(st: Strip, sign: 1 | -1): Float32Array {
  const na = st.band.na;
  const out = new Float32Array(na);
  const v = new Float32Array(PARTS);
  for (let a = SPAN; a < na - SPAN; a++) {
    for (let k = 0; k < PARTS; k++) v[k] = Math.max(0, sign * st.parts[k * na + a]);
    v.sort();
    let s = 0;
    for (let k = TRIM; k < PARTS - TRIM; k++) s += v[k];
    out[a] = s / (PARTS - 2 * TRIM);
  }
  return out;
}

/**
 * Where a peak of `v` (from `o` on) found at step `at` lies, to a fraction of a step: the middle of what stands above half
 * its height around it, weighted by how far above (an edge shows as a peak a few steps wide, flat on top when it is
 * sharp). `lo`, `hi`: the steps that may be looked at; `sign`: −1 for a peak below nought.
 */
function centreOf(v: ArrayLike<number>, o: number, at: number, lo: number, hi: number, sign = 1): number {
  const half = (sign * v[o + at]) / 2;
  let sw = 0;
  let sa = 0;
  const add = (a: number) => {
    const above = sign * v[o + a] - half;
    if (above <= 0) return false;
    sw += above;
    sa += above * a;
    return true;
  };
  for (let a = at; a >= lo && add(a); a--);
  for (let a = at + 1; a <= hi && add(a); a++);
  return sw > 0 ? sa / sw : at;
}

/**
 * The edges across a strip: where it shows clearly above what is usual there, the strongest first, at most eight. A faint
 * edge beside a strong one still counts: a light card on white shows its own edge far less than the photo printed on it.
 */
function hitsOf(st: Strip, score: Float32Array): Hit[] {
  const { a0, na, step } = st.band;
  const inner = Array.from(score.subarray(SPAN, na - SPAN)).sort((x, y) => x - y);
  if (!inner.length) return [];
  const need = Math.max(EDGE_MIN, inner[inner.length - 1] * 0.04, inner[inner.length >> 1] * 3);
  const out: Hit[] = [];
  for (let a = SPAN + 2; a < na - SPAN - 2; a++) {
    const s = score[a];
    if (s >= need && s >= score[a - 1] && s > score[a + 1] && s >= score[a - 2] && s > score[a + 2]) {
      out.push({ at: a, pos: a0 + centreOf(score, 0, a, SPAN, na - SPAN - 1) * step, s });
    }
  }
  return out.sort((x, y) => y.s - x.s).slice(0, 8);
}

/**
 * The edges that make the shape of a card among those found on each side, for a card lighter than what is around it and
 * for one darker: four of the same kind (the nearer the shape of a card, the better), or, only when no four do, three,
 * with the shape of a card giving the fourth (a card cut short by the scan, or an edge that does not show).
 *
 * Of them, `clearest` may be print, a photo or a darker border: on a light card on white they show far more than the
 * card's own edge. `card` is the card's own edges: the outermost that lie around the clearest and still show clearly
 * enough (OUTER_MIN), since print, a photo and a border all lie inside the card's edge. `tol`: how far an edge may lie
 * inside the clearest and still count as around it, in points.
 */
function cardEdges(hits: Record<1 | -1, Record<Name, Hit[]>>, tol: number): Found | null {
  const four: Edges[] = [];
  const three: Edges[] = [];
  for (const sign of [1, -1] as const) {
    const options = (k: Name): (Hit | null)[] => [...hits[sign][k], null];
    for (const l of options('L'))
      for (const r of options('R'))
        for (const t of options('T'))
          for (const b of options('B')) {
            const got = (l ? 1 : 0) + (r ? 1 : 0) + (t ? 1 : 0) + (b ? 1 : 0);
            if (got < 3 || (got === 3 && four.length)) continue;
            let s = (l?.s ?? 0) + (r?.s ?? 0) + (t?.s ?? 0) + (b?.s ?? 0);
            let [L, R, T, B] = [l?.pos ?? 0, r?.pos ?? 0, t?.pos ?? 0, b?.pos ?? 0];
            if (got === 4) {
              const off = (R - L) / (B - T) / CARD_RATIO - 1;
              if (!(Math.abs(off) <= SHAPE_TOL)) continue;
              s *= 1 - 0.5 * (off / SHAPE_TOL) ** 2;
            } else if (!l) L = R - (B - T) * CARD_RATIO;
            else if (!r) R = L + (B - T) * CARD_RATIO;
            else if (!t) T = B - (R - L) / CARD_RATIO;
            else B = T + (R - L) / CARD_RATIO;
            if (!(R > L && B > T)) continue;
            const by: Partial<Record<Name, Hit>> = {};
            if (l) by.L = l;
            if (r) by.R = r;
            if (t) by.T = t;
            if (b) by.B = b;
            (got === 4 ? four : three).push({ L, R, T, B, s, sign, by, sides: got });
          }
  }
  const fit = four.length ? four : three;
  if (!fit.length) return null;
  const clearest = fit.reduce((a, e) => (e.s > a.s ? e : a));
  const around = (e: Edges) => e.L <= clearest.L + tol && e.R >= clearest.R - tol && e.T <= clearest.T + tol && e.B >= clearest.B - tol;
  const area = (e: Edges) => (e.R - e.L) * (e.B - e.T);
  const card = fit.filter((e) => e.s >= OUTER_MIN * clearest.s && around(e)).reduce((a, e) => (area(e) > area(a) ? e : a), clearest);
  return { clearest, card };
}

/** The slope of the line through points (x, y) of weights w, leaving out one at a time those more than `tol` off it. Null with fewer than four. */
function slopeOf(xs: number[], ys: number[], ws: number[], tol: number): number | null {
  const on = xs.map(() => true);
  for (;;) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < xs.length; i++) if (on[i]) [sw, sx, sy] = [sw + ws[i], sx + ws[i] * xs[i], sy + ws[i] * ys[i]];
    if (on.filter(Boolean).length < 4 || !(sw > 0)) return null;
    const mx = sx / sw;
    const my = sy / sw;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) if (on[i]) [sxx, sxy] = [sxx + ws[i] * (xs[i] - mx) ** 2, sxy + ws[i] * (xs[i] - mx) * (ys[i] - my)];
    if (!(sxx > 0)) return null;
    const slope = sxy / sxx;
    let worst = -1;
    let off = tol;
    for (let i = 0; i < xs.length; i++) {
      const d = on[i] ? Math.abs(ys[i] - my - slope * (xs[i] - mx)) : 0;
      if (d > off) [worst, off] = [i, d];
    }
    if (worst < 0) return slope;
    on[worst] = false;
  }
}

/**
 * How far the card still leans at a look, in degrees, clockwise as seen: each of its own edges is placed in each part of
 * its length, and a line drawn through. Null when no edge can be measured.
 */
function leanOf(v: Look): number | null {
  const e = v.found?.card;
  if (!e) return null;
  /** what each edge says the card leans by, and how long a stretch of it was measured */
  const says: [number, number][] = [];
  for (const k of NAMES) {
    const hit = e.by[k];
    if (!hit) continue;
    const { band, parts, ends } = v.strips[k];
    const { na, a0, b0, step, rows } = band;
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (let p = 0; p < PARTS; p++) {
      const o = p * na;
      let at = -1;
      let top = 0;
      for (let a = Math.max(SPAN + 1, hit.at - 2); a <= Math.min(na - SPAN - 2, hit.at + 2); a++) {
        const s = e.sign * parts[o + a];
        if (s > top) [at, top] = [a, s];
      }
      if (at < 0) continue;
      xs.push(b0 + ((ends[p] + ends[p + 1] - 1) / 2) * step);
      ys.push(a0 + centreOf(parts, o, at, SPAN, na - SPAN - 1, e.sign) * step);
      ws.push(top);
    }
    // the parts where the edge hardly shows are left out
    const strong = [...ws].sort((x, y) => x - y)[ws.length >> 1] * 0.35;
    const keep = ws.map((w) => w >= strong);
    const slope = slopeOf(
      xs.filter((_, i) => keep[i]),
      ys.filter((_, i) => keep[i]),
      ws.filter((_, i) => keep[i]),
      0.75 * step,
    );
    // an edge across the picture drops by tan(lean) for each point along it; a side edge moves back by as much for each point down
    if (slope !== null) says.push([((rows ? Math.atan(slope) : -Math.atan(slope)) * 180) / Math.PI, band.nb * step]);
  }
  // the edges' own say, the longer the more; one that says far otherwise than the rest (a photo close beside it) is left out
  if (says.length >= 3) {
    const mid = [...says].sort((x, y) => x[0] - y[0])[says.length >> 1][0];
    says.splice(says.reduce((w, e, i) => (Math.abs(e[0] - mid) > Math.abs(says[w][0] - mid) ? i : w), 0), 1);
  }
  const weight = says.reduce((m, e) => m + e[1], 0);
  return weight > 0 ? says.reduce((m, e) => m + e[0] * e[1], 0) / weight : null;
}

/**
 * The frame laid on the card's own edges near it, in the shape of an ID card, and the slider (`fine`) that sets the card
 * level; or null when no clear edges of a card show near the frame. `px`: the picture under the frame, before it is
 * turned (the work canvas, at any scale); `at`: the frame, and how far the picture is shown turned. The slider moves at
 * most COARSE degrees either way of where it is (and never past FINE_MAX), and stays on its tenths of a degree; the frame
 * stays on the picture.
 */
export function fitEdges(px: Pixels, at: Framing): Fitted | null {
  const { rect, base, fine } = at;
  const W = px.width;
  const H = px.height;
  const fw = rect.w * W;
  const fh = rect.h * H;
  if (!(W >= 16 && H >= 16 && fw >= 24 && fh >= 16)) return null;
  const n = Math.max(1, Math.round(Math.max(fw, fh) / LOOK_SIZE));
  const pic = greyOf(px, n);
  if (pic.w < 8 || pic.h < 8) return null;
  const rad = (d: number) => (d * Math.PI) / 180;

  // the middle of the frame on the picture itself (as frameCard has it): each angle is tried about it
  const t0 = rad(base + fine);
  const dx = (rect.x + rect.w / 2) * W - W / 2;
  const dy = (rect.y + rect.h / 2) * H - H / 2;
  const sx = W / 2 + dx * Math.cos(t0) + dy * Math.sin(t0);
  const sy = H / 2 - dx * Math.sin(t0) + dy * Math.cos(t0);

  // a band around each side of the frame: `side` where the side is, `across` the frame's size across it, `along` its length
  const band = (rows: boolean, inward: 1 | -1, side: number, across: number, along: number): Band => {
    const m = BAND * across;
    return {
      rows,
      inward,
      a0: side - m - (SPAN + 2) * n,
      na: Math.round((2 * m) / n) + 2 * (SPAN + 2) + 1,
      b0: -ALONG * along,
      nb: Math.max(2 * PARTS, Math.round((2 * ALONG * along) / n)),
      step: n,
    };
  };
  const bands: Record<Name, Band> = {
    L: band(false, 1, -fw / 2, fw, fh),
    R: band(false, -1, fw / 2, fw, fh),
    T: band(true, 1, -fh / 2, fh, fw),
    B: band(true, -1, fh / 2, fh, fw),
  };

  const look = (f: number): Look => {
    const turn = rad(base + f);
    const strips = {} as Record<Name, Strip>;
    for (const k of NAMES) strips[k] = stripOf(pic, sx, sy, turn, bands[k]);
    const hits = { 1: {}, [-1]: {} } as Record<1 | -1, Record<Name, Hit[]>>;
    for (const sign of [1, -1] as const) for (const k of NAMES) hits[sign][k] = hitsOf(strips[k], scoreOf(strips[k], sign));
    return { fine: f, strips, found: cardEdges(hits, 2 * n) };
  };

  // First roughly, in steps of half a degree: the angle at which four edges show sharpest in the shape of a card (on a
  // light card on white, they may be print: it lies level with the card, near enough). Four edges before three; nearer
  // the slider's own angle first, so that it wins a tie.
  let best: Look | null = null;
  const tried = new Set<number>();
  for (let i = 0; i <= COARSE / COARSE_STEP; i++) {
    for (const f of i ? [fineOf(fine - i * COARSE_STEP), fineOf(fine + i * COARSE_STEP)] : [fineOf(fine)]) {
      if (tried.has(f)) continue;
      tried.add(f);
      const v = look(f);
      const a = v.found?.clearest;
      const b = best?.found?.clearest;
      if (a && (!b || a.sides > b.sides || (a.sides === b.sides && a.s > b.s))) best = v;
    }
  }
  if (!best?.found) return null;
  const rough = best.found.card;

  // Then exactly: what the card's own edges still lean by is taken out, until they lean by less than a fiftieth of a
  // degree. They are long and straight, where print is not.
  let cur = best;
  let f = best.fine;
  for (let round = 0; round < 4; round++) {
    const lean = leanOf(cur);
    if (lean === null || Math.abs(lean) < 0.02) break;
    const next = clamp(f - clamp(lean, -1, 1), -FINE_MAX, FINE_MAX);
    if (Math.abs(next - f) < 0.005) break;
    const v = look(next);
    if (!v.found) break;
    [f, cur] = [next, v];
  }
  // on the slider's tenths of a degree; if the card's edges show less there than at the rough angle, the lean misled
  const snapped = fineOf(f);
  let end = snapped === cur.fine ? cur : look(snapped);
  const there = end.found?.card;
  if (!there || there.sides < rough.sides || there.s < 0.75 * rough.s) end = best;
  const e = end.found!.card;

  // the shape of an ID card, as near as can be to the edges found, about their middle
  const h = ((e.R - e.L) * CARD_RATIO + (e.B - e.T)) / (CARD_RATIO * CARD_RATIO + 1);
  const w = h * CARD_RATIO;
  const p = (e.L + e.R) / 2;
  const q = (e.T + e.B) / 2;
  // its middle on the picture, then on the picture as shown, turned
  const turn = rad(base + end.fine);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const X = sx + p * cos + q * sin - W / 2;
  const Y = sy - p * sin + q * cos - H / 2;
  const u = W / 2 + X * cos - Y * sin;
  const v = H / 2 + X * sin + Y * cos;
  const ww = Math.min(W, w);
  const hh = Math.min(H, h);
  return {
    fine: end.fine,
    rect: { x: clamp((u - ww / 2) / W, 0, 1 - ww / W), y: clamp((v - hh / 2) / H, 0, 1 - hh / H), w: ww / W, h: hh / H },
  };
}

const greys = new WeakMap<HTMLCanvasElement, Pixels>();

/** The picture under the frame as grey points, at most 1400 across, as the Cropper shows it. Kept for the same picture. */
export function pixelsOf(work: HTMLCanvasElement): Pixels {
  let got = greys.get(work);
  if (!got) {
    const k = Math.min(1, 1400 / Math.max(work.width, work.height));
    const cv = canvasOf(work.width * k, work.height * k);
    const ctx = ctxOf(cv, true);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work, 0, 0, cv.width, cv.height);
    const { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height);
    const g = new Uint8ClampedArray(width * height);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2];
    got = { data: g, width, height };
    greys.set(work, got);
  }
  return got;
}
