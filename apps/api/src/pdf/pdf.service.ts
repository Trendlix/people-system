import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, type PDFObject, type PDFRef } from '@cantoo/pdf-lib';

// Turns a filled Word document into a PDF (job offers, owner's request, 15 October 2026), through the converter beside
// the API (deploy/docker-compose.yml: Gotenberg's LibreOffice route, POST {PDF_URL}/forms/libreoffice/convert). It is
// optional: without PDF_URL, `available` is false and fromDocx answers null.
//
// A filled document leaves the system only as a protected PDF (owner's request, 15 October 2026: "No doc file export,
// just a protected PDF"): the converter's PDF re-saved encrypted (protectPdf), as it is otherwise: the pages, fonts,
// Arabic text and images untouched. Anyone opens it, without a password, and prints it; nobody can change it, copy
// from it, annotate it, fill in forms on it or insert, rotate or delete pages. The owner password that would lift
// that is random for each file, and never stored or logged. The Word templates HR uploads, and the Fields Guide, stay
// Word files (they are HR's own and the system's own files, not filled documents).

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** A page or two takes a second or so; a cold start of LibreOffice a few more. */
const TIMEOUT_MS = 60_000;

/**
 * What a protected PDF lets its reader do: print it, at full quality. Not modify it, copy or extract its text and
 * pictures, annotate it, fill in forms or assemble it (insert, rotate or delete pages). Extraction for accessibility
 * stays allowed, as ISO 32000-2 asks of every PDF written with this encryption (screen readers read it aloud; it
 * copies nothing).
 */
export const PROTECTED_PERMISSIONS = {
  printing: 'highResolution',
  modifying: false,
  copying: false,
  annotating: false,
  fillingForms: false,
  contentAccessibility: true,
  documentAssembly: false,
} as const;

/** The 409 when there is no converter: a filled document is given only as a protected PDF. */
export const PDF_NOT_SET_UP = "The PDF converter isn't set up on the server, so documents can't be given out yet: they are given as protected PDFs only.";

/**
 * The PDF re-saved encrypted with AES-256 (ISO 32000-2, revision 6): no user password, so anyone opens it; a random
 * owner password, thrown away; PROTECTED_PERMISSIONS. Nothing else changes: its own metadata (producer, dates) kept.
 */
export async function protectPdf(pdf: Uint8Array): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  doc.encrypt({ ownerPassword: randomBytes(32).toString('base64url'), permissions: PROTECTED_PERMISSIONS, algorithm: 'AES-256' });
  const { context } = doc;
  // The library encrypts the streams as it writes them, but not the strings outside them (the title, the language, a
  // link's address …), which a viewer would then decrypt into nonsense: they are encrypted here, every object written
  // on its own (no object streams), as ISO 32000-2 §7.6.2 asks. The cross-reference streams the source had are
  // replaced by the table written; a document information dictionary written into the trailer becomes an object.
  if (context.trailerInfo.Info instanceof PDFDict) context.trailerInfo.Info = context.register(context.trailerInfo.Info);
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.lookup(PDFName.of('Type')) === PDFName.of('XRef')) context.delete(ref);
  }
  const security = context.security!;
  const skip = context.trailerInfo.Encrypt as PDFRef;
  const seen = new WeakSet<PDFDict | PDFArray>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (ref === skip) continue; // the encryption dictionary's own strings are written as they are
    const encrypt = security.getEncryptFn(ref.objectNumber, ref.generationNumber);
    const sealed = (value: PDFObject): PDFObject | null => {
      if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.fromBytes(encrypt(value.asBytes()));
      if ((value instanceof PDFDict || value instanceof PDFArray) && !seen.has(value)) seal(value);
      return null;
    };
    const seal = (container: PDFDict | PDFArray) => {
      seen.add(container);
      if (container instanceof PDFDict) {
        for (const [key, value] of container.entries()) {
          const replaced = sealed(value);
          if (replaced) container.set(key, replaced);
        }
      } else {
        for (let i = 0; i < container.size(); i++) {
          const replaced = sealed(container.get(i));
          if (replaced) container.set(i, replaced);
        }
      }
    };
    if (object instanceof PDFStream) seal(object.dict);
    else if (object instanceof PDFDict || object instanceof PDFArray) seal(object);
    else {
      const replaced = sealed(object);
      if (replaced) context.assign(ref, replaced);
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
}

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

  /**
   * The .docx as PDF, as the converter makes it; null without a converter. Refused (503) when the converter doesn't
   * answer or fails. For use inside the system: a filled document goes out through protectedFromDocx.
   */
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

  /** A filled .docx as a protected PDF (see protectPdf); null without a converter. Refused (503) when either step fails. */
  async protectedFromDocx(docx: Uint8Array, fileName = 'document.docx'): Promise<Buffer | null> {
    const pdf = await this.fromDocx(docx, fileName);
    if (!pdf) return null;
    try {
      return await protectPdf(pdf);
    } catch (err) {
      this.logger.warn(`The PDF of ${fileName} could not be protected: ${(err as Error).message}`);
      throw new ServiceUnavailableException("The document's PDF could not be protected. Please try again in a minute.");
    }
  }

  /**
   * A PDF kept with a filled document, protected: as it is when it already is, else re-saved protected (a job offer
   * sent before PDFs were protected). Refused (503) when it can't be read.
   */
  async protectedCopy(pdf: Uint8Array): Promise<Buffer> {
    try {
      const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
      return doc.isEncrypted ? Buffer.from(pdf) : await protectPdf(pdf);
    } catch (err) {
      this.logger.warn(`A kept PDF could not be protected: ${(err as Error).message}`);
      throw new ServiceUnavailableException("The document's PDF could not be protected. Please try again in a minute.");
    }
  }

  /**
   * A filled document (generated documents, job offers, a template previewed with data) as it leaves the system: a
   * protected PDF named like it. Refused (409) without a converter: there is no Word file instead.
   */
  async protectedFile(file: { data: Buffer; fileName: string }): Promise<{ data: Buffer; type: string; fileName: string }> {
    const pdf = await this.protectedFromDocx(file.data, file.fileName);
    if (!pdf) throw new ConflictException(PDF_NOT_SET_UP);
    return { data: pdf, type: 'application/pdf', fileName: pdfName(file.fileName) };
  }

  /**
   * A Word file of HR's own to show in the browser (Preview: a template as uploaded, the Fields Guide; owner's request,
   * 15 October 2026), as a PDF named like it. Refused (409) without a converter: the Word file can still be downloaded.
   */
  async preview(file: { data: Buffer; fileName: string }): Promise<{ data: Buffer; type: string; fileName: string }> {
    const pdf = await this.fromDocx(file.data, file.fileName);
    if (!pdf) throw new ConflictException("The PDF converter isn't set up on the server, so there is no preview: download the Word file instead.");
    return { data: pdf, type: 'application/pdf', fileName: pdfName(file.fileName) };
  }
}

/** A Word file's PDF name. */
export function pdfName(docxName: string): string {
  return `${docxName.replace(/\.docx$/i, '')}.pdf`;
}
