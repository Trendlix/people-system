import { applyEdits, attribute, innerText, parseXml, removal, wordPrefix, type XmlEdit, type XmlElement } from './xml.js';

// Word fields unwrapped to the text they show (owner's request, 15 October 2026). The owner's contract was a mail
// merge: each {{tag}} sits inside an old MERGEFIELD as its displayed result. Left as a field, Word may update it on
// opening or printing and put back «الأسم», or the merge source's value, over the filled-in one. Every other field
// would go stale the same way (a DATE field showing the day it is opened, not the day the contract was made), so all
// fields become their displayed result: plain runs, with the formatting they had.
//
// The exception is page numbering (PAGE, NUMPAGES, SECTIONPAGES): it must stay live so the footers count the pages of
// this document. A field kept keeps everything inside it.
//
// - A simple field <w:fldSimple w:instr="…">runs</w:fldSimple> becomes its runs.
// - A complex field is a sequence of runs: <w:fldChar begin/>, the instruction (<w:instrText>, possibly with fields
//   of its own), <w:fldChar separate/>, the result, <w:fldChar end/>. Only the result's runs are kept; the field
//   characters and the instruction (with any field inside it) go. The pieces are run children and may share runs with
//   each other (Word often writes the last bit of instruction and the separator in one run), so they are removed one
//   by one, and a run left with nothing but its properties is removed too. Paragraphs, bookmarks and the like between
//   them stay. A field with no result (no separator) disappears.
// - A field cut short (no end) is left alone. A text box is a story of its own: its fields don't mix with the
//   paragraph holding it.

const LIVE_FIELDS = new Set(['PAGE', 'NUMPAGES', 'SECTIONPAGES']);

type FieldState = 'keep' | 'unwrap' | 'dead';

interface Field {
  chars: XmlElement[]; // begin, separate, end
  instruction: string;
  phase: 'instruction' | 'result';
  parent: Field | null;
  /** Began inside its parent's instruction. */
  inInstruction: boolean;
  complete: boolean;
  state?: FieldState;
}

interface Piece {
  el: XmlElement;
  owner: Field | null;
  phase: Field['phase'] | null;
}

/** The first word of a field's instruction, e.g. "MERGEFIELD", "PAGE". */
export function fieldKeyword(instruction: string): string {
  return instruction.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
}

/** The part's XML with its fields unwrapped, page numbering excepted; unchanged when it has none. */
export function unwrapFields(xml: string): string {
  if (!/fldChar|fldSimple/.test(xml)) return xml;
  const w = wordPrefix(xml);
  const R = `${w}:r`;
  const RPR = `${w}:rPr`;
  const FLD_CHAR = `${w}:fldChar`;
  const FLD_SIMPLE = `${w}:fldSimple`;
  const INSTRUCTIONS = new Set([`${w}:instrText`, `${w}:delInstrText`]);
  const STORIES = new Set([`${w}:txbxContent`, `${w}:footnote`, `${w}:endnote`, `${w}:comment`]);

  const fields: Field[] = [];
  const pieces: Piece[] = []; // run children other than field characters
  const runs: { run: XmlElement; children: XmlElement[] }[] = [];
  const simples: Piece[] = [];

  const visit = (el: XmlElement, stack: Field[]) => {
    for (const child of el.children) {
      if (STORIES.has(child.name)) {
        visit(child, []);
      } else if (child.name === R) {
        visitRun(child, stack);
      } else {
        if (child.name === FLD_SIMPLE) simples.push(at(child, stack));
        visit(child, stack);
      }
    }
  };
  const at = (el: XmlElement, stack: Field[]): Piece => {
    const owner = stack[stack.length - 1] ?? null;
    return { el, owner, phase: owner?.phase ?? null };
  };
  const visitRun = (run: XmlElement, stack: Field[]) => {
    const children = run.children.filter((c) => c.name !== RPR);
    runs.push({ run, children });
    for (const child of children) {
      const top = stack[stack.length - 1];
      if (child.name === FLD_CHAR) {
        const type = attribute(xml, child, `${w}:fldCharType`);
        if (type === 'begin') {
          const field: Field = { chars: [child], instruction: '', phase: 'instruction', parent: top ?? null, inInstruction: top?.phase === 'instruction', complete: false };
          fields.push(field);
          stack.push(field);
        } else if (top && type === 'separate') {
          top.chars.push(child);
          top.phase = 'result';
        } else if (top && type === 'end') {
          top.chars.push(child);
          top.complete = true;
          stack.pop();
        }
        continue; // a stray separator or end is left as it is
      }
      pieces.push(at(child, stack));
      if (top?.phase === 'instruction' && INSTRUCTIONS.has(child.name)) top.instruction += innerText(xml, child);
      visit(child, stack); // a drawing's text box
    }
  };
  visit(parseXml(xml), []);
  if (!fields.length && !simples.length) return xml;

  // parents come before their children
  for (const field of fields) {
    const parent = field.parent?.state;
    if (parent === 'dead' || (parent === 'unwrap' && field.inInstruction)) field.state = 'dead';
    else if (parent === 'keep' || !field.complete || LIVE_FIELDS.has(fieldKeyword(field.instruction))) field.state = 'keep';
    else field.state = 'unwrap';
  }
  const dropped = new Set<XmlElement>();
  const goes = ({ owner, phase }: Piece) => owner !== null && (owner.state === 'dead' || (owner.state === 'unwrap' && phase === 'instruction'));
  for (const field of fields) if (field.state !== 'keep') for (const char of field.chars) dropped.add(char);
  for (const piece of pieces) if (goes(piece)) dropped.add(piece.el);

  const edits: XmlEdit[] = [];
  for (const { run, children } of runs) {
    const gone = children.filter((c) => dropped.has(c));
    if (!gone.length) continue;
    if (gone.length === children.length) edits.push(removal(run));
    else edits.push(...gone.map(removal));
  }
  for (const piece of simples) {
    const { el } = piece;
    if (piece.owner?.state === 'keep') continue; // inside a field kept
    if (goes(piece)) {
      edits.push(removal(el)); // part of an instruction going
      continue;
    }
    if (LIVE_FIELDS.has(fieldKeyword(attribute(xml, el, `${w}:instr`) ?? ''))) continue;
    if (el.empty) {
      edits.push(removal(el));
      continue;
    }
    edits.push({ start: el.start, end: el.openEnd, text: '' }, { start: el.closeStart, end: el.end, text: '' });
    for (const data of el.children) if (data.name === `${w}:fldData`) edits.push(removal(data));
  }
  return applyEdits(xml, edits);
}
