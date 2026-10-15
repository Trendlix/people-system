import { pdfFieldBoxes, pdfFieldGroups, type PdfField, type PdfPageSize, type PdfRect } from '@trendlix/shared';

// The arithmetic of Place Fields (a PDF template's fields placed on the form, owner's decision, 15 October 2026): screen
// pixels and PDF points, a field moved, resized or drawn without leaving its page, the boxes of a boxes field (their
// groups typed as "4+2+2", one box nudged on its own), a field duplicated, whether anything changed since the last save,
// and which field the API's refusal names. Points run from the page's top-left corner, as pdf.js shows the page at
// scale 1, so a screen pixel is a point × the zoom. Pure code, tested; no "@/" imports.

export interface Point {
  x: number;
  y: number;
}

/** The corners and edges a selected field is resized by. */
export const GRIPS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Grip = (typeof GRIPS)[number];

/** The smallest a field can be, in points. */
export const MIN_SIZE = 4;

/** An arrow key moves the selected field (or box) this far, in points; with Shift, NUDGE_BIG. */
export const NUDGE = 0.5;
export const NUDGE_BIG = 5;

/** The most boxes one field can have. */
export const BOXES_MAX = 60;

/** The zoom can't go below or above these (fit width on a very narrow or very wide screen). */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/** To a hundredth of a point: what the editor keeps (a drag gives any fraction). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Screen pixels at a zoom → points, and back. */
export const toPoints = (px: number, scale: number) => px / scale;
export const toScreen = (pt: number, scale: number) => pt * scale;

/** Where a pointer is on a page, in points, from the page's place on screen (its top-left corner) and the zoom. */
export function pointOnPage(clientX: number, clientY: number, page: { left: number; top: number }, scale: number): Point {
  return { x: toPoints(clientX - page.left, scale), y: toPoints(clientY - page.top, scale) };
}

/** The zoom at which the widest page fills `available` pixels (Fit width). */
export function fitScale(available: number, pages: readonly PdfPageSize[]): number {
  const widest = Math.max(0, ...pages.map((p) => p.width));
  if (!(available > 0) || !(widest > 0)) return 1;
  return clamp(available / widest, SCALE_MIN, SCALE_MAX);
}

/** A rectangle made to fit on its page: at least `min` points each way, at most the page, and wholly on it. */
export function clampRect(r: PdfRect, page: PdfPageSize, min = MIN_SIZE): PdfRect {
  const width = round2(clamp(r.width, Math.min(min, page.width), page.width));
  const height = round2(clamp(r.height, Math.min(min, page.height), page.height));
  // rounded first, then kept off the far edge: x + width never passes the page by a rounding
  const x = Math.min(round2(clamp(r.x, 0, page.width - width)), Math.floor((page.width - width) * 100) / 100);
  const y = Math.min(round2(clamp(r.y, 0, page.height - height)), Math.floor((page.height - height) * 100) / 100);
  return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

/** A rectangle moved by dx, dy points, its size kept, stopped at the page's edges. */
export function moveRect(r: PdfRect, dx: number, dy: number, page: PdfPageSize): PdfRect {
  return clampRect({ ...r, x: r.x + dx, y: r.y + dy }, page);
}

/** A rectangle resized by one of its grips, moved dx, dy points: the far side stays, never past the page or under `min`. */
export function resizeRect(r: PdfRect, grip: Grip, dx: number, dy: number, page: PdfPageSize, min = MIN_SIZE): PdfRect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  if (grip.includes('w')) left = clamp(left + dx, 0, right - min);
  if (grip.includes('e')) right = clamp(right + dx, left + min, page.width);
  if (grip.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (grip.includes('s')) bottom = clamp(bottom + dy, top + min, page.height);
  return clampRect({ x: left, y: top, width: right - left, height: bottom - top }, page, min);
}

/**
 * The rectangle a new field takes: dragged from `a` to `b`, or (a click: moved less than `click` points) the default
 * size centred on where it was clicked. Always on the page.
 */
export function drawnRect(a: Point, b: Point, page: PdfPageSize, size: { width: number; height: number }, click = 2): PdfRect {
  if (Math.abs(b.x - a.x) < click && Math.abs(b.y - a.y) < click) {
    return clampRect({ x: a.x - size.width / 2, y: a.y - size.height / 2, width: size.width, height: size.height }, page);
  }
  return clampRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }, page);
}

