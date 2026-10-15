import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit, { type Font } from '@cantoo/fontkit';

// The fonts a PDF template is filled in with (owner's decision, 15 October 2026), kept in apps/api/assets/fonts with
// their licence (SIL Open Font License 1.1, OFL-*.txt beside them): Noto Naskh Arabic for Arabic (its short ascenders
// and descenders suit a form's small boxes) and Noto Sans for Latin letters, digits and the punctuation Naskh doesn't
// have (names in English, emails, dates). Each in regular and bold, static files rather than the variable font. They are
// embedded subset (only the letters printed), so a filled form stays small.

/** Which font a piece of text is printed in. */
export type FontScript = 'arabic' | 'latin';

const FILES: Record<FontScript, { regular: string; bold: string }> = {
  arabic: { regular: 'NotoNaskhArabic-Regular.ttf', bold: 'NotoNaskhArabic-Bold.ttf' },
  latin: { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
};

// apps/api/assets/fonts, from src/documents/pdf-engine (tests, the dev server) and dist/documents/pdf-engine (the build
// and the Docker image, which copies all of apps/api) alike
const DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));

/** A font file: its bytes, to embed, and the font read from them, to measure and lay out text as the PDF will print it. */
export interface FontFile {
  bytes: Uint8Array;
  font: Font;
}

const loaded = new Map<string, FontFile>();

/** The font file for a script and weight, read once. */
export function fontFile(script: FontScript, bold = false): FontFile {
  const name = FILES[script][bold ? 'bold' : 'regular'];
  let file = loaded.get(name);
  if (!file) {
    const bytes = new Uint8Array(readFileSync(`${DIR}${name}`));
    file = { bytes, font: fontkit.create(bytes) as Font };
    loaded.set(name, file);
  }
  return file;
}

export { fontkit };
