// "Fit to the page's edges": the frame laid on a page's own edges near it, in whatever shape they make, and the page set
// level, on pictures drawn here as arrays of points (after employees/scan/edges.test.ts).
import { describe, expect, it } from 'vitest';
import { fitPage, STRAIGHTEN_MAX, type PageFit, type PageRect, type Pixels } from './page-edges';

const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const near = (a: number, b: number, by: number, what?: string) => expect(Math.abs(a - b), what).toBeLessThanOrEqual(by);

/** A run of numbers between 0 and 1 that is the same each time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** A sheet of paper on the picture: its middle, its size in points, and how far it leans, clockwise, in degrees. */
interface Sheet {
  cx: number;
  cy: number;
  w: number;
  h: number;
  deg: number;
}

interface Scene {
  W: number;
  H: number;
  /** The grey around the sheet, or the grey at each point. */
  bg: number | ((x: number, y: number) => number);
  sheet: Sheet;
  /** The paper's grey. */
  face: number;
  /** A printed border: how far inside the paper's edge, how thick, and its grey, in points. */
  border?: [number, number, number];
  /** How many points an edge takes to go from one grey to the other. */
  soft?: number;
  noise?: number;
  /** A dark frame of this many points around the whole picture, as some scanning apps leave. */
  frame?: number;
  /** A shadow just outside the paper's edge, as a scanner's light leaves along it: how wide, and its grey. */
  rim?: [number, number];
}

/** The print on a sheet, as shares of it from its middle: [left, top, right, bottom, grey]. A heading, then lines of words. */
function print(): [number, number, number, number, number][] {
  const rnd = seeded(5);
  const out: [number, number, number, number, number][] = [[-0.2, -0.36, 0.2, -0.32, 40]];
  for (let line = 0; line < 18; line++) {
    const top = -0.27 + line * 0.035;
    for (let u = -0.36; u < 0.34; ) {
      const len = 0.02 + rnd() * 0.07;
      out.push([u, top, Math.min(0.36, u + len), top + 0.014, 50]);
      u += len + 0.012 + rnd() * 0.015;
    }
  }
  return out;
}

/** The picture drawn as grey points, one a point, W by H. */
function picture(s: Scene): Pixels {
  const { W, H, sheet: c } = s;
  const data = new Uint8ClampedArray(W * H);
  const rnd = seeded(9);
  const soft = s.soft ?? 1;
  const marks = print();
  const cos = Math.cos(rad(c.deg));
  const sin = Math.sin(rad(c.deg));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const X = x + 0.5;
      const Y = y + 0.5;
      let v = typeof s.bg === 'number' ? s.bg : s.bg(X, Y);
      const u = (X - c.cx) * cos + (Y - c.cy) * sin;
      const w = -(X - c.cx) * sin + (Y - c.cy) * cos;
      const d = Math.max(Math.abs(u) - c.w / 2, Math.abs(w) - c.h / 2);
      const cover = clamp(0.5 - d / soft, 0, 1);
      if (s.rim && d > 0 && d < s.rim[0]) v = s.rim[1];
      if (cover) {
        let face = s.face;
        if (s.border) {
          // inside the line's outer edge and outside its inner edge
          const [inset, thick, grey] = s.border;
          const inLine = clamp(0.5 - (d + inset) / soft, 0, 1) * clamp(0.5 + (d + inset + thick) / soft, 0, 1);
          face = face * (1 - inLine) + grey * inLine;
        }
        const su = u / c.w;
        const sv = w / c.h;
        for (const [l, t, r, b, g] of marks) if (su >= l && su < r && sv >= t && sv < b) face = g;
        v = v * (1 - cover) + face * cover;
      }
      if (s.frame && Math.min(x, y, W - 1 - x, H - 1 - y) < s.frame) v = 12;
      data[y * W + x] = v + (s.noise ? (rnd() - 0.5) * 2 * s.noise : 0);
    }
  return { data, width: W, height: H };
}

/** Where a sheet (or the box `inset` points inside its edge) lies on the picture shown turned by `tilt` degrees, once set level: left, top, right, bottom. */
function shownBox(c: Sheet, W: number, H: number, tilt: number, inset = 0): [number, number, number, number] {
  const t = rad(tilt);
  const dx = c.cx - W / 2;
  const dy = c.cy - H / 2;
  const u = W / 2 + dx * Math.cos(t) - dy * Math.sin(t);
  const v = H / 2 + dx * Math.sin(t) + dy * Math.cos(t);
  return [u - c.w / 2 + inset, v - c.h / 2 + inset, u + c.w / 2 - inset, v + c.h / 2 - inset];
}

