// "Fit to the page's edges" in the document adjuster (components/adjust): a page of any shape, found near the frame a
// person dragged over it, and set level. A generalised version of fitEdges (employees/scan/edges.ts), which looks for an
// ID card: what it does is kept (an edge is a straight line that changes the same way all along its length, so a strip
// of the picture summed along it shows the edge while print and noise cancel out; the strip is taken in parts so that a
// shadow beside a stretch of the edge does not decide; how far the page still leans is read from where its edges lie
// from one end of their length to the other). What is new: the four edges are found each on its own, in no set shape;
// each side takes the outermost edge that shows clearly enough, since print, a printed border and a photo all lie
// inside the paper's edge; and an edge right on the border of the picture (a scanner's or a scanning app's dark border)
// is not taken for the page's.
//
// So it finds light paper on a darker scanner lid or desk, paper a little darker than a white lid, and, where the
// paper's own edge does not show (white paper on a white lid), the printed document's border against its white margin.
//
// fitPage only counts, on an array of points, and is tested on pictures drawn as arrays (page-edges.test.ts); in the
// browser, pixelsOf (employees/scan/edges.ts) takes them off a canvas.

/** The frame's longer side, in points of the picture looked at: a larger picture is shrunk to about this, for speed. */
const LOOK_SIZE = 360;
/** How far either way of each side of the frame the page's edge is looked for, as a share of the frame across that side. */
const BAND = 0.25;
/** How much of each side is looked along, either way of its middle, as a share of its length. */
const ALONG = 0.3;
/** The parts each band is taken in along its length, and how many are left out at either end of how strongly the edge
 *  shows in them: a shadow, a finger or a fold over a stretch of the edge. */
const PARTS = 8;
const TRIM = 2;
/** The angles tried first, either way of the slider's, in degrees, and the step between them. */
const COARSE = 4;
const COARSE_STEP = 0.5;
/** How clearly an edge further out than the clearest on its side must show, at least, to be taken for the paper's. Low:
 *  a grey paper on a white lid shows its edge far less than the print on it. */
const OUTER_MIN = 0.06;
/** The least change across an edge, in levels of grey (0 to 255), that counts as one. */
const EDGE_MIN = 4;
/** How far either way of a point the picture is compared, across an edge, in points of the picture looked at. */
const SPAN = 2;
/** How close to the border of the picture an edge may lie and still be the page's, as a share of the picture's longer side. */
const BORDER = 0.012;
/** An edge the other way just outside an edge, at least this clear against it, makes the two the sides of a line (lineSide). */
const LINE_PARTNER = 0.5;
/** How far out a line's other side is looked for, as a share of the frame across that side: the height of a line of print. */
const LINE_REACH = 0.035;
/** How clearly the edges lying around others must show, at least, against them, to be taken for the page's. */
const OUTER_SET_MIN = 0.25;
/** The furthest the slider straightens a page, either way, in degrees. */
export const STRAIGHTEN_MAX = 10;

/** A picture as points: RGBA as ImageData gives it, or one grey value a point. */
export interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** A frame as shares of the picture shown (between 0 and 1). */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A frame as it stands: `rect` over the picture shown turned by base + fine degrees (fine: the slider; base: 0 if left out). */
export interface PageFraming {
  rect: PageRect;
  fine: number;
  base?: number;
}

