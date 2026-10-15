import { deflateSync } from 'node:zlib';
import { countPdfPages } from './pdf-pages.js';

/** A PDF with these objects (numbered from 1), a cross-reference table and a trailer. */
function pdf(objects: string[], trailer = '/Root 1 0 R'): string {
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  return `${body}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
}

const page = (parent: number) => `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 595 842] >>`;
const count = (text: string | Buffer) => countPdfPages(Buffer.isBuffer(text) ? text : Buffer.from(text, 'latin1'));

describe('counting the pages of a PDF', () => {
  it('reads the count of the page tree named by the catalog', () => {
    const three = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>', page(2), page(2), page(2)]);
    expect(count(three)).toBe(3);
    const one = pdf(['<< /Type /Catalog /Pages 2 0 R /PageLabels 4 0 R >>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', page(2), '<< /Nums [0 << /S /D >>] >>']);
    expect(count(one)).toBe(1);
  });

  it('counts the pages under the root of a tree with branches, not the branches', () => {
    const tree = pdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 5 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 6 0 R] /Count 2 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [7 0 R 8 0 R 9 0 R] /Count 3 >>',
      page(3), page(3), page(4), page(4), page(4),
    ]);
    expect(count(tree)).toBe(5);
  });

  it('finds the objects inside compressed object streams, with a cross-reference stream', () => {
    // objects 2 (catalog), 3 (pages) and 4, 5 (pages) in one object stream, object 1; then the cross-reference stream
    const inside = ['<< /Type /Catalog /Pages 3 0 R >>', '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>', page(3), page(3)];
    let header = '';
    let content = '';
    inside.forEach((object, i) => {
      header += `${i + 2} ${content.length} `;
      content += `${object}\n`;
    });
    const packed = deflateSync(Buffer.from(header + content, 'latin1'));
    const xref = deflateSync(Buffer.from([1, 0, 15, 0, 2, 0, 1, 0]));
    const file = Buffer.concat([
      Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N 4 /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, 'latin1'),
      packed,
      Buffer.from(`\nendstream\nendobj\n6 0 obj\n<< /Type /XRef /Size 7 /W [1 2 1] /Root 2 0 R /Filter /FlateDecode /Length ${xref.length} >>\nstream\n`, 'latin1'),
      xref,
      Buffer.from('\nendstream\nendobj\nstartxref\n0\n%%EOF\n', 'latin1'),
    ]);
    expect(count(file)).toBe(2);
  });

  it('takes the latest copy of an object and the latest trailer, as for a PDF saved again with changes appended', () => {
    const original = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>', page(2), page(2), page(2)]);
    const update = '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\nxref\n2 1\n0000000000 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R /Prev 9 >>\nstartxref\n0\n%%EOF\n';
    expect(count(original + update)).toBe(2);
    // a new catalog, named by the new trailer
    const recatalogued = '6 0 obj\n<< /Type /Catalog /Pages 7 0 R >>\nendobj\n7 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\ntrailer\n<< /Size 8 /Root 6 0 R >>\nstartxref\n0\n%%EOF\n';
    expect(count(original + recatalogued)).toBe(1);
  });

  it('keeps the catalog of the first trailer when the last one names none (a linearized PDF)', () => {
    const file = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', page(2), page(2)]);
    expect(count(`${file}trailer\n<< /Size 5 >>\nstartxref\n0\n%%EOF\n`)).toBe(2);
  });

  it('finds the catalog by its type when there is no trailer', () => {
    expect(count('%PDF-1.4\n1 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n2 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n')).toBe(1);
  });

  it('takes nothing inside a stream for an object or a trailer', () => {
    const fake = '9 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 9 0 R >>\nstartxref\n';
    const content = `<< /Length ${fake.length} >>\nstream\n${fake}\nendstream`;
    const file = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', page(2), page(2), content]);
    expect(count(file)).toBe(2);
  });

  it('reads past an object without "endobj"', () => {
    const file = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n';
    expect(count(file)).toBe(1);
  });

  it('stays quick on damaged or hostile files, and opens no object stream larger than 64 MB', () => {
    const started = performance.now();
    expect(count(`%PDF-1.4\n${'1 0 obj\n<< /A 1 >>\n'.repeat(200_000)}`)).toBeNull(); // no "endobj" anywhere
    expect(count(`%PDF-1.4\n${'trailer\n<< /Root 1 0 R >>\n'.repeat(200_000)}`)).toBeNull(); // no "startxref"
    const bomb = deflateSync(Buffer.alloc(80 * 1024 * 1024)); // 80 MB of zeros, about 80 KB compressed
    const file = Buffer.concat([
      Buffer.from('%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n', 'latin1'),
      bomb,
      Buffer.from('\nendstream\nendobj\n2 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n3 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\ntrailer\n<< /Root 2 0 R >>\n', 'latin1'),
    ]);
    expect(count(file)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('says it cannot tell rather than guess', () => {
    expect(count('%PDF-1.4\n% MARK:X\n%%EOF\n')).toBeNull();
    expect(count(pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 4 0 R >>', page(2), '1']))).toBeNull(); // the count elsewhere
    expect(count(pdf(['<< /Type /Catalog >>']))).toBeNull();
    expect(count(pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>']))).toBeNull();
    // the catalog in an object stream that cannot be opened (encrypted)
    const scrambled = Buffer.from('not a zlib stream at all');
    const file = Buffer.concat([
      Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N 2 /First 10 /Filter /FlateDecode /Length ${scrambled.length} >>\nstream\n`, 'latin1'),
      scrambled,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 2 0 R /Encrypt 3 0 R >>\n%%EOF\n', 'latin1'),
    ]);
    expect(count(file)).toBeNull();
  });
});
