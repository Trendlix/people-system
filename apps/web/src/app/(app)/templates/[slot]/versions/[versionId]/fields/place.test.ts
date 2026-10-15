import { pdfFieldBoxes, type PdfField } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import {
  arrowDelta,
  boxAt,
  clampRect,
  cleanField,
  drawnRect,
  duplicateField,
  fieldInMessage,
  fieldsDirty,
  fitScale,
  groupsText,
  moveRect,
  newFieldId,
  nudgeBox,
  parseGroups,
  pointOnPage,
  resizeRect,
  setBoxCount,
  toPoints,
  toScreen,
} from './place';

// a legal-size page, as the owner's social insurance forms are
const PAGE = { width: 612.12, height: 1008.12 };

const field = (over: Partial<PdfField> = {}): PdfField => ({ id: 'a1b2c3d4', kind: 'text', tag: 'full_name_ar', page: 1, x: 100, y: 200, width: 150, height: 16, fontSize: 11, ...over });

describe('screen pixels and points', () => {
  it('turns pixels at a zoom into points and back', () => {
    expect(toPoints(150, 1.5)).toBe(100);
    expect(toScreen(100, 1.5)).toBe(150);
    expect(toPoints(toScreen(37.25, 0.8), 0.8)).toBeCloseTo(37.25);
  });

  it('places a pointer on the page from where the page is on screen', () => {
    expect(pointOnPage(260, 340, { left: 60, top: 40 }, 2)).toEqual({ x: 100, y: 150 });
  });

  it('fits the widest page to the room there is, within the zoom’s limits', () => {
    expect(fitScale(612, [{ width: 612, height: 792 }])).toBe(1);
    expect(fitScale(918, [{ width: 500, height: 700 }, { width: 612, height: 1008 }])).toBe(1.5);
    expect(fitScale(10, [PAGE])).toBe(0.25);
    expect(fitScale(0, [PAGE])).toBe(1);
    expect(fitScale(800, [])).toBe(1);
  });
});

describe('a field on its page', () => {
  it('keeps a rectangle wholly on the page, at least 4 points each way', () => {
    expect(clampRect({ x: -10, y: -5, width: 50, height: 10 }, PAGE)).toEqual({ x: 0, y: 0, width: 50, height: 10 });
    expect(clampRect({ x: 600, y: 1000, width: 50, height: 10 }, PAGE)).toEqual({ x: 562.12, y: 998.12, width: 50, height: 10 });
    expect(clampRect({ x: 10, y: 10, width: 1, height: 0 }, PAGE)).toEqual({ x: 10, y: 10, width: 4, height: 4 });
    expect(clampRect({ x: 10, y: 10, width: 9999, height: 20 }, PAGE)).toEqual({ x: 0, y: 10, width: 612.12, height: 20 });
  });

  it('rounds to a hundredth of a point, never past the far edge', () => {
    const r = clampRect({ x: 462.123456, y: 3.33333, width: 150.004, height: 16 }, PAGE);
    expect(r).toEqual({ x: 462.12, y: 3.33, width: 150, height: 16 });
    expect(r.x + r.width).toBeLessThanOrEqual(PAGE.width);
  });

  it('moves a field, its size kept, stopped at the edges', () => {
    expect(moveRect(field(), 10.5, -20, PAGE)).toEqual({ x: 110.5, y: 180, width: 150, height: 16 });
    expect(moveRect(field(), -500, 0, PAGE).x).toBe(0);
    expect(moveRect(field(), 1000, 1000, PAGE)).toEqual({ x: 462.12, y: 992.12, width: 150, height: 16 });
  });

  it('resizes by a corner or an edge, the far side staying put', () => {
    expect(resizeRect(field(), 'se', 20, 4, PAGE)).toEqual({ x: 100, y: 200, width: 170, height: 20 });
    expect(resizeRect(field(), 'nw', -10, -10, PAGE)).toEqual({ x: 90, y: 190, width: 160, height: 26 });
    expect(resizeRect(field(), 'e', -30, 99, PAGE)).toEqual({ x: 100, y: 200, width: 120, height: 16 });
    expect(resizeRect(field(), 'n', 0, 5, PAGE)).toEqual({ x: 100, y: 205, width: 150, height: 11 });
  });

  it('never resizes under 4 points or past the page', () => {
    expect(resizeRect(field(), 'w', 400, 0, PAGE)).toEqual({ x: 246, y: 200, width: 4, height: 16 });
    expect(resizeRect(field(), 's', 0, -100, PAGE).height).toBe(4);
    expect(resizeRect(field(), 'e', 1000, 0, PAGE)).toEqual({ x: 100, y: 200, width: 512.12, height: 16 });
    expect(resizeRect(field(), 'nw', -500, -500, PAGE)).toEqual({ x: 0, y: 0, width: 250, height: 216 });
  });

  it('draws a new field as dragged, or the default size centred on a click', () => {
    expect(drawnRect({ x: 300, y: 120 }, { x: 200, y: 100 }, PAGE, { width: 150, height: 16 })).toEqual({ x: 200, y: 100, width: 100, height: 20 });
    expect(drawnRect({ x: 300, y: 100 }, { x: 301, y: 100.5 }, PAGE, { width: 150, height: 16 })).toEqual({ x: 225, y: 92, width: 150, height: 16 });
    // a click at the page's corner: the field stays on the page
    expect(drawnRect({ x: 2, y: 2 }, { x: 2, y: 2 }, PAGE, { width: 150, height: 16 })).toEqual({ x: 0, y: 0, width: 150, height: 16 });
  });

  it('moves half a point with an arrow key, five with Shift', () => {
    expect(arrowDelta('ArrowLeft', false)).toEqual({ x: -0.5, y: 0 });
    expect(arrowDelta('ArrowDown', true)).toEqual({ x: 0, y: 5 });
    expect(arrowDelta('ArrowUp', false)).toEqual({ x: 0, y: -0.5 });
    expect(arrowDelta('Enter', false)).toBeNull();
  });
});

