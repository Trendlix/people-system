import {
  expectedHoursOf,
  formatHours,
  paidAdjustments,
  parseHours,
  type PayrollInputs,
  type PayrollLeaveDays,
  type PayrollResult,
  type PayrollSegment,
  type PayrollTerms,
} from '@trendlix/shared';
import { formatEgp } from '../../employees/[id]/contracts/salary';

// The run's inputs grid (owner's decisions, 16 October 2026): the month's figures HR types for each employee, laid out
// like the owner's payroll sheet, until attendance fills the hours and days itself; without the sheet's Medical column,
// as there is no medical subscription on the payroll any more (owner's decision, 16 October 2026). Without the sheet's
// Soft skills %, Performance % and Client satisfaction % columns either (owner, 16 October 2026: "this is going to be
// from the KPI's module, lets remove it till we work on it"): the KPIs module will fill those inputs, which the pay
// still counts; a line's step-by-step pay shows any it has, and the grid never sends them, so none saved is lost.
// The expected hours are filled in (owner, 17 October 2026: "prefill the expected hours, and dont count abcent days or
// leave days, as they already have their own deduction and fields"): the hours the run worked out from the shift less
// the holidays (owner's request, 16 October 2026, Payroll Setup), less a day of the shift for each no-show and leave
// day typed in the row, as the pay counts them (expectedHoursOf); they follow those days as they are typed. What HR
// types instead is taken as the expected hours already without the no-show and leave days, nothing more taken out, and
// clearing it brings the shift's back; the figure filled in is only shown, never sent. The Attendance % is the worked
// hours over those expected hours, as the pay counts it. Leave days (approved paid leave: nothing cut) and Unpaid leave
// days (unpaid leave, and the unpaid share of a partly paid one such as sick leave below 100%: a day of the gross ÷ the
// day divisor cut for each) are filled in from the leave approved for the month (owner, 18 October 2026: "can you apply
// the leaves according to the law?"; leaveFill), marked "from leave" as the expected hours are "from the shift": only
// shown, never sent; what HR types instead wins, and clearing it brings the leave's back. A month under two contracts
// (owner, 17 October 2026: "take into consideration the start and end date of the contract if it is in the middle of
// the billing period") says so by the employee's name (contractsNote). The Penalty days, Bonus days, Commission and Settlements columns are gone (owner,
// 17 October 2026, pointing at them: "instead of there, i think earnings and deductions will be enough"; he chose "Yes,
// as proposed"): two read-only columns, Earnings and Deductions, show the month's totals of the person's additions and
// deductions as the line has them (the taxed and untaxed additions together, marked when some aren't taxed; the
// deductions after tax), each opening that person's month on Additions / Deductions, the one place to enter them. A
// draft's line is worked out again whenever one of them changes, so the totals follow. Released (it changes the bank
// transfer, not the pay), Hold and Comments stay. The CEO fills the C-level people's lines, HR the rest (owner, 19
// October 2026: "the CEO fills their inputs"): a row the caller doesn't fill is read only, and never sent. Pure code,
// tested: the columns, how each cell is read and shown, which rows changed (only those are sent, in one PATCH
// /payroll/runs/:id/lines), and the API's refusals put by the cell they are about.

/** The inputs HR types on the grid: not the CEO's attendance waiver (17 October 2026), which the results table has. */
export type InputField = Exclude<keyof PayrollInputs, 'attendanceWaived'>;

/**
 * How a cell is typed, and the limits the API checks: hours as attendance shows them ("270:00") or as a number
 * ("270.5"), up to 744 (31 days); days 0 to 31, whole or half; what was already released this month, in EGP, 0 or
 * more, up to 10,000,000.
 */
export type FieldKind = 'hours' | 'days' | 'released';

export interface GridColumn {
  field: InputField;
  label: string;
  kind: FieldKind;
}

/**
 * The typed columns, in the sheet's order. The attendance % after the hours is worked out from them; the Earnings and
 * Deductions (read only, 17 October 2026) come after the leave days, where the bonus and penalty days, commission and
 * settlements were.
 */
export const GRID_COLUMNS: readonly GridColumn[] = [
  { field: 'workedHours', label: 'Worked hours', kind: 'hours' },
  { field: 'expectedHours', label: 'Expected hours', kind: 'hours' },
  { field: 'noShowDays', label: 'No-show days', kind: 'days' },
  { field: 'leaveDays', label: 'Leave days', kind: 'days' },
  // unpaid leave (owner, 18 October 2026), beside the paid leave days
  { field: 'unpaidLeaveDays', label: 'Unpaid leave days', kind: 'days' },
  { field: 'released', label: 'Released', kind: 'released' },
];

