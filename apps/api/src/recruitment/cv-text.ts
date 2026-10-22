import { readZip } from '../templates/zip.js';
import { paragraphTexts } from '../templates/docx-tags.js';
import { DOCX, PDF, type CvType } from './cv-file.js';

// A CV's text, to read its person's name, email and mobile (owner, 22 October 2026: the bulk upload of LinkedIn's Easy
// Apply CVs, "why not"; packages/shared general-cvs.ts cvGuesses): a PDF's text as pdf.js reads it (a scanned one has
// none), its pages' lines in order; a Word file's paragraphs. Never fails: a file it can't read gives no text, for HR
// to fill the row in by hand. At most the first 3 pages, and 20,000 characters, are read.

const MAX_PAGES = 3;
const MAX_CHARS = 20_000;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;
const loadPdfJs = () => (pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

async function pdfText(data: Buffer): Promise<string> {
  const { getDocument, VerbosityLevel } = await loadPdfJs();
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    const lines: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        } else if (item.str && !line.endsWith(' ')) {
          line += ' ';
        }
      }
      if (line.trim()) lines.push(line);
    }
    return lines.join('\n').slice(0, MAX_CHARS);
  } finally {
    await task.destroy();
  }
}

function docxText(data: Buffer): string {
  const xml = readZip(data).read('word/document.xml')?.toString('utf8') ?? '';
  return paragraphTexts(xml).join('\n').slice(0, MAX_CHARS);
}

/** The CV's text; '' when it has none (a scanned PDF) or can't be read. */
export async function cvText(data: Buffer, type: CvType): Promise<string> {
  try {
    if (type === PDF) return await pdfText(data);
    if (type === DOCX) return docxText(data);
  } catch {
    // a damaged or protected file: the row is HR's to fill in
  }
  return '';
}