describe('the boxes of a boxes field', () => {
  it('reads groups typed as 4+2+2, which must add up to the boxes', () => {
    expect(parseGroups('4+2+2', 8)).toEqual({ groups: [4, 2, 2] });
    expect(parseGroups(' 2 + 2 + 4 ', 8)).toEqual({ groups: [2, 2, 4] });
    expect(parseGroups('4 2 2', 8)).toEqual({ groups: [4, 2, 2] });
    expect(parseGroups('', 8)).toEqual({ groups: undefined });
    expect(parseGroups('14', 14)).toEqual({ groups: undefined });
    expect(parseGroups('4+2', 8)).toEqual({ error: 'The groups add up to 6: they must add up to the 8 boxes.' });
    expect(parseGroups('4+x', 8)).toEqual({ error: 'Type the groups as numbers joined by +, e.g. 4+2+2.' });
    expect(parseGroups('4+0+4', 8)).toHaveProperty('error');
    expect(groupsText([4, 2, 2])).toBe('4+2+2');
    expect(groupsText(undefined)).toBe('');
  });

  it('keeps groups that still add up when the number of boxes changes, and drops nudges past the end', () => {
    const date = field({ kind: 'boxes', boxes: 8, groups: [4, 2, 2], nudges: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 2, dy: 0 }] });
    const fewer = setBoxCount(date, 6);
    expect(fewer.boxes).toBe(6);
    expect(fewer.groups).toBeUndefined();
    expect(fewer.nudges).toEqual([{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }]);
    expect(setBoxCount(date, 8).groups).toEqual([4, 2, 2]);
    expect(setBoxCount(date, 0).boxes).toBe(1);
    expect(setBoxCount(date, 500).boxes).toBe(60);
  });

  it('finds the box a point is in, the nearest between boxes, none outside the field', () => {
    const id = field({ kind: 'boxes', x: 100, width: 140, boxes: 14 }); // 10 points a box
    expect(boxAt(id, { x: 105, y: 205 })).toBe(0);
    expect(boxAt(id, { x: 235, y: 210 })).toBe(13);
    const gapped = field({ kind: 'boxes', x: 0, width: 50, boxes: 2, boxGap: 10 }); // boxes 0–20 and 30–50
    expect(boxAt(gapped, { x: 24, y: 205 })).toBe(0);
    expect(boxAt(gapped, { x: 27, y: 205 })).toBe(1);
    expect(boxAt(id, { x: 50, y: 205 })).toBeNull();
  });

  it('moves one box on its own, keeping it on the page, and forgets nudges back at nought', () => {
    const id = field({ kind: 'boxes', x: 100, width: 140, boxes: 14 });
    const once = nudgeBox(id, 2, 0.5, -0.5, PAGE);
    expect(once.nudges).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0.5, dy: -0.5 }]);
    expect(pdfFieldBoxes(once)[2]).toMatchObject({ x: 120.5, y: 199.5 });
    expect(pdfFieldBoxes(once)[3]).toMatchObject({ x: 130, y: 200 });
    expect(nudgeBox(once, 2, -0.5, 0.5, PAGE).nudges).toBeUndefined();
    // the first box can't go past the page's left edge
    expect(nudgeBox(id, 0, -500, 0, PAGE).nudges).toEqual([{ dx: -100, dy: 0 }]);
    expect(nudgeBox(id, 20, 1, 1, PAGE)).toBe(id);
  });
});

