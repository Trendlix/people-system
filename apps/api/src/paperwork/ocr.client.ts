import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extensionOf, type PaperworkType } from './paperwork-file.js';

// Talks to the OCR service (services/ocr), which reads the text of scans and photos (POST {OCR_URL}/read?lang=ar|en),
// finds ID cards on a scan (POST {OCR_URL}/cards) and shows the pages of a PDF or photo as pictures (POST
// {OCR_URL}/pages), with the file. It is optional: without OCR_URL, or when the service is down, fails or is too slow,
// documents are still stored, only without their text (status "unavailable" or "failed").

export type OcrLang = 'ar' | 'en';

/** A page as read: its lines in reading order, each with its box, and the page's size when the service gives it. */
export interface OcrPageRead {
  lines: { text: string; box: [number, number, number, number]; confidence?: number }[]; // box: x_min, y_min, x_max, y_max in pixels
  width?: number;
  height?: number;
}

export type OcrRead =
  | { status: 'done'; text: string; lines: string[]; pages: OcrPageRead[] } // lines in reading order: all, and page by page
  | { status: 'failed' | 'unavailable' };

/** A card found on a scan: where it lies on its page, and the card itself, cut out, straightened and upright. */
export interface OcrCard {
  page: number;
  /** Rotated rectangle on the page image: centre, size (w ≥ h) and angle in degrees (services/ocr/README.md). */
  box: { cx: number; cy: number; w: number; h: number; angle: number };
  image: string; // base64 JPEG
  side: 'front' | 'back' | null;
  confidence: number;
}

/** A page as the service analysed it (base64 JPEG), for framing a card by hand. */
export interface OcrPage {
  width: number;
  height: number;
  image: string;
}

export type OcrCards = { status: 'done'; pages: OcrPage[]; cards: OcrCard[] } | { status: 'failed' | 'unavailable' };

export type OcrPages = { status: 'done'; pages: OcrPage[] } | { status: 'failed' | 'unavailable' };

/**
 * What pages() answers: the pages; or, for a PDF of more than 20 pages, how many it has (the service shows 20 at most:
 * MAX_PDF_PAGES in services/ocr/app/documents.py); or that the service was built before POST /pages, so that the
 * pages are to be had from cardPages() instead.
 */
export type OcrShownPages = OcrPages | { status: 'tooLong'; pages: number } | { status: 'old' };

/** How many pages of a PDF cardPages() gives at most: /cards looks at a PDF's first 2 (CARDS_PDF_PAGES in services/ocr/app/main.py). */
export const OCR_CARDS_PDF_PAGES = 2;

/** What the service answers. Lines are in reading order; the text is as read (Arabic-Indic digits kept). */
interface OcrResponse {
  lang: string;
  pages: { lines: { text: string; confidence: number; box: [number, number, number, number] }[]; width?: number; height?: number }[];
  text: string;
}

const TIMEOUT_MS = 90_000;
// network errors that mean nothing answers at OCR_URL, as opposed to a service that failed or was too slow
const NOT_RUNNING = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

@Injectable()
export class OcrClient {
  private readonly log = new Logger(OcrClient.name);
  private readonly url: string | null;

  constructor(config: ConfigService) {
    this.url = config.get<string>('OCR_URL')?.trim().replace(/\/+$/, '') || null;
  }

  async read(file: Buffer, mimeType: PaperworkType, lang: OcrLang): Promise<OcrRead> {
    const res = await this.send(`/read?lang=${lang}`, file, mimeType);
    if (res.status !== 'ok') return { status: res.status };
    const lines = linesOf(res.body);
    if (!lines) return this.fail('failed', 'the answer was not in the expected form');
    return { status: 'done', text: lines.text, lines: lines.lines, pages: lines.pages };
  }

  /** Finds the ID cards on a scan or photo, each cut out and straightened (POST {OCR_URL}/cards). */
  async cards(file: Buffer, mimeType: PaperworkType): Promise<OcrCards> {
    const res = await this.send('/cards', file, mimeType);
    if (res.status !== 'ok') return { status: res.status };
    const found = cardsOf(res.body);
    if (!found) return this.fail('failed', 'the card answer was not in the expected form');
    return { status: 'done', ...found };
  }

  /**
   * The pages of a photo or a PDF as pictures, in order (POST {OCR_URL}/pages): base64 JPEG, upright, at most 2000 px on
   * their long side (a PDF page rendered at 200 dpi), all together within about 4 MB in base64. Every page of a PDF of
   * up to 20; for a longer one, "tooLong" and how many pages it has. "old" when the service has no /pages (its image
   * was built before it, and the API deployed first): cardPages() then gives what it can.
   */
  async pages(file: Buffer, mimeType: PaperworkType): Promise<OcrShownPages> {
    const res = await this.send('/pages', file, mimeType, [400, 404]);
    if (res.status === 'ok') {
      const pages = pagesOf((res.body as { pages?: unknown } | null)?.pages);
      return pages ? { status: 'done', pages } : this.fail('failed', 'the page answer was not in the expected form');
    }
    if (!res.refused) return { status: res.status };
    const { code, body } = res.refused;
    if (code === 404) {
      this.log.warn(`The OCR service has no POST /pages (its image is older): a PDF's first ${OCR_CARDS_PDF_PAGES} pages at most are shown, from /cards.`);
      return { status: 'old' };
    }
    const pages = (body as { pages?: unknown } | null)?.pages;
    if (isNumber(pages)) return { status: 'tooLong', pages };
    return this.fail('failed', `the service answered ${code}`);
  }

