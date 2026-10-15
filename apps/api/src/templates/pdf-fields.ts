import {
  PDF_DATE_ORDERS,
  PDF_FIELD_ALIGNS,
  PDF_FIELD_KINDS,
  PDF_FIELDS_MAX,
  PDF_FONT_SIZE_MAX,
  PDF_FONT_SIZE_MIN,
  TEMPLATE_TAGS,
  type PdfField,
  type PdfPageSize,
} from '@trendlix/shared';

// The fields HR places on a PDF template (owner's decision, 15 October 2026), checked before they are saved, used for a
// sample or set by a starter layout: each one on a page of the form and inside it, printing a tag the system knows (a
// fixed field its own text), at a size that prints. Problems are answered in words HR act on, naming the field (its
// tag, else its kind) and its page; the first one found.

const TAGS = new Map(TEMPLATE_TAGS.map((t) => [t.tag, t]));

/** A field may stick out of its page by this much, in points: a box drawn on the page's very edge. */
const EDGE = 1;
export const PDF_BOXES_MAX = 40;
/** How far one box can be moved from its place, in points. */
export const PDF_NUDGE_MAX = 20;
export const PDF_FIELD_ID_MAX = 40;
export const PDF_FIELD_TEXT_MAX = 200;
export const PDF_FIELD_EQUALS_MAX = 100;

const KIND_NAMES: Record<string, string> = { text: 'text field', boxes: 'boxes', check: 'check box', fixed: 'fixed text' };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isString = (s: unknown): s is string => typeof s === 'string';

/** "The boxes for "National ID number" on page 1", "A fixed text on page 2" (without the page when it is the problem). */
function nameOf(f: PdfField, withPage = true): string {
  const kind = KIND_NAMES[f.kind] ?? 'field';
  const tag = isString(f.tag) ? TAGS.get(f.tag) : undefined;
  const page = withPage && Number.isInteger(f.page) ? ` on page ${f.page}` : '';
  return tag ? `The ${kind} for "${tag.labelEn}"${page}` : `${/^[aeiou]/.test(kind) ? 'An' : 'A'} ${kind}${page}`;
}

/** Why one field can't be saved; null when it can. */
function fieldProblem(f: PdfField, pages: readonly PdfPageSize[]): string | null {
  const name = nameOf(f);
  if (!(PDF_FIELD_KINDS as readonly string[]).includes(f.kind)) return `${name} is of an unknown kind. Choose text, boxes, a check box or fixed text.`;
  if (!isString(f.id) || !f.id.trim() || f.id.length > PDF_FIELD_ID_MAX) return `${name} needs an id of 1 to ${PDF_FIELD_ID_MAX} characters.`;

  // what it prints
  if (f.kind === 'text' || f.kind === 'boxes') {
    if (!isString(f.tag) || !f.tag) return `${name} prints nothing: choose the field it prints.`;
    if (!TAGS.has(f.tag)) return `${name} prints {{${f.tag}}}, which the system doesn't know. Choose another field.`;
  } else if (f.kind === 'check') {
    if (f.tag !== null && f.tag !== undefined) {
      if (!isString(f.tag) || !TAGS.has(f.tag)) return `${name} depends on {{${String(f.tag)}}}, which the system doesn't know. Choose another field.`;
      if (!isString(f.equals) || !f.equals.trim()) return `${name} needs the value that ticks it.`;
    }
  } else if (f.kind === 'fixed') {
    if (f.tag !== null && f.tag !== undefined) return `${name} prints its own text, not a field: remove the field from it.`;
    if (!isString(f.text) || !f.text.trim()) return `${name} has no text: type what it prints.`;
  }
  if (f.text !== undefined && f.text !== null && (!isString(f.text) || f.text.length > PDF_FIELD_TEXT_MAX)) {
    return `${name}: keep its text to ${PDF_FIELD_TEXT_MAX} characters or fewer.`;
  }
  if (f.equals !== undefined && f.equals !== null && (!isString(f.equals) || f.equals.length > PDF_FIELD_EQUALS_MAX)) {
    return `${name}: keep the value that ticks it to ${PDF_FIELD_EQUALS_MAX} characters or fewer.`;
  }

  // where it is
  if (!Number.isInteger(f.page) || f.page < 1 || f.page > pages.length) {
    return `${nameOf(f, false)} is on page ${String(f.page)}, but the form has ${pages.length === 1 ? '1 page' : `${pages.length} pages`}.`;
  }
  const page = pages[f.page - 1];
  if (![f.x, f.y, f.width, f.height].every(finite) || f.width <= 0 || f.height <= 0) return `${name} has no size: draw it again.`;
  if (f.x < -EDGE || f.y < -EDGE || f.x + f.width > page.width + EDGE || f.y + f.height > page.height + EDGE) {
    return `${name} goes past the edge of the page: move it inside the page.`;
  }

  // how it prints
  if (!finite(f.fontSize) || f.fontSize < PDF_FONT_SIZE_MIN || f.fontSize > PDF_FONT_SIZE_MAX) {
    return `${name}: choose a text size of ${PDF_FONT_SIZE_MIN} to ${PDF_FONT_SIZE_MAX} points.`;
  }
  if (f.align !== undefined && !(PDF_FIELD_ALIGNS as readonly string[]).includes(f.align)) return `${name}: align it right, center or left.`;
  if ([f.bold, f.shrinkToFit, f.arabicDigits].some((flag) => flag !== undefined && typeof flag !== 'boolean')) {
    return `${name}: bold, shrink to fit and Arabic digits are each on or off.`;
  }
  if (f.kind === 'boxes') {
    if (!Number.isInteger(f.boxes) || f.boxes! < 1 || f.boxes! > PDF_BOXES_MAX) return `${name} must cover 1 to ${PDF_BOXES_MAX} boxes.`;
    const boxes = f.boxes!;
    if (f.groups !== undefined) {
      if (!Array.isArray(f.groups) || !f.groups.length || !f.groups.every((g) => Number.isInteger(g) && g > 0)) return `${name}: each group needs 1 box or more.`;
      const total = f.groups.reduce((a, b) => a + b, 0);
      if (total !== boxes) return `${name}: its groups add up to ${total} ${total === 1 ? 'box' : 'boxes'}, not ${boxes}.`;
    }
    for (const gap of [f.groupGap, f.boxGap]) {
      if (gap !== undefined && (!finite(gap) || gap < 0)) return `${name}: the space between boxes can't be less than 0.`;
    }
    if (f.nudges !== undefined) {
      if (!Array.isArray(f.nudges) || f.nudges.length > boxes) return `${name} has more moved boxes than boxes.`;
      const far = f.nudges.some((n) => !n || !finite(n.dx) || !finite(n.dy) || Math.abs(n.dx) > PDF_NUDGE_MAX || Math.abs(n.dy) > PDF_NUDGE_MAX);
      if (far) return `${name}: a box can be moved by at most ${PDF_NUDGE_MAX} points.`;
    }
    if (f.boxAlign !== undefined && f.boxAlign !== 'left' && f.boxAlign !== 'right') return `${name}: start the value in the left-most or the right-most box.`;
    if (f.dateOrder !== undefined && !(PDF_DATE_ORDERS as readonly string[]).includes(f.dateOrder)) return `${name}: put the date in its boxes as YMD or DMY.`;
    if (f.amountPart !== undefined && f.amountPart !== 'pounds' && f.amountPart !== 'piasters') return `${name}: print the pounds or the piastres of the amount.`;
  }
  return null;
}

