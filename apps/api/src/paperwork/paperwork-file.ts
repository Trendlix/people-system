import { detectLogoType } from '../company/logo-type.js';

// Checks on uploaded paperwork. The type is identified by the file's first bytes, never by the browser's file type
// or the name; the name is cleaned before it is stored, shown or sent back in a header.

export const PAPERWORK_MAX_MB = 10;
export const PAPERWORK_MAX_BYTES = PAPERWORK_MAX_MB * 1024 * 1024;

export type PaperworkType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const EXTENSIONS: Record<PaperworkType, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

// extensions of other document and image types: replaced, not kept, when the content is something else
const OTHER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'svg', 'txt'];

const NAME_MAX = 120;

/** JPEG, PNG and WebP (as for the company logo; never SVG, which can carry scripts) and PDF. */
export function detectPaperworkType(data: Buffer): PaperworkType | null {
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return detectLogoType(data);
}

/** The usual extension for a type: what the OCR service and downloads are told the file is. */
export function extensionOf(type: PaperworkType): string {
  return EXTENSIONS[type][0];
}

/**
 * The uploaded file's name, safe to keep: no folders; no control or direction characters (which can make
 * "gpj.exe" look like "exe.jpg"); none of < > : " | ? *; at most 120 characters; and the extension of what the file
 * really is ("scan.png" holding a PDF becomes "scan.pdf").
 */
export function safeFileName(name: string | undefined, type: PaperworkType): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = Array.from(base.normalize('NFC'))
    .filter((ch) => !isHidden(ch.codePointAt(0)!))
    .join('')
    .replace(/[<>:"|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|\s+$/g, '');

  const m = /^(.+)\.([^.\s]+)$/.exec(clean);
  const given = m?.[2].toLowerCase() ?? '';
  const extension = EXTENSIONS[type].includes(given) ? given : extensionOf(type);
  const stem = m && (EXTENSIONS[type].includes(given) || OTHER_EXTENSIONS.includes(given)) ? m[1] : clean;
  const short = Array.from(stem).slice(0, NAME_MAX - extension.length - 1).join('').trim();
  return `${short || 'document'}.${extension}`;
}

// Names a browser or an editor gives a file it made, which say nothing about the document: "blob" (a canvas or a
// Blob sent without a name), "image.jpg", "document (2).pdf", "adjusted.jpg" …
const GENERIC_NAME = /^(blob|image|img|picture|photo|scan|page|file|document|upload|download|untitled|output|adjusted|cropped|edited)(?:[\s_-]*\(?\d+\)?)?$/i;
const ADJUSTED = '-adjusted';

/**
 * The name of a file that replaces a stored one (adjusted in the browser: cropped, straightened …): the name it was
 * uploaded with when that says something; otherwise the stored name with "-adjusted" and the extension of what the
 * new file is ("Birth certificate.pdf" replaced by a JPEG named "blob" becomes "Birth certificate-adjusted.jpg"),
 * never "-adjusted-adjusted".
 */
export function replacementName(given: string | undefined, previous: string, type: PaperworkType): string {
  const name = safeFileName(given, type);
  const stem = name.slice(0, name.lastIndexOf('.'));
  if (given?.trim() && !GENERIC_NAME.test(stem)) return name;
  const dot = previous.lastIndexOf('.');
  const base = (dot > 0 ? previous.slice(0, dot) : previous).replace(/-adjusted$/i, '');
  const extension = extensionOf(type);
  const short = Array.from(base).slice(0, NAME_MAX - extension.length - 1 - ADJUSTED.length).join('').trim();
  return `${short || 'document'}${ADJUSTED}.${extension}`;
}

/** Control characters, and the invisible marks that change the direction or joining of text. */
function isHidden(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** "inline" with the file name: an ASCII stand-in for old browsers, and the exact name (RFC 6266 and 8187). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
  const exact = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${exact}`;
}
