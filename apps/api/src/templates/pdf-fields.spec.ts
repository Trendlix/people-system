import { PDF_FIELDS_MAX, type PdfField, type PdfPageSize } from '@trendlix/shared';
import { pdfFieldsProblem, pdfFieldTags, plainPdfFields } from './pdf-fields.js';

// The fields placed on a PDF template, checked before they are saved (owner's decision, 15 October 2026): each problem
// named by the field's tag (else its kind) and page.

const PAGES: PdfPageSize[] = [
  { width: 612, height: 1008 },
  { width: 612, height: 1008 },
];

const text = (f: Partial<PdfField> = {}): PdfField => ({ id: 'name', kind: 'text', tag: 'full_name_ar', page: 1, x: 300, y: 300, width: 180, height: 13, fontSize: 11, ...f });
const boxes = (f: Partial<PdfField> = {}): PdfField => ({ id: 'nid', kind: 'boxes', tag: 'national_id', page: 1, x: 200, y: 280, width: 280, height: 20, fontSize: 12, boxes: 14, ...f });
const problem = (...fields: PdfField[]) => pdfFieldsProblem(fields, PAGES);

describe('pdfFieldsProblem', () => {
  it('takes good fields of every kind, and none at all', () => {
    expect(
      problem(
        text({ align: 'right', shrinkToFit: true, bold: true }),
        boxes({ groups: [2, 12], groupGap: 4, boxGap: 0, nudges: [{ dx: -1.5, dy: 0 }], boxAlign: 'left', dateOrder: 'DMY', arabicDigits: false }),
        { id: 'c1', kind: 'check', tag: null, page: 1, x: 397, y: 108, width: 20, height: 20, fontSize: 14 },
        { id: 'c2', kind: 'check', tag: 'employment_type_ar', equals: 'دوام كامل', text: 'X', page: 2, x: 10, y: 10, width: 20, height: 20, fontSize: 14 },
        { id: 'f1', kind: 'fixed', tag: null, text: 'مكتب الدقي', page: 2, x: 0, y: 0, width: 612, height: 1008, fontSize: 36 },
      ),
    ).toBeNull();
    expect(problem()).toBeNull();
    // a box drawn on the very edge may stick out by a point
    expect(problem(text({ x: -1, y: 1008 - 12, width: 613 }))).toBeNull();
  });

  it('refuses an unknown kind, and text or boxes without a tag the system knows', () => {
    expect(problem(text({ kind: 'signature' as PdfField['kind'], tag: null }))).toBe('A field on page 1 is of an unknown kind. Choose text, boxes, a check box or fixed text.');
    expect(problem(text({ tag: null }))).toBe('A text field on page 1 prints nothing: choose the field it prints.');
    expect(problem(boxes({ tag: 'salary', page: 2 }))).toBe("A boxes on page 2 prints {{salary}}, which the system doesn't know. Choose another field.");
  });

  it('refuses a check box on an unknown tag or without the value that ticks it, and a fixed text without text or with a tag', () => {
    const check = (f: Partial<PdfField>): PdfField => ({ id: 'c', kind: 'check', tag: null, page: 1, x: 10, y: 10, width: 20, height: 20, fontSize: 12, ...f });
    expect(problem(check({ tag: 'gender', equals: 'ذكر' }))).toBe("A check box on page 1 depends on {{gender}}, which the system doesn't know. Choose another field.");
    expect(problem(check({ tag: 'employment_type_ar', equals: ' ' }))).toBe('The check box for "Employment type (Arabic)" on page 1 needs the value that ticks it.');
    const fixed = (f: Partial<PdfField>): PdfField => ({ id: 'f', kind: 'fixed', tag: null, page: 1, x: 10, y: 10, width: 100, height: 20, fontSize: 12, ...f });
    expect(problem(fixed({ text: '  ' }))).toBe('A fixed text on page 1 has no text: type what it prints.');
    expect(problem(fixed({ text: 'مكتب', tag: 'full_name_ar' }))).toBe('The fixed text for "Full name (Arabic)" on page 1 prints its own text, not a field: remove the field from it.');
  });

  it('refuses a page the form doesn’t have, no size, and a field past the page’s edge', () => {
    expect(problem(text({ page: 3 }))).toBe('The text field for "Full name (Arabic)" is on page 3, but the form has 2 pages.');
    expect(pdfFieldsProblem([text({ page: 2 })], [PAGES[0]])).toBe('The text field for "Full name (Arabic)" is on page 2, but the form has 1 page.');
    expect(problem(text({ page: 1.5 }))).toMatch(/is on page 1\.5, but the form has 2 pages\.$/);
    expect(problem(text({ width: 0 }))).toBe('The text field for "Full name (Arabic)" on page 1 has no size: draw it again.');
    expect(problem(text({ height: Number.NaN }))).toMatch(/has no size/);
    expect(problem(text({ x: 500, width: 120 }))).toBe('The text field for "Full name (Arabic)" on page 1 goes past the edge of the page: move it inside the page.');
    expect(problem(text({ y: -2 }))).toMatch(/goes past the edge of the page/);
  });

  it('refuses a text size outside 5 to 36 points, and an unknown alignment', () => {
    expect(problem(text({ fontSize: 4.9 }))).toBe('The text field for "Full name (Arabic)" on page 1: choose a text size of 5 to 36 points.');
    expect(problem(text({ fontSize: 37 }))).toMatch(/choose a text size of 5 to 36 points/);
    expect(problem(text({ align: 'justify' as PdfField['align'] }))).toBe('The text field for "Full name (Arabic)" on page 1: align it right, center or left.');
  });

  it('refuses boxes that aren’t 1 to 40, groups that don’t add up, negative gaps and nudges too many or too far', () => {
    const name = 'The boxes for "National ID number" on page 1';
    expect(problem(boxes({ boxes: 0 }))).toBe(`${name} must cover 1 to 40 boxes.`);
    expect(problem(boxes({ boxes: 41 }))).toBe(`${name} must cover 1 to 40 boxes.`);
    expect(problem(boxes({ boxes: 2.5 }))).toBe(`${name} must cover 1 to 40 boxes.`);
    expect(problem(boxes({ groups: [4, 2, 2] }))).toBe(`${name}: its groups add up to 8 boxes, not 14.`);
    expect(problem(boxes({ groups: [14, 0] }))).toBe(`${name}: each group needs 1 box or more.`);
    expect(problem(boxes({ boxGap: -0.5 }))).toBe(`${name}: the space between boxes can't be less than 0.`);
    expect(problem(boxes({ groupGap: -1 }))).toBe(`${name}: the space between boxes can't be less than 0.`);
    expect(problem(boxes({ boxes: 2, width: 40, nudges: [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }] }))).toBe(`${name} has more moved boxes than boxes.`);
    expect(problem(boxes({ nudges: [{ dx: 20.5, dy: 0 }] }))).toBe(`${name}: a box can be moved by at most 20 points.`);
    expect(problem(boxes({ nudges: [{ dx: 0, dy: -21 }] }))).toBe(`${name}: a box can be moved by at most 20 points.`);
    expect(problem(boxes({ boxAlign: 'middle' as 'left' }))).toBe(`${name}: start the value in the left-most or the right-most box.`);
    expect(problem(boxes({ dateOrder: 'MDY' as 'DMY' }))).toBe(`${name}: put the date in its boxes as YMD or DMY.`);
    expect(problem(boxes({ amountPart: 'cents' as 'pounds' }))).toBe(`${name}: print the pounds or the piastres of the amount.`);
  });

  it('refuses the same id twice, ids and texts too long, and more than 300 fields', () => {
    expect(problem(text(), boxes({ id: 'name' }))).toBe('Two fields have the id "name": each field needs its own.');
    expect(problem(text({ id: 'x'.repeat(41) }))).toBe('The text field for "Full name (Arabic)" on page 1 needs an id of 1 to 40 characters.');
    expect(problem(text({ id: '' }))).toMatch(/needs an id of 1 to 40 characters/);
    const fixed: PdfField = { id: 'f', kind: 'fixed', tag: null, text: 'x'.repeat(201), page: 1, x: 10, y: 10, width: 100, height: 20, fontSize: 12 };
    expect(problem(fixed)).toBe('A fixed text on page 1: keep its text to 200 characters or fewer.');
    const check: PdfField = { id: 'c', kind: 'check', tag: 'employment_type_ar', equals: 'x'.repeat(101), page: 1, x: 10, y: 10, width: 20, height: 20, fontSize: 12 };
    expect(problem(check)).toBe('The check box for "Employment type (Arabic)" on page 1: keep the value that ticks it to 100 characters or fewer.');
    const many = Array.from({ length: PDF_FIELDS_MAX + 1 }, (_, i) => text({ id: `f${i}` }));
    expect(pdfFieldsProblem(many, PAGES)).toBe('A form can have at most 300 fields; this one has 301.');
    expect(pdfFieldsProblem(many.slice(1), PAGES)).toBeNull();
  });
});

