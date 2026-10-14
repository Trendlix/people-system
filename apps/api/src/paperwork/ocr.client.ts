import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extensionOf, type PaperworkType } from './paperwork-file.js';

// Talks to the OCR service (services/ocr), which reads the text of scans and photos: POST {OCR_URL}/read?lang=ar|en
// with the file. It is optional: without OCR_URL, or when the service is down, fails or is too slow, documents are
// still stored, only without their text (status "unavailable" or "failed").

export type OcrLang = 'ar' | 'en';

export type OcrRead =
  | { status: 'done'; text: string; lines: string[]; pages: string[][] } // lines in reading order: all, and page by page
  | { status: 'failed' | 'unavailable' };

/** What the service answers. Lines are in reading order; the text is as read (Arabic-Indic digits kept). */
interface OcrResponse {
  lang: string;
  pages: { lines: { text: string; confidence: number; box: [number, number, number, number] }[] }[];
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
    if (!this.url) return { status: 'unavailable' };

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type: mimeType }), `document.${extensionOf(mimeType)}`);
    try {
      const res = await fetch(`${this.url}/read?lang=${lang}`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 503) return this.fail('unavailable', 'the service is starting or overloaded (503)');
      if (!res.ok) return this.fail('failed', `the service answered ${res.status}`);
      const lines = linesOf(await res.json());
      if (!lines) return this.fail('failed', 'the answer was not in the expected form');
      return { status: 'done', text: lines.text, lines: lines.lines, pages: lines.pages };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') return this.fail('failed', `no answer within ${TIMEOUT_MS / 1000} s`);
      if (notRunning(err)) return this.fail('unavailable', `nothing answers at ${this.url}`);
      return this.fail('failed', err instanceof Error ? err.message : String(err));
    }
  }

  /** Logged without the document or its text. */
  private fail(status: 'failed' | 'unavailable', reason: string): OcrRead {
    this.log.warn(`Could not read a document: ${reason}.`);
    return { status };
  }
}

/** The lines (all, and page by page) and text of a well-formed answer; null for anything else. The text is the lines when it is missing. */
function linesOf(body: unknown): { text: string; lines: string[]; pages: string[][] } | null {
  if (!body || typeof body !== 'object') return null;
  const { pages, text } = body as Partial<OcrResponse>;
  if (!Array.isArray(pages)) return null;
  const byPage = pages.map((page) =>
    (Array.isArray(page?.lines) ? page.lines : []).map((line) => (typeof line?.text === 'string' ? line.text.trim() : '')).filter(Boolean),
  );
  const lines = byPage.flat();
  return { text: typeof text === 'string' && text.trim() ? text : lines.join('\n'), lines, pages: byPage };
}

function notRunning(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const codes = [(e as NodeJS.ErrnoException).code, ...(e instanceof AggregateError ? e.errors.map((x: NodeJS.ErrnoException) => x?.code) : [])];
    if (codes.some((code) => code !== undefined && NOT_RUNNING.has(code))) return true;
  }
  return false;
}
