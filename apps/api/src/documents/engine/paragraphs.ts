import { escapeText, innerText, parseXml, wordPrefix, type XmlElement } from './xml.js';

// A part's paragraphs as the tag reader (templates/docx-tags.ts paragraphTexts) reads them, with a way back to the
// markup: shared by filling the tags in (tags.ts) and by Map Fields (edit.ts; owner's request, 15 October 2026). A
// paragraph's text is its <w:t> texts joined in order, other markup ignored, entities decoded; a text box's paragraphs
// sit inside the paragraph holding the box, each is a paragraph of its own, and the holding paragraph's text continues
// around it. Paragraphs come in document order (where each starts), every <w:p> counted, empty ones too: those with
// text are, in order, exactly what paragraphTexts gives.

/** One <w:t> of a paragraph. */
export interface TextElement {
  el: XmlElement;
  /** Where its text starts in the paragraph's. */
  from: number;
  text: string;
}

export interface Paragraph {
  /** The <w:p>. */
  el: XmlElement;
  /** Its <w:t> elements in order (not those of a text box inside it); <w:t/> left out. */
  texts: TextElement[];
  /** Their texts joined. */
  text: string;
}

/** Every paragraph of a part, in document order. */
export function readParagraphs(xml: string): Paragraph[] {
  const w = wordPrefix(xml);
  const P = `${w}:p`;
  const T = `${w}:t`;

  const found: { el: XmlElement; texts: XmlElement[] }[] = [];
  const collect = (el: XmlElement, paragraph: XmlElement[] | null) => {
    for (const child of el.children) {
      if (child.name === P) {
        const own: XmlElement[] = [];
        found.push({ el: child, texts: own });
        collect(child, own);
      } else if (child.name === T) {
        if (paragraph && !child.empty) paragraph.push(child);
      } else {
        collect(child, paragraph);
      }
    }
  };
  collect(parseXml(xml), null);

  return found.map(({ el, texts }) => {
    let from = 0;
    const elements = texts.map((t) => {
      const text = innerText(xml, t);
      const out = { el: t, from, text };
      from += text.length;
      return out;
    });
    return { el, texts: elements, text: elements.map((t) => t.text).join('') };
  });
}

/** A piece of a rewritten <w:t>: text kept as it was, or text put in (whose line breaks become <w:br/>). */
export interface TextPiece {
  text: string;
  value: boolean;
}

const LINE_BREAK = /\r\n|\r|\n/;
const EDGE_SPACE = /^[ \t\r\n]|[ \t\r\n]$/;

/** The <w:t> `el` rewritten to hold these pieces, keeping its start tag (and so its run's formatting). */
export function rewriteText(xml: string, el: XmlElement, pieces: readonly TextPiece[], w: string): string {
  return textElements(xml.slice(el.start, el.openEnd), pieces, w);
}

/**
 * <w:t> elements with this start tag holding the pieces: a value's line breaks become <w:br/> between <w:t> elements
 * of the same run, and xml:space="preserve" is added where a text starts or ends with a space, so Word keeps it.
 */
export function textElements(startTag: string, pieces: readonly TextPiece[], w: string): string {
  const lines = [''];
  for (const piece of pieces) {
    const [first, ...rest] = piece.value ? piece.text.split(LINE_BREAK) : [piece.text];
    lines[lines.length - 1] += first;
    lines.push(...rest);
  }
  const preserving = withPreserve(startTag);
  return lines.map((line) => `${EDGE_SPACE.test(line) ? preserving : startTag}${escapeText(line)}</${w}:t>`).join(`<${w}:br/>`);
}

/** The start tag with xml:space="preserve". */
function withPreserve(startTag: string): string {
  if (/\sxml:space\s*=\s*["']preserve["']/.test(startTag)) return startTag;
  if (/\sxml:space\s*=/.test(startTag)) return startTag.replace(/(\sxml:space\s*=\s*)(["'])[^"']*\2/, '$1"preserve"');
  return startTag.replace(/\s*>$/, ' xml:space="preserve">');
}
