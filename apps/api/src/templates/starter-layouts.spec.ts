import { createHash } from 'node:crypto';
import { pdfFieldsProblem } from './pdf-fields.js';
import { STARTER_LAYOUTS, starterLayoutFor, type StarterLayout } from './starter-layouts.js';

// Starter layouts (owner's decision, 15 October 2026): the fields of a known form, placed when that form (the same
// file, or the same pages) is uploaded to its slot.

const FILE = Buffer.from('%PDF-1.7 the owner’s Form 1');
const PAGES = [{ width: 612, height: 1008 }];
const LAYOUT: StarterLayout = {
  slotKey: 'insurance_form_1',
  sha256: [createHash('sha256').update(FILE).digest('hex').toUpperCase()], // compared whatever its case
  pages: PAGES,
  note: 'Form 1 (test)',
  fields: [{ id: 'name', kind: 'text', tag: 'full_name_ar', page: 1, x: 300, y: 300, width: 180, height: 13, fontSize: 11 }],
};
const OTHER = Buffer.from('%PDF-1.7 another file');

describe('starterLayoutFor', () => {
  it('finds the layout of exactly this file in this slot', () => {
    expect(starterLayoutFor('insurance_form_1', FILE, [{ width: 595, height: 842 }], [LAYOUT])).toBe(LAYOUT);
    expect(starterLayoutFor('insurance_form_6', FILE, PAGES, [LAYOUT])).toBeNull();
  });

  it('finds it for another file of the slot with the same pages (the form saved again), to 1 pt', () => {
    expect(starterLayoutFor('insurance_form_1', OTHER, [{ width: 612.6, height: 1007.4 }], [LAYOUT])).toBe(LAYOUT);
    expect(starterLayoutFor('insurance_form_1', OTHER, [{ width: 595, height: 842 }], [LAYOUT])).toBeNull();
    expect(starterLayoutFor('insurance_form_1', OTHER, [...PAGES, ...PAGES], [LAYOUT])).toBeNull();
  });

  it('knows the owner’s Forms 1 and 6, each placed inside its pages', () => {
    expect(STARTER_LAYOUTS.map((l) => l.slotKey)).toEqual(['insurance_form_1', 'insurance_form_6']);
    for (const l of STARTER_LAYOUTS) {
      expect(pdfFieldsProblem(l.fields, l.pages)).toBeNull();
      expect(l.sha256.every((s) => /^[0-9a-f]{64}$/.test(s))).toBe(true);
    }
    expect(starterLayoutFor('insurance_form_1', OTHER, STARTER_LAYOUTS[0].pages)).toBe(STARTER_LAYOUTS[0]);
    expect(starterLayoutFor('nda', OTHER, STARTER_LAYOUTS[0].pages)).toBeNull();
  });
});
