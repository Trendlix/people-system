import type { Role } from '@trendlix/shared';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';

// Who sees which employees and which restricted fields (spec §1). Managers and employees are matched to their own
// employee record by work email: a sign-in account whose email is an employee's work email is that employee.

// a Super Admin counts as an Admin here, as everywhere (see auth/roles.ts)
const has = (user: SessionUser, roles: Role[]) => actsAs(user.roles, roles);

/** HR, CEO and Finance see every employee. Managers see themselves and their direct reports; anyone else, themselves. */
export const seesEveryone = (user: SessionUser) => has(user, ['hr', 'ceo', 'finance']);

/** National ID: HR and CEO. */
export const seesIdentity = (user: SessionUser) => has(user, ['hr', 'ceo']);

/** The employee file (the scanned paperwork, the personal photo among it): HR and CEO (owner's decision, 15 October 2026). */
export const seesEmployeeFile = (user: SessionUser) => has(user, ['hr', 'ceo']);

/** Bank and payment: HR, Finance and CEO. */
export const seesBank = (user: SessionUser) => has(user, ['hr', 'finance', 'ceo']);

/** Salaries (contracts): HR, Finance and CEO, like bank details (owner's decisions, 15 October 2026). */
export const seesSalary = seesBank;

/** Only HR adds and changes employees. */
export const editsEmployees = (user: SessionUser) => has(user, ['hr']);

/**
 * Deleting an employee record, e.g. one added by mistake: a Super Admin only, like every other deletion (owner's
 * decision, 15 October 2026). Before, HR and Admin could.
 */
export const deletesEmployees = (user: SessionUser) => isSuperAdmin(user);

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
