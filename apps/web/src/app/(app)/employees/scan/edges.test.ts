// "Fit to the card's edges": the frame laid on a card's own edges near it, on pictures drawn here as arrays of points.
import { describe, expect, it } from 'vitest';
import { CARD_RATIO, clamp, FINE_MAX, frameCard, type Card, type Rect } from './card';
import { fitEdges, type Fitted, type Pixels } from './edges';

const rad = (d: number) => (d * Math.PI) / 180;
const near = (a: number, b: number, by: number, what?: string) => expect(Math.abs(a - b), what).toBeLessThanOrEqual(by);

/** A run of numbers between 0 and 1 that is the same each time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

interface Scene {
  W: number;
  H: number;
  /** The grey around the cards, or the grey at each point. */
  bg: number | ((x: number, y: number) => number);
  cards: Card[];
  /** The card's own grey, and a border of [width, grey] around it. */
  face: number;
  border?: [number, number];
  /** How many points an edge takes to go from one grey to the other. */
  soft?: number;
  noise?: number;
}

/** A card's print, as shares of it from its middle: [left, top, right, bottom, grey]. A photo on the left, lines of words on the right. */
function print(): [number, number, number, number, number][] {
  const rnd = seeded(11);
  const out: [number, number, number, number, number][] = [[-0.43, -0.3, -0.15, 0.26, 105]];
  for (let line = 0; line < 6; line++) {
    const top = -0.33 + line * 0.11;
    for (let u = -0.08; u < 0.42; ) {
      const len = 0.02 + rnd() * 0.06;
      out.push([u, top, Math.min(0.44, u + len), top + 0.045, 55]);
      u += len + 0.015 + rnd() * 0.02;
    }
  }
  return out;
}

/** A scan drawn as grey points, one a point, W by H. */
function scan(s: Scene): Pixels {
  const { W, H } = s;
  const data = new Uint8ClampedArray(W * H);
  const rnd = seeded(7);
  const soft = s.soft ?? 1;
  const marks = print();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const X = x + 0.5;
      const Y = y + 0.5;
      let v = typeof s.bg === 'number' ? s.bg : s.bg(X, Y);
      for (const c of s.cards) {
        const cos = Math.cos(c.angle);
        const sin = Math.sin(c.angle);
        const u = (X - c.cx) * cos + (Y - c.cy) * sin;
        const w = -(X - c.cx) * sin + (Y - c.cy) * cos;
        const d = Math.max(Math.abs(u) - c.w / 2, Math.abs(w) - c.h / 2);
        const cover = clamp(0.5 - d / soft, 0, 1);
        if (!cover) continue;
        let face = s.face;
        if (s.border) {
          const inner = clamp(0.5 - (d + s.border[0]) / soft, 0, 1);
          face = s.border[1] * (1 - inner) + s.face * inner;
        }
        const su = u / c.w;
        const sv = w / c.h;
        for (const [l, t, r, b, g] of marks) if (su >= l && su < r && sv >= t && sv < b) face = g;
        v = v * (1 - cover) + face * cover;
      }
      data[y * W + x] = v + (s.noise ? (rnd() - 0.5) * 2 * s.noise : 0);
    }
  return { data, width: W, height: H };
}

/** A card of w points across, its middle at (cx, cy), leaning clockwise by `deg`. */
const card = (cx: number, cy: number, w: number, deg: number): Card => ({ cx, cy, w, h: w / CARD_RATIO, angle: rad(deg) });

/** Where a card lies on the picture shown turned by `tilt` degrees: its middle, in points. */
function shown(c: Card, W: number, H: number, tilt: number): [number, number] {
  const t = rad(tilt);
  const dx = c.cx - W / 2;
  const dy = c.cy - H / 2;
  return [W / 2 + dx * Math.cos(t) - dy * Math.sin(t), H / 2 + dx * Math.sin(t) + dy * Math.cos(t)];
}

/** A rough frame over a card, as a person drags it: moved by (dx, dy) points, and k times as large (kx across, ky down). */
function rough(c: Card, W: number, H: number, tilt: number, dx: number, dy: number, kx: number, ky = kx): Rect {
  const [u, v] = shown(c, W, H, tilt);
  const w = c.w * kx;
  const h = c.h * ky;
  return { x: (u + dx - w / 2) / W, y: (v + dy - h / 2) / H, w: w / W, h: h / H };
}

/**
 * The fitted frame is on the card: the card turned level to within `deg` degrees, each edge of the frame within `px`
 * points of the card's, in the shape of a card, and the frame stands for the card (as Use this frame cuts it).
 */
