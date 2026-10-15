// bidi-js (MIT, https://github.com/lojjic/bidi-js) ships no types: the part of it the PDF filler uses.
declare module 'bidi-js' {
  export interface EmbeddingLevels {
    /** Each paragraph's range and level (0: left to right, 1: right to left). */
    paragraphs: { start: number; end: number; level: number }[];
    /** Each UTF-16 unit's resolved level: odd is right to left. */
    levels: Uint8Array;
  }

  export interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels;
    /** The characters at an odd level that print mirrored ("(" as ")"), by index. */
    getMirroredCharactersMap(text: string, levels: Uint8Array, start?: number, end?: number): Map<number, string>;
  }

  export default function bidiFactory(): Bidi;
}
