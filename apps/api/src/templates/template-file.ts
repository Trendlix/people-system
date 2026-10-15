import { BadRequestException } from '@nestjs/common';
import { contentDisposition } from '../paperwork/paperwork-file.js';

// The uploaded template's name, cleaned as paperwork's are (paperwork-file.ts) before it is stored, shown or sent
// back in a header: the file is a .docx or (an official form, owner's decision, 15 October 2026) a PDF by its content,
// so the name always ends in .docx or .pdf, as the file is.

/** What a template version is: a Word template with {{tags}}, or a PDF form with its fields placed on it. */
export const TEMPLATE_FORMATS = ['docx', 'pdf'] as const;
export type TemplateFormat = (typeof TEMPLATE_FORMATS)[number];

/** A version's format as kept (docx unless pdf). */
export const formatOf = (format: string | null | undefined): TemplateFormat => (format === 'pdf' ? 'pdf' : 'docx');

const NAME_MAX = 120;
// Word's own extensions, and a PDF's, replaced rather than kept before ".docx" or ".pdf" ("Contract.doc" holding a
// .docx becomes "Contract.docx", not "Contract.doc.docx"; "Form 1.docx" holding a PDF becomes "Form 1.pdf")
const KNOWN_EXTENSIONS = ['docx', 'doc', 'dotx', 'dot', 'docm', 'dotm', 'rtf', 'odt', 'pdf'];

export function templateFileName(name: string | undefined, format: TemplateFormat = 'docx'): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = Array.from(base.normalize('NFC'))
    .filter((ch) => !isHidden(ch.codePointAt(0)!))
    .join('')
    .replace(/[<>:"|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|\s+$/g, '');
  const m = /^(.+)\.([^.\s]+)$/.exec(clean);
  const stem = m && KNOWN_EXTENSIONS.includes(m[2].toLowerCase()) ? m[1] : clean;
  const short = Array.from(stem).slice(0, NAME_MAX - format.length - 1).join('').trim();
  return `${short || 'template'}.${format}`;
}

/** Control characters, and the invisible marks that change the direction or joining of text (as paperwork-file.ts). */
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

/** Downloaded, not shown: browsers can't show a Word file. The exact name as well as an ASCII stand-in (RFC 6266, 8187). */
export function attachment(fileName: string): string {
  return contentDisposition(fileName).replace(/^inline;/, 'attachment;');
}

/**
 * How a Word file of HR's own is asked for (a template as uploaded, the Fields Guide): docx, the default, or a PDF to
 * preview in the browser. A filled document is given only as a protected PDF (pdf/pdf-file.ts).
 */
export const FILE_FORMATS = ['docx', 'pdf'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

/** ?format= read: docx unless pdf is asked for; anything else is refused (400). */
export function fileFormat(format: string | undefined): FileFormat {
  if (format === undefined || format === '' || format === 'docx') return 'docx';
  if (format === 'pdf') return 'pdf';
  throw new BadRequestException('Choose the format: pdf or docx.');
}
