// A job description's rich text (owner, 15 October 2026: "allow me to format the text (bold, indent, etc.), not full
// format, keep the mail system format", and "don't auto number"): bold, italic, underline, bulleted and numbered lists
// (nested lists to indent points), paragraphs indented by level, and line breaks. It is written in the editor
// (components/rich-text-editor.tsx), kept as HTML by the API, which cleans it when it saves it, and shown with
// components/rich-text.tsx.

/** The tags rich text may use; the API strips anything else when it saves it. */
const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li']);
/** Text formatting, which a paragraph or list may not start inside of. */
const INLINE = new Set(['strong', 'em', 'u']);

/** How far a paragraph can be indented: levels 1 to 4, kept as `data-indent` on the paragraph. */
export const MAX_INDENT = 4;

/** A tag (whether it closes, its name and its attributes), or a comment, doctype or the like. */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|<[!?][^>]*>/g;
const INDENT = /\bdata-indent\s*=\s*(?:"\s*([1-4])\s*"|'\s*([1-4])\s*'|([1-4])(?![^\s/]))/i;

/**
 * Rich text as it is safe to show: only the allowed tags (`p`, with a `data-indent` of 1 to 4 or none, `br`, `strong`,
 * `em`, `u`, `ul`, `ol`, `li`), with no other attribute; every other tag dropped and its text kept (a script's or a
 * style's dropped with it), and every tag closed in order, so nothing spills out of the box it is shown in.
 * The API already cleans what it saves; this is a second line of defence for the page that shows it.
 */
export function sanitizeRichText(html: string): string {
  const source = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const out: string[] = [];
  const open: string[] = [];
  const closeTop = () => out.push(`</${open.pop()}>`);

  let last = 0;
  for (const match of source.matchAll(TAG)) {
    out.push(escapeText(source.slice(last, match.index)));
    last = match.index + match[0].length;
    const [, closing, rawName, attributes] = match;
    const name = rawName?.toLowerCase();
    if (!name || !ALLOWED.has(name)) continue;

    if (closing) {
      // a closing tag closes everything opened inside it; one with nothing to close is dropped
      if (!open.includes(name)) continue;
      while (open.at(-1) !== name) closeTop();
      closeTop();
    } else if (name === 'br') {
      out.push('<br>');
    } else {
      if (!INLINE.has(name)) {
        // a paragraph or list starts outside any paragraph or formatting, and a list item ends the one before it
        while (open.length && (INLINE.has(open.at(-1)!) || open.at(-1) === 'p')) closeTop();
        if (name === 'li' && open.at(-1) === 'li') closeTop();
      }
      const indent = name === 'p' ? INDENT.exec(attributes ?? '') : null;
      const level = indent && (indent[1] ?? indent[2] ?? indent[3]);
      out.push(level ? `<p data-indent="${level}">` : `<${name}>`);
      open.push(name);
    }
  }
  out.push(escapeText(source.slice(last)));
  while (open.length) closeTop();
  return out.join('');
}

/** Text between tags, with any `<` or `>` that is not part of an allowed tag shown as it is. */
function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Whether rich text has nothing to read, e.g. the editor's empty `<p></p>`, or only spaces and line breaks. */
export function isBlankRichText(html: string | null | undefined): boolean {
  if (!html) return true;
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&(nbsp|#160|#xa0);/gi, ' ')
      .trim() === ''
  );
}

/** What the editor sends for a field: its HTML, or "" when it has nothing to read (which clears the field). */
export function richTextValue(html: string): string {
  return isBlankRichText(html) ? '' : html;
}

/** Points in one unit of each kind a pasted margin can come in. */
const POINTS: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pc: 12, em: 12, rem: 12 };

/**
 * The indent level of a pasted paragraph from its left margin (`style="margin-left: 36pt"`): Word and Google Docs indent
 * in steps of half an inch (36pt), an email in steps of 40px. 0 for none, up to MAX_INDENT.
 */
export function indentFromMargin(marginLeft: string): number {
  const margin = /^(\d*\.?\d+)(pt|px|in|cm|mm|pc|em|rem)$/i.exec(marginLeft.trim());
  if (!margin) return 0;
  const points = Number(margin[1]) * POINTS[margin[2].toLowerCase()];
  return Math.min(MAX_INDENT, Math.round(points / 36));
}

/** A paragraph pasted from Word that is really a list item: which list it is in, its level (1 = top) and its kind. */
export interface WordListItem {
  list: string;
  level: number;
  ordered: boolean;
}

/**
 * Word copies a list as paragraphs (`style="mso-list:l0 level1 lfo1"`) with the bullet or number typed in front of
 * the text (`marker`, e.g. "·", "o", "§", "1.", "a)", "iv."). Which list item a paragraph is, from its style and marker;
 * null for a paragraph that is not one. Only a number or letter followed by "." or ")" makes it a numbered list.
 */
export function wordListItem(style: string, marker: string): WordListItem | null {
  const list = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(style);
  if (!list) return null;
  return {
    list: list[1].toLowerCase(),
    level: Math.max(1, Number(list[2])),
    ordered: /^\(?(\d+|[a-z]{1,5})[.)]/i.test(marker.trim()),
  };
}
