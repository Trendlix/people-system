import { contentDisposition } from '../paperwork/paperwork-file.js';

// The uploaded template's name, cleaned as paperwork's are (paperwork-file.ts) before it is stored, shown or sent
// back in a header: the file is always a .docx by its content, so the name always ends in .docx.

const NAME_MAX = 120;
const EXTENSION = 'docx';
// Word's own extensions, replaced rather than kept before ".docx" ("Contract.doc" holding a .docx becomes
// "Contract.docx", not "Contract.doc.docx")
const WORD_EXTENSIONS = ['docx', 'doc', 'dotx', 'dot', 'docm', 'dotm', 'rtf', 'odt'];

export function templateFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = Array.from(base.normalize('NFC'))
    .filter((ch) => !isHidden(ch.codePointAt(0)!))
    .join('')
    .replace(/[<>:"|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|\s+$/g, '');
  const m = /^(.+)\.([^.\s]+)$/.exec(clean);
  const stem = m && WORD_EXTENSIONS.includes(m[2].toLowerCase()) ? m[1] : clean;
  const short = Array.from(stem).slice(0, NAME_MAX - EXTENSION.length - 1).join('').trim();
  return `${short || 'template'}.${EXTENSION}`;
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
