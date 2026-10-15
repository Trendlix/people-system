import { jfifDpi } from '@/app/(app)/employees/scan/card';
import { canvasOf, ctxOf, loadBitmap, toBlob } from '@/app/(app)/employees/scan/image';
import { adjustedName, cutSize, fitUnder, MAX_SIDE, type Rect } from '@/lib/page-frame';
import { jpegInfo, pdfOverhead, printDpi, writePdf, type Paper } from '@/lib/pdf-writer';

// The canvas work of the document adjuster: opening a page, drawing what a frame holds, and making the adjusted file.
// The arithmetic is in lib/page-frame.ts, the PDF in lib/pdf-writer.ts; the canvas helpers of the ID scan are used as
// they are (employees/scan/image.ts).

/**
 * The most points a page is opened at: a phone's 48-megapixel photo is made smaller (still more than an adjusted page
 * keeps, MAX_SIDE), and the largest canvas some browsers draw (iPhones: 16.7 million points) is never passed.
 */
export const MAX_AREA = 16_000_000;

/** A page's own size once opened: at most MAX_AREA points. */
export function openedSize(w: number, h: number): [number, number] {
  const k = Math.min(1, Math.sqrt(MAX_AREA / (w * h)));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** A picture of a page, as given (a photo or a page of a PDF), opened on a canvas turned clockwise by `quarter` degrees. */
export async function openPage(source: Blob, quarter: number): Promise<HTMLCanvasElement> {
  const bmp = await loadBitmap(source);
  try {
    const [w, h] = openedSize(bmp.width, bmp.height);
    const side = quarter === 90 || quarter === 270;
    const cv = canvasOf(side ? h : w, side ? w : h);
    const ctx = ctxOf(cv);
    ctx.fillStyle = '#fff'; // a transparent PNG would turn black as JPEG
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.rotate((quarter * Math.PI) / 180);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    return cv;
  } finally {
    bmp.close?.();
  }
}

/** The long side of a page's small picture (the list of pages). */
const THUMB_SIDE = 320;

/** A page's small picture, for the list of pages, and the page's own size in pixels. */
export async function thumbOf(source: Blob): Promise<{ thumb: HTMLCanvasElement; width: number; height: number }> {
  const bmp = await loadBitmap(source);
  try {
    const k = Math.min(1, THUMB_SIDE / Math.max(bmp.width, bmp.height));
    const thumb = canvasOf(bmp.width * k, bmp.height * k);
    const ctx = ctxOf(thumb);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, thumb.width, thumb.height);
    return { thumb, width: bmp.width, height: bmp.height };
  } finally {
    bmp.close?.();
  }
}

/**
 * What the frame `rect` holds, as the Cropper shows it: the picture `work` turned by `tilt` degrees about its middle
 * (white where it does not reach), the part under the frame, `size` pixels large.
 */
export function cutFrame(work: HTMLCanvasElement, rect: Rect, tilt: number, size: [number, number]): HTMLCanvasElement {
  const W = work.width;
  const H = work.height;
  const cv = canvasOf(size[0], size[1]);
  const ctx = ctxOf(cv);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(cv.width / (rect.w * W), cv.height / (rect.h * H));
  ctx.translate(-rect.x * W, -rect.y * H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate((tilt * Math.PI) / 180);
  ctx.drawImage(work, -W / 2, -H / 2);
  return cv;
}

/** A page turned clockwise by `quarter` degrees, as a small picture (the thumbnail of a page as it will be). */
export function turned(src: HTMLCanvasElement, quarter: number): HTMLCanvasElement {
  if (!quarter) return src;
  const side = quarter === 90 || quarter === 270;
  const out = canvasOf(side ? src.height : src.width, side ? src.width : src.height);
  const ctx = ctxOf(out);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((quarter * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/** A canvas as JPEG bytes. */
async function jpegOf(cv: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await toBlob(cv, 'image/jpeg', quality);
  if (!blob) throw new Error('This browser could not save the picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** A page as it will be cut: its picture as given, how it is turned and straightened, and its frame. */
export interface PageCut {
  source: Blob;
  quarter: number;
  fine: number;
  rect: Rect;
  /** The page already opened at `quarter` (the one on screen), so that it is not opened again. */
  work?: HTMLCanvasElement | null;
  /** The sheet chosen for it with a preset (A4 or A5), which sizes it in the file; otherwise worked out from its shape. */
  paper?: Paper | null;
}

/** The adjusted document, and a sentence when its pictures had to be made smaller to stay under the limit. */
export interface Adjusted {
  file: File;
  pages: number;
  note?: string;
}

/**
 * The adjusted document: each page cut to its frame, turned and straightened, as a JPEG (quality 0.9, its long side at
 * most MAX_SIDE, never larger than the page); one page as a JPEG file, several as one PDF, named after `name`. Over
 * `limit` bytes, the quality is lowered step by step, then the size of the pages (fitUnder), and the note says so.
 * Throws an Error with a sentence to show when it cannot be made small enough, or the browser cannot make it.
 */
export async function makeDocument(pages: PageCut[], name: string, limit: number, limitText: string): Promise<Adjusted> {
  const pdf = pages.length > 1;
  const fileName = adjustedName(name, pdf);
  // the last page cut, kept while its size is the same: a single page is cut once, however many qualities are tried
  let kept: { page: number; factor: number; cv: HTMLCanvasElement } | null = null;
  const cut = async (page: number, factor: number) => {
    if (kept?.page === page && kept.factor === factor) return kept.cv;
    const p = pages[page];
    const work = p.work ?? (await openPage(p.source, p.quarter));
    const cv = cutFrame(work, p.rect, p.fine, cutSize(p.rect, work.width, work.height, MAX_SIDE, factor));
    if (work !== p.work) work.width = work.height = 0; // let the browser have its memory back now
    kept = { page, factor, cv };
    return cv;
  };
  const fitted = await fitUnder(pages.length, limit, pdf ? pdfOverhead(pages.length, fileName.length) : 0, async (page, factor, qualities) => {
    const cv = await cut(page, factor);
    const out: Uint8Array[] = [];
    for (const q of qualities) out.push(await jpegOf(cv, q));
    return out;
  });
  if (!fitted) {
    throw new Error(
      `The adjusted document is still larger than ${limitText}, even at a lower quality and resolution. Remove the pages that aren't needed, or crop more closely.`,
    );
  }
  const note =
    fitted.lowered === 'quality'
      ? `To stay under ${limitText}, the ${pdf ? 'pages were' : 'picture was'} saved at a lower quality.`
      : fitted.lowered === 'resolution'
        ? `To stay under ${limitText}, the ${pdf ? 'pages were' : 'picture was'} saved at a lower quality and resolution.`
        : undefined;
  if (!pdf) {
    // its print size goes in the file too: the sheet chosen, else 300 dpi or an A4 sheet when it has the shape of one
    const [jpeg] = fitted.jpegs;
    const info = jpegInfo(jpeg);
    const bytes = info ? jfifDpi(jpeg, printDpi(info.width, info.height, pages[0].paper)) : jpeg;
    return { file: new File([bytes.buffer as ArrayBuffer], fileName, { type: 'image/jpeg' }), pages: 1, note };
  }
  const bytes = writePdf(fitted.jpegs, { title: name.replace(/\.[^.]*$/, ''), papers: pages.map((p) => p.paper) });
  return { file: new File([bytes.buffer as ArrayBuffer], fileName, { type: 'application/pdf' }), pages: pages.length, note };
}
