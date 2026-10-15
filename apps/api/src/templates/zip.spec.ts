import { patchCentral } from '../../test/fixtures/docx.js';
import { readZip, writeZip, ZipError, type ZipProblem } from './zip.js';

/** The problem readZip (and reading every entry) finds with `data`, or null. */
function problemOf(data: Buffer, limits?: Parameters<typeof readZip>[1]): ZipProblem | null {
  try {
    const zip = readZip(data, limits);
    for (const e of zip.entries) zip.read(e.name);
    return null;
  } catch (err) {
    if (err instanceof ZipError) return err.problem;
    throw err;
  }
}

describe('zip', () => {
  it('reads back what it wrote, stored and deflated, with UTF-8 names', () => {
    const text = 'مرحبا {{full_name_ar}} '.repeat(200);
    const zip = writeZip([
      { name: 'word/document.xml', data: text },
      { name: 'media/صورة.bin', data: Buffer.from([0, 1, 2, 3, 255]), store: true },
      { name: 'empty.txt', data: '' },
    ]);
    const read = readZip(zip);
    expect(read.entries.map((e) => [e.name, e.method])).toEqual([
      ['word/document.xml', 8],
      ['media/صورة.bin', 0],
      ['empty.txt', 8],
    ]);
    expect(read.read('word/document.xml')!.toString('utf8')).toBe(text);
    expect([...read.read('media/صورة.bin')!]).toEqual([0, 1, 2, 3, 255]);
    expect(read.read('empty.txt')!.length).toBe(0);
    expect(read.has('nothing.xml')).toBe(false);
    expect(read.read('nothing.xml')).toBeNull();
  });

  it('copies entries from another zip as they are stored, byte for byte', () => {
    const text = '<w:document>نص</w:document>'.repeat(50);
    const original = writeZip([
      { name: 'word/document.xml', data: text },
      { name: 'word/media/image1.png', data: Buffer.from([137, 80, 78, 71, 0, 255]), store: true },
      { name: 'word/', data: '', store: true },
    ]);
    const zip = readZip(original);
    expect(zip.raw('nothing.xml')).toBeNull();
    const deflated = zip.raw('word/document.xml')!;
    expect(deflated).toMatchObject({ method: 8, size: Buffer.byteLength(text) });
    expect(deflated.data.length).toBeLessThan(deflated.size);

    // copied as they are, in the same order and with the same dates, the zip comes out the same
    const copy = writeZip(zip.entries.map((e) => ({ name: e.name, raw: zip.raw(e.name)! })));
    expect(copy.equals(original)).toBe(true);

    // copied next to an entry written afresh
    const mixed = readZip(writeZip([{ name: 'word/media/image1.png', raw: zip.raw('word/media/image1.png')! }, { name: 'word/document.xml', data: '<w:document/>' }]));
    expect(mixed.raw('word/media/image1.png')!.data.equals(zip.raw('word/media/image1.png')!.data)).toBe(true);
    expect([...mixed.read('word/media/image1.png')!]).toEqual([137, 80, 78, 71, 0, 255]);
    expect(mixed.read('word/document.xml')!.toString('utf8')).toBe('<w:document/>');
  });

  it('always writes the same bytes for the same files', () => {
    const files = [{ name: 'a.xml', data: '<a/>' }];
    expect(writeZip(files).equals(writeZip(files))).toBe(true);
  });

  it('refuses what is not a zip', () => {
    expect(problemOf(Buffer.from('%PDF-1.4\n%%EOF\n'))).toBe('not_zip');
    expect(problemOf(Buffer.alloc(0))).toBe('not_zip');
    expect(problemOf(Buffer.from('PK'))).toBe('not_zip');
  });

  it('refuses encrypted entries and zip64', () => {
    const zip = writeZip([{ name: 'a.xml', data: '<a/>' }]);
    expect(problemOf(patchCentral(zip, 'a.xml', (z, at) => z.writeUInt16LE(z.readUInt16LE(at + 8) | 1, at + 8)))).toBe('encrypted');
    expect(problemOf(patchCentral(zip, 'a.xml', (z, at) => z.writeUInt16LE(99, at + 10)))).toBe('encrypted'); // AES
    expect(problemOf(patchCentral(zip, 'a.xml', (z, at) => z.writeUInt32LE(0xffffffff, at + 24)))).toBe('zip64');
    const end = Buffer.from(zip);
    end.writeUInt16LE(0xffff, end.length - 22 + 10);
    expect(problemOf(end)).toBe('zip64');
  });

  it('refuses compression Word does not use', () => {
    const zip = writeZip([{ name: 'a.xml', data: '<a/>' }]);
    expect(problemOf(patchCentral(zip, 'a.xml', (z, at) => z.writeUInt16LE(12, at + 10)))).toBe('unsupported_method'); // bzip2
  });

  it('guards against zip bombs: the file size, the number of entries and the expanded size', () => {
    const small = { maxBytes: 1000, maxEntries: 2000, maxExpandedBytes: 50 * 1024 * 1024 };
    expect(problemOf(writeZip([{ name: 'a.bin', data: Buffer.alloc(5000, 7), store: true }]), small)).toBe('too_large');

    const many = writeZip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.xml`, data: '', store: true })));
    expect(problemOf(many)).toBe('too_many_entries');
    expect(problemOf(writeZip(Array.from({ length: 2000 }, (_, i) => ({ name: `f${i}.xml`, data: '', store: true }))))).toBeNull();

    // a fake bomb: a tiny entry whose header says it expands to 60 MB is refused before anything is inflated
    const declared = patchCentral(writeZip([{ name: 'word/document.xml', data: '<w:document/>' }]), 'word/document.xml', (z, at) =>
      z.writeUInt32LE(60 * 1024 * 1024, at + 24),
    );
    expect(problemOf(declared)).toBe('expands_too_much');

    // and many entries that together expand past 50 MB
    const pieces = writeZip(Array.from({ length: 51 }, (_, i) => ({ name: `m${i}.bin`, data: Buffer.alloc(1024 * 1024) })));
    expect(pieces.length).toBeLessThan(100_000); // the file itself is small
    expect(problemOf(pieces)).toBe('expands_too_much');
  });

  it('never inflates an entry past the size its header declares', () => {
    // 4 MB of zeros, with headers claiming 100 bytes
    const lying = patchCentral(writeZip([{ name: 'word/document.xml', data: Buffer.alloc(4 * 1024 * 1024) }]), 'word/document.xml', (z, at) =>
      z.writeUInt32LE(100, at + 24),
    );
    expect(problemOf(lying)).toBe('expands_too_much');
  });

  it('refuses damaged entries', () => {
    const zip = writeZip([{ name: 'a.xml', data: '<a>some text</a>' }]);
    expect(problemOf(patchCentral(zip, 'a.xml', (z, at) => z.writeUInt32LE((z.readUInt32LE(at + 16) ^ 1) >>> 0, at + 16)))).toBe('damaged'); // CRC
    expect(problemOf(patchCentral(zip, 'a.xml', (z, at) => z.writeUInt32LE(1_000_000, at + 42)))).toBe('damaged'); // offset
    const twice = writeZip([
      { name: 'a.xml', data: '<a/>' },
      { name: 'a.xml', data: '<b/>' },
    ]);
    expect(problemOf(twice)).toBe('damaged');
  });
});
