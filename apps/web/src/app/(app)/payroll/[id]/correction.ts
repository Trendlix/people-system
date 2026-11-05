import type { PayrollInputs } from '@trendlix/shared';
import { formatDate } from '../../../../lib/format';
import type { PayrollLineCorrection, PayrollLineView } from '../../../../lib/types';
import { formatEgp } from '../../employees/[id]/contracts/salary';
import { cellText, fieldLabel, fromImport, GRID_COLUMNS, importMarkText, leaveFill, parseCell, permissionFill, type GridColumn, type InputField } from './grid';

// Correcting a line of an approved or paid run (owner, 5 November 2026: "batches sent to the back employees are not to be
// selected again instead there is an edit and they have remaining payment"; asked, "if there was a problem in the
// employee calculation and has been edited", "Payslip and register too"): the figures the draft's grid types (never the
// expected hours, always worked out), each prefilled as the line has it, an imported one too (a correction may change
// it: the API takes it off the import's mark), and why. Only the figures changed are sent; the API works the line out
// again, the register and the payslip follow, and the bank batches pay what is left of the new transfer. Pure code,
// tested; relative imports, as vitest doesn't know the @/ paths.

/** The figures a correction changes: the grid's typed columns. */
export const CORRECTION_FIELDS: readonly GridColumn[] = GRID_COLUMNS.filter((c) => !c.workedOut);

export const REASON_MAX = 500;

type CorrectedLine = Pick<PayrollLineView, 'inputs' | 'terms' | 'attendanceImport'>;

/** Each figure as its field starts: the line's saved value as the grid shows it (empty: none typed). */
export function correctionStart(line: Pick<CorrectedLine, 'inputs'>): Record<InputField, string> {
  const inputs = line.inputs as Partial<Record<InputField, number | null>>;
  return Object.fromEntries(CORRECTION_FIELDS.map((c) => [c.field, cellText(c.kind, inputs[c.field] ?? null)])) as Record<InputField, string>;
}

/**
 * What a field says under it: where its figure came from when none is typed (the leave's days, the permission hours
 * approved), or that an import filled it ("from Zoho: corrected here, it is no longer"); null for nothing to say.
 */
export function correctionHint(line: CorrectedLine, c: GridColumn): string | null {
  if (fromImport(line.attendanceImport, c.field)) return `${importMarkText(line.attendanceImport?.source)}: a correction here replaces it`;
  const inputs = line.inputs as Partial<Record<InputField, number | null>>;
  if ((inputs[c.field] ?? null) !== null) return null;
  const leave = leaveFill(line.terms.leave, c.field);
  if (leave !== null) return `Empty: ${cellText(c.kind, leave)} from leave`;
  const permission = permissionFill(line.terms.permissionHours, c.field);
  if (permission !== null) return `Empty: ${cellText(c.kind, permission)} from permissions`;
  return null;
}

/**
 * The correction as typed: only the figures changed from the line's (a field emptied sends null), and the reason; or
 * what to put right first, in words.
 */
export function correctionOf(
  line: Pick<CorrectedLine, 'inputs'>,
  typed: Partial<Record<InputField, string>>,
  reason: string,
): { ok: true; inputs: Partial<PayrollInputs>; reason: string } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const inputs: Partial<Record<InputField, number | null>> = {};
  const saved = line.inputs as Partial<Record<InputField, number | null>>;
  for (const c of CORRECTION_FIELDS) {
    const parsed = parseCell(c.kind, typed[c.field] ?? '');
    if (!parsed.ok) {
      errors.push(`${fieldLabel(c.field)}: ${parsed.error}`);
      continue;
    }
    if (parsed.value !== (saved[c.field] ?? null)) inputs[c.field] = parsed.value;
  }
  const why = reason.trim();
  if (!why) errors.push('Write why the line is corrected.');
  else if (why.length > REASON_MAX) errors.push(`Keep the reason to ${REASON_MAX} characters or fewer.`);
  if (!errors.length && !Object.keys(inputs).length) errors.push('Change at least one figure to correct the line.');
  return errors.length ? { ok: false, errors } : { ok: true, inputs: inputs as Partial<PayrollInputs>, reason: why };
}

/** A correction under its line: "Corrected 05/11/2026 by Sara Ali: Overtime missed · transfer EGP 9,000.00 → EGP 10,000.00". */
export function correctionText(c: PayrollLineCorrection): string {
  const by = c.by ? ` by ${c.by}` : '';
  return `Corrected ${formatDate(c.at)}${by}: ${c.reason} · transfer ${formatEgp(c.transferFrom)} → ${formatEgp(c.transferTo)}`;
}
