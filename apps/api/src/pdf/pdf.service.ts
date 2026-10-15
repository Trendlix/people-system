import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Turns a filled Word document into a PDF (job offers, owner's request, 15 October 2026), through the converter beside
// the API (deploy/docker-compose.yml: Gotenberg's LibreOffice route, POST {PDF_URL}/forms/libreoffice/convert). It is
// optional: without PDF_URL, `available` is false and fromDocx answers null, so the Word file is used instead.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** A page or two takes a second or so; a cold start of LibreOffice a few more. */
const TIMEOUT_MS = 60_000;

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly url: string | null;

  constructor(config: ConfigService) {
    this.url = config.get<string>('PDF_URL')?.trim().replace(/\/+$/, '') || null;
  }

  /** Whether a converter is set up (PDF_URL). */
  get available(): boolean {
    return this.url !== null;
  }

  /** The .docx as PDF; null without a converter. Refused (503) when the converter doesn't answer or fails. */
  async fromDocx(docx: Uint8Array, fileName = 'document.docx'): Promise<Buffer | null> {
    if (!this.url) return null;
    const form = new FormData();
    // the converter goes by the file's extension
    const name = /\.docx$/i.test(fileName) ? fileName : `${fileName}.docx`;
    form.append('files', new Blob([Buffer.from(docx)], { type: DOCX }), name);
    let res: Response;
    try {
      res = await fetch(`${this.url}/forms/libreoffice/convert`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      this.logger.warn(`The PDF converter did not answer: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The PDF converter is not answering. Please try again in a minute.');
    }
    if (!res.ok) {
      this.logger.warn(`The PDF converter answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      throw new ServiceUnavailableException('The PDF converter could not convert the document. Please try again in a minute.');
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * A Word file to show in the browser (Preview: templates, generated documents; owner's request, 15 October 2026), as
   * a PDF named like it. Refused (409) without a converter: the Word file can still be downloaded.
   */
  async preview(file: { data: Buffer; fileName: string }): Promise<{ data: Buffer; type: string; fileName: string }> {
    const pdf = await this.fromDocx(file.data, file.fileName);
    if (!pdf) throw new ConflictException("The PDF converter isn't set up on the server, so there is no preview: download the Word file instead.");
    return { data: pdf, type: 'application/pdf', fileName: `${file.fileName.replace(/\.docx$/i, '')}.pdf` };
  }
}