/** The Earnings and Deductions columns come after this one. */
export const ITEMS_AFTER: InputField = 'unpaidLeaveDays';

const COLUMN = new Map(GRID_COLUMNS.map((c) => [c.field as string, c]));

export const HOURS_MAX = 744;
export const DAYS_MAX = 31;
export const AMOUNT_MAX = 10_000_000;

const HINTS: Record<FieldKind, string> = {
  hours: `Type the hours as 270:00 or 270.5, up to ${HOURS_MAX}.`,
  days: `Type the days from 0 to ${DAYS_MAX}, whole or half, e.g. 1.5.`,
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
  if (kind === 'days') {
    if (!/^\d+(\.(0|5|50))?$/.test(s)) return bad(kind);
    const n = Number(s);
    return n <= DAYS_MAX ? { ok: true, value: n } : bad(kind);
  }
  // an amount: "1,500", "1 500", "250.50"; none below 0 (a minus typed, or a dash, is refused)
  const amount = s.replace(/[,\s]/g, '').replace(/^[−–]/, '-');
  if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) return bad(kind);
  const n = Number(amount);
  if (n < 0) return bad(kind);
  return n <= AMOUNT_MAX ? { ok: true, value: n === 0 ? 0 : n } : bad(kind);
}

/** A saved value as its cell shows it: hours as attendance shows them ("270:30"), amounts with two decimals. */
export function cellText(kind: FieldKind, value: number | null): string {
  if (value === null) return '';
  if (kind === 'hours') return formatHours(value);
  if (kind === 'released') return value.toFixed(2);
  return String(value);
}

/** A cell once its field is left: as `cellText` shows its value, or as typed when it can't be read (to be put right). */
export function tidyCell(kind: FieldKind, text: string): string {
  const parsed = parseCell(kind, text);
  return parsed.ok ? cellText(kind, parsed.value) : text;
}

/**
 * The attendance a row's hours give, in percent: worked ÷ expected, the expected hours already without the no-show and
 * leave days (expectedCell); null when either is missing, or nothing is expected.
 */
export function attendancePercent(worked: number | null, expected: number | null): number | null {
  if (worked === null || expected === null || expected <= 0) return null;
  return Math.round((worked / expected) * 10_000) / 100;
}

/**
 * The expected hours a row counts, as its Expected hours cell shows them (owner, 17 October 2026: "prefill the expected
 * hours, and dont count abcent days or leave days, as they already have their own deduction and fields"): HR's figure
 * when typed (or saved), taken as it is; else the shift's hours for the month less a day of the shift for each no-show
 * and leave day in the row (`fromShift`), as payrollLine counts them (expectedHoursOf); null when neither (no shift, or
 * by the hour, with nothing typed).
 */
export function expectedCell(
  row: { shiftExpectedHours: number | null; hoursPerDay: number | null; leave?: PayrollLeaveDays | null },
  cells: Pick<PayrollInputs, 'expectedHours' | 'noShowDays' | 'leaveDays' | 'unpaidLeaveDays'>,
): { hours: number | null; fromShift: boolean } {
  if (cells.expectedHours !== null) return { hours: cells.expectedHours, fromShift: false };
  // the leave days filled in from the leave count as typed ones (leaveDaysOf, in expectedHoursOf)
  const hours = expectedHoursOf({ expectedHours: row.shiftExpectedHours, hoursPerDay: row.hoursPerDay, leave: row.leave ?? null }, cells);
  return { hours, fromShift: hours !== null };
}

/** The columns the leave approved for the month fills in (owner, 18 October 2026). */
export const LEAVE_FIELDS: readonly InputField[] = ['leaveDays', 'unpaidLeaveDays'];

/**
 * The days a Leave days or Unpaid leave days cell is filled in with when HR hasn't typed any (owner, 18 October 2026: the
 * Leave module fills the leave days): the month's approved paid leave, and its unpaid leave with the unpaid share of a
 * partly paid one, as the run took them (PayrollTerms.leave); null for the other cells, and without any.
 */
export function leaveFill(leave: PayrollLeaveDays | null | undefined, field: InputField): number | null {
  if (!leave) return null;
  if (field === 'leaveDays') return leave.paidDays > 0 ? leave.paidDays : null;
  if (field === 'unpaidLeaveDays') return leave.unpaidDays > 0 ? leave.unpaidDays : null;
  return null;
}

/** What a no-show day costs, under the column: "2 days' pay each". */
export const noShowPay = (multiplier: number) => `${multiplier} ${multiplier === 1 ? "day's" : "days'"} pay each`;

/**
 * What a column's heading says under it: what a no-show day costs and that a leave day is paid, each with its hours out
 * of the expected hours (owner, 16 and 17 October 2026); null for the others.
 */