function onCard(got: Fitted | null, c: Card, W: number, H: number, base: number, deg = 0.2, px = 3) {
  expect(got).not.toBeNull();
  const tilt = base + got!.fine;
  near(tilt, (-c.angle * 180) / Math.PI, deg, 'the angle');
  expect(Math.abs(got!.fine)).toBeLessThanOrEqual(FINE_MAX);
  expect(Math.round(got!.fine * 10) / 10).toBe(got!.fine); // on the slider's tenths of a degree
  const r = got!.rect;
  const [u, v] = shown(c, W, H, tilt);
  near(r.x * W, u - c.w / 2, px, 'the left edge');
  near((r.x + r.w) * W, u + c.w / 2, px, 'the right edge');
  near(r.y * H, v - c.h / 2, px, 'the top edge');
  near((r.y + r.h) * H, v + c.h / 2, px, 'the bottom edge');
  near((r.w * W) / (r.h * H), CARD_RATIO, 1e-9, 'the shape');
  const cut = frameCard(r, W, H, tilt);
  near(cut.cx, c.cx, px, 'the middle across');
  near(cut.cy, c.cy, px, 'the middle down');
}

const inside = (r: Rect) => {
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.y).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12);
  expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12);
};

describe('the frame laid on the card\'s own edges', () => {
  it('a light card on a dark scanner lid, leaning by 2°, framed roughly: turned level and framed tightly', () => {
    const W = 1000, H = 700, c = card(520, 330, 560, 2);
    const px = scan({ W, H, bg: 28, face: 218, cards: [c], noise: 6 });
    onCard(fitEdges(px, { rect: rough(c, W, H, 0, 18, -12, 1.06), base: 0, fine: 0 }), c, W, H, 0);
  });

  it('a dark card on a white lid: the card darker than what is around it', () => {
    const W = 1000, H = 700, c = card(495, 355, 560, -1.4);
    const px = scan({ W, H, bg: 244, face: 72, cards: [c], noise: 5 });
    onCard(fitEdges(px, { rect: rough(c, W, H, 0, -12, 10, 1.05), base: 0, fine: 0 }), c, W, H, 0);
  });

  it('a pale card on a pale lid, its lower part over the shadow of the lid: darker than the lid along its top, lighter than the shadow along its bottom', () => {
    // a flatbed scan with the lid up (after Prime ERP, 16 October 2026): the one card's edges are of both kinds
    const W = 1000, H = 760, c = card(495, 365, 600, 1.1);
    const px = scan({ W, H, bg: (_, y) => (y > 480 && y < 700 ? 118 : 236), face: 220, cards: [c], noise: 4 });
    const starts = [[0, 0, 1.02], [0, 18, 1.06], [-14, 8, 0.97], [12, 36, 1.05], [0, -14, 1.04], [16, -6, 1.0]];
    for (const [dx, dy, k] of starts) onCard(fitEdges(px, { rect: rough(c, W, H, 0, dx, dy, k), base: 0, fine: 0 }), c, W, H, 0);
  });

  it('a light card with a darker border on white, leaning the other way by 1.3°: the outer edge of the border is the card\'s', () => {
    const W = 1000, H = 700, c = card(480, 360, 560, -1.3);
    const px = scan({ W, H, bg: 248, face: 228, border: [9, 150], cards: [c], noise: 4 });
    onCard(fitEdges(px, { rect: rough(c, W, H, 0, -15, 10, 0.95), base: 0, fine: 0 }), c, W, H, 0);
  });

  it('a light card on white, only a little darker than the lid', () => {
    const W = 1000, H = 700, c = card(500, 350, 580, 0.6);
    const px = scan({ W, H, bg: 250, face: 232, cards: [c], noise: 3 });
    onCard(fitEdges(px, { rect: rough(c, W, H, 0, 10, 14, 1.04, 1.08), base: 0, fine: 0 }), c, W, H, 0);
  });

  it('the slider at −2.0° and the card needing −3.4°: the slider follows', () => {
    const W = 1100, H = 760, c = card(560, 380, 600, 3.4);
    const px = scan({ W, H, bg: 32, face: 210, cards: [c], noise: 6 });
    onCard(fitEdges(px, { rect: rough(c, W, H, -2, -20, 8, 1.05), base: 0, fine: -2 }), c, W, H, 0);
  });

  it('a turn the slider cannot hold (base) is kept, and the slider stays on its tenths', () => {
    const W = 1000, H = 700, base = -0.37, c = card(500, 340, 540, -1);
    const px = scan({ W, H, bg: 40, face: 205, cards: [c], noise: 5 });
    onCard(fitEdges(px, { rect: rough(c, W, H, base + 0.4, 12, 12, 0.96), base, fine: 0.4 }), c, W, H, base);
  });

  it('a phone photo: soft edges, uneven light, more noise', () => {
    const W = 1200, H = 900, c = card(610, 450, 760, 0.8);
    const px = scan({ W, H, bg: (x, y) => 85 + (x / W) * 60 + (y / H) * 20, face: 205, soft: 4, cards: [c], noise: 10 });
    onCard(fitEdges(px, { rect: rough(c, W, H, 0, -25, -18, 1.07), base: 0, fine: 0 }), c, W, H, 0, 0.2, 4);
  });

  it('two cards on one scan page, one above the other: the edges of the card that is framed, not of the other', () => {
    const W = 800, H = 900, front = card(400, 230, 500, 1.1), back = card(405, 230 + 500 / CARD_RATIO + 40, 500, 1.6);
    const px = scan({ W, H, bg: 30, face: 215, cards: [front, back], noise: 5 });
    onCard(fitEdges(px, { rect: rough(back, W, H, 0, 10, -28, 1.05), base: 0, fine: 0 }), back, W, H, 0);
    onCard(fitEdges(px, { rect: rough(front, W, H, 0, -8, 26, 1.05), base: 0, fine: 0 }), front, W, H, 0);
  });

  it('the same from RGBA points, as a canvas gives them', () => {
    const W = 600, H = 420, c = card(300, 210, 360, -1.7);
    const grey = scan({ W, H, bg: 30, face: 215, cards: [c], noise: 4 });
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set([grey.data[i], grey.data[i], grey.data[i], 255], 4 * i);
    const at = { rect: rough(c, W, H, 0, 9, -7, 1.05), base: 0, fine: 0 };
    const a = fitEdges(grey, at), b = fitEdges({ data: rgba, width: W, height: H }, at);
    onCard(b, c, W, H, 0);
    expect(b!.fine).toBe(a!.fine);
    near(b!.rect.x, a!.rect.x, 1e-3); near(b!.rect.y, a!.rect.y, 1e-3);
  });
});

