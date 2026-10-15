import type { Role } from '@trendlix/shared';
import type { SessionUser } from '../auth/session-user.js';

// Who sees which employees and which restricted fields (spec §1). Managers and employees are matched to their own
// employee record by work email: a sign-in account whose email is an employee's work email is that employee.

const has = (user: SessionUser, roles: Role[]) => user.roles.some((r) => roles.includes(r));

/** HR, CEO and Finance see every employee. Managers see themselves and their direct reports; anyone else, themselves. */
export const seesEveryone = (user: SessionUser) => has(user, ['hr', 'ceo', 'finance']);

/** National ID: HR and CEO. */
export const seesIdentity = (user: SessionUser) => has(user, ['hr', 'ceo']);

/** Bank and payment: HR, Finance and CEO. */
export const seesBank = (user: SessionUser) => has(user, ['hr', 'finance', 'ceo']);

/** Salaries (contracts): HR, Finance and CEO, like bank details (owner's decisions, 15 October 2026). */
export const seesSalary = seesBank;

/** Only HR adds and changes employees. */
export const editsEmployees = (user: SessionUser) => has(user, ['hr']);

/** HR and Admin (the top role) can delete an employee record, e.g. one added by mistake. */
export const deletesEmployees = (user: SessionUser) => has(user, ['hr', 'admin']);

/**
 * How an employment ends (its ending, with the CEO's decision and note): HR, Admin and the CEO only, not the employee
 * nor their manager (contracts review, 15 October 2026), so a termination waiting for the CEO never reaches the
 * employee before the CEO decides.
 */
export const seesEndings = (user: SessionUser) => has(user, ['hr', 'admin', 'ceo']);

/** An employee's change requests: HR, Admin and the CEO, besides the employee themself (owner's decision, 15 October 2026). */
export const seesChangeRequests = (user: SessionUser) => has(user, ['hr', 'admin', 'ceo']);

/** The employee themself: a sign-in account whose email is the profile's work email. */
export const isSelf = (user: SessionUser, employee: { workEmail: string | null }) =>
  !!employee.workEmail && employee.workEmail === user.email.toLowerCase();