/** Why the fields can't be saved, in words HR act on; null when they can. */
export function pdfFieldsProblem(fields: readonly PdfField[], pages: readonly PdfPageSize[]): string | null {
  if (!Array.isArray(fields)) return 'Send the fields as a list.';
  if (fields.length > PDF_FIELDS_MAX) return `A form can have at most ${PDF_FIELDS_MAX} fields; this one has ${fields.length}.`;
  const ids = new Set<string>();
  for (const f of fields) {
    if (!f || typeof f !== 'object') return 'Each field must have its kind, page, position and size.';
    const problem = fieldProblem(f, pages);
    if (problem) return problem;
    if (ids.has(f.id)) return `Two fields have the id "${f.id}": each field needs its own.`;
    ids.add(f.id);
  }
  return null;
}

/** The tags the fields print (text, boxes, and a check box that depends on one), each once, down the pages: by page, then from the top, then from the left. */
export function pdfFieldTags(fields: readonly PdfField[]): string[] {
  const tagged = fields.filter((f): f is PdfField & { tag: string } => f.kind !== 'fixed' && isString(f.tag) && f.tag !== '');
  const ordered = [...tagged].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  return [...new Set(ordered.map((f) => f.tag))];
}

/** The fields as plain objects with only what a field has (what a request sends is a DTO instance), to keep as JSON. */
export function plainPdfFields(fields: readonly PdfField[]): PdfField[] {
  return fields.map((f) => {
    const plain: PdfField = { id: f.id, kind: f.kind, tag: f.tag ?? null, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height, fontSize: f.fontSize };
    const optional = ['text', 'equals', 'bold', 'align', 'shrinkToFit', 'boxes', 'groups', 'groupGap', 'boxGap', 'boxAlign', 'dateOrder', 'amountPart', 'arabicDigits'] as const;
    for (const key of optional) if (f[key] !== undefined && f[key] !== null) Object.assign(plain, { [key]: Array.isArray(f[key]) ? [...(f[key] as number[])] : f[key] });
    if (f.nudges) plain.nudges = f.nudges.map((n) => ({ dx: n.dx, dy: n.dy }));
    return plain;
  });
}
