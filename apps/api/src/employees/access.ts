import type { Role } from '@trendlix/shared';
import { actsAs, isSuperAdmin } from '../auth/roles.js';
import type { SessionUser } from '../auth/session-user.js';

// Who sees which employees and which restricted fields (spec §1). Managers and employees are matched to their own
// employee record by their account's link (users.employee_id, 22 October 2026), never by email.

// a Super Admin counts as an Admin here, as everywhere (see auth/roles.ts)
const has = (user: SessionUser, roles: Role[]) => actsAs(user.roles, roles);

/** HR, CEO and Finance see every employee. Managers see themselves and their direct reports; anyone else, themselves. */
export const seesEveryone = (user: SessionUser) => has(user, ['hr', 'ceo', 'finance']);

/**
 * National ID: HR and CEO; never a developer (owner, 22 October 2026: "real sensitve numbers as national ids hidden"),
 * who is answered with HR's and the CEO's roles but lacks every restricted right.
 */
export const seesIdentity = (user: SessionUser) => !user.developer && has(user, ['hr', 'ceo']);

/** The employee file (the scanned paperwork, the personal photo among it): HR and CEO (owner's decision, 15 October 2026). */
export const seesEmployeeFile = (user: SessionUser) => has(user, ['hr', 'ceo']);

/** Bank and payment: HR, Finance and CEO; never a developer (22 October 2026: "Money and personal IDs" hidden). */
export const seesBank = (user: SessionUser) => !user.developer && has(user, ['hr', 'finance', 'ceo']);

/** Salaries (contracts): HR, Finance and CEO, like bank details (owner's decisions, 15 October 2026). */
export const seesSalary = seesBank;

/**
 * Who sees a person's contracts on their profile (owner, 31 October 2026: "show no contract details anywhere in an
 * employee profile"): HR, the CEO, Finance and a Super Admin; never the employee themself or their manager.
 */
export const seesContracts = (user: SessionUser) => has(user, ['hr', 'ceo', 'finance']) || user.roles.includes('super_admin');

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

/**
 * The employee themself: the profile their account is linked to (users.employee_id; owner, 22 October 2026: "any active
 * employee with active contract should have access"), never matched by email any more.
 */
export const isSelf = (user: SessionUser, employee: { id: string }) => !!user.employeeId && user.employeeId === employee.id;
