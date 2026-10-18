import { checkedReceipts, RECEIPT_MAX_BYTES } from './receipts.js';

// A claim's receipts (owner, 18 October 2026): photos or PDFs, told by their first bytes, at most five, each at most
// 10 MB, their names cleaned.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n%…');
const file = (buffer: Buffer, originalname: string, size = buffer.length) => ({ buffer, originalname, size });

describe('a claim’s receipts', () => {
  it('are kept as what they really are, with a clean name', () => {
    const { receipts, problems } = checkedReceipts([file(PNG, 'taxi.png'), file(PDF, 'bill.jpg'), file(JPEG, '../../etc/la‮gpj.exe')]);
    expect(problems).toEqual([]);
    expect(receipts.map((r) => [r.fileName, r.mimeType, r.sizeBytes])).toEqual([
      ['taxi.png', 'image/png', PNG.length],
      ['bill.pdf', 'application/pdf', PDF.length],
      ['lagpj.exe.jpg', 'image/jpeg', JPEG.length],
    ]);
  });

  it('may be none', () => {
    expect(checkedReceipts(undefined)).toEqual({ receipts: [], problems: [] });
    expect(checkedReceipts([])).toEqual({ receipts: [], problems: [] });
  });

  it('refuses each one that is empty, too large or neither a photo nor a PDF, by its place and name', () => {
    const { receipts, problems } = checkedReceipts([
      file(PNG, 'fine.png'),
      file(Buffer.alloc(0), 'empty.png'),
      file(PNG, 'huge.png', RECEIPT_MAX_BYTES + 1),
      file(Buffer.from('GIF89a......'), 'animation.gif'),
      file(Buffer.from('<svg/>'), ''),
    ]);
    expect(receipts.map((r) => r.fileName)).toEqual(['fine.png']);
    expect(problems).toEqual([
      'Receipt 2 (empty.png) is empty.',
      'Receipt 3 (huge.png) must be 10 MB or smaller.',
      'Receipt 4 (animation.gif) must be a JPEG, PNG or WebP photo, or a PDF.',
      'Receipt 5 must be a JPEG, PNG or WebP photo, or a PDF.',
    ]);
  });

  it('are five at most', () => {
    expect(checkedReceipts(Array.from({ length: 6 }, (_, i) => file(PNG, `r${i}.png`))).problems).toEqual(['Attach at most 5 receipts.']);
    expect(checkedReceipts(Array.from({ length: 5 }, (_, i) => file(PNG, `r${i}.png`))).problems).toEqual([]);
  });
});
