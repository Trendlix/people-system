import { formatHours, parseHours, type PayrollInputs } from '@trendlix/shared';

// The run's inputs grid (owner's decisions, 16 October 2026): the month's figures HR types for each employee, laid out
// like the owner's payroll sheet, until attendance fills the hours and days itself. Pure code, tested: the columns, how
// each cell is read and shown, which rows changed (only those are sent, in one PATCH /payroll/runs/:id/lines), and the
// API's refusals put by the cell they are about.

export type InputField = keyof PayrollInputs;

/**
 * How a cell is typed, and the limits the API checks: hours as attendance shows them ("270:00") or as a number
 * ("270.5"), up to 744 (31 days); percents 0 to 200; days 0 to 31, whole or half; amounts in EGP within ±10,000,000
 * (settlements may be negative: corrections); what was already released this month, 0 or more.
 */
export type FieldKind = 'hours' | 'percent' | 'days' | 'amount' | 'released';

export interface GridColumn {
  field: InputField;
  label: string;
  kind: FieldKind;
}

/** The typed columns, in the sheet's order. The attendance % between the hours and the KPIs is worked out from the hours. */
export const GRID_COLUMNS: readonly GridColumn[] = [
  { field: 'workedHours', label: 'Worked hours', kind: 'hours' },
  { field: 'expectedHours', label: 'Expected hours', kind: 'hours' },
  { field: 'softSkills', label: 'Soft skills %', kind: 'percent' },
  { field: 'performance', label: 'Performance %', kind: 'percent' },
  { field: 'clientSatisfaction', label: 'Client satisfaction %', kind: 'percent' },
  { field: 'noShowDays', label: 'No-show days', kind: 'days' },
  { field: 'penaltyDays', label: 'Penalty days', kind: 'days' },
  { field: 'bonusDays', label: 'Bonus days', kind: 'days' },
  { field: 'commission', label: 'Commission', kind: 'amount' },
  { field: 'settlements', label: 'Settlements', kind: 'amount' },
  { field: 'medical', label: 'Medical', kind: 'amount' },
  { field: 'released', label: 'Released', kind: 'released' },
];

const COLUMN = new Map(GRID_COLUMNS.map((c) => [c.field as string, c]));

export const HOURS_MAX = 744;
export const PERCENT_MAX = 200;
export const DAYS_MAX = 31;
export const AMOUNT_MAX = 10_000_000;

const HINTS: Record<FieldKind, string> = {
  hours: `Type the hours as 270:00 or 270.5, up to ${HOURS_MAX}.`,
  percent: `Type a percent from 0 to ${PERCENT_MAX}, e.g. 95.`,
  days: `Type the days from 0 to ${DAYS_MAX}, whole or half, e.g. 1.5.`,
  amount: 'Type an amount in EGP, e.g. 1,500 or -250.50.',
  released: 'Type an amount in EGP of 0 or more, e.g. 1,500.',
};

/** Arabic-Indic digits (٠-٩) typed on an Arabic keyboard become 0-9, and an Arabic decimal point a dot. */
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');

export type Parsed = { ok: true; value: number | null } | { ok: false; error: string };

const bad = (kind: FieldKind): Parsed => ({ ok: false, error: HINTS[kind] });

/** A cell as typed: its value (null when left empty), or why it can't be read. */
export function parseCell(kind: FieldKind, text: string): Parsed {
  const s = latin(text).trim();
  if (s === '') return { ok: true, value: null };
  if (kind === 'hours') {
    const hours = parseHours(s);
    return hours !== null && hours >= 0 && hours <= HOURS_MAX ? { ok: true, value: hours } : bad(kind);
  }
  if (kind === 'percent') {
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return bad(kind);
    const n = Number(s);
    return n <= PERCENT_MAX ? { ok: true, value: n } : bad(kind);
  }
  if (kind === 'days') {
    if (!/^\d+(\.(0|5|50))?$/.test(s)) return bad(kind);
    const n = Number(s);
    return n <= DAYS_MAX ? { ok: true, value: n } : bad(kind);
  }
  // an amount: "1,500", "1 500", "-250.50" (with a typed minus or a dash)
  const amount = s.replace(/[,\s]/g, '').replace(/^[−–]/, '-');
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) return bad(kind);
  const n = Number(amount);
  if (kind === 'released' && n < 0) return bad(kind);
  return Math.abs(n) <= AMOUNT_MAX ? { ok: true, value: n === 0 ? 0 : n } : bad(kind);
}

/** A saved value as its cell shows it: hours as attendance shows them ("270:30"), amounts with two decimals. */
export function cellText(kind: FieldKind, value: number | null): string {
  if (value === null) return '';
  if (kind === 'hours') return formatHours(value);
  if (kind === 'amount' || kind === 'released') return value.toFixed(2);
  return String(value);
}

/** A cell once its field is left: as `cellText` shows its value, or as typed when it can't be read (to be put right). */
export function tidyCell(kind: FieldKind, text: string): string {
  const parsed = parseCell(kind, text);
  return parsed.ok ? cellText(kind, parsed.value) : text;
}

/** The attendance a row's hours give, in percent (worked ÷ expected); null when either is missing or nothing is expected. */
export function attendancePercent(worked: number | null, expected: number | null): number | null {
  if (worked === null || expected === null || expected <= 0) return null;
  return Math.round((worked / expected) * 10_000) / 100;
}

// ---------- what changed ----------

/** A row as saved: what the grid compares the edits with. */
export interface GridLine {
  id: string;
  name: string;
  inputs: PayrollInputs;
  onHold: boolean;
  comments: string | null;
}