describe('pdfFieldTags', () => {
  it('lists the tags printed, each once, down the pages: by page, then from the top, then from the left', () => {
    const fields: PdfField[] = [
      text({ id: 'a', tag: 'address', page: 2, y: 10 }),
      boxes({ id: 'b', tag: 'national_id', y: 280, x: 200 }),
      text({ id: 'c', tag: 'full_name_ar', y: 280, x: 100 }),
      { id: 'd', kind: 'check', tag: 'employment_type_ar', equals: 'دوام كامل', page: 1, x: 10, y: 50, width: 20, height: 20, fontSize: 12 },
      { id: 'e', kind: 'check', tag: null, page: 1, x: 10, y: 5, width: 20, height: 20, fontSize: 12 },
      { id: 'f', kind: 'fixed', tag: null, text: 'x', page: 1, x: 10, y: 1, width: 20, height: 20, fontSize: 12 },
      boxes({ id: 'g', tag: 'national_id', y: 900 }),
    ];
    expect(pdfFieldTags(fields)).toEqual(['employment_type_ar', 'full_name_ar', 'national_id', 'address']);
    expect(pdfFieldTags([])).toEqual([]);
  });
});

describe('plainPdfFields', () => {
  it('keeps only what a field has, as plain objects', () => {
    const sent = Object.assign(Object.create({ inherited: true }) as object, boxes({ nudges: [{ dx: 1, dy: 2 }], groups: [7, 7] }), { text: undefined });
    const [plain] = plainPdfFields([sent as PdfField]);
    expect(plain).toEqual({ id: 'nid', kind: 'boxes', tag: 'national_id', page: 1, x: 200, y: 280, width: 280, height: 20, fontSize: 12, boxes: 14, groups: [7, 7], nudges: [{ dx: 1, dy: 2 }] });
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(plainPdfFields([{ ...text(), tag: undefined as unknown as null }])[0].tag).toBeNull();
  });
});
