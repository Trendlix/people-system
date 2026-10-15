import { PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import { PDF_TEMPLATE_PAGES_MAX, type PdfPageSize } from '@trendlix/shared';

// A PDF template's pages as HR sees them in the editor (owner's decision, 15 October 2026): the fields are placed in
// points from the page's top-left corner as it is shown, which is what pdf.js shows (page.getViewport({ scale: 1 })):
// the part of the page its CropBox keeps (within its MediaBox), turned by its /Rotate. The filler draws through the
// same geometry, so a field prints where it was placed whatever the page's boxes and rotation.

/** A page as shown, and how to draw on it in those terms. */
export interface ShownPage {
  width: number;
  height: number;
  /**
   * The transformation (a b c d e f) from the page as shown (x to the right, y up, from its bottom-left corner) to the
   * page's own space, for a "cm" before drawing.
   */
  matrix: [number, number, number, number, number, number];
}

interface Box {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

const boxOf = (r: { x: number; y: number; width: number; height: number }): Box => ({
  left: Math.min(r.x, r.x + r.width),
  bottom: Math.min(r.y, r.y + r.height),
  right: Math.max(r.x, r.x + r.width),
  top: Math.max(r.y, r.y + r.height),
});

/** The page as shown: its CropBox within its MediaBox (as pdf.js takes it), turned by its rotation. */
export function shownPage(page: PDFPage): ShownPage {
  const media = boxOf(page.getMediaBox());
  const crop = boxOf(page.getCropBox());
  const inside = { left: Math.max(media.left, crop.left), bottom: Math.max(media.bottom, crop.bottom), right: Math.min(media.right, crop.right), top: Math.min(media.top, crop.top) };
  const box = inside.right > inside.left && inside.top > inside.bottom ? inside : media;
  const w = box.right - box.left;
  const h = box.top - box.bottom;
  // pdf.js: a rotation that isn't a multiple of 90 is none
  const angle = page.getRotation().angle;
  const rotation = angle % 90 === 0 ? ((angle % 360) + 360) % 360 : 0;
  switch (rotation) {
    case 90: // turned clockwise: the page's left edge is shown at the top
      return { width: h, height: w, matrix: [0, 1, -1, 0, box.right, box.bottom] };
    case 180:
      return { width: w, height: h, matrix: [-1, 0, 0, -1, box.right, box.top] };
    case 270:
      return { width: h, height: w, matrix: [0, -1, 1, 0, box.left, box.top] };
    default:
      return { width: w, height: h, matrix: [1, 0, 0, 1, box.left, box.bottom] };
  }
}

/** A PDF the library can't take as a template, with what HR should do about it. */
export class PdfTemplateError extends Error {}

const SAVE_AGAIN = 'Save it again as a PDF and upload that.';
export const PDF_PROTECTED = 'This PDF is protected. Save an unprotected copy of it and upload that.';

/** Points to two decimals: what the editor works in. */
const points = (n: number) => Math.round(n * 100) / 100;

/**
 * Checks that `data` is a PDF the library can take as a template: readable, not protected, 1 to 20 pages, each with a
 * size. Answers its pages as shown. Throws a PdfTemplateError saying what to do otherwise.
 */
export async function readPdfTemplate(data: Uint8Array): Promise<PdfPageSize[]> {
  let doc: PDFDocument;
  let count: number;
  try {
    doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
    count = doc.isEncrypted ? 0 : doc.getPageCount();
  } catch {
    // not a PDF the library can read, or one without its catalog or page tree
    throw new PdfTemplateError(`This PDF is damaged and can't be read. ${SAVE_AGAIN}`);
  }
  // protected, even with no password to open it: the filler couldn't print on it
  if (doc.isEncrypted) throw new PdfTemplateError(PDF_PROTECTED);
  if (!count) throw new PdfTemplateError(`This PDF has no pages. ${SAVE_AGAIN}`);
  if (count > PDF_TEMPLATE_PAGES_MAX) {
    throw new PdfTemplateError(`This PDF has ${count} pages; a form can have at most ${PDF_TEMPLATE_PAGES_MAX}. Upload only the form's pages.`);
  }
  return doc.getPages().map((page, i) => {
    let shown: ShownPage | null = null;
    try {
      shown = shownPage(page);
    } catch {
      // no MediaBox, or one that isn't a rectangle
    }
    if (!shown || !(shown.width >= 1 && shown.height >= 1) || !Number.isFinite(shown.width) || !Number.isFinite(shown.height)) {
      throw new PdfTemplateError(`Page ${i + 1} of this PDF has no size. ${SAVE_AGAIN}`);
    }
    return { width: points(shown.width), height: points(shown.height) };
  });
}