describe('fields', () => {
  it('makes short ids no other field has', () => {
    const ids = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb-cccc'];
    expect(newFieldId(new Set(['aaaaaaaa']), () => ids.shift()!)).toBe('bbbbbbbb');
    expect(newFieldId(new Set())).toMatch(/^[0-9a-z]{8}$/i);
  });

  it('duplicates a field a little down and to the right, or up and to the left at the corner', () => {
    expect(duplicateField(field(), 'copy0001', PAGE)).toMatchObject({ id: 'copy0001', x: 110, y: 210, tag: 'full_name_ar' });
    const corner = field({ x: 462.12, y: 992.12 });
    expect(duplicateField(corner, 'copy0002', PAGE)).toMatchObject({ x: 452.12, y: 982.12 });
  });

  it('sees no change in what means nothing, and a change in anything else', () => {
    const saved = [field({ bold: false, shrinkToFit: true, align: 'right' })];
    expect(fieldsDirty(saved, [field({ shrinkToFit: true, align: 'right', text: '' })])).toBe(false);
    expect(fieldsDirty(saved, [field({ x: 100.001, shrinkToFit: true, align: 'right' })])).toBe(false);
    expect(fieldsDirty(saved, [field({ x: 100.5, shrinkToFit: true, align: 'right' })])).toBe(true);
    expect(fieldsDirty(saved, [field({ shrinkToFit: true, align: 'center' })])).toBe(true);
    expect(fieldsDirty(saved, [])).toBe(true);
    expect(fieldsDirty([], [])).toBe(false);
    const boxes = field({ kind: 'boxes', boxes: 3 });
    expect(fieldsDirty([boxes], [{ ...boxes, nudges: [{ dx: 0, dy: 0 }] }])).toBe(false);
    expect(fieldsDirty([boxes], [{ ...boxes, nudges: [{ dx: 0, dy: 1 }] }])).toBe(true);
  });

  it('sees a field made optional as a change, and optional turned off as none', () => {
    const saved = [field()];
    expect(fieldsDirty(saved, [field({ optional: true })])).toBe(true);
    expect(fieldsDirty(saved, [field({ optional: false })])).toBe(false);
    expect(fieldsDirty([field({ optional: true })], [field({ optional: true })])).toBe(false);
    expect(cleanField(field({ optional: false }))).not.toHaveProperty('optional');
    expect(cleanField(field({ optional: true }))).toMatchObject({ optional: true });
  });

  it('keeps a field as it is sent: rounded, without empty options, the tag always there', () => {
    expect(cleanField({ ...field({ x: 10.123, bold: false, text: '', groups: [] }), tag: null })).toEqual({
      fontSize: 11,
      height: 16,
      id: 'a1b2c3d4',
      kind: 'text',
      page: 1,
      tag: null,
      width: 150,
      x: 10.12,
      y: 200,
    });
  });

  it('finds the field a refusal names: by its id, its number, or a tag only it prints', () => {
    const fields = [field({ id: 'f1aaaaaa', tag: 'national_id' }), field({ id: 'f2bbbbbb', tag: 'join_date' }), field({ id: 'f3cccccc', tag: 'join_date' })];
    expect(fieldInMessage('Field f2bbbbbb is off the page.', fields)).toBe('f2bbbbbb');
    expect(fieldInMessage('Field 3: the groups must add up to the boxes.', fields)).toBe('f3cccccc');
    expect(fieldInMessage('The national_id field has 15 boxes.', fields)).toBe('f1aaaaaa');
    expect(fieldInMessage('The join_date field is too small.', fields)).toBeNull();
    expect(fieldInMessage('Something went wrong.', fields)).toBeNull();
  });
});
