import { CONFIDENTIAL_NOTE, decidesConfidentialStage, type Role } from '@trendlix/shared';
import { hasRole } from './roles';

// C-level people kept from HR (owner, 19 October 2026: "make C level Employees details not visible to HR"), on the
// screens: who is left as a directory card, the pickers of HR's actions without them, the requests whose HR (and
// Finance) stage the CEO decides worded so, and who gets the decide buttons. The rules are @trendlix/shared's
// (confidential.ts), which the API decides with: hiding is a convenience, the API answers 404 or 403 whatever the screen
// shows. Pure code (no server-only), so client components and tests can use it too; tested in confidential.test.ts.

type WithRoles = { roles: readonly Role[] };

/** A row or a profile of a C-level person that the caller sees only the directory card of (`restricted`, from the API). */
export const isRestricted = <T extends { restricted?: boolean }>(row: T): row is Extract<T, { restricted: true }> => row.restricted === true;

/**
 * The people an HR action can be taken on (a leave recorded for them, a raise asked, an addition, a document …): all but
 * the C-level people the caller sees only the card of, whom the API refuses any action on.
 */
export function actionablePeople<T extends { restricted?: boolean }>(rows: readonly T[]): Exclude<T, { restricted: true }>[] {
  return rows.filter((r): r is Exclude<T, { restricted: true }> => r.restricted !== true);
}

/**
 * What the "C-level" mark beside a person says when pointed at: for a card, that only the CEO and the Super Admin see
 * the rest (CONFIDENTIAL_NOTE); for someone the caller sees in full (the CEO, a Super Admin, the person themself), that
 * the others see only the card.
 */
export const cLevelTitle = (restricted: boolean | null | undefined): string =>
  restricted === true ? CONFIDENTIAL_NOTE : 'C-level: HR and the others see only their directory card.';

/** What a C-level person's request waiting at HR's or Finance's stage says instead: the CEO decides it (19 October 2026). */
export const WITH_THE_CEO = 'With the CEO';

/** The statuses of the stages HR and Finance decide, which are the CEO's for a C-level person. */
const STAFF_STAGES: ReadonlySet<string> = new Set(['with_hr', 'with_finance']);

/**
 * A request's status as shown: its label ("With HR", "With Finance" …), but "With the CEO" for a C-level person's
 * request at HR's or Finance's stage (`confidential`, from the API). Leave requests, reimbursement claims and raise
 * requests alike.
 */
export function requestStatusLabel(status: string, label: string, confidential: boolean | null | undefined): string {
  return confidential === true && STAFF_STAGES.has(status) ? WITH_THE_CEO : label;
}

/**
 * Whether the user decides a request's HR stage: HR; for a C-level person's (`confidential`) the CEO, or HR with Super
 * Admin (decidesConfidentialStage). The API checks it again, and `waitingForYou` says it where a view has it.
 */
export function decidesHrStage(user: WithRoles, confidential: boolean | null | undefined): boolean {
  return confidential === true ? decidesConfidentialStage(user, ['hr']) : hasRole(user, 'hr');
}

/**
 * Whether the user approves or rejects an employee's change of details: HR and Admin (a Super Admin too, owner's
 * decision of 15 October 2026); for a C-level person's (`confidential`), the CEO, or a Super Admin (who counts as an
 * Admin), not HR (19 October 2026).
 */
export function decidesChangeOfDetails(user: WithRoles, confidential: boolean | null | undefined): boolean {
  return confidential === true ? decidesConfidentialStage(user, ['hr', 'admin']) : hasRole(user, 'hr', 'admin');
}
