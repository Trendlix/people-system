// After Prime ERP production/web/src/scan/flatten.test.ts (commit c6646b8, 10 November 2026), for what was taken into
// apps/web/src/app/(app)/employees/scan/flatten.ts: a card framed by hand by its four corners, flattened. Finding the
// corners and telling the card's proportions from them are the OCR service's here (services/ocr/tests/test_flatten.py).
// Pictures are drawn as arrays of points, a made-up card photographed through a lens drawn by camera.ts.
import { describe, expect, it } from 'vitest';
import { photo } from './camera';
import { CARD_RATIO, CUT_FRAME, type Pt } from './card';
import { convex, cornerCut, cornersAsShown, flatPixels, homography, invert, mapPt, warp, type Mat, type Source } from './flatten';

const close = (a: number, b: number, by: number, what?: string) => expect(Math.abs(a - b), what).toBeLessThanOrEqual(by);

describe('a perspective transform from four points', () => {
  it('takes each of four points to its own, and the transform undone takes them back', () => {
    const from: Pt[] = [[0, 0], [1700, 0], [1700, 1072], [0, 1072]];
    const to: Pt[] = [[412.3, 301.7], [2391.8, 260.2], [2502.4, 1544.9], [330.6, 1610.1]];
    const m = homography(from, to)!;
    const back = invert(m)!;
    from.forEach((p, i) => {
      const q = mapPt(m, p[0], p[1]);
      close(q[0], to[i][0], 1e-6);
      close(q[1], to[i][1], 1e-6);
      const r = mapPt(back, q[0], q[1]);
      close(r[0], p[0], 1e-6);
      close(r[1], p[1], 1e-6);
    });
    // straight lines stay straight: the middle of the card lies where its diagonals cross
    const cross = (p: Pt, q: Pt, r: Pt, s: Pt): Pt => {
      const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
      const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    const mid = mapPt(m, 850, 536);
    const x = cross(to[0], to[2], to[1], to[3]);
    close(mid[0], x[0], 1e-6);
    close(mid[1], x[1], 1e-6);
  });
  it('a plain move and a scale are what they are; three points on a line give none', () => {
    const m = homography([[0, 0], [10, 0], [10, 5], [0, 5]], [[100, 50], [120, 50], [120, 60], [100, 60]])!;
    [2, 0, 100, 0, 2, 50, 0, 0, 1].forEach((v, i) => close(m[i], v, 1e-9));
    expect(homography([[0, 0], [1, 1], [2, 2], [0, 5]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toBeNull();
  });
});

describe('the shape four corners make', () => {
  it('a card with no corner pushed in, and none whose sides cross', () => {
    expect(convex([[0, 0], [10, 0], [10, 6], [0, 6]])).toBe(true);
    expect(convex([[0, 0], [10, 1], [9, 7], [1, 6]])).toBe(true);
    expect(convex([[0, 0], [10, 0], [3, 3], [0, 6]])).toBe(false); // a corner pushed in
    expect(convex([[0, 0], [10, 6], [10, 0], [0, 6]])).toBe(false); // sides that cross
    expect(convex([[0, 0], [10, 0], [20, 0], [0, 6]])).toBe(false); // three on a line
  });
  it('corners in the order a card is cut out in: clockwise from the top left as shown, a card on its end laid on its long side', () => {
    const q: Pt[] = [[110, 20], [905, 60], [880, 560], [90, 520]];
    expect(cornersAsShown([q[2], q[0], q[3], q[1]])).toEqual(q);
    expect(cornersAsShown([q[1], q[3], q[2], q[0]])).toEqual(q);
    const tall: Pt[] = [[100, 100], [600, 110], [590, 900], [95, 905]]; // standing on its end
    expect(cornersAsShown(tall)).toEqual([tall[3], tall[0], tall[1], tall[2]]);
  });
});

describe('the cut of a card framed by its corners', () => {
  const W = 2000;
  const H = 1500;
  const q: Pt[] = [[400, 300], [1500, 330], [1560, 1000], [330, 960]];
  const shares = (ps: Pt[]) => ps.map(([x, y]): Pt => [x / W, y / H]);
  it('the size of an ID card, with the margin a card cut out keeps, its corners where the card lies on the cut', () => {
    const cut = cornerCut(shares([q[2], q[0], q[3], q[1]]), W, H)!; // in any order
    cut.frame.forEach((v, i) => close(v, CUT_FRAME[i], 1e-4)); // the card a whole number of points across
    const [l, t, r, b] = [cut.frame[0] * cut.ow, cut.frame[1] * cut.oh, cut.frame[2] * cut.ow, cut.frame[3] * cut.oh];
    close((r - l) / (b - t), CARD_RATIO, 0.003);
    ([[l, t], [r, t], [r, b], [l, b]] as Pt[]).forEach(([x, y], i) => {
      const p = mapPt(cut.m, x, y);
      close(p[0], q[i][0], 1e-6);
      close(p[1], q[i][1], 1e-6);
    });
    // as sharp as the nearest of its sides: the card about as wide as its longest
    close(r - l, Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]), 4);
  });
  it('at most 1800 points wide, with its margin; corners that do not make a card give none', () => {
    const big: Pt[] = [[100, 100], [1950, 140], [1900, 1400], [60, 1380]];
    expect(cornerCut(shares(big), W, H)!.ow).toBe(1800);
    expect(cornerCut(shares([q[0], q[2], q[1], q[3]].map((p, i) => (i === 1 ? ([800, 500] as Pt) : p))), W, H)).toBeNull(); // a corner pushed in
    expect(cornerCut(shares([q[0], q[1], q[2]]), W, H)).toBeNull();
  });
});

describe('the points of the cut, each from its place on the picture', () => {
  /** A picture of `W` by `H` whose every point says where it is: red its column, green its row. */
  const grid = (W: number, H: number) => {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set([x, y, 128, 255], (y * W + x) * 4);
    return px;
  };
  it('the transform that leaves everything where it is gives the picture back, point for point', () => {
    const px = grid(40, 30);
    const id: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect([...warp(px, 40, 30, id, 40, 30)]).toEqual([...px]);
  });
  it('between points, a share of each of the four around; past the picture, white', () => {
    const px = grid(40, 30);
    const between = warp(px, 40, 30, [1, 0, 0.25, 0, 1, 0.75, 0, 0, 1], 40, 30);
    expect([between[(10 * 40 + 10) * 4], between[(10 * 40 + 10) * 4 + 1]]).toEqual([10, 11]); // 10.25 and 10.75, kept as whole levels
    const out = warp(px, 40, 30, [1, 0, 30, 0, 1, 0, 0, 0, 1], 40, 30);
    expect([...out.slice((5 * 40 + 20) * 4, (5 * 40 + 20) * 4 + 4)]).toEqual([255, 255, 255, 255]);
  });
});

describe('a card photographed at an angle, flattened from its corners', () => {
  // a made-up card, light on a dark desk, with a line of dark print across it a quarter of the way down
  const CW = 856;
  const CH = Math.round(CW / CARD_RATIO);
  const SW = 1200;
  const SH = 900;
  const at = { x: (SW - CW) / 2, y: (SH - CH) / 2 };
  const ink = { x0: 0.2 * CW, x1: 0.8 * CW, y0: 0.25 * CH, y1: 0.25 * CH + 14 };
  function scene(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(SW * SH * 4);
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++) {
        const u = x + 0.5 - at.x;
        const v = y + 0.5 - at.y;
        const onCard = u >= 0 && v >= 0 && u < CW && v < CH;
        const g = !onCard ? 40 : u >= ink.x0 && u < ink.x1 && v >= ink.y0 && v < ink.y1 ? 30 : 235;
        px.set([g, g, g, 255], (y * SW + x) * 4);
      }
    return px;
  }
  /** A picture held as an array, as a Source: a part of it copied, taking the nearest point. */
  const sourceOfArray = (px: Uint8ClampedArray, W: number, H: number): Source => ({
    W,
    H,
    copy: (sx, sy, sw, sh, dw, dh) => {
      const out = new Uint8ClampedArray(dw * dh * 4);
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          const X = Math.min(W - 1, Math.floor(sx + ((x + 0.5) * sw) / dw));
          const Y = Math.min(H - 1, Math.floor(sy + ((y + 0.5) * sh) / dh));
          out.set(px.subarray((Y * W + X) * 4, (Y * W + X) * 4 + 4), (y * dw + x) * 4);
        }
      return out;
    },
  });
  /** Where, down a column of a cut from row `from` to `to`, its grey first gets halfway between what it is at either end. */
  function crossing(px: Uint8ClampedArray, ow: number, col: number, from: number, to: number): number {
    const v: number[] = [];
    const step = to > from ? 1 : -1;
    for (let y = from; y !== to + step; y += step) v.push(px[(y * ow + Math.round(col)) * 4]);
    const level = (v[0] + v[v.length - 1]) / 2;
    for (let k = 1; k < v.length; k++)
      if ((v[k] - level) * (v[0] - level) <= 0) return from + (k - 1 + (level - v[k - 1]) / (v[k] - v[k - 1])) * step + 0.5;
    return NaN;
  }

  it('its edges where the frame says, and its print level, where it slanted on the photo', () => {
    const W = 1600;
    const H = 1200;
    // the scene seen through a lens held at an angle: where its corners show, and the photo itself
    const shown = photo(W, H, 1250, SW, SH, { tilt: 24, yaw: 10, roll: 4, size: 0.95 });
    const toScene = invert(homography([[0, 0], [SW, 0], [SW, SH], [0, SH]], shown)!)!;
    const picture = warp(scene(), SW, SH, toScene, W, H);
    const toPhoto = invert(toScene)!;
    const corners: Pt[] = ([[0, 0], [CW, 0], [CW, CH], [0, CH]] as Pt[]).map(([u, v]) => mapPt(toPhoto, at.x + u, at.y + v));
    const slant = Math.abs(Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]) / Math.hypot(corners[2][0] - corners[3][0], corners[2][1] - corners[3][1]) - 1);
    expect(slant).toBeGreaterThan(0.1); // clearly slanted on the photo

    const cut = cornerCut(corners.map(([x, y]): Pt => [x / W, y / H]), W, H)!;
    const px = flatPixels(sourceOfArray(picture, W, H), cut.m, cut.ow, cut.oh)!;
    const [l, t, r, b] = [cut.frame[0] * cut.ow, cut.frame[1] * cut.oh, cut.frame[2] * cut.ow, cut.frame[3] * cut.oh];
    // the top and bottom edges, crossed at a quarter, a half and three quarters of the card's width, where the frame says
    for (const p of [0.25, 0.5, 0.75]) {
      const col = l + p * (r - l);
      close(crossing(px, cut.ow, col, 1, Math.round(t) + 8), t, 1.5, `top at ${p}`);
      close(crossing(px, cut.ow, col, cut.oh - 2, Math.round(b) - 8), b, 1.5, `bottom at ${p}`);
    }
    // the line of print: its top at either end the same height on the cut, where it is on the card
    const want = t + (ink.y0 / CH) * (b - t);
    const ends = [ink.x0 + 0.08 * (ink.x1 - ink.x0), ink.x1 - 0.08 * (ink.x1 - ink.x0)].map((u) =>
      crossing(px, cut.ow, l + (u / CW) * (r - l), Math.round(want) - 12, Math.round(want) + 6),
    );
    close(ends[0], ends[1], 1, `print: ${ends}`);
    ends.forEach((y) => close(y, want, 1.5));
  });
});
