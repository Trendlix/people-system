import { withFileLinks } from '@trendlix/shared';
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

/** How much is read: pages of a PDF, characters in all (the bulk upload's guess: 3 and 20,000; a CV's reading: 5 and 60,000). */
export interface CvTextLimits {
  pages: number;
  chars: number;
}

const GUESS: CvTextLimits = { pages: MAX_PAGES, chars: MAX_CHARS };

/** A CV's text and the links behind its words (a "LinkedIn" word or icon linking to the profile; 29 October 2026). */
export interface CvTextParts {
  text: string;
  links: string[];
}

async function pdfText(data: Buffer, limits: CvTextLimits): Promise<CvTextParts> {
  const { getDocument, VerbosityLevel } = await loadPdfJs();
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    const lines: string[] = [];
    const links: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, limits.pages); n++) {
      const page = await doc.getPage(n);
      // the page's links (owner, 29 October 2026: "the OCR is not filling the linkedin link like in the candidate profile")
      for (const a of (await page.getAnnotations().catch(() => [])) as { subtype?: string; url?: string; unsafeUrl?: string }[]) {
        const url = a.subtype === 'Link' ? (a.url ?? a.unsafeUrl) : undefined;
        if (typeof url === 'string' && url) links.push(url);
      }
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
    return { text: lines.join('\n').slice(0, limits.chars), links };
  } finally {
    await task.destroy();
  }
}

/** XML's five entities, as a relationship's target writes them. */
const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function docxText(data: Buffer, limits: CvTextLimits): CvTextParts {
  const zip = readZip(data);
  const xml = zip.read('word/document.xml')?.toString('utf8') ?? '';
  // its hyperlinks' addresses (29 October 2026): the relationships of kind hyperlink pointing outside the file
  const rels = zip.read('word/_rels/document.xml.rels')?.toString('utf8') ?? '';
  const links = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /Type="[^"]*\/hyperlink"/.test(tag) && /TargetMode="External"/.test(tag))
    .map((tag) => unescapeXml(/Target="([^"]*)"/.exec(tag)?.[1] ?? ''))
    .filter(Boolean);
  return { text: paragraphTexts(xml).join('\n').slice(0, limits.chars), links };
}

/** The CV's text and the links behind its words, apart; none when it has no text (a scanned PDF) or can't be read. */
export async function cvTextParts(data: Buffer, type: CvType, limits: CvTextLimits = GUESS): Promise<CvTextParts> {
  try {
    if (type === PDF) return await pdfText(data, limits);
    if (type === DOCX) return docxText(data, limits);
  } catch {
    // a damaged or protected file: the row is HR's to fill in
  }
  return { text: '', links: [] };
}

/** The CV's text, the links behind its words kept after it (withFileLinks); '' when it has none or can't be read. */
export async function cvText(data: Buffer, type: CvType, limits: CvTextLimits = GUESS): Promise<string> {
  const parts = await cvTextParts(data, type, limits);
  return parts.text ? withFileLinks(parts.text, parts.links, limits.chars) : '';
}
