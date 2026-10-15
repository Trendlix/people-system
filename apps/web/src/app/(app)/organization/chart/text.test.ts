// The org chart's text: widths without a browser, names cut short with "…", and titles wrapped onto lines.
import { describe, expect, it } from 'vitest';
import { cssFont, estimateWidth, FONTS, hasArabic, truncate, wrapText, type Measure } from './text';

/** Every character 10 pixels wide, whatever the font: easy sums. */
const mono: Measure = (text) => Array.from(text).length * 10;

describe('widths', () => {
  it('estimates a width close to Arial’s, wider in bold and in larger text, nothing for nothing', () => {
    expect(estimateWidth('', 'title')).toBe(0);
    const regular = estimateWidth('Senior Content Creator', 'person');
    expect(regular).toBeGreaterThan(80);
    expect(regular).toBeLessThan(140);
    expect(estimateWidth('Head of Marketing', 'department')).toBeGreaterThan(estimateWidth('Head of Marketing', 'person'));
    expect(estimateWidth('WWW', 'person')).toBeGreaterThan(estimateWidth('iii', 'person'));
    expect(estimateWidth('رئيس التسويق', 'titleAr')).toBeGreaterThan(40);
  });

  it('names the canvas font of each kind of text, Arabic ones in an Arabic font', () => {
    expect(cssFont('department')).toBe('700 14px Arial, Helvetica, sans-serif');
    expect(cssFont('titleAr')).toMatch(/^400 11\.5px Tahoma/);
    expect(FONTS.titleAr.arabic).toBe(true);
    expect(hasArabic('مدير')).toBe(true);
    expect(hasArabic('Manager (2)')).toBe(false);
  });
});

describe('cutting short', () => {
  it('leaves a text that fits as it is, trimmed', () => {
    expect(truncate('  Adel Mahmoud ', 200, 'person', mono)).toBe('Adel Mahmoud');
    expect(truncate('Adel Mahmoud', 120, 'person', mono)).toBe('Adel Mahmoud'); // exactly 120
  });

  it('cuts a long one with "…" so that it fits, without a space before the "…"', () => {
    const cut = truncate('Mohamed Abdelrahman Elsayed', 90, 'person', mono);
    expect(cut).toBe('Mohamed…');
    expect(mono(cut, 'person')).toBeLessThanOrEqual(90);
    expect(truncate('Mohamed Abdelrahman', 100, 'person', mono)).toBe('Mohamed A…');
  });

  it('never splits a character made of two, and gives "…" alone when nothing else fits', () => {
    expect(truncate('😀😀😀😀', 30, 'person', mono)).toBe('😀😀…');
    expect(truncate('Anything', 5, 'person', mono)).toBe('…');
  });

  it('cuts Arabic the same way, the "…" at its end', () => {
    expect(truncate('محمد عبد الرحمن السيد', 60, 'personAr', mono)).toBe('محمد…');
  });
});

describe('wrapping', () => {
  it('breaks between words, filling each line', () => {
    expect(wrapText('Senior Content Creator', 140, 'title', mono, 3)).toEqual(['Senior Content', 'Creator']);
    expect(wrapText('  Writer  ', 140, 'title', mono, 3)).toEqual(['Writer']);
    expect(wrapText('', 140, 'title', mono, 3)).toEqual([]);
  });

  it('keeps to the number of lines allowed, the last one ending in "…"', () => {
    const lines = wrapText('Head of Digital Marketing and Brand Communications Strategy', 100, 'title', mono, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Head of');
    expect(lines[1].endsWith('…')).toBe(true);
    for (const l of lines) expect(mono(l, 'title')).toBeLessThanOrEqual(100);
  });

  it('breaks a word longer than a line where it must', () => {
    expect(wrapText('Supercalifragilistic', 80, 'title', mono, 3)).toEqual(['Supercal', 'ifragili', 'stic']);
    // one character wider than the line: kept, rather than looping for ever
    expect(wrapText('W', 5, 'title', mono, 3)).toEqual(['W']);
  });

  it('wraps Arabic between words too', () => {
    expect(wrapText('رئيس قسم التسويق الرقمي', 100, 'titleAr', mono, 3)).toEqual(['رئيس قسم', 'التسويق', 'الرقمي']);
  });
});