  /**
   * The pages of a photo or a PDF as /cards answers with them, its cards left aside (base64 JPEG, upright, at most
   * 2000 px on their long side; a PDF page rendered at 300 dpi): a PDF's first OCR_CARDS_PDF_PAGES. For an OCR service
   * older than POST /pages.
   */
  async cardPages(file: Buffer, mimeType: PaperworkType): Promise<OcrPages> {
    const res = await this.send('/cards', file, mimeType);
    if (res.status !== 'ok') return { status: res.status };
    const pages = pagesOf((res.body as { pages?: unknown } | null)?.pages);
    if (!pages) return this.fail('failed', 'the page answer was not in the expected form');
    return { status: 'done', pages };
  }

  /** The answer of a call. A status in `handled` is the caller's to judge, with the answer's body, and is not logged. */
  private async send(
    path: string,
    file: Buffer,
    mimeType: PaperworkType,
    handled: number[] = [],
  ): Promise<{ status: 'ok'; body: unknown } | { status: 'failed' | 'unavailable'; refused?: { code: number; body: unknown } }> {
    if (!this.url) return { status: 'unavailable' };
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: mimeType }), `document.${extensionOf(mimeType)}`);
    try {
      const res = await fetch(`${this.url}${path}`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 503) return this.fail('unavailable', 'the service is starting or overloaded (503)');
      if (handled.includes(res.status)) return { status: 'failed', refused: { code: res.status, body: await res.json().catch(() => null) } };
      if (!res.ok) return this.fail('failed', `the service answered ${res.status}`);
      return { status: 'ok', body: await res.json() };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') return this.fail('failed', `no answer within ${TIMEOUT_MS / 1000} s`);
      if (notRunning(err)) return this.fail('unavailable', `nothing answers at ${this.url}`);
      return this.fail('failed', err instanceof Error ? err.message : String(err));
    }
  }

  /** Logged without the document or its text. */
  private fail<S extends 'failed' | 'unavailable'>(status: S, reason: string): { status: S } {
    this.log.warn(`Could not read a document: ${reason}.`);
    return { status };
  }
}

/** The lines (all, and page by page with their boxes) and text of a well-formed answer; null for anything else. The text is the lines when it is missing. */
function linesOf(body: unknown): { text: string; lines: string[]; pages: OcrPageRead[] } | null {
  if (!body || typeof body !== 'object') return null;
  const { pages, text } = body as Partial<OcrResponse>;
  if (!Array.isArray(pages)) return null;
  const byPage: OcrPageRead[] = pages.map((page) => ({
    lines: (Array.isArray(page?.lines) ? page.lines : [])
      .map((line) => ({
        text: typeof line?.text === 'string' ? line.text.trim() : '',
        box: (Array.isArray(line?.box) && line.box.length === 4 && line.box.every(isNumber) ? line.box : [0, 0, 0, 0]) as [number, number, number, number],
        ...(isNumber(line?.confidence) && { confidence: line.confidence }),
      }))
      .filter((line) => line.text),
    ...(isNumber(page?.width) && isNumber(page?.height) && { width: page.width, height: page.height }),
  }));
  const lines = byPage.flatMap((p) => p.lines.map((l) => l.text));
  return { text: typeof text === 'string' && text.trim() ? text : lines.join('\n'), lines, pages: byPage };
}

function notRunning(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const codes = [(e as NodeJS.ErrnoException).code, ...(e instanceof AggregateError ? e.errors.map((x: NodeJS.ErrnoException) => x?.code) : [])];
    if (codes.some((code) => code !== undefined && NOT_RUNNING.has(code))) return true;
  }
  return false;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The pages of a well-formed answer (each a picture with its size), in order; null for anything else. */
function pagesOf(pages: unknown): OcrPage[] | null {
  if (!Array.isArray(pages)) return null;
  const ok = pages.every((p: Partial<OcrPage>) => isNumber(p?.width) && isNumber(p?.height) && typeof p?.image === 'string');
  return ok ? (pages as OcrPage[]).map(({ width, height, image }) => ({ width, height, image })) : null;
}

/** The pages and cards of a well-formed /cards answer; null for anything else. */
function cardsOf(body: unknown): { pages: OcrPage[]; cards: OcrCard[] } | null {
  if (!body || typeof body !== 'object') return null;
  const { pages: rawPages, cards } = body as { pages?: unknown; cards?: unknown };
  const pages = pagesOf(rawPages);
  if (!pages || !Array.isArray(cards)) return null;
  const okCards = cards.every((c: Partial<OcrCard>) => {
    const b = c?.box;
    return (
      isNumber(c?.page) && c.page >= 0 && c.page < pages.length && typeof c?.image === 'string' &&
      !!b && [b.cx, b.cy, b.w, b.h, b.angle].every(isNumber) &&
      (c.side === 'front' || c.side === 'back' || c.side === null) && isNumber(c.confidence)
    );
  });
  if (!okCards) return null;
  return {
    pages,
    cards: (cards as OcrCard[]).map(({ page, box, image, side, confidence }) => ({
      page,
      box: { cx: box.cx, cy: box.cy, w: box.w, h: box.h, angle: box.angle },
      image,
      side,
      confidence,
    })),
  };
}
