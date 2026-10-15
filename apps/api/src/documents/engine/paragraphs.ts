import { hasArabic } from '../format.js';
import { blockText, type RichBlock } from './rich.js';
import { attribute, escapeText, parseXml } from './xml.js';

// A rich value on a line of its own, as Word paragraphs (owner's request, 15 October 2026: the role's duties printed
// as written, keeping their bold and indented points, with no auto-numbering). The paragraph that held the tag is
// replaced by one paragraph per block, each looking as the tag did:
// - its paragraph properties (style, alignment, direction, spacing) are the template paragraph's, but for Word's
//   numbering (taken out: a point's bullet or number is typed text), its tracked changes, and a section break, which
//   only the last one keeps;
// - its runs take the formatting of the run the tag was in (font, size, colour), with the block's bold, italic and
//   underline added (for Arabic words too: w:bCs, w:iCs);
// - a list item starts with its bullet or number and a tab, and is indented by its level with the bullet hanging
//   before its text: half an inch a level, as Word indents and as the web shows it; a paragraph indented in the editor
//   by its level, from where the template's paragraph starts;
// - a block with Arabic in it is right to left: w:bidi on the paragraph, w:rtl on its runs.

/** Half an inch, in twentieths of a point: one level of indent. */
export const INDENT_STEP = 720;
/** How far a bullet hangs before the text of its point. */
export const BULLET_HANG = 360;

/** The child elements of a paragraph's properties, in the order the schema wants them (CT_PPr). */
const P_ORDER = (
  'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku ' +
  'wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents ' +
  'suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange'
).split(' ');
/** The child elements of a run's properties, in the order the schema wants them (CT_RPr). */
const R_ORDER = (
  'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w ' +
  'kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange'
).split(' ');

/** What the paragraph holding the tag gives the paragraphs that replace it. */
export interface TagParagraph {
  /** The part's WordprocessingML prefix. */
  w: string;
  /** The paragraph's start tag (its attributes go to the first paragraph only: a paragraph's id is its own). */
  startTag: string;
  /** Its <w:pPr>, as written; null when it has none. */
  pPr: string | null;
  /** The <w:rPr> of the run the tag starts in, as written; null when it has none. */
  rPr: string | null;
  /** Markers that must not be lost (bookmarks, comment ranges), put in the first paragraph. */
  markers: string;
}

/** The paragraphs printing `blocks` in place of the tag's paragraph. */
export function richParagraphs(blocks: readonly RichBlock[], tag: TagParagraph): string {
  const { w } = tag;
  return blocks
    .map((block, i) => {
      const arabic = hasArabic(blockText(block));
      const p: Record<string, string | null> = { numPr: null, pPrChange: null };
      if (i < blocks.length - 1) p.sectPr = null;
      if (arabic) p.bidi = `<${w}:bidi/>`;
      if (block.marker !== null) p.ind = indent(tag.pPr, w, block.indent * INDENT_STEP, BULLET_HANG);
      else if (block.indent > 0) p.ind = indent(tag.pPr, w, block.indent * INDENT_STEP, null);
      const pPr = withProperties(tag.pPr, w, 'pPr', p, P_ORDER);

      const base: Record<string, string | null> = { rPrChange: null, ...(arabic && { rtl: `<${w}:rtl/>` }) };
      const runs: string[] = [];
      if (block.marker !== null) runs.push(`<${w}:r>${withProperties(tag.rPr, w, 'rPr', base, R_ORDER)}${texts(block.marker, w)}<${w}:tab/></${w}:r>`);
      for (const span of block.spans) {
        const r = { ...base };
        if (span.bold) Object.assign(r, { b: `<${w}:b/>`, bCs: `<${w}:bCs/>` });
        if (span.italic) Object.assign(r, { i: `<${w}:i/>`, iCs: `<${w}:iCs/>` });
        if (span.underline) r.u = `<${w}:u ${w}:val="single"/>`;
        runs.push(`<${w}:r>${withProperties(tag.rPr, w, 'rPr', r, R_ORDER)}${texts(span.text, w)}</${w}:r>`);
      }
      return `${i === 0 ? tag.startTag : `<${w}:p>`}${pPr}${i === 0 ? tag.markers : ''}${runs.join('')}</${w}:p>`;
    })
    .join('');
}

