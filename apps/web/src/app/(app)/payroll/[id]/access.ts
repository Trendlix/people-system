import { confidentialPeople, hiddenLinesLabel, type PayrollStatus } from '@trendlix/shared';

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

/** The C-level mark's title on a line, for those who see it (the CEO, a Super Admin). */
export const CONFIDENTIAL_LINE_TITLE = 'C-level: only the CEO and the Super Admin see this line, and the CEO fills it.';

/** The Employees card's note: those left out of the run, and the C-level lines hidden ("1 left out · C-level (2 people) hidden"). */
export function employeesNote(excluded: number, hidden: number): string | undefined {
  const parts = [excluded > 0 && `${excluded} left out`, hidden > 0 && `${confidentialPeople(hidden)} hidden`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** Who a figure typed on a line is marked as typed by: the CEO on a C-level person's line (19 October 2026), HR on the others. */
export const typist = (confidential: boolean | undefined): string => (confidential ? 'the CEO' : 'HR');

/** Beside the Monthly Figures heading once the run is locked: with the CEO, or approved; null on a draft. */
export function figuresNote(status: PayrollStatus): string | null {
  if (status === 'draft') return null;
  return status === 'pending_ceo' ? 'Locked while with the CEO.' : 'Approved: the figures are locked.';
}
