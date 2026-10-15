import { docx, footerXml, p, r } from '../../test/fixtures/docx.js';
import { paragraphTexts, readDocx } from './docx-tags.js';
import { MapFieldsError, mapFields, partLabel, templateLines } from './map-fields.js';
import { mappedFileName } from './template-file.js';
import { readZip } from './zip.js';

const file = docx({
  body: p(r('Name: ......')) + '<w:p/>' + p(r('{{phone}} and {{x}}')),
  parts: { 'word/footer1.xml': footerXml(p(r('Page'))), 'word/styles.xml': '<w:styles/>' },
});

/** The message mapFields refuses these edits with. */
function refusal(edits: Parameters<typeof mapFields>[1]): string {
  try {
    mapFields(file, edits);
  } catch (err) {
    if (err instanceof MapFieldsError) return err.message;
    throw err;
  }
  throw new Error('not refused');
}

describe('Map Fields on a file', () => {
  it('numbers the lines with text within each part, as the tag reader reads them', () => {
    const lines = templateLines(file, 'en');
    expect(lines.map((l) => [l.id, l.partLabel, l.index, l.text])).toEqual([
      ['word/document.xml#0', 'Body', 0, 'Name: ......'],
      ['word/document.xml#1', 'Body', 1, '{{phone}} and {{x}}'],
      ['word/footer1.xml#0', 'Footer', 0, 'Page'],
    ]);
    expect(lines[1].tags).toEqual([
      { tag: 'phone', from: 0, to: 9, known: true },
      { tag: 'x', from: 14, to: 19, known: false },
    ]);
    expect(lines[0].suggestions).toEqual([{ tag: 'full_name_en', from: 6, to: 12, label: 'Name', text: '{{full_name_en}}' }]);
  });

  it('makes the edits, copying the parts not edited byte for byte', () => {
    const out = mapFields(file, [
      { line: 'word/document.xml#0', from: 6, to: 12, text: '{{ full_name_en }}' },
      { line: 'word/document.xml#1', from: 14, to: 19, text: '' },
      { line: 'word/document.xml#1', from: 0, to: 9, text: '{{work_email}} ' },
      { line: 'word/footer1.xml#0', from: 4, to: 4, text: ' {{employee_code}}' },
    ]);
    expect([out.inserted, out.changed, out.removed]).toEqual([2, 1, 1]);
    const zip = readZip(out.file);
    expect(paragraphTexts(zip.read('word/document.xml')!.toString('utf8'))).toEqual(['Name: {{full_name_en}}', '{{work_email}}  and ']);
    expect(paragraphTexts(zip.read('word/footer1.xml')!.toString('utf8'))).toEqual(['Page {{employee_code}}']);
    const before = readZip(file);
    expect(zip.entries.map((e) => e.name)).toEqual(before.entries.map((e) => e.name));
    expect(zip.raw('word/styles.xml')!.data.equals(before.raw('word/styles.xml')!.data)).toBe(true);
    expect(readDocx(out.file)).toEqual({ tags: ['full_name_en', 'work_email', 'employee_code'], unknownTags: [], broken: [] });
  });

  it('refuses what would change the wording, naming the line', () => {
    expect(refusal([])).toBe('Make at least one change.');
    expect(refusal([{ line: 'word/footer1.xml#0', from: 0, to: 4, text: '{{date}}' }])).toBe(
      "Line 1 of the footer: only a tag or a blank (dots, dashes or underscores) can be replaced. The template's wording is never changed.",
    );
    expect(refusal([{ line: 'word/document.xml#1', from: 1, to: 1, text: '{{date}}' }])).toBe("Line 2 of the body: a tag can't go inside another tag.");
    expect(refusal([{ line: 'word/document.xml#1', from: 0, to: 9, text: '{{x}}' }])).toBe("Line 2 of the body: {{x}} isn't a tag the system knows.");
    expect(refusal([{ line: 'word/document.xml#2', from: 0, to: 0, text: '{{date}}' }])).toBe(
      'There is no line "word/document.xml#2" in this version. Reload the page and try again.',
    );
  });

  it('names the parts, and the new file after the version it was made from', () => {
    expect(['word/document.xml', 'word/header2.xml', 'word/footer.xml', 'word/footnotes.xml', 'word/endnotes.xml'].map(partLabel)).toEqual([
      'Body',
      'Header',
      'Footer',
      'Footnotes',
      'Endnotes',
    ]);
    expect(mappedFileName('عقد العمل.docx')).toBe('عقد العمل (fields mapped).docx');
    expect(mappedFileName('NDA (fields mapped).docx')).toBe('NDA (fields mapped).docx');
    const long = mappedFileName(`${'x'.repeat(200)}.docx`);
    expect([long.length, long.endsWith('x (fields mapped).docx')]).toEqual([120, true]);
  });
});