export function columnNote(field: InputField, noShowDayMultiplier: number): string | null {
  if (field === 'noShowDays') return `${noShowPay(noShowDayMultiplier)}, out of the expected hours`;
  if (field === 'leaveDays') return 'Paid, out of the expected hours';
  if (field === 'unpaidLeaveDays') return "A day's pay each, out of the expected hours";
  return null;
}

// ---------- the month's additions and deductions ----------

/**
 * A line's additions and deductions for the month, as its Earnings and Deductions columns show them (owner, 17 October
 * 2026: "instead of there, i think earnings and deductions will be enough"), from what the line was worked out with:
 * the earnings are the additions, taxed and not (a Bonus (days) as the run worked it out; on a line saved before then,
 * the bonus, commission and settlements typed on the grid), `untaxed` the part not taxed; the deductions those after
 * tax (a Penalty (days) as worked out, and the penalty days typed before then). `count`: how many additions and
 * deductions it has.
 */
export interface LineItems {
  earnings: number;
  untaxed: number;
  deductions: number;
  count: number;
}

const cents = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0);

export function lineItems(line: { terms: Pick<PayrollTerms, 'adjustments'>; result: PayrollResult }): LineItems {
  const r = line.result;
  return {
    earnings: (cents(r.bonus) + cents(r.commission) + cents(r.settlements) + cents(r.additionsTaxed) + cents(r.additionsUntaxed)) / 100 + 0,
    untaxed: cents(r.additionsUntaxed) / 100 + 0,
    deductions: (cents(r.penaltyCut) + cents(r.adjustmentDeductions)) / 100 + 0,
    count: paidAdjustments(line).length,
  };
}

/** The mark under the Earnings when some aren't taxed: "EGP 200.00 not taxed"; null when all are. */
export const untaxedNote = (items: Pick<LineItems, 'untaxed'>) => (items.untaxed > 0 ? `${formatEgp(items.untaxed)} not taxed` : null);

// ---------- the month's contracts ----------

const MONTH_ONLY = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });

/** A date's day and month name: "2026-10-14" → "14 October". */
const dayOf = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTH_ONLY.format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1)))}`;

/**
 * The days of a part of the month (YYYY-MM-DD), as the grid and a line's breakdown name them: "1–14 October", a single
 * day "31 October" (two months, which a payroll month never has: "28 September–3 October").
 */
export function dayRange(from: string, to: string): string {
  if (from === to) return dayOf(from);
  return from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))}–${dayOf(to)}` : `${dayOf(from)}–${dayOf(to)}`;
}

/** A contract as a line names it: its number and version, "CON-2026-0012 v2". */
export const contractLabel = (s: Pick<PayrollSegment, 'number' | 'version'>) => `${s.number} v${s.version}`;

/**
 * What the employee's cell says of a month under two contracts or more (owner, 17 October 2026: "take into consideration
 * the start and end date of the contract if it is in the middle of the billing period"): each one's days, "2 contracts
 * this month: CON-2025-0003 v1, 1–14 October · CON-2026-0012 v2, 15–31 October"; with one paid by the hour, that the
 * latest alone is paid, as payrollLine pays it. Null for a month on one contract, and for lines made before.
 */
export function contractsNote(terms: Pick<PayrollTerms, 'segments'>): string | null {
  const all = terms.segments ?? [];
  if (all.length < 2) return null;
  const count = `${all.length} contracts this month`;
  const hourly = all.filter((s) => s.payBasis === 'hourly').length;
  if (hourly === 0) return `${count}: ${all.map((s) => `${contractLabel(s)}, ${dayRange(s.from, s.to)}`).join(' · ')}`;
  const which = hourly === 1 ? 'one' : hourly < all.length ? String(hourly) : all.length === 2 ? 'both' : 'all';
  return `${count}, ${which} by the hour: paid on the latest, ${contractLabel(all[all.length - 1])}`;
}

// ---------- what changed ----------

/** A row as saved: what the grid compares the edits with. */
export interface GridLine {
  id: string;
  name: string;
  inputs: PayrollInputs;
  onHold: boolean;
  comments: string | null;
  /**
   * False when the line isn't the caller's to change (owner, 19 October 2026: the CEO fills the C-level people's lines,
   * HR the rest; access.ts lineEditable): its row is read only, and anything typed in it is never sent nor counted.
   * Left out: the line takes edits whenever the grid does.
   */
  editable?: boolean;
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
  // a line locked to the caller (another's to fill, 19 October 2026) is never sent
  if (!edits || line.editable === false) return { patch: null, errors: [], count: 0 };
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
      // a line saved before a field existed (the leave days, 17 October 2026) has it as not given
    } else if (parsed.value !== (line.inputs[field] ?? null)) {
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