/** Text as <w:t> elements, its line breaks <w:br/>; xml:space="preserve" where it starts or ends with a space. */
function texts(text: string, w: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `<${w}:t${/^\s|\s$/.test(line) ? ' xml:space="preserve"' : ''}>${escapeText(line)}</${w}:t>` : ''))
    .join(`<${w}:br/>`);
}

/**
 * The paragraph's <w:ind> with its start moved in by `by` from the template paragraph's own start, and the first line
 * hanging by `hanging` (a list item), or as it was (a paragraph). Its end indent stays as it was. In a right-to-left
 * paragraph Word reads w:left as the start, on the right.
 */
function indent(pPr: string | null, w: string, by: number, hanging: number | null): string {
  const props = pPr ? parseXml(pPr).children[0] : undefined;
  const ind = props?.children.find((c) => c.name === `${w}:ind`);
  const own = ind ? pPr!.slice(ind.start, ind.openEnd) : '';
  const start = Number(ind && (attribute(pPr!, ind, `${w}:left`) ?? attribute(pPr!, ind, `${w}:start`))) || 0;
  const replaced = [...START_ATTRIBUTES, ...(hanging === null ? [] : FIRST_LINE_ATTRIBUTES)];
  const kept = [...own.matchAll(/\s([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g)]
    .filter((m) => !replaced.includes(m[1].slice(m[1].indexOf(':') + 1)))
    .map((m) => ` ${m[1]}=${m[2]}`);
  const hangs = hanging === null ? '' : ` ${w}:hanging="${hanging}"`;
  return `<${w}:ind${kept.join('')} ${w}:left="${start + by}"${hangs}/>`;
}

/** The attributes of <w:ind> that say where a paragraph starts, and where its first line starts. */
const START_ATTRIBUTES = ['left', 'start', 'leftChars', 'startChars'];
const FIRST_LINE_ATTRIBUTES = ['hanging', 'hangingChars', 'firstLine', 'firstLineChars'];

/**
 * Properties (<w:pPr>, <w:rPr>) with some child elements replaced: each key of `changes` a child's local name, its
 * value the element to put in its place (where the schema's order wants it), or null to take it out. The other
 * children stay as written. Empty when nothing is left.
 */
export function withProperties(
  xml: string | null,
  w: string,
  name: 'pPr' | 'rPr',
  changes: Readonly<Record<string, string | null>>,
  order: readonly string[],
): string {
  const props = xml ? parseXml(xml).children[0] : undefined;
  const prefix = `${w}:`;
  const local = (qname: string) => (qname.startsWith(prefix) ? qname.slice(prefix.length) : null);
  const rank = (qname: string) => {
    const l = local(qname);
    return l === null ? -1 : order.indexOf(l);
  };
  const children = (props?.children ?? [])
    .filter((c) => {
      const l = local(c.name);
      return l === null || !Object.hasOwn(changes, l);
    })
    .map((c) => ({ name: c.name, xml: xml!.slice(c.start, c.end) }));

  const added = Object.entries(changes)
    .filter((e): e is [string, string] => e[1] !== null)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  for (const [l, element] of added) {
    const at = order.indexOf(l);
    // before the first child the schema puts after it, or before another namespace's (w14:…), which come last
    let i = children.findIndex((c) => (local(c.name) === null ? true : rank(c.name) > at));
    if (i < 0) i = children.length;
    children.splice(i, 0, { name: `${prefix}${l}`, xml: element });
  }
  if (!children.length) return '';
  const startTag = props && !props.empty ? xml!.slice(props.start, props.openEnd) : `<${w}:${name}>`;
  return `${startTag}${children.map((c) => c.xml).join('')}</${w}:${name}>`;
}