/** How far an arrow key moves: NUDGE points, NUDGE_BIG with Shift; null for any other key. */
export function arrowDelta(key: string, shift: boolean): Point | null {
  const step = shift ? NUDGE_BIG : NUDGE;
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

/** A field with a new place or size: only its rectangle changes. */
export const withRect = (field: PdfField, r: PdfRect): PdfField => ({ ...field, x: r.x, y: r.y, width: r.width, height: r.height });

// ---------- boxes ----------

/** "4+2+2" (or "4 2 2", "4,2,2"): the groups, which must add up to the boxes; empty, or one group of all: none. */
export function parseGroups(text: string, boxes: number): { groups: number[] | undefined } | { error: string } {
  const typed = text.trim();
  if (!typed) return { groups: undefined };
  const parts = typed.split(/\s*[+,\s]\s*/);
  if (!parts.every((p) => /^\d{1,2}$/.test(p) && Number(p) > 0)) return { error: 'Type the groups as numbers joined by +, e.g. 4+2+2.' };
  const groups = parts.map(Number);
  const sum = groups.reduce((a, b) => a + b, 0);
  if (sum !== boxes) return { error: `The groups add up to ${sum}: they must add up to the ${boxes} boxes.` };
  return { groups: groups.length > 1 ? groups : undefined };
}

/** Groups as they are typed: [4, 2, 2] → "4+2+2"; none → "". */
export const groupsText = (groups: readonly number[] | undefined) => (groups && groups.length > 1 ? groups.join('+') : '');

/** How many boxes a boxes field has. */
export const boxCount = (field: Pick<PdfField, 'boxes' | 'groups'>) => pdfFieldGroups(field).reduce((a, b) => a + b, 0);

/** Nudges as kept: rounded, without the zero ones at the end; none when no box is moved. */
export function cleanNudges(nudges: readonly ({ dx: number; dy: number } | null | undefined)[] | undefined, boxes: number): { dx: number; dy: number }[] | undefined {
  const dense = Array.from({ length: boxes }, (_, i) => ({ dx: round2(nudges?.[i]?.dx ?? 0), dy: round2(nudges?.[i]?.dy ?? 0) }));
  while (dense.length && dense[dense.length - 1].dx === 0 && dense[dense.length - 1].dy === 0) dense.pop();
  return dense.length ? dense : undefined;
}

/** A boxes field with another number of boxes: its groups kept only while they still add up, nudges past the end dropped. */
export function setBoxCount(field: PdfField, boxes: number): PdfField {
  const n = clamp(Math.round(boxes) || 1, 1, BOXES_MAX);
  const groups = field.groups && field.groups.reduce((a, b) => a + b, 0) === n ? field.groups : undefined;
  return { ...field, boxes: n, groups, nudges: cleanNudges(field.nudges, n) };
}

/** Which box of a boxes field a point is in (its index, left to right); the nearest one when it is between them; else null. */
export function boxAt(field: PdfField, p: Point): number | null {
  const rects = pdfFieldBoxes(field);
  const inside = rects.findIndex((r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height);
  if (inside >= 0) return inside;
  if (p.x < field.x || p.x > field.x + field.width || p.y < field.y || p.y > field.y + field.height) return null;
  let best = 0;
  let distance = Infinity;
  rects.forEach((r, i) => {
    const d = Math.hypot(r.x + r.width / 2 - p.x, r.y + r.height / 2 - p.y);
    if (d < distance) [best, distance] = [i, d];
  });
  return rects.length ? best : null;
}

/** One box of a boxes field moved by dx, dy points on its own (its nudge), without leaving the page. */
export function nudgeBox(field: PdfField, index: number, dx: number, dy: number, page: PdfPageSize): PdfField {
  const boxes = boxCount(field);
  if (index < 0 || index >= boxes) return field;
  const base = pdfFieldBoxes({ ...field, nudges: undefined })[index];
  const was = field.nudges?.[index] ?? { dx: 0, dy: 0 };
  const nudges = Array.from({ length: boxes }, (_, i) => field.nudges?.[i] ?? { dx: 0, dy: 0 });
  nudges[index] = {
    dx: clamp(was.dx + dx, -base.x, page.width - base.width - base.x),
    dy: clamp(was.dy + dy, -base.y, page.height - base.height - base.y),
  };
  return { ...field, nudges: cleanNudges(nudges, boxes) };
}

// ---------- fields ----------

/** A short id no other field of the version has (crypto's where the browser gives it, as on http://localhost or https). */
export function newFieldId(taken: ReadonlySet<string>, random: () => string = randomId): string {
  for (;;) {
    const id = random().replace(/[^0-9a-z]/gi, '').slice(0, 8);
    if (id && !taken.has(id)) return id;
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** A copy of a field, a little down and to the right of it (up and to the left at the page's corner), under a new id. */
export function duplicateField(field: PdfField, id: string, page: PdfPageSize, offset = 10): PdfField {
  let r = moveRect(field, offset, offset, page);
  if (r.x === field.x && r.y === field.y) r = moveRect(field, -offset, -offset, page);
  return withRect({ ...field, id }, r);
}

/**
 * A field as it is kept and compared: rounded to a hundredth of a point, keys in one order, and what means nothing left
 * out (an option off, an empty text or list, boxes that aren't moved).
 */
export function cleanField(field: PdfField): PdfField {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(field).sort() as (keyof PdfField)[]) {
    let value: unknown = field[key];
    if (key === 'tag') value = value || null;
    else if (key === 'nudges') value = cleanNudges(field.nudges, boxCount(field));
    else if (key === 'groups') value = field.groups && field.groups.length > 1 ? [...field.groups] : undefined;
    else if (typeof value === 'number') value = round2(value);
    if (key !== 'tag' && (value === undefined || value === null || value === false || value === '')) continue;
    out[key] = value;
  }
  return out as unknown as PdfField;
}

/** Whether the fields differ from those saved: a field added, removed, moved, or any of its options changed. */
export function fieldsDirty(saved: readonly PdfField[], current: readonly PdfField[]): boolean {
  if (saved.length !== current.length) return true;
  return JSON.stringify(saved.map(cleanField)) !== JSON.stringify(current.map(cleanField));
}

/**
 * The field a refusal from the API is about, to select it: its id named in the message, "field 3" (counted from 1), or a
 * tag only one field prints. Null when the message names none.
 */
export function fieldInMessage(message: string, fields: readonly PdfField[]): string | null {
  const words = new Set(message.match(/[A-Za-z0-9_]+/g) ?? []);
  const byId = fields.find((f) => words.has(f.id));
  if (byId) return byId.id;
  const numbered = /\bfield\s+#?(\d{1,3})\b/i.exec(message);
  if (numbered && fields[Number(numbered[1]) - 1]) return fields[Number(numbered[1]) - 1].id;
  for (const word of words) {
    const tagged = fields.filter((f) => f.tag === word);
    if (tagged.length === 1) return tagged[0].id;
  }
  return null;
}
