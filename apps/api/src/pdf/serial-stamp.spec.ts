import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, type PDFRef } from '@cantoo/pdf-lib';
import { documentSerial } from '@trendlix/shared';
import { describe, expect, it } from 'vitest';
import { stampSerial } from './serial-stamp.js';

// A generated document's serial on every page (owner, 2 November 2026: "print like a serial number on each document
// generated").

/** A page's content streams, decoded, as text. */
function contentOf(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r as PDFRef)) : [contents];
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1'))
    .join('\n');
}

const hex = (text: string) => Buffer.from(text, 'latin1').toString('hex').toUpperCase();

describe('the serial stamp', () => {
  it('prints the serial, the page and the page count at the foot of every page', async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    source.addPage([842, 595]);
    const serial = documentSerial(2026, 42);
    const stamped = await PDFDocument.load(await stampSerial(await source.save(), serial));
    expect(stamped.getPageCount()).toBe(2);
    for (const [i, of] of [
      [0, '1/2'],
      [1, '2/2'],
    ] as const) {
      const text = contentOf(stamped, i);
      expect(text).toContain(hex(serial));
      expect(text).toContain(hex(of));
    }
  });
});
