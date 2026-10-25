// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"). Asked, the
// owner chose: C-level is everyone whose grade is G9 · Executive, by a flag on the grade (Grade.confidential, which a
// Super Admin ticks on the grades page), so it follows the grade, not a person: changing someone's grade changes it.
// Those who may not see a C-level person (HR, Finance, Admin, managers) get only the directory card: name, photo, job
// title, department or team, work email, employee code and where they stand. Not their personal details, national ID,
// bank, social insurance, papers and documents, contracts and pay, raises, salary history, payslips, payroll lines,
// advances, loans and recurring deductions, reimbursements, leave balances. Who sees and manages them instead: the CEO
// and the Super Admin (not Finance), and the person themself. Payroll: their lines are hidden from HR (one row "C-level
// (N people) — hidden", the totals without them), the CEO fills their inputs and approves the run as now. The stages HR
// (and Finance) decide of a C-level person's requests go to the CEO. Pure: the web shows these and the API decides with
// the same, returning 404 for a C-level person's restricted records as for anyone not visible.

import type { Role } from './index.js';

type Roles = { roles: readonly Role[] };

/** What C-level people are called on the screens. */
export const CONFIDENTIAL_LABEL = 'C-level';

/** The note beside a C-level person's card, for those who see only the card. */
export const CONFIDENTIAL_NOTE = 'C-level: only the CEO and the Super Admin see the rest.';

/** The grade the C-level migration marks confidential: G9 · Executive (rank 9 in the owner's table, 14 October 2026). */
export const CONFIDENTIAL_GRADE_RANK = 9;

/**
 * Who may see C-level people's details and manage them: the CEO and the Super Admin (owner, 19 October 2026: "the CEO
 * and the Super Admin", not Finance). The person themself sees their own as always (the API matches them by work email).
 * It only narrows: a Super Admin without HR still can't do what only HR does (auth/roles.ts).
 */
export const seesConfidential = (user: Roles): boolean => user.roles.includes('ceo') || user.roles.includes('super_admin');

/** Whether a grade makes those holding it C-level. */
export const isConfidentialGrade = (grade: { confidential?: boolean | null } | null | undefined): boolean => grade?.confidential === true;

/** "C-level (1 person)", "C-level (3 people)". */
export const confidentialPeople = (count: number): string => `${CONFIDENTIAL_LABEL} (${count} ${count === 1 ? 'person' : 'people'})`;

/** The payroll run's row for the lines hidden from the caller: "C-level (2 people) — hidden". */
export const hiddenLinesLabel = (count: number): string => `${confidentialPeople(count)} — hidden`;

/**
 * What a page, a report or a download says when C-level people are left out for the caller (none: null): "C-level (2
 * people) are left out: only the CEO and the Super Admin see their amounts." `what` they see instead of their amounts:
 * "contracts" on the Contracts report (25 October 2026), which has no amounts.
 */
export function confidentialExcludedNote(count: number, what = 'amounts'): string | null {
  if (!(count > 0)) return null;
  return `${confidentialPeople(count)} ${count === 1 ? 'is' : 'are'} left out: only the CEO and the Super Admin see their ${what}.`;
}

/** Whether these roles hold `role` as the guards count it: a Super Admin counts as an Admin (auth/roles.ts actsAs). */
const holds = (roles: readonly Role[], role: Role) => roles.includes(role) || (role === 'admin' && roles.includes('super_admin'));

/**
 * Who decides a stage that one of `stageRoles` decides (HR's, Finance's, or HR's and Admin's for a change of details) of a
 * C-level person's request (owner, 19 October 2026: their HR stages go to the CEO): the CEO, or someone holding that
 * role who sees C-level people (a Super Admin with it; for a change of details a Super Admin, who counts as an Admin).
 * Nobody their own: the services check that apart.
 */
export function decidesConfidentialStage(user: Roles, stageRoles: readonly Role[]): boolean {
  return user.roles.includes('ceo') || (seesConfidential(user) && stageRoles.some((r) => holds(user.roles, r)));
}

/**
 * Who changes a payroll line's inputs, holds and comments while the run is a draft: HR, except a C-level person's line,
 * which the CEO fills (owner, 19 October 2026: "the CEO fills their inputs"), or HR who sees C-level people (HR with
 * Super Admin).
 */
export function changesPayrollLine(user: Roles, confidentialLine: boolean): boolean {
  const hr = user.roles.includes('hr');
  if (!confidentialLine) return hr;
  return user.roles.includes('ceo') || (hr && seesConfidential(user));
}

/**
 * Who sets a C-level grade on an employment or a job offer, or a raise's promotion to one, or ticks a grade confidential:
 * only those who see C-level people (owner, 19 October 2026: else HR could hide or unhide someone by their grade). The
 * grade's flag itself is a Super Admin's (the grades page).
 */
export const setsConfidentialGrade = (user: Roles): boolean => seesConfidential(user);

/** Who ticks a grade C-level on the grades page: a Super Admin only. */
export const marksConfidentialGrade = (user: Roles): boolean => user.roles.includes('super_admin');