/** A rough frame over a sheet, as a person drags it: moved by (dx, dy) points, and k times as large, on the picture. */
function rough(c: Sheet, W: number, H: number, dx: number, dy: number, k: number): PageRect {
  const [l, t, r, b] = shownBox(c, W, H, 0);
  const w = (r - l) * k;
  const h = (b - t) * k;
  const x = clamp((l + r) / 2 + dx - w / 2, 0, W);
  const y = clamp((t + b) / 2 + dy - h / 2, 0, H);
  return { x: x / W, y: y / H, w: Math.min(w, W - x) / W, h: Math.min(h, H - y) / H };
}

/**
 * The fitted frame is on the sheet (or `inset` points inside its edge): the sheet turned level to within `deg` degrees,
 * and each edge of the frame within `px` points of where it is, on the picture (never past it).
 */
function onSheet(got: PageFit | null, c: Sheet, W: number, H: number, opts: { inset?: number; deg?: number; px?: number; sides?: number } = {}) {
  const { inset = 0, deg = 0.2, px = 4, sides = 4 } = opts;
  expect(got).not.toBeNull();
  near(got!.fine, -c.deg, deg, 'the angle');
  expect(Math.round(got!.fine * 10) / 10).toBe(got!.fine); // on the slider's tenths of a degree
  expect(got!.sides).toBe(sides);
  const [l, t, r, b] = shownBox(c, W, H, got!.fine, inset);
  const { x, y, w, h } = got!.rect;
  near(x * W, clamp(l, 0, W), px, 'the left edge');
  near((x + w) * W, clamp(r, 0, W), px, 'the right edge');
  near(y * H, clamp(t, 0, H), px, 'the top edge');
  near((y + h) * H, clamp(b, 0, H), px, 'the bottom edge');
  inside(got!.rect);
}

const inside = (r: PageRect) => {
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12);
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12);
};

const WHOLE: PageRect = { x: 0, y: 0, w: 1, h: 1 };
/** An A4 sheet this many points across. */
const a4 = (cx: number, cy: number, w: number, deg: number): Sheet => ({ cx, cy, w, h: w * (297 / 210), deg });

