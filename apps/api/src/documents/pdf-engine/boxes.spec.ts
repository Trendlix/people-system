import { pdfBoxCharacters, pdfCheckTicked, pdfFieldBoxes, pdfFieldGroups, toArabicDigits } from '@trendlix/shared';

// The box helpers of packages/shared (pdf-fields.ts), which has no test runner of its own: the web editor draws the
// boxes they give and the filler prints in them (owner's decision, 15 October 2026), so both always agree.

describe('pdfFieldBoxes', () => {
  it('shares the width out equally among the boxes', () => {
    expect(pdfFieldBoxes({ x: 100, y: 50, width: 140, height: 20, boxes: 14 })).toEqual(
      Array.from({ length: 14 }, (_, i) => ({ x: 100 + 10 * i, y: 50, width: 10, height: 20 })),
    );
  });

  it('takes off the gaps between boxes and between groups', () => {
    // a date in [4, 2, 2]: 8 boxes, 5 gaps of 1 inside the groups, 2 of 10 between them → (100 - 5 - 20) / 8 = 9.375
    const boxes = pdfFieldBoxes({ x: 0, y: 0, width: 100, height: 10, boxes: 8, groups: [4, 2, 2], boxGap: 1, groupGap: 10 });
    expect(boxes.map((b) => b.width)).toEqual(Array(8).fill(9.375));
    expect(boxes.map((b) => b.x)).toEqual([0, 10.375, 20.75, 31.125, 50.5, 60.875, 80.25, 90.625]);
    expect(boxes[7].x + boxes[7].width).toBeCloseTo(100, 10);
  });

  it('moves each box by its nudge', () => {
    const boxes = pdfFieldBoxes({ x: 0, y: 0, width: 30, height: 10, boxes: 3, nudges: [{ dx: 0, dy: 0 }, { dx: -1.5, dy: 2 }] });
    expect(boxes.map((b) => [b.x, b.y])).toEqual([
      [0, 0],
      [8.5, 2],
      [20, 0],
    ]);
  });

  it('takes groups that don’t add up to the boxes as one group', () => {
    expect(pdfFieldGroups({ boxes: 8, groups: [4, 2] })).toEqual([8]);
    expect(pdfFieldGroups({ boxes: 8, groups: [4, 2, 2] })).toEqual([4, 2, 2]);
  });
});

describe('pdfBoxCharacters', () => {
  it('spreads a value one character per box from the left, or ends it in the right-most box', () => {
    expect(pdfBoxCharacters({ boxes: 6 }, '1234')).toEqual(['1', '2', '3', '4', '', '']);
    expect(pdfBoxCharacters({ boxes: 6, boxAlign: 'right' }, '1234')).toEqual(['', '', '1', '2', '3', '4']);
    // too long: the characters nearest the side it is aligned to
    expect(pdfBoxCharacters({ boxes: 3 }, '12345')).toEqual(['1', '2', '3']);
    expect(pdfBoxCharacters({ boxes: 3, boxAlign: 'right' }, '12345')).toEqual(['3', '4', '5']);
  });

  it('puts a date’s parts in its order: DMY unless YMD (an Arabic form, the day right-most)', () => {
    expect(pdfBoxCharacters({ boxes: 8 }, '05/01/2026').join('')).toBe('05012026');
    expect(pdfBoxCharacters({ boxes: 8, dateOrder: 'YMD' }, '05/01/2026').join('')).toBe('20260105');
    expect(pdfBoxCharacters({ boxes: 8, dateOrder: 'YMD' }, '5/1/2026').join('')).toBe('20260105');
    // MM/YYYY (a national ID's issue date)
    expect(pdfBoxCharacters({ boxes: 6, dateOrder: 'YMD' }, '10/2026').join('')).toBe('202610');
  });

  it('prints the pounds or the piastres of an amount', () => {
    expect(pdfBoxCharacters({ boxes: 5, boxAlign: 'right', amountPart: 'pounds' }, '15,000.50')).toEqual(['1', '5', '0', '0', '0']);
    expect(pdfBoxCharacters({ boxes: 2, amountPart: 'piasters' }, '15,000.50')).toEqual(['5', '0']);
    expect(pdfBoxCharacters({ boxes: 2, amountPart: 'piasters' }, '15,000')).toEqual(['0', '0']);
    expect(pdfBoxCharacters({ boxes: 6, boxAlign: 'right', amountPart: 'pounds' }, '9,400.5')).toEqual(['', '', '9', '4', '0', '0']);
  });

  it('leaves out spaces and dashes, which only lay a value out (a tax number kept as 123-456-789)', () => {
    expect(pdfBoxCharacters({ boxes: 9 }, '123-456-789').join('')).toBe('123456789');
    expect(pdfBoxCharacters({ boxes: 9 }, '123 456 789').join('')).toBe('123456789');
    expect(pdfBoxCharacters({ boxes: 9 }, '123–456—789').join('')).toBe('123456789');
  });

  it('reads Arabic-Indic digits as digits, and prints them so only when asked', () => {
    expect(pdfBoxCharacters({ boxes: 4 }, '٢٠٢٦').join('')).toBe('2026');
    expect(pdfBoxCharacters({ boxes: 4, arabicDigits: true }, '2026').join('')).toBe('٢٠٢٦');
    expect(toArabicDigits('12/5')).toBe('١٢/٥');
  });
});

describe('pdfCheckTicked', () => {
  it('ticks a box without a tag always, one with a tag when the tag prints its value', () => {
    expect(pdfCheckTicked({ tag: null }, undefined)).toBe(true);
    expect(pdfCheckTicked({ tag: 'employment_type_ar', equals: 'دوام كامل' }, ' دوام كامل ')).toBe(true);
    expect(pdfCheckTicked({ tag: 'employment_type_ar', equals: 'دوام كامل' }, 'دوام جزئي')).toBe(false);
    expect(pdfCheckTicked({ tag: 'employment_type_ar', equals: '' }, '')).toBe(false);
  });
});
