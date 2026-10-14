// After Prime ERP production/web/src/scan/image.test.ts (commit 1368621): the cut of a card, for the functions ported to
// apps/web/src/app/(app)/employees/scan/image.ts. The finder is not ported (the OCR service finds cards here), so the
// cards are given as they are, not found on a mask. The canvas paths are checked in a real browser (crop-check.html).
import { describe, expect, it } from 'vitest';
import { CARD_MM, CARD_RATIO, type Card } from './card';
import { cutPlan, cutSize } from './image';

type Edge = 'top' | 'bottom' | 'left' | 'right';
/** How far beyond each edge of the card `truth` the cut of the card `found` reaches, in millimetres: below 0, the cut is inside the card. */
function margins(found: Card, truth: Card, W: number, H: number): Record<Edge, number> {
  const { reach: [l, t, r, b] } = cutPlan(found, W, H), cos = Math.cos(found.angle), sin = Math.sin(found.angle), dx = truth.cx - found.cx, dy = truth.cy - found.cy, du = dx * cos + dy * sin, dv = -dx * sin + dy * cos, mm = truth.w / CARD_MM[0];
  return { top: (t + dv - truth.h / 2) / mm, bottom: (b - dv - truth.h / 2) / mm, left: (l + du - truth.w / 2) / mm, right: (r - du - truth.w / 2) / mm };
}
const card = (angle = 0, cx = 700, cy = 500, w = 560): Card => ({ cx, cy, w, h: w / CARD_RATIO, angle: (angle * Math.PI) / 180 });

describe('what is cut out holds the whole card, and never less', () => {
  it('a margin of 1.2 mm above and below the card, and 1.9 mm at its sides', () => {
    for (const deg of [0, 2, -3, 9.5]) {
      const m = margins(card(deg), card(deg), 1414, 2000);
      expect(m.top).toBeCloseTo(1.2, 6); expect(m.bottom).toBeCloseTo(1.2, 6); expect(m.left).toBeCloseTo(1.2 * CARD_RATIO, 6); expect(m.right).toBeCloseTo(1.2 * CARD_RATIO, 6);
    }
  });
  it('never past the edge of the picture: a card near an edge is cut up to the edge, and says it goes on beyond it', () => {
    const mm = 560 / CARD_MM[0], top = card(0, 700, 353.1 / 2 - 2 * mm); // 2 mm of the card off the top of the page
    const plan = cutPlan(top, 1414, 2000);
    expect(plan.reach[1]).toBeCloseTo(top.cy, 6);
    expect(plan.frame[1]).toBeLessThan(0);
    expect(-plan.frame[1] * (plan.reach[1] + plan.reach[3]) / mm).toBeCloseTo(2, 1);
    const near = card(0, 700, 353.1 / 2 + 0.5 * mm); // 0.5 mm of room above it: the margin stops at the edge
    expect(cutPlan(near, 1414, 2000).reach[1]).toBeCloseTo(near.cy, 6);
    const askew = card(5, 290, 1000); // leaning, close to the left edge: the cut ends at the edge, measured from the card's middle
    const { reach: [l] } = cutPlan(askew, 1414, 2000), cos = Math.cos(askew.angle);
    expect(askew.cx - l * cos).toBeCloseTo(0, 6); expect(l).toBeLessThan(askew.w / 2 + 1.2 * CARD_RATIO * (askew.w / CARD_MM[0]));
  });
  it('the size of the cut: at the picture\'s own scale, or with the card brought to a given size, at most 1800 pixels wide', () => {
    const c = card(0), [w, h] = cutSize(c, 1414, 2000), mm = c.w / CARD_MM[0];
    expect(w).toBe(Math.round(c.w + 2 * 1.2 * CARD_RATIO * mm)); expect(h).toBe(Math.round(c.h + 2 * 1.2 * mm));
    near(w / h, CARD_RATIO, 0.01);
    const [w2, h2] = cutSize(c, 1414, 2000, [1011, 638]); // the card at 300 dpi
    expect(w2).toBe(Math.round((c.w + 2 * 1.2 * CARD_RATIO * mm) * (1011 / c.w))); expect(h2).toBe(Math.round((c.h + 2 * 1.2 * mm) * (638 / c.h)));
    const [w3] = cutSize(card(0, 1000, 1000, 1900), 2000, 2000); expect(w3).toBe(1800);
  });
});

function near(a: number, b: number, by: number) { expect(Math.abs(a - b)).toBeLessThan(by); }
