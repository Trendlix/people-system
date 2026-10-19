import { confidentialExcludedNote, confidentialPeople, hiddenLinesLabel, type PayrollStatus } from '@trendlix/shared';

// Who changes which line of a run, and what the run's page says of the lines kept from the caller (owner, 19 October
// 2026: "make C level Employees details not visible to HR"). The C-level people's lines (their grade is G9 · Executive)
// are hidden from HR, Finance and the rest: the page shows one row for them, "C-level (2 people) — hidden", with no
// figures, and its totals, bank files, register and payslips leave them out (the API does that). The CEO and the Super
// Admin see those lines, marked C-level, and the CEO fills their inputs while the run is a draft, HR the rest (owner,
// 19 October 2026: "the CEO fills their inputs"). Each line says whether the caller changes it (`editable`: the API's
// changesPayrollLine in @trendlix/shared); an API from before it leaves that out, and then HR changes every line of a
// draft, as before. Pure code, tested; relative imports, as vitest doesn't know the @/ paths.

/** What a line says of who sees and fills it; both left out by an API from before 19 October 2026. */
export interface LineAccess {
  confidential?: boolean;
  editable?: boolean;
}

/**
 * Whether the caller changes this line's inputs, hold and comments now: as the API says (a draft, and the line theirs
 * to fill: HR's, or a C-level person's the CEO's), else the run's rule (`runLevel`: HR, on a draft).
 */
export const lineEditable = (line: LineAccess, runLevel: boolean): boolean => line.editable ?? runLevel;

/** Whether any line is the caller's to change: the grid then takes edits, with Save changes. */
export const anyEditable = (lines: readonly LineAccess[], runLevel: boolean): boolean => lines.some((l) => lineEditable(l, runLevel));

type Hidden = { hidden?: { count: number; label?: string } | null };

/** How many of the run's lines are hidden from the caller: none when the API says none, or doesn't say. */
export const hiddenCount = (run: Hidden): number => (run.hidden && run.hidden.count > 0 ? run.hidden.count : 0);

/** The row standing for the lines hidden from the caller, as the API names it: "C-level (2 people) — hidden"; null for none. */
export function hiddenRowLabel(run: Hidden): string | null {
  const n = hiddenCount(run);
  if (!n) return null;
  return run.hidden?.label?.trim() || hiddenLinesLabel(n);
}

/** Beside the hidden row on the grid of the month's figures. */
export const HIDDEN_INPUTS_NOTE = 'Only the CEO and the Super Admin see their lines; the CEO fills them.';

/** Beside the hidden row on the pay. */
export const HIDDEN_PAY_NOTE = 'Not in the totals: only the CEO and the Super Admin see their pay.';

/** The C-level mark's title on a line, for those who see it (the CEO, a Super Admin). */
export const CONFIDENTIAL_LINE_TITLE = 'C-level: only the CEO and the Super Admin see this line, and the CEO fills it.';

/**
 * Under the run's totals, when lines are hidden from the caller: "The totals leave out C-level (2 people): only the CEO
 * and the Super Admin see their lines."; null for none.
 */
export function hiddenTotalsNote(count: number): string | null {
  if (!(count > 0)) return null;
  return `The totals leave out ${confidentialPeople(count)}: only the CEO and the Super Admin see their lines.`;
}

/** The Employees card's note: those left out of the run, and the C-level lines hidden ("1 left out · C-level (2 people) hidden"). */
export function employeesNote(excluded: number, hidden: number): string | undefined {
  const parts = [excluded > 0 && `${excluded} left out`, hidden > 0 && `${confidentialPeople(hidden)} hidden`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * By the run's files (the register, the CIB and ACH files, the payslips): that those the caller downloads leave the
 * hidden people out ("C-level (2 people) are left out: only the CEO and the Super Admin see their amounts."); null when
 * nothing is hidden: the CEO and the Super Admin download them complete.
 */
export const filesNote = (run: Hidden): string | null => confidentialExcludedNote(hiddenCount(run));

/** Who a figure typed on a line is marked as typed by: the CEO on a C-level person's line (19 October 2026), HR on the others. */
export const typist = (confidential: boolean | undefined): string => (confidential ? 'the CEO' : 'HR');

/**
 * What the Monthly Figures heading says of who changes them: once the run is with the CEO or approved, that they are
 * locked; on a draft, HR types them, the CEO the C-level people's (owner, 19 October 2026), worded for the caller: the
 * CEO is told which lines are theirs, HR that the CEO fills those hidden from them. `runLevel`: the run's rule (HR, on a
 * draft), for an API that doesn't say per line; `hidden`: how many lines are hidden from the caller.
 */
export function figuresNote(status: PayrollStatus, lines: readonly LineAccess[], runLevel: boolean, hidden: number): string {
  if (status === 'pending_ceo') return 'With the CEO: the figures can’t be changed unless the CEO returns it.';
  if (status !== 'draft') return 'Approved: the figures are locked.';
  const typedByHr = 'Typed by HR until attendance fills them';
  if (lines.length === 0) return hidden > 0 ? 'The CEO fills the C-level people’s lines.' : runLevel ? `${typedByHr}.` : 'Only HR types the month’s figures.';
  const mine = lines.filter((l) => lineEditable(l, runLevel));
  const cLevel = lines.some((l) => l.confidential === true);
  if (mine.length === 0) return cLevel || hidden > 0 ? 'Only HR types the month’s figures, and the CEO the C-level people’s.' : 'Only HR types the month’s figures.';
  if (mine.length === lines.length) {
    if (hidden > 0) return `${typedByHr}; the CEO fills the C-level people’s lines.`;
    return cLevel ? `${typedByHr}; the C-level people’s lines, marked C-level, by the CEO.` : `${typedByHr}.`;
  }
  // some lines are the caller's and some not: the CEO's are the C-level people's
  if (mine.every((l) => l.confidential === true)) return 'The C-level people’s lines, marked C-level, are yours to fill; HR types the rest until attendance fills them.';
  return 'Only the lines open to you can be changed: HR types the month’s figures, and the CEO the C-level people’s.';
}