/** What was typed in a row and not saved yet: cells as typed, the hold and the comments. */
export interface RowEdits {
  inputs?: Partial<Record<InputField, string>>;
  onHold?: boolean;
  comments?: string;
}

/** The grid's unsaved edits, by line id. */
export type GridEdits = Record<string, RowEdits>;

/** One changed row, as PATCH /payroll/runs/:id/lines takes it: only what changed. */
export interface LinePatch {
  id: string;
  inputs?: Partial<PayrollInputs>;
  onHold?: boolean;
  comments?: string | null;
}

/** A cell typed wrongly, or refused by the API: `field` null for the row as a whole. */
export interface CellError {
  lineId: string;
  field: InputField | 'onHold' | 'comments' | null;
  message: string;
}

/** Comments as saved: trimmed, and none for empty. */
const commentsOf = (text: string) => text.trim() || null;

/** One row's changes against what is saved: the patch (null when nothing changed) and the cells that can't be read. */
function rowChanges(line: GridLine, edits: RowEdits | undefined): { patch: LinePatch | null; errors: CellError[]; count: number } {
  if (!edits) return { patch: null, errors: [], count: 0 };
  const errors: CellError[] = [];
  const inputs: Partial<PayrollInputs> = {};
  let count = 0;
  for (const [field, text] of Object.entries(edits.inputs ?? {}) as [InputField, string][]) {
    const column = COLUMN.get(field);
    if (!column) continue;
    const parsed = parseCell(column.kind, text);
    if (!parsed.ok) {
      errors.push({ lineId: line.id, field, message: parsed.error });
      count++;
    } else if (parsed.value !== line.inputs[field]) {
      inputs[field] = parsed.value;
      count++;
    }
  }
  const patch: LinePatch = { id: line.id };
  if (Object.keys(inputs).length > 0) patch.inputs = inputs;
  if (edits.onHold !== undefined && edits.onHold !== line.onHold) {
    patch.onHold = edits.onHold;
    count++;
  }
  if (edits.comments !== undefined && commentsOf(edits.comments) !== (line.comments?.trim() || null)) {
    patch.comments = commentsOf(edits.comments);
    count++;
  }
  return { patch: Object.keys(patch).length > 1 ? patch : null, errors, count };
}

/**
 * The edits as PATCH /payroll/runs/:id/lines takes them, only the rows and the cells that changed (a cell typed back to
 * what is saved isn't a change), and the cells that can't be read: nothing is sent while there are any.
 */
export function linePatches(lines: readonly GridLine[], edits: GridEdits): { patches: LinePatch[]; errors: CellError[] } {
  const patches: LinePatch[] = [];
  const errors: CellError[] = [];
  for (const line of lines) {
    const row = rowChanges(line, edits[line.id]);
    if (row.patch) patches.push(row.patch);
    errors.push(...row.errors);
  }
  return { patches, errors };
}

/** How many cells differ from what is saved (one typed wrongly counts), and in how many rows. */
export function unsavedCount(lines: readonly GridLine[], edits: GridEdits): { cells: number; rows: number } {
  let cells = 0;
  let rows = 0;
  for (const line of lines) {
    const { count } = rowChanges(line, edits[line.id]);
    cells += count;
    if (count > 0) rows++;
  }
  return { cells, rows };
}

/** "1 unsaved change", "5 unsaved changes in 2 rows". */
export function unsavedText({ cells, rows }: { cells: number; rows: number }): string {
  const changes = `${cells} unsaved ${cells === 1 ? 'change' : 'changes'}`;
  return rows > 1 ? `${changes} in ${rows} rows` : changes;
}

// ---------- the API's refusals ----------

const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(GRID_COLUMNS.map((c) => [c.field, c.label])),
  onHold: 'Hold',
  comments: 'Comments',
};

/** A field's name as the grid shows it: "Worked hours". */
export const fieldLabel = (field: CellError['field']) => (field ? (FIELD_LABELS[field] ?? field) : '');

/**
 * The API's messages put by the cell they are about. Its validation names a row by its place in what was sent and the
 * field ("lines.2.inputs.workedHours must not be greater than 744"), or a line by its id; each such message is kept
 * with that row and field, worded without the path ("Worked hours must not be greater than 744."). The rest are about
 * the save as a whole.
 */
export function placeApiErrors(messages: readonly string[], sent: readonly LinePatch[]): { cells: CellError[]; general: string[] } {
  const cells: CellError[] = [];
  const general: string[] = [];
  for (const message of messages) {
    const path = /^lines\.(\d+)(?:\.(?:inputs\.)?([A-Za-z]+))?\s*(.*)$/.exec(message);
    const line = path ? sent[Number(path[1])] : undefined;
    if (path && line) {
      const field = path[2] && path[2] in FIELD_LABELS ? (path[2] as CellError['field']) : null;
      const rest = path[3].trim();
      const words = field ? `${fieldLabel(field)} ${rest}` : rest || message;
      cells.push({ lineId: line.id, field, message: /[.!?]$/.test(words) ? words : `${words}.` });
      continue;
    }
    const byId = sent.find((l) => message.includes(l.id));
    if (byId) {
      cells.push({ lineId: byId.id, field: null, message });
      continue;
    }
    general.push(message);
  }
  return { cells, general };
}

/** A cell's error as listed above the grid: "Sara Adel · Worked hours: Type the hours as 270:00 or 270.5, up to 744." */
export function errorLine(error: CellError, name: string): string {
  const label = fieldLabel(error.field);
  const message = label && error.message.startsWith(label) ? error.message : label ? `${label}: ${error.message}` : error.message;
  return `${name} · ${message}`;
}
