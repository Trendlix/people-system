// Ported from Prime ERP production/web/src/scan/card.test.ts (commit 1368621), for the functions ported to
// apps/web/src/app/(app)/employees/scan/card.ts, plus the changes and additions made there.
import { describe, expect, it } from 'vitest';
import {
  CARD_MM, CARD_RATIO, cardDims, cardOff, cardRect, CROP_MIN, CUT_FRAME, CUT_MM, dragRect, fineOf, foundRect, frameCard, frameSays,
  jfifDpi, keyRect, quarterFor, startRect, turnCard, wholeRect, type Card,
} from './card';

const near = (a: number, b: number, by = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(by);

describe('the size of an ID card', () => {
  it('a card is 85.6 by 53.98 mm: a shape is measured against that', () => {
    near(CARD_RATIO, 1.58577, 1e-4);
    near(cardOff(856, 539.8), 0); expect(cardOff(1000, 500)).toBeGreaterThan(0.25); expect(cardOff(1400, 1000)).toBeLessThan(-0.11);
  });
  it('a picture fixed to the card size keeps about its pixels, at a whole number of dots per inch', () => {
    const [w, h, dpi] = cardDims(1012, 638);
    expect(dpi).toBe(300); expect(w).toBe(1011); expect(h).toBe(638);
    near(w / h, CARD_RATIO, 0.002);
    expect(cardDims(10, 10)[2]).toBe(20); expect(cardDims(9000, 9000)[2]).toBe(712);
    for (const [a, b] of [[640, 400], [2400, 1500], [333, 777]]) { const [x, y, d] = cardDims(a, b); expect(x).toBe(Math.round((d * 85.6) / 25.4)); expect(y).toBe(Math.round((d * 53.98) / 25.4)); }
  });
  it('the print size is written into the header of a JPEG that has one, and into nothing else', () => {
    const jpeg = new Uint8Array(24); jpeg.set([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]);
    jfifDpi(jpeg, 300);
    expect([...jpeg.slice(13, 18)]).toEqual([1, 1, 44, 1, 44]);
    const other = new Uint8Array(24); other.set([0xFF, 0xD8, 0xFF, 0xE1, 0, 16, 0x45, 0x78, 0x69, 0x66]);
    expect([...jfifDpi(other.slice(), 300)]).toEqual([...other]);
    const odd = jpeg.slice(); jfifDpi(odd, 70000); expect([...odd]).toEqual([...jpeg]);
  });
  it('a card cut out lies inside a margin of 1.2 mm above and below it, and 1.9 mm at its sides', () => {
    near(CUT_FRAME[0], CUT_FRAME[1]); near(CUT_FRAME[1] * (CARD_MM[1] + 2 * CUT_MM), CUT_MM); near(CUT_FRAME[0] * (CARD_MM[0] + 2 * CUT_MM * CARD_RATIO), CUT_MM * CARD_RATIO, 1e-9);
    near(CUT_MM * CARD_RATIO, 1.9, 0.01);
  });
});

describe('the frame', () => {
  it('takes the proportions of a card inside the place it has, around the same middle', () => {
    const r = cardRect(startRect(), 1400, 1000);
    near((r.w * 1400) / (r.h * 1000), CARD_RATIO, 1e-9); near(r.x + r.w / 2, 0.5); near(r.y + r.h / 2, 0.5); near(r.w, 0.92);
    const tall = cardRect(startRect(), 1000, 1400);
    near((tall.w * 1000) / (tall.h * 1400), CARD_RATIO, 1e-9); near(tall.w, 0.92); expect(tall.h).toBeLessThan(0.5);
    const wide = cardRect(wholeRect(), 2000, 600);
    near((wide.w * 2000) / (wide.h * 600), CARD_RATIO, 1e-9); near(wide.h, 1); near(wide.x + wide.w / 2, 0.5);
  });
  it('moved by the pointer, it stays inside the picture', () => {
    const r = { x: 0.2, y: 0.2, w: 0.5, h: 0.4 };
    expect(dragRect(r, 'move', 0.1, -0.05)).toEqual({ x: 0.2 + 0.1, y: 0.2 - 0.05, w: 0.5, h: 0.4 });
    expect(dragRect(r, 'move', 5, 5)).toEqual({ x: 0.5, y: 0.6, w: 0.5, h: 0.4 });
    expect(dragRect(r, 'move', -5, -5)).toEqual({ x: 0, y: 0, w: 0.5, h: 0.4 });
  });
  it('a handle moves its own edges only, never past the picture or the opposite edge', () => {
    const r = { x: 0.2, y: 0.2, w: 0.5, h: 0.4 };
    const e = dragRect(r, 'e', 0.1, 0.3); near(e.x, 0.2); near(e.y, 0.2); near(e.w, 0.6); near(e.h, 0.4);
    const nw = dragRect(r, 'nw', 0.1, 0.1); near(nw.x, 0.3); near(nw.y, 0.3); near(nw.w, 0.4); near(nw.h, 0.3);
    const s = dragRect(r, 's', 0, 5); near(s.y + s.h, 1); near(s.w, 0.5);
    const crossed = dragRect(r, 'w', 5, 0); near(crossed.w, CROP_MIN); near(crossed.x + crossed.w, 0.7);
    const up = dragRect(r, 'se', -5, -5); near(up.w, CROP_MIN); near(up.h, CROP_MIN); near(up.x, 0.2); near(up.y, 0.2);
  });
  it('the arrow keys move it, with Shift they resize it, and other keys are not its business', () => {
    const r = { x: 0.2, y: 0.2, w: 0.5, h: 0.4 };
    near(keyRect(r, 'ArrowLeft', false)!.x, 0.19); near(keyRect(r, 'ArrowDown', false)!.y, 0.21); near(keyRect(r, 'ArrowRight', true)!.w, 0.51); near(keyRect(r, 'ArrowUp', true)!.h, 0.39);
    expect(keyRect({ x: 0, y: 0, w: 0.5, h: 0.4 }, 'ArrowLeft', false)!.x).toBe(0);
    near(keyRect({ x: 0.5, y: 0.6, w: 0.5, h: 0.4 }, 'ArrowRight', true)!.w, 0.5);
    near(keyRect({ x: 0, y: 0, w: CROP_MIN, h: 0.4 }, 'ArrowLeft', true)!.w, CROP_MIN);
    expect(keyRect(r, 'Enter', false)).toBeNull(); expect(keyRect(r, 'a', true)).toBeNull();
  });
  it('opens on the card that was found, with the page turned so that the card lies level (no air: the cut keeps its margin)', () => {
    const level = foundRect({ cx: 800, cy: 600, w: 900, h: 567, angle: 0 }, 1600, 2400);
    near(level.base, 0); near(level.rect.x + level.rect.w / 2, 0.5); near(level.rect.y + level.rect.h / 2, 0.25); near(level.rect.w, 900 / 1600); near(level.rect.h, 567 / 2400);
    const askew = foundRect({ cx: 840, cy: 560, w: 900, h: 567.4, angle: (1.8 * Math.PI) / 180 }, 1654, 2339);
    near(askew.base, -1.8, 1e-9);
    expect(askew.rect.x + askew.rect.w / 2).toBeLessThan(840 / 1654);
    const edge = foundRect({ cx: 100, cy: 100, w: 900, h: 567, angle: 0 }, 1000, 800);
    expect(edge.rect.x).toBe(0); expect(edge.rect.y).toBe(0); expect(edge.rect.w).toBeLessThanOrEqual(1);
  });
  it('a rotation by hand is at most ten degrees either way, in tenths of a degree (owner\'s range)', () => {
    expect(fineOf('0.44')).toBe(0.4); expect(fineOf(0.45000001)).toBe(0.5); expect(fineOf(7)).toBe(7); expect(fineOf(12)).toBe(10); expect(fineOf(-19)).toBe(-10); expect(fineOf('x')).toBe(0); expect(fineOf(0.1 + 0.2)).toBe(0.3);
    expect(fineOf(9.95)).toBe(10); expect(fineOf(-9.9 - 0.1)).toBe(-10);
  });
  it('says what the frame will give: the size, and how far the frame is from a card', () => {
    expect(frameSays(wholeRect(), 1400, 1000, false)).toMatchObject({ w: 1400, h: 1000 });
    const whole = frameSays(wholeRect(), 1400, 1000, true);
    expect(whole).toMatchObject({ far: false, pct: 12, wider: false }); near(whole.w / whole.h, CARD_RATIO, 0.002);
    expect(frameSays({ x: 0, y: 0, w: 1, h: 0.4 }, 1400, 1000, true)).toMatchObject({ far: true, wider: true });
    expect(frameSays(cardRect(startRect(), 1400, 1000), 1400, 1000, true)).toMatchObject({ far: false, pct: 0 });
  });
});

describe('the pages of POST /id-card/prepare (added here)', () => {
  const rad = (d: number) => (d * Math.PI) / 180;
  it('a quarter turn of the page carries the card with it, as turnCanvas turns the page', () => {
    const c: Card = { cx: 300, cy: 200, w: 500, h: 315, angle: rad(3) };
    const q = turnCard(c, 1000, 1400, 90); // clockwise: (x, y) → (H − y, x)
    near(q.cx, 1400 - 200, 1e-9); near(q.cy, 300, 1e-9); near(q.angle, rad(93), 1e-12); expect(q.w).toBe(500);
    const h = turnCard(c, 1000, 1400, 180); near(h.cx, 700); near(h.cy, 1200);
    const t = turnCard(c, 1000, 1400, 270); near(t.cx, 200, 1e-9); near(t.cy, 1000 - 300, 1e-9); near(t.angle, rad(-87), 1e-12); // kept between −180° and 180°
    const back = turnCard(turnCard(c, 1000, 1400, 90), 1400, 1000, 270); near(back.cx, c.cx, 1e-9); near(back.cy, c.cy, 1e-9);
  });
  it('the quarter turn leaves the card leaning by 45° or less', () => {
    expect(quarterFor(rad(2))).toBe(0); expect(quarterFor(rad(-30))).toBe(0);
    expect(quarterFor(rad(90))).toBe(270); expect(quarterFor(rad(-88))).toBe(90); expect(quarterFor(rad(178))).toBe(180); expect(quarterFor(rad(-179))).toBe(180);
    for (const d of [-170, -100, -60, -10, 0, 20, 50, 89, 135, 180]) {
      const left = d + quarterFor(rad(d)); const lean = ((((left + 180) % 360) + 360) % 360) - 180;
      expect(Math.abs(lean), `${d}°`).toBeLessThanOrEqual(45);
    }
  });
  it('the frame over a card found and turned level stands for that card again', () => {
    for (const deg of [0, 2.5, -7, 30, 88, -91, 179]) {
      const W = 1414, H = 2000, found: Card = { cx: 640, cy: 500, w: 560, h: 353, angle: rad(deg) };
      const q = quarterFor(found.angle), side = q === 90 || q === 270, w = side ? H : W, h = side ? W : H;
      const turned = turnCard(found, W, H, q), at = foundRect(turned, w, h), card = frameCard(at.rect, w, h, at.base);
      near(card.cx, turned.cx, 1e-6); near(card.cy, turned.cy, 1e-6); near(card.w, found.w, 1e-6); near(card.h, found.h, 1e-6);
      near(Math.cos(card.angle), Math.cos(turned.angle), 1e-9); near(Math.sin(card.angle), Math.sin(turned.angle), 1e-9);
    }
  });
  it('a level frame on a level page is the card under it', () => {
    const c = frameCard({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 800, 0);
    near(c.cx, 350); near(c.cy, 260); near(c.w, 500); near(c.h, 200); near(c.angle, 0);
  });
});
