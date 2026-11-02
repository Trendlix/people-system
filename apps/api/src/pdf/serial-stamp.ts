import { degrees, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { serialStampText } from '@trendlix/shared';

// A generated document's serial on every page (owner, 2 November 2026: "print like a serial number on each document
// generated … and when uploaded verify the document from the OCR and the Serial Printed"): at the foot of the page, on
// the left, in a bold fixed-width font OCR reads well, with the page and the page count ("DOC-2026-000123-4 · 1/3").
// Inside the page's visible area (its crop box), upright however the page is turned. Before the PDF is protected.

const SIZE = 9;
const MARGIN = 28; // from the left edge, in points
const FOOT = 16; // from the bottom edge, in points

export async function stampSerial(pdf: Uint8Array, serial: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.CourierBold);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const text = serialStampText(serial, i + 1, pages.length);
    const box = page.getCropBox();
    const turn = ((page.getRotation().angle % 360) + 360) % 360;
    // the foot of the page as it is shown, wherever that is on a turned page
    const at =
      turn === 90
        ? { x: box.x + box.width - FOOT, y: box.y + MARGIN, rotate: 90 }
        : turn === 180
          ? { x: box.x + box.width - MARGIN, y: box.y + box.height - FOOT, rotate: 180 }
          : turn === 270
            ? { x: box.x + FOOT, y: box.y + box.height - MARGIN, rotate: 270 }
            : { x: box.x + MARGIN, y: box.y + FOOT, rotate: 0 };
    page.drawText(text, { x: at.x, y: at.y, size: SIZE, font, color: rgb(0, 0, 0), rotate: degrees(at.rotate) });
  });
  return Buffer.from(await doc.save());
}
