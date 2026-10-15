import { writePdf } from '@/lib/pdf-writer';
import type { ChartLayout } from './tree';
import { chartSvg, containIn, logoRect, pagePlan, pageSvg, pngScale, type ChartPaper, type Rect } from './svg';

// The org chart's files, made in the browser (owner's request, 15 October 2026): the SVG as it is; the PNG and the PDF
// by drawing that SVG as a picture on a canvas. The PDF is one picture of the whole page (title and chart) put on an A4
// or A3 sheet by lib/pdf-writer.ts, as the document adjuster does with scans, so no PDF library is needed.
//
// On a canvas the logo is drawn after the chart, from its own file, rather than inside the SVG: some browsers refuse to
// save a canvas once an SVG with a picture inside it was drawn on it.

/** The JPEG quality of the PDF's page: high, as it is lines and small text. */
const PDF_QUALITY = 0.92;

/** Saves a file made here, as a download. */
export function saveFile(blob: Blob, name: string): void {
  const address = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = address;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // the download has its own copy by then
  setTimeout(() => URL.revokeObjectURL(address), 60_000);
}

/** A file read as a data: address, for a picture inside an SVG. */
export function dataAddress(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** The SVG drawn on a new canvas of w × h, on white, with the logo in `logoAt` when there is one. */
async function drawn(svg: string, w: number, h: number, logo: Blob | null, logoAt: Rect | null): Promise<HTMLCanvasElement> {
  const address = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    // waited for with onload rather than decode(), which some versions of Safari refuse for an SVG
    const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The browser could not draw the chart.'));
      img.src = address;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser gave no canvas to draw on.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
    if (logo && logoAt) {
      // a logo this browser can't open (an old one and a WebP, say) leaves its square empty rather than failing the file
      const bitmap = await createImageBitmap(logo).catch(() => null);
      if (bitmap) {
        const r = containIn(logoAt, bitmap.width, bitmap.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
        bitmap.close();
      }
    }
    return canvas;
  } finally {
    URL.revokeObjectURL(address);
  }
}

async function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error('The browser could not make a picture this large. Try the SVG, or A4.');
  return blob;
}

/** The chart as an .svg file, with the logo inside it. */
export function svgFile(layout: ChartLayout, logo: string | null, title: string): Blob {
  return new Blob([chartSvg(layout, { logo, title })], { type: 'image/svg+xml;charset=utf-8' });
}

/** The chart as a PNG at up to three times its size (pngScale), on white. */
export async function pngFile(layout: ChartLayout, logo: Blob | null): Promise<Blob> {
  const scale = pngScale(layout);
  const canvas = await drawn(chartSvg(layout, { scale }), layout.width * scale, layout.height * scale, logo, logoRect(layout, scale));
  return blobOf(canvas, 'image/png');
}

/** The chart on one landscape page of `paper` under `heading`, as a PDF. */
export async function pdfFile(layout: ChartLayout, logo: Blob | null, paper: ChartPaper, heading: string): Promise<Blob> {
  const plan = pagePlan(layout, paper);
  const canvas = await drawn(pageSvg(layout, plan, heading), plan.width, plan.height, logo, logoRect(layout, plan.chart.scale, plan.chart.x, plan.chart.y));
  const jpeg = new Uint8Array(await (await blobOf(canvas, 'image/jpeg', PDF_QUALITY)).arrayBuffer());
  const bytes = writePdf([jpeg], { title: heading, papers: [paper] });
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}