describe('what it does not do', () => {
  it('a blank picture, or a frame over nothing, gives nothing: the frame is left as it was', () => {
    const W = 800, H = 560, at = { rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 * (800 / 560) / CARD_RATIO }, base: 0, fine: 0 };
    expect(fitEdges(scan({ W, H, bg: 245, face: 0, cards: [], noise: 4 }), at)).toBeNull();
    expect(fitEdges(scan({ W, H, bg: 0, face: 0, cards: [] }), at)).toBeNull();
    // a card far off in a corner, out of reach of the frame
    const corner = scan({ W, H, bg: 30, face: 215, cards: [card(110, 70, 160, 0)], noise: 5 });
    expect(fitEdges(corner, { ...at, rect: { x: 0.45, y: 0.5, w: 0.4, h: 0.4 * (800 / 560) / CARD_RATIO } })).toBeNull();
  });

  it('a frame too small to look in gives nothing', () => {
    const px = scan({ W: 200, H: 140, bg: 30, face: 215, cards: [card(100, 70, 120, 0)] });
    expect(fitEdges(px, { rect: { x: 0.5, y: 0.5, w: 0.05, h: 0.05 }, base: 0, fine: 0 })).toBeNull();
  });

  it('the slider never goes past 10° either way', () => {
    const W = 1000, H = 700;
    // a card that needs all of 10°: the slider goes there
    const right = card(500, 350, 520, -10);
    const all = scan({ W, H, bg: 30, face: 215, cards: [right], noise: 5 });
    onCard(fitEdges(all, { rect: rough(right, W, H, 9, 10, 5, 1.04), base: 0, fine: 9 }), right, W, H, 0);
    // one that needs 10.6°: the slider stops at 10°
    const past = card(500, 350, 520, 10.6);
    const more = scan({ W, H, bg: 30, face: 215, cards: [past], noise: 5 });
    const got = fitEdges(more, { rect: rough(past, W, H, -9.5, 0, 0, 1.03), base: 0, fine: -9.5 });
    expect(got?.fine).toBe(-FINE_MAX);
    inside(got!.rect);
  });

  it('a card the scan cut short at the top: three edges and the shape of a card, the frame kept on the picture', () => {
    const W = 1000, H = 700, c = card(480, 353.1 / 2 - 12, 560, 0.9);
    const px = scan({ W, H, bg: 28, face: 218, cards: [c], noise: 5 });
    const got = fitEdges(px, { rect: { ...rough(c, W, H, 0, 8, 0, 1.0), y: 0.0 }, base: 0, fine: 0 });
    expect(got).not.toBeNull();
    near(got!.fine, -0.9, 0.2);
    inside(got!.rect);
    expect(got!.rect.y).toBe(0);
    const [u] = shown(c, W, H, got!.fine);
    near(got!.rect.x * W, u - c.w / 2, 3); near((got!.rect.x + got!.rect.w) * W, u + c.w / 2, 3);
  });
});
