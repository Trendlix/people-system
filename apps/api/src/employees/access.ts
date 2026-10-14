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

/** Only HR adds, changes and deletes employees. */
export const editsEmployees = (user: SessionUser) => has(user, ['hr']);
