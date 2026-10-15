// The frame of the document adjuster, what it gives, and bringing a document under the upload limit.
import { describe, expect, it } from 'vitest';
import { A4_RATIO, adjustedName, cutSize, fitUnder, isWhole, MIN_FACTOR, PRESETS, ratioRect, shapeOf, turnRect, turnRectBy, wholeRect, type Rect } from './page-frame';

const near = (a: Rect, b: Rect) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 9);
};

describe('the frame over a page', () => {
  it('follows the page when it is turned by a quarter: the same part of it', () => {
    // a frame on the top left of a page turned clockwise lies on its top right
    near(turnRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.4, y: 0.1, w: 0.4, h: 0.3 });
    // four quarter turns bring it back
    const r = { x: 0.12, y: 0.05, w: 0.5, h: 0.81 };
    near(turnRectBy(r, 360), r);
    near(turnRectBy(r, 180), { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h });
    near(turnRect(wholeRect()), wholeRect());
  });

  it('the A4 presets: the shape of an A4 sheet, about as large as the frame was, on the page', () => {
    const W = 3000, H = 2000; // a landscape photo
    const portrait = ratioRect({ x: 0.2, y: 0.1, w: 0.5, h: 0.7 }, W, H, PRESETS.a4Portrait);
    expect((portrait.w * W) / (portrait.h * H)).toBeCloseTo(1 / A4_RATIO, 9);
    expect(portrait.w * W * portrait.h * H).toBeCloseTo(0.5 * W * 0.7 * H, 3);
    expect(portrait.x + portrait.w / 2).toBeCloseTo(0.45, 9);
    expect(shapeOf(portrait, W, H)).toBe('a4Portrait');
    // and back to landscape: the same size
    const landscape = ratioRect(portrait, W, H, PRESETS.a4Landscape);
    expect(shapeOf(landscape, W, H)).toBe('a4Landscape');
    expect(landscape.w * W * landscape.h * H).toBeCloseTo(0.5 * W * 0.7 * H, 3);
    // from the whole page: as large as fits, never off the page
    const fromWhole = ratioRect(wholeRect(), W, H, PRESETS.a4Portrait);
    expect(fromWhole.h).toBeCloseTo(1, 9);
    expect(fromWhole.y).toBe(0);
    expect(fromWhole.x).toBeGreaterThan(0);
    expect(fromWhole.x + fromWhole.w).toBeLessThanOrEqual(1);
    // near an edge: moved onto the page
    const edge = ratioRect({ x: 0.9, y: 0.0, w: 0.1, h: 0.3 }, W, H, PRESETS.a4Landscape);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1 + 1e-12);
    expect(edge.y).toBeGreaterThanOrEqual(0);
    expect(shapeOf({ x: 0, y: 0, w: 0.5, h: 0.5 }, W, H)).toBeNull();
    expect(isWhole(wholeRect())).toBe(true);
    expect(isWhole(fromWhole)).toBe(false);
  });

  it('what it gives: the page\'s own scale, never larger, at most 3500 pixels on the long side', () => {
    expect(cutSize({ x: 0, y: 0, w: 0.5, h: 0.5 }, 2000, 3000)).toEqual([1000, 1500]);
    expect(cutSize(wholeRect(), 4000, 6000)).toEqual([2333, 3500]);
    expect(cutSize(wholeRect(), 4000, 6000, 3500, 0.5)).toEqual([1167, 1750]);
    expect(cutSize({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, 100, 100)).toEqual([1, 1]);
  });

  it('the adjusted file\'s name', () => {
    expect(adjustedName('birth-certificate.pdf', false)).toBe('birth-certificate-adjusted.jpg');
    expect(adjustedName('birth-certificate.pdf', true)).toBe('birth-certificate-adjusted.pdf');
    expect(adjustedName('Scan 2026.10.15.jpeg', true)).toBe('Scan 2026.10.15-adjusted.pdf');
    expect(adjustedName('شهادة الميلاد.jpg', false)).toBe('شهادة الميلاد-adjusted.jpg');
    // adjusted again: not "-adjusted-adjusted"
    expect(adjustedName('cert-adjusted.jpg', true)).toBe('cert-adjusted.pdf');
    expect(adjustedName('.pdf', false)).toBe('document-adjusted.jpg');
    expect(adjustedName('', true)).toBe('document-adjusted.pdf');
  });
});

describe('a document brought under the upload limit', () => {
  /** A page's JPEG as large as its pixels and its quality make it: `base` bytes at quality 0.9 and full size. */
  function encoder(bases: number[]) {
    const calls: { page: number; factor: number; qualities: readonly number[] }[] = [];
    const encode = async (page: number, factor: number, qualities: readonly number[]) => {
      calls.push({ page, factor, qualities });
      return qualities.map((q) => new Uint8Array(Math.round(bases[page] * factor * factor * (q / 0.9) ** 2)));
    };
    return { encode, calls };
  }

  it('small enough at once: quality 0.9, nothing lowered, each page cut once', async () => {
    const { encode, calls } = encoder([1000, 2000]);
    const got = await fitUnder(2, 4000, 100, encode);
    expect(got).toMatchObject({ quality: 0.9, factor: 1, lowered: null });
    expect(got!.jpegs.map((j) => j.length)).toEqual([1000, 2000]);
    expect(calls).toHaveLength(2);
  });

  it('too large: the quality is lowered step by step, the highest that fits is kept', async () => {
    const { encode, calls } = encoder([3000, 3000]);
    // at 0.8: 2 × 2370 = 4741; at 0.7: 2 × 1815 = 3630
    const got = await fitUnder(2, 4000, 100, encode);
    expect(got).toMatchObject({ quality: 0.7, factor: 1, lowered: 'quality' });
    // the lower qualities are tried with one cut of each page
    expect(calls.slice(2)).toEqual([
      { page: 0, factor: 1, qualities: [0.8, 0.7, 0.6] },
      { page: 1, factor: 1, qualities: [0.8, 0.7, 0.6] },
    ]);
  });

  it('still too large at the lowest quality: the pages are made smaller', async () => {
    const { encode } = encoder([10000]);
    const got = await fitUnder(1, 3000, 0, encode);
    expect(got?.lowered).toBe('resolution');
    expect(got!.quality).toBe(0.6);
    expect(got!.factor).toBeLessThan(1);
    expect(got!.factor).toBeGreaterThanOrEqual(MIN_FACTOR);
    expect(got!.jpegs[0].length).toBeLessThanOrEqual(3000);
  });

  it('gives up when even the smallest is too large', async () => {
    const { encode } = encoder([1_000_000]);
    expect(await fitUnder(1, 3000, 0, encode)).toBeNull();
  });
});