describe("the frame laid on the page's own edges", () => {
  it('light paper on a dark scanner lid, leaning by 2.5°, the frame on the whole picture: set level and framed tightly', () => {
    const W = 900, H = 1200, c = a4(455, 590, 640, 2.5);
    const px = picture({ W, H, bg: 30, face: 228, sheet: c, noise: 6 });
    onSheet(fitPage(px, { rect: WHOLE, fine: 0 }), c, W, H);
  });

  it('paper a little darker than a white lid, leaning the other way by 1.2°: the paper\'s edge, not its print', () => {
    const W = 900, H = 1200, c = a4(440, 610, 660, -1.2);
    const px = picture({ W, H, bg: 252, face: 236, sheet: c, noise: 3 });
    onSheet(fitPage(px, { rect: rough(c, W, H, 15, -20, 1.12), fine: 0 }), c, W, H);
  });

  it('white paper on a white lid (its edge does not show): the printed border, against the white margin', () => {
    const W = 900, H = 1200, c = a4(450, 600, 700, 0.8);
    const px = picture({ W, H, bg: 250, face: 250, border: [38, 4, 70], sheet: c, noise: 3 });
    onSheet(fitPage(px, { rect: rough(c, W, H, -10, 12, 1.0), fine: 0 }), c, W, H, { inset: 38 });
  });

  it('white paper on a white lid, with only the thin shadow a scanner leaves along its edge: all of the paper, and a sliver of the lid at most', () => {
    const W = 900, H = 1200, c = a4(450, 600, 680, -0.6);
    const px = picture({ W, H, bg: 250, face: 249, rim: [3, 175], sheet: c, noise: 3 });
    // the frame on the outer side of the shadow, 3 points outside the paper
    onSheet(fitPage(px, { rect: rough(c, W, H, 12, 10, 1.1), fine: 0 }), c, W, H, { inset: -3 });
  });

  it('white paper on a light grey lid, with far more contrast in its print: the paper, not the block of print', () => {
    const W = 900, H = 1200, c = a4(450, 600, 640, 1.9);
    const px = picture({ W, H, bg: 205, face: 245, sheet: c, noise: 4 });
    onSheet(fitPage(px, { rect: WHOLE, fine: 0 }), c, W, H);
  });

  it('a phone photo of a landscape paper on a desk: soft edges, uneven light, more noise, and its own shape', () => {
    const W = 1200, H = 900, c: Sheet = { cx: 610, cy: 455, w: 820, h: 820 / 1.6, deg: -1.7 };
    const px = picture({ W, H, bg: (x, y) => 70 + (x / W) * 50 + (y / H) * 25, face: 210, soft: 4, sheet: c, noise: 9 });
    const got = fitPage(px, { rect: rough(c, W, H, 20, 15, 1.1), fine: 0 });
    onSheet(got, c, W, H, { px: 5 });
    near((got!.rect.w * W) / (got!.rect.h * H), 1.6, 0.03, 'the shape');
  });

  it('the slider at −2.0° and the page needing −3.4°: the slider follows', () => {
    const W = 900, H = 1200, c = a4(450, 600, 620, 3.4);
    const px = picture({ W, H, bg: 35, face: 220, sheet: c, noise: 5 });
    onSheet(fitPage(px, { rect: rough(c, W, H, 0, 0, 1.08), fine: -2 }), c, W, H);
  });

  it('a dark frame around the picture, as a scanning app leaves: the paper inside it, not the frame', () => {
    const W = 900, H = 1200, c = a4(450, 600, 650, 1.4);
    const px = picture({ W, H, bg: 246, face: 226, sheet: c, noise: 3, frame: 7 });
    onSheet(fitPage(px, { rect: WHOLE, fine: 0 }), c, W, H);
  });

  it('a page cut short at the bottom by the scan: three edges found, the bottom stays at the frame', () => {
    const W = 900, H = 1000, c = a4(450, 620, 620, -0.9); // its bottom edge is past the picture
    const px = picture({ W, H, bg: 30, face: 225, sheet: c, noise: 5 });
    const got = fitPage(px, { rect: rough(c, W, H, 0, 0, 1.06), fine: 0 });
    expect(got).not.toBeNull();
    expect(got!.sides).toBe(3);
    near(got!.fine, 0.9, 0.2, 'the angle');
    const [l, t, r] = shownBox(c, W, H, got!.fine);
    near(got!.rect.x * W, l, 4, 'the left edge');
    near((got!.rect.x + got!.rect.w) * W, r, 4, 'the right edge');
    near(got!.rect.y * H, t, 4, 'the top edge');
    near((got!.rect.y + got!.rect.h) * H, H, 2, "the frame's own bottom, on the picture's edge");
  });

  it('the same from RGBA points, as a canvas gives them', () => {
    const W = 600, H = 800, c = a4(300, 400, 420, -1.5);
    const grey = picture({ W, H, bg: 30, face: 220, sheet: c, noise: 4 });
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set([grey.data[i], grey.data[i], grey.data[i], 255], 4 * i);
    const at = { rect: rough(c, W, H, 9, -7, 1.06), fine: 0 };
    const a = fitPage(grey, at);
    const b = fitPage({ data: rgba, width: W, height: H }, at);
    onSheet(b, c, W, H);
    expect(b!.fine).toBe(a!.fine);
    near(b!.rect.x, a!.rect.x, 1e-3);
    near(b!.rect.y, a!.rect.y, 1e-3);
  });
});

describe('what it does not do', () => {
  it('a blank picture, or a frame over nothing, gives nothing: the frame is left as it was', () => {
    const W = 800, H = 1000, at = { rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fine: 0 };
    const blank = { W, H, bg: 245, face: 245, sheet: a4(-5000, -5000, 10, 0), noise: 4 };
    expect(fitPage(picture(blank), at)).toBeNull();
    expect(fitPage(picture({ ...blank, bg: 0, face: 0, noise: 0 }), at)).toBeNull();
    // a sheet far off in a corner, out of reach of the frame
    const corner = picture({ W, H, bg: 30, face: 220, sheet: a4(110, 130, 150, 0), noise: 5 });
    expect(fitPage(corner, { rect: { x: 0.45, y: 0.45, w: 0.45, h: 0.45 }, fine: 0 })).toBeNull();
  });

  it('a frame too small to look in gives nothing', () => {
    const px = picture({ W: 200, H: 260, bg: 30, face: 215, sheet: a4(100, 130, 120, 0) });
    expect(fitPage(px, { rect: { x: 0.5, y: 0.5, w: 0.05, h: 0.05 }, fine: 0 })).toBeNull();
  });

  it('the slider never goes past 10° either way', () => {
    const W = 900, H = 1200;
    const all = a4(450, 600, 560, -10);
    onSheet(fitPage(picture({ W, H, bg: 30, face: 220, sheet: all, noise: 5 }), { rect: rough(all, W, H, 0, 0, 1.15), fine: 9 }), all, W, H, { px: 5 });
    const past = a4(450, 600, 560, 10.6);
    const got = fitPage(picture({ W, H, bg: 30, face: 220, sheet: past, noise: 5 }), { rect: rough(past, W, H, 0, 0, 1.15), fine: -9.5 });
    expect(got?.fine).toBe(-STRAIGHTEN_MAX);
    inside(got!.rect);
  });
});