/** The frame laid on the page's edges, the slider that sets it level, and how many of its four edges were found. */
export interface PageFit {
  rect: PageRect;
  fine: number;
  sides: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A slider position: within ten degrees either way, on its tenths of a degree. */
export const straightenOf = (v: unknown) => clamp(Math.round((+(v as number) || 0) * 10) / 10, -STRAIGHTEN_MAX, STRAIGHTEN_MAX);

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

/**
 * A band as it shows at one angle: how much lighter the picture gets into the frame, at each step across, in each part
 * (PARTS × na); and `mean`, the picture's grey at each step across, along the whole band.
 */
interface Strip {
  band: Band;
  parts: Float32Array;
  ends: number[];
  mean: Float32Array;
}

/** An edge found across a band: at step `at`, at `pos` in the frame's points, this strong. */
interface Hit {
  at: number;
  pos: number;
  s: number;
}

/**
 * The page's edges as they show at one angle, in the frame's points, for a page lighter (`sign` 1) or darker (−1) than
 * what is around it: on each side the outermost edge that shows clearly enough, or none. `clear`: how clearly the
 * clearest edge of each side shows, together; `s`: how clearly the edges taken show, together.
 */
interface Edges {
  by: Partial<Record<Name, Hit>>;
  sides: number;
  sign: 1 | -1;
  clear: number;
  s: number;
}

/** The picture at one position of the slider: its four bands, and the edges found on them, if any. */
interface Look {
  fine: number;
  strips: Record<Name, Strip>;
  found: Edges | null;
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
  // how much lighter it gets into the frame, from two steps before to two steps after, in each part
  const parts = new Float32Array(PARTS * na);
  for (let k = 0; k < PARTS; k++) {
    const o = k * na;
    const len = Math.max(1, ends[k + 1] - ends[k]);
    for (let a = SPAN; a < na - SPAN; a++) parts[o + a] = (inward * (sums[o + a + SPAN] - sums[o + a - SPAN])) / len;
  }
  const mean = new Float32Array(na);
  for (let a = 0; a < na; a++) {
    let m = 0;
    for (let k = 0; k < PARTS; k++) m += sums[k * na + a];
    mean[a] = m / Math.max(1, nb);
  }
  return { band, parts, ends, mean };
}

/**
 * Where an edge found lies, more exactly: where the picture changes most from one step to the next, near it. The edge is
 * found comparing points two steps either way of it, which puts a line thinner than that (a printed border, a shadow
 * along the paper) a little outside where it is; one step at a time it is in its place. A plain edge stays where it was.
 */
function exactly(st: Strip, hit: Hit, sign: 1 | -1): number {
  const { mean, band } = st;
  const { a0, na, step, inward } = band;
  const change = (a: number) => (a >= 0 && a < na - 1 ? sign * inward * (mean[a + 1] - mean[a]) : 0);
  let at = -1;
  let top = 0;
  for (let a = Math.max(0, hit.at - SPAN - 1); a <= Math.min(na - 2, hit.at + SPAN); a++) {
    if (change(a) > top) [at, top] = [a, change(a)];
  }
  if (at < 0) return hit.pos;
  // to a fraction of a step: the top of the curve through the change there and either side of it
  const l = change(at - 1);
  const r = change(at + 1);
  const bend = l - 2 * top + r;
  const off = bend < 0 ? clamp((l - r) / (2 * bend), -0.5, 0.5) : 0;
  return a0 + (at + 0.5 + off) * step;
}

/**
 * How clearly an edge shows at each step across a strip, for a page lighter (`sign` 1) or darker (−1) than what is
 * around it: the mean of its parts, leaving out those where it shows most and least. An edge that runs the whole length
 * shows in every part; a line of print beside it, in some only; and at the wrong angle it is in a different place in each.
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
 * its height around it, weighted by how far above. `lo`, `hi`: the steps that may be looked at; `sign`: −1 for a peak
 * below nought.
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

/** The edges across a strip: where it shows clearly above what is usual there, at most eight, the strongest first. */
function hitsOf(st: Strip, score: Float32Array, keep: (pos: number) => boolean): Hit[] {
  const { a0, na, step } = st.band;
  const inner = Array.from(score.subarray(SPAN, na - SPAN)).sort((x, y) => x - y);
  if (!inner.length) return [];
  const need = Math.max(EDGE_MIN, inner[inner.length - 1] * 0.04, inner[inner.length >> 1] * 3);
  const out: Hit[] = [];
  for (let a = SPAN + 2; a < na - SPAN - 2; a++) {
    const s = score[a];
    if (s >= need && s >= score[a - 1] && s > score[a + 1] && s >= score[a - 2] && s > score[a + 2]) {
      const pos = a0 + centreOf(score, 0, a, SPAN, na - SPAN - 1) * step;
      if (keep(pos)) out.push({ at: a, pos, s });
    }
  }
  return out.sort((x, y) => y.s - x.s).slice(0, 8);
}

/** Which way is out on each side, in the frame's points: left and top towards smaller, right and bottom towards larger. */
const OUT: Record<Name, 1 | -1> = { L: -1, T: -1, R: 1, B: 1 };

/**
 * Whether an edge is the inner side of a line (a line of print, a printed border, a shadow): an edge the other way just
 * outside it, nearly as clear. A page's edge has nothing like it beyond: only what the page lies on. `opposite`: how
 * clearly an edge the other way shows at each step across the strip; `out`: which way is out, in steps; `reach`: how
 * many steps out to look.
 */
function lineSide(hit: Hit, opposite: Float32Array, out: 1 | -1, reach: number): boolean {
  for (let d = 1; d <= reach; d++) {
    const a = hit.at + out * d;
    if (a < 0 || a >= opposite.length) break;
    if (opposite[a] >= LINE_PARTNER * hit.s) return true;
  }
  return false;
}

/**
 * The page's edges among those found on each side, for a page lighter than what is around it (sign 1) and for one darker
 * (−1): on each side the outermost that shows at least OUTER_MIN as clearly as the clearest there, or none; at least
 * three sides. Of the two, the one whose edges lie around the other's, when it shows clearly enough (light paper on a
 * dark lid gives the paper's edges one way and the lines of print inside it the other way); else the clearer. `fw`,
 * `fh`: the frame, whose side stands for one without an edge; `tol`: how far an edge may lie inside another and still
 * count as around it, in points.
 */
function pageEdges(hits: Record<1 | -1, Record<Name, Hit[]>>, fw: number, fh: number, tol: number): Edges | null {
  const sets: Edges[] = [];
  for (const sign of [1, -1] as const) {
    const by: Partial<Record<Name, Hit>> = {};
    let clear = 0;
    let s = 0;
    for (const k of NAMES) {
      const list = hits[sign][k];
      if (!list.length) continue;
      const top = list[0].s;
      const outer = list.filter((h) => h.s >= OUTER_MIN * top).reduce((a, h) => (OUT[k] * h.pos > OUT[k] * a.pos ? h : a));
      by[k] = outer;
      clear += top;
      s += outer.s;
    }
    const sides = Object.keys(by).length;
    if (sides >= 3) sets.push({ by, sides, sign, clear, s });
  }
  if (sets.length < 2) return sets[0] ?? null;
  const box = (e: Edges) => [e.by.L?.pos ?? -fw / 2, e.by.T?.pos ?? -fh / 2, e.by.R?.pos ?? fw / 2, e.by.B?.pos ?? fh / 2];
  const around = (a: Edges, b: Edges) => {
    const [al, at, ar, ab] = box(a);
    const [bl, bt, br, bb] = box(b);
    return al <= bl + tol && at <= bt + tol && ar >= br - tol && ab >= bb - tol && a.clear >= OUTER_SET_MIN * b.clear;
  };
  const [a, b] = sets;
  if (around(a, b)) return a;
  if (around(b, a)) return b;
  return a.clear >= b.clear ? a : b;
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
 * How far the page still leans at a look, in degrees, clockwise as seen: each of its edges is placed in each part of its
 * length, and a line drawn through. Null when no edge can be measured.
 */
function leanOf(v: Look): number | null {
  const e = v.found;
  if (!e) return null;
  /** what each edge says the page leans by, and how long a stretch of it was measured */
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
  // the edges' own say, the longer the more; one that says far otherwise than the rest is left out
  if (says.length >= 3) {
    const mid = [...says].sort((x, y) => x[0] - y[0])[says.length >> 1][0];
    says.splice(says.reduce((w, s, i) => (Math.abs(s[0] - mid) > Math.abs(says[w][0] - mid) ? i : w), 0), 1);
  }
  const weight = says.reduce((m, s) => m + s[1], 0);
  return weight > 0 ? says.reduce((m, s) => m + s[0] * s[1], 0) / weight : null;
}

/**
 * The frame laid on the page's own edges near it, in whatever shape they make, and the slider (`fine`) that sets the page
 * level; or null when fewer than three of its edges show near the frame. A side whose edge does not show (the page goes
 * on past the picture there) stays where the frame had it. `px`: the picture under the frame, before it is turned (at
 * any scale); `at`: the frame, and how far the picture is shown turned. The slider moves at most four degrees either way
 * of where it is (and never past ten), and stays on its tenths of a degree; the frame stays on the picture.
 */
export function fitPage(px: Pixels, at: PageFraming): PageFit | null {
  const { rect, fine } = at;
  const base = at.base ?? 0;
  const W = px.width;
  const H = px.height;
  const fw = rect.w * W;
  const fh = rect.h * H;
  if (!(W >= 16 && H >= 16 && fw >= 24 && fh >= 24)) return null;
  const n = Math.max(1, Math.round(Math.max(fw, fh) / LOOK_SIZE));
  const pic = greyOf(px, n);
  if (pic.w < 8 || pic.h < 8) return null;
  const rad = (d: number) => (d * Math.PI) / 180;

  // the middle of the frame on the picture itself: each angle is tried about it
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

  // an edge right on the border of the picture is the border's (a scanner's dark edge), not the page's: where the middle
  // of an edge found lies on the picture
  const margin = Math.max(BORDER * Math.max(W, H), (SPAN + 2) * n);
  const awayFromBorder = (k: Name, turn: number) => (pos: number) => {
    const [p, q] = bands[k].rows ? [0, pos] : [pos, 0];
    const x = sx + p * Math.cos(turn) + q * Math.sin(turn);
    const y = sy - p * Math.sin(turn) + q * Math.cos(turn);
    return Math.min(x, W - x, y, H - y) > margin;
  };

  const look = (f: number): Look => {
    const turn = rad(base + f);
    const strips = {} as Record<Name, Strip>;
    for (const k of NAMES) strips[k] = stripOf(pic, sx, sy, turn, bands[k]);
    const scores = { 1: {}, [-1]: {} } as Record<1 | -1, Record<Name, Float32Array>>;
    for (const sign of [1, -1] as const) for (const k of NAMES) scores[sign][k] = scoreOf(strips[k], sign);
    const hits = { 1: {}, [-1]: {} } as Record<1 | -1, Record<Name, Hit[]>>;
    for (const sign of [1, -1] as const)
      for (const k of NAMES) {
        const reach = Math.max(4, Math.round((LINE_REACH * (bands[k].rows ? fh : fw)) / n));
        hits[sign][k] = hitsOf(strips[k], scores[sign][k], awayFromBorder(k, turn)).filter((h) => !lineSide(h, scores[-sign as 1 | -1][k], OUT[k], reach));
      }
    return { fine: f, strips, found: pageEdges(hits, fw, fh, 2 * n) };
  };

  // First roughly, in steps of half a degree: the angle at which the edges show sharpest (the clearest of each side: on
  // white paper on a white lid, they may be print, which lies level with the page). More sides first; nearer the
  // slider's own angle first, so that it wins a tie.
  let best: Look | null = null;
  const tried = new Set<number>();
  for (let i = 0; i <= COARSE / COARSE_STEP; i++) {
    for (const f of i ? [straightenOf(fine - i * COARSE_STEP), straightenOf(fine + i * COARSE_STEP)] : [straightenOf(fine)]) {
      if (tried.has(f)) continue;
      tried.add(f);
      const v = look(f);
      const a = v.found;
      const b = best?.found;
      if (a && (!b || a.sides > b.sides || (a.sides === b.sides && a.clear > b.clear))) best = v;
    }
  }
  if (!best?.found) return null;
  const rough = best.found;

  // Then exactly: what the page's edges still lean by is taken out, until they lean by less than a fiftieth of a degree.
  let cur = best;
  let f = best.fine;
  for (let round = 0; round < 4; round++) {
    const lean = leanOf(cur);
    if (lean === null || Math.abs(lean) < 0.02) break;
    const next = clamp(f - clamp(lean, -1, 1), -STRAIGHTEN_MAX, STRAIGHTEN_MAX);
    if (Math.abs(next - f) < 0.005) break;
    const v = look(next);
    if (!v.found) break;
    [f, cur] = [next, v];
  }
  // on the slider's tenths of a degree; if the edges show less there than at the rough angle, the lean misled
  const snapped = straightenOf(f);
  let end = snapped === cur.fine ? cur : look(snapped);
  const there = end.found;
  if (!there || there.sides < rough.sides || there.clear < 0.75 * rough.clear) end = best;
  const e = end.found!;

  // the frame on the edges found, each placed exactly; a side without one stays where it was
  const placed = (k: Name, none: number) => {
    const hit = e.by[k];
    return hit ? exactly(end.strips[k], hit, e.sign) : none;
  };
  const L = placed('L', -fw / 2);
  const R = placed('R', fw / 2);
  const T = placed('T', -fh / 2);
  const B = placed('B', fh / 2);
  const p = (L + R) / 2;
  const q = (T + B) / 2;
  // its middle on the picture, then on the picture as shown, turned
  const turn = rad(base + end.fine);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const X = sx + p * cos + q * sin - W / 2;
  const Y = sy - p * sin + q * cos - H / 2;
  const u = W / 2 + X * cos - Y * sin;
  const v = H / 2 + X * sin + Y * cos;
  const x0 = clamp((u - (R - L) / 2) / W, 0, 1);
  const x1 = clamp((u + (R - L) / 2) / W, 0, 1);
  const y0 = clamp((v - (B - T) / 2) / H, 0, 1);
  const y1 = clamp((v + (B - T) / 2) / H, 0, 1);
  if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return null;
  return { fine: end.fine, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, sides: e.sides };
}
